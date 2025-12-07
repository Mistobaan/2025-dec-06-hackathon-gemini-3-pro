"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GroundedSkybox } from "three/examples/jsm/objects/GroundedSkybox.js";
import { EditorCameraPreset, EditorTransformMode, SceneGraph, SceneObject } from "@/lib/scene/types";
import { editorCommands } from "@/lib/editor/commands";
import { SceneEditorEvent, sceneEditorEvents } from "@/lib/editor/events";

import type { OrbitControls } from "@/lib/editor/controls/OrbitControls.js";
import type { TransformControls } from "@/lib/editor/controls/TransformControls.js";

const presets: Record<EditorCameraPreset, THREE.Vector3> = {
  home: new THREE.Vector3(6, 4, 6),
  front: new THREE.Vector3(0, 0, 10),
  side: new THREE.Vector3(10, 0, 0),
  top: new THREE.Vector3(0, 10, 0),
};

type PerspectiveLike = THREE.Camera & { isPerspectiveCamera?: boolean; aspect: number; updateProjectionMatrix: () => void };
type OrthographicLike = THREE.Camera & {
  isOrthographicCamera?: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  updateProjectionMatrix: () => void;
};
type OrbitControlsCtor = new (object: THREE.Object3D, domElement?: HTMLElement | null) => OrbitControls;
type TransformControlsCtor = new (camera: THREE.Camera, domElement?: HTMLElement | null) => TransformControls;

const isCameraObject = (object: THREE.Object3D): object is THREE.Camera =>
  (object as { isCamera?: boolean }).isCamera === true;

const isPerspectiveCamera = (camera: THREE.Camera): camera is PerspectiveLike =>
  (camera as PerspectiveLike).isPerspectiveCamera === true;

const isOrthographicCamera = (camera: THREE.Camera): camera is OrthographicLike =>
  (camera as OrthographicLike).isOrthographicCamera === true;

type SceneEditorCanvasProps = {
  scene?: SceneGraph | null;
  defaultCameraTag?: string;
  selectableObjects?: SceneObject[];
  onEvent?: (event: SceneEditorEvent) => void;
};

export function SceneEditorCanvas({
  scene,
  defaultCameraTag,
  selectableObjects,
  onEvent,
}: SceneEditorCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const activeCameraRef = useRef<THREE.Camera | null>(null);
  const selectedRef = useRef<SceneObject | null>(null);
  const transformModeRef = useRef<EditorTransformMode>("translate");
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const groundedSkyboxRef = useRef<THREE.Object3D | null>(null);
  const activeSkyboxTextureRef = useRef<THREE.Texture | null>(null);
  const boundingHelpersRef = useRef<Map<string, THREE.Box3Helper>>(new Map());
  const objectIndexRef = useRef<Map<string, SceneObject>>(new Map());
  const orthoFrustumHeights = useRef<WeakMap<THREE.Camera, number>>(new WeakMap());
  const controlConstructors = useRef<{
    OrbitControls: OrbitControlsCtor | null;
    TransformControls: TransformControlsCtor | null;
  }>({
    OrbitControls: null,
    TransformControls: null,
  });
  const sceneGraph = scene ?? null;
  const textureLoader = useMemo(() => new THREE.TextureLoader(), []);
  const textureCache = useMemo(() => new Map<string, THREE.Texture>(), []);

  const objects = useMemo<SceneObject[]>(() => {
    if (!sceneGraph?.objects) return [];
    if (selectableObjects?.length) return selectableObjects;

    return sceneGraph.objects.filter((child) => {
      if (child.object3d.type === "TransformControls" || child.object3d.type === "OrbitControls") return false;
      if ((child.object3d as { isCamera?: boolean }).isCamera) return false;
      return true;
    });
  }, [sceneGraph, selectableObjects]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<EditorTransformMode>("translate");
  const [skyboxUrl, setSkyboxUrl] = useState<string | null>(sceneGraph?.skybox?.textureUrl ?? null);
  const [skyboxHeight, setSkyboxHeight] = useState<number>(sceneGraph?.skybox?.height ?? 15);
  const [skyboxRadius, setSkyboxRadius] = useState<number>(sceneGraph?.skybox?.radius ?? 100);
  const [skyboxResolution, setSkyboxResolution] = useState<number>(sceneGraph?.skybox?.resolution ?? 32);
  const [skyboxLoading, setSkyboxLoading] = useState(false);
  const [localSkyboxes, setLocalSkyboxes] = useState<Array<{ label: string; textureUrl: string }>>([]);

  const cameras = useMemo<SceneObject[]>(() => {
    if (!sceneGraph?.objects) return [];
    return sceneGraph.objects.filter((child) => isCameraObject(child.object3d));
  }, [sceneGraph]);

  const availableSkyboxes = useMemo(() => {
    const fromScene = sceneGraph?.skybox?.availableTextures ?? [];
    const merged = [...fromScene];

    localSkyboxes.forEach((option) => {
      if (!merged.some((existing) => existing.textureUrl === option.textureUrl)) {
        merged.push(option);
      }
    });

    return merged;
  }, [localSkyboxes, sceneGraph]);

  const emitEvent = useCallback(
    (event: SceneEditorEvent) => {
      sceneEditorEvents.emit(event);
      onEvent?.(event);
    },
    [onEvent]
  );

  useEffect(() => {
    const nextIndex = new Map<string, SceneObject>();
    objects.forEach((obj) => nextIndex.set(obj.id, obj));
    objectIndexRef.current = nextIndex;
  }, [objects]);

  const configureCameraForViewport = useCallback(
    (camera: THREE.Camera) => {
      const mount = mountRef.current;
      if (!mount) return;

      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;

      if (isPerspectiveCamera(camera)) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }

      if (isOrthographicCamera(camera)) {
        const storedHeight =
          orthoFrustumHeights.current.get(camera) ?? (Math.abs(camera.top - camera.bottom) || 10);
        orthoFrustumHeights.current.set(camera, storedHeight);
        const halfHeight = storedHeight / 2;
        const halfWidth = halfHeight * (width / height);
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
      }
    },
    []
  );

  useEffect(() => {
    setSkyboxUrl(sceneGraph?.skybox?.textureUrl ?? null);
    setSkyboxHeight(sceneGraph?.skybox?.height ?? 15);
    setSkyboxRadius(sceneGraph?.skybox?.radius ?? 100);
    setSkyboxResolution(sceneGraph?.skybox?.resolution ?? 32);
  }, [sceneGraph]);

  useEffect(() => {
    let cancelled = false;

    const loadLocalSkyboxes = async () => {
      try {
        const response = await fetch("/api/skyboxes");
        if (!response.ok) return;

        const data = (await response.json()) as { skyboxes?: Array<{ label: string; textureUrl: string }> };
        if (!cancelled && Array.isArray(data.skyboxes)) {
          setLocalSkyboxes(data.skyboxes);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to list local skyboxes", error);
          setLocalSkyboxes([]);
        }
      }
    };

    loadLocalSkyboxes();

    return () => {
      cancelled = true;
    };
  }, []);

  const disposeGroundedSkybox = useCallback(() => {
    const graphScene = sceneGraph?.scene;
    const grounded = groundedSkyboxRef.current as THREE.Mesh | null;
    if (graphScene && grounded) {
      graphScene.remove(grounded);
    }

    if (grounded) {
      const material = (grounded as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose());
      } else {
        material?.dispose();
      }
      (grounded as unknown as { geometry?: THREE.BufferGeometry }).geometry?.dispose?.();
    }

    groundedSkyboxRef.current = null;
  }, [sceneGraph]);

  const rebuildSkybox = useCallback(
    (texture: THREE.Texture, overrides?: { height?: number; radius?: number }) => {
      const graphScene = sceneGraph?.scene;
      if (!graphScene) return;

      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      graphScene.environment = texture;
      activeSkyboxTextureRef.current = texture;

      disposeGroundedSkybox();

      const height = overrides?.height ?? skyboxHeight;
      const radius = overrides?.radius ?? skyboxRadius;
      const resolution = skyboxResolution || 32;
      const grounded = new GroundedSkybox(texture, height, radius, resolution);
      grounded.position.y = height - 0.01;
      graphScene.add(grounded);
      groundedSkyboxRef.current = grounded;
    },
    [disposeGroundedSkybox, sceneGraph, skyboxHeight, skyboxRadius, skyboxResolution]
  );

  const loadSkyboxFromUrl = useCallback(
    (url: string | null) => {
      if (!url) return;

      const cached = textureCache.get(url);
      setSkyboxLoading(true);

      if (cached) {
        rebuildSkybox(cached);
        setSkyboxLoading(false);
        return;
      }

      textureLoader.load(
        url,
        (texture) => {
          textureCache.set(url, texture);
          rebuildSkybox(texture);
          setSkyboxLoading(false);
        },
        undefined,
        () => {
          setSkyboxLoading(false);
        }
      );
    },
    [rebuildSkybox, textureCache, textureLoader]
  );

  useEffect(() => {
    loadSkyboxFromUrl(skyboxUrl);
  }, [loadSkyboxFromUrl, skyboxUrl]);

  useEffect(() => {
    if (!activeSkyboxTextureRef.current) return;
    rebuildSkybox(activeSkyboxTextureRef.current, {
      height: skyboxHeight,
      radius: skyboxRadius,
    });
  }, [rebuildSkybox, skyboxHeight, skyboxRadius, skyboxResolution]);

  useEffect(() => {
    const graphScene = sceneGraph?.scene;
    if (!graphScene) return;

    const helpers = boundingHelpersRef.current;
    helpers.forEach((helper) => graphScene.remove(helper));
    helpers.clear();

    const characters = objects.filter(
      (obj) => obj.tags?.includes("type:character") || Boolean(obj.bounds)
    );

    characters.forEach((character) => {
      const helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(character.bounds?.color ?? 0x22c55e));
      helper.name = `${character.name} Bounds`;
      graphScene.add(helper);
      helpers.set(character.id, helper);
    });

    return () => {
      helpers.forEach((helper) => graphScene.remove(helper));
      helpers.clear();
    };
  }, [objects, sceneGraph]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const graphScene = sceneGraph?.scene;
    if (!graphScene) {
      console.error("SceneEditorCanvas: no scene provided");
      return;
    }
    let orbit: OrbitControls | null = null;
    let transform: TransformControls | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let cancelled = false;
    const cleanupListeners: Array<() => void> = [];

    (async () => {
      const [orbitModule, transformModule] = await Promise.all([
        import("@/lib/editor/controls/OrbitControls.js"),
        import("@/lib/editor/controls/TransformControls.js"),
      ]);

      if (cancelled) return;

      const OrbitCtor =
        orbitModule.OrbitControls ?? (orbitModule as { default?: typeof OrbitControls }).default ?? null;
      const TransformCtor =
        transformModule.TransformControls ??
        (transformModule as { default?: typeof TransformControls }).default ??
        null;

      if (!OrbitCtor || !TransformCtor) {
        console.error("Failed to load three.js control constructors", {
          OrbitCtorLoaded: Boolean(OrbitCtor),
          TransformCtorLoaded: Boolean(TransformCtor),
        });
        return;
      }

      const orbitConstructor = OrbitCtor as unknown as OrbitControlsCtor;
      const transformConstructor = TransformCtor as unknown as TransformControlsCtor;

      if (!(transformConstructor.prototype instanceof THREE.Object3D)) {
        Object.setPrototypeOf(transformConstructor.prototype, THREE.Object3D.prototype);
        Object.defineProperty(transformConstructor.prototype, "constructor", { value: transformConstructor });

        const transformPrototype = transformConstructor.prototype as unknown as THREE.Object3D;
        Object.defineProperty(transformPrototype, "isObject3D", { value: true });
      }

      controlConstructors.current = {
        OrbitControls: orbitConstructor,
        TransformControls: transformConstructor,
      };

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.shadowMap.enabled = true;
      mount.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const taggedDefault = defaultCameraTag ? sceneGraph?.getFirstByTag(defaultCameraTag) : null;
      const taggedCamera = taggedDefault && isCameraObject(taggedDefault.object3d) ? taggedDefault.object3d : null;
      const fallbackCamera = cameras.find((entry) => isCameraObject(entry.object3d))?.object3d ?? null;

      const chosenCamera = taggedCamera ?? fallbackCamera;

      if (!chosenCamera || !isCameraObject(chosenCamera)) {
        console.error("SceneEditorCanvas: no camera available in the provided scene");
        return;
      }

      activeCameraRef.current = chosenCamera;
      configureCameraForViewport(chosenCamera);

      orbit = new orbitConstructor(activeCameraRef.current!, renderer.domElement);
      orbit.enableDamping = true;
      orbit.target.set(0, 1, 0);
      orbitRef.current = orbit;

      transform = new transformConstructor(activeCameraRef.current!, renderer.domElement);
      transform.setMode("translate");
      transform.addEventListener("mouseDown", () => {
        if (orbitRef.current) orbitRef.current.enabled = false;
        emitEvent({ type: "transform-start", object: selectedRef.current, mode: transformModeRef.current });
      });
      transform.addEventListener("mouseUp", () => {
        if (orbitRef.current) orbitRef.current.enabled = true;
        emitEvent({ type: "transform-end", object: selectedRef.current, mode: transformModeRef.current });
      });
      transform.addEventListener("objectChange", () => {
        emitEvent({ type: "transform-change", object: selectedRef.current, mode: transformModeRef.current });
      });

      const transformObject = transform as unknown as THREE.Object3D & {
        isObject3D?: boolean;
      };

      if (transformObject.isObject3D ?? true) {
        graphScene.add(transformObject);
        transformRef.current = transform;
      } else {
        console.error("TransformControls did not initialize as an Object3D", transform);
      }

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();

      const onPointerDown = (event: PointerEvent) => {
        const rect = renderer!.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointer, activeCameraRef.current!);
        const hits = raycaster.intersectObjects(objects.map((o) => o.object3d));
        if (hits.length) {
          const hit = hits[0].object;
          const found = objects.find((o) => o.object3d === hit || o.object3d.children.includes(hit));
          if (found && transformRef.current) {
            setSelectedId(found.id);
            selectedRef.current = found;
            transformRef.current.attach(found.object3d);
            emitEvent({ type: "select", object: found });
          }
        } else {
          setSelectedId(null);
          transformRef.current?.detach();
          selectedRef.current = null;
          emitEvent({ type: "deselect" });
        }
      };

      const handleResize = () => {
        const width = mount.clientWidth;
        const height = mount.clientHeight;
        renderer!.setSize(width, height);
        const camera = activeCameraRef.current;
        if (camera) configureCameraForViewport(camera);
      };

      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      cleanupListeners.push(() => renderer?.domElement.removeEventListener("pointerdown", onPointerDown));

      window.addEventListener("resize", handleResize);
      cleanupListeners.push(() => window.removeEventListener("resize", handleResize));

      const workingBox = new THREE.Box3();
      const animate = () => {
        if (cancelled) return;
        requestAnimationFrame(animate);
        if (orbitRef.current) {
          orbitRef.current.update();
        }
        boundingHelpersRef.current.forEach((helper, objectId) => {
          const target = objectIndexRef.current.get(objectId);
          if (!target) return;
          workingBox.setFromObject(target.object3d);
          workingBox.expandByScalar(target.bounds?.padding ?? 0.1);
          helper.box.copy(workingBox);
          helper.updateMatrixWorld(true);
        });
        renderer!.render(graphScene, activeCameraRef.current!);
      };

      animate();

    })();

    return () => {
      cancelled = true;
      cleanupListeners.forEach((fn) => fn());
      orbitRef.current?.dispose();
      transformRef.current?.dispose();
      rendererRef.current?.dispose();
      if (rendererRef.current && mount && rendererRef.current.domElement.parentElement === mount) {
        mount.removeChild(rendererRef.current.domElement);
      }
      if (transformRef.current) {
        const transformObject = transformRef.current as unknown as THREE.Object3D;
        if (graphScene && transformObject.parent === graphScene) {
          graphScene.remove(transformObject);
        }
      }
      disposeGroundedSkybox();
    };
  }, [cameras, configureCameraForViewport, defaultCameraTag, disposeGroundedSkybox, emitEvent, objects, sceneGraph]);

  useEffect(() => {
    if (!transformRef.current) return;
    transformModeRef.current = transformMode;
    transformRef.current.setMode(transformMode);
  }, [transformMode]);

  const setActiveCameraByTag = useCallback(
    (tag: string) => {
      if (!rendererRef.current) return;
      const OrbitCtor = controlConstructors.current.OrbitControls;
      if (!OrbitCtor) return;

      const renderer = rendererRef.current;
      const taggedCamera = sceneGraph?.getFirstByTag(tag);
      const cameraCandidate = taggedCamera && isCameraObject(taggedCamera.object3d) ? taggedCamera.object3d : null;
      const camera = cameraCandidate ?? activeCameraRef.current;
      if (!camera) return;

      configureCameraForViewport(camera);
      activeCameraRef.current = camera;

      if (orbitRef.current) {
        orbitRef.current.dispose();
      }

      const orbit = new OrbitCtor(camera, renderer.domElement);
      orbit.enableDamping = true;
      orbit.target.set(0, 1, 0);
      orbitRef.current = orbit;

      if (transformRef.current) {
        (transformRef.current as unknown as { camera?: THREE.Camera }).camera = camera;
      }
    },
    [configureCameraForViewport, sceneGraph]
  );

  const moveCameraToPreset = useCallback((preset: EditorCameraPreset) => {
    const camera = activeCameraRef.current;
    if (!camera || !orbitRef.current) return;

    const target = presets[preset];
    camera.position.copy(target);
    orbitRef.current.target.set(0, 1, 0);
    camera.lookAt(0, 1, 0);
  }, []);

  const handleSelectFromList = useCallback(
    (id: string) => {
      setSelectedId(id);
      const found = objects.find((o) => o.id === id);
      if (found && transformRef.current) {
        transformRef.current.attach(found.object3d);
        selectedRef.current = found;
        emitEvent({ type: "select", object: found });
      }
    },
    [emitEvent, objects]
  );

  const handleSelectByTag = useCallback(
    (tag: string) => {
      const found = sceneGraph?.getByTag(tag)[0];
      if (found && transformRef.current) {
        setSelectedId(found.id);
        transformRef.current.attach(found.object3d);
        selectedRef.current = found;
        emitEvent({ type: "select", object: found });
      }
    },
    [emitEvent, sceneGraph]
  );

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    if (transformRef.current) {
      transformRef.current.detach();
    }
    selectedRef.current = null;
    emitEvent({ type: "deselect" });
  }, [emitEvent]);

  useEffect(() => {
    const handler = {
      setCameraByTag: setActiveCameraByTag,
      setTransformMode,
      moveCameraToPreset,
      selectObject: handleSelectFromList,
      selectObjectByTag: handleSelectByTag,
      clearSelection,
    };

    editorCommands.register(handler);
    return () => editorCommands.unregister(handler);
  }, [clearSelection, handleSelectByTag, handleSelectFromList, moveCameraToPreset, setActiveCameraByTag, setTransformMode]);

  return (
    <div className="relative h-full w-full bg-zinc-50">
      {!sceneGraph && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
          No scene provided to SceneEditorCanvas.
        </div>
      )}
      <div ref={mountRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-4 top-4 flex w-[360px] max-w-[80vw] flex-col space-y-3">
        <div className="pointer-events-auto rounded-xl bg-white/80 p-4 text-sm text-zinc-800 shadow-md backdrop-blur">
          <div className="text-base font-semibold text-zinc-900">Three.js Editor</div>
          <p className="leading-relaxed text-zinc-700">
            Use the <code className="rounded bg-zinc-100 px-1">editorCommands</code> API to drive camera modes, presets,
            transforms, and selection programmatically. The viewport supports orbit (left drag), pan (right drag), and
            zoom (wheel or pinch).
          </p>
        </div>
        <div className="pointer-events-auto space-y-3 rounded-xl bg-white/90 p-4 text-sm text-zinc-800 shadow-md backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-base font-semibold text-zinc-900">Skybox</div>
            {skyboxLoading && <span className="text-[11px] font-semibold text-amber-600">Loading…</span>}
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Texture
            <select
              className="w-full rounded border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-800 shadow-sm focus:border-sky-400 focus:outline-none"
              value={skyboxUrl ?? ""}
              onChange={(event) => setSkyboxUrl(event.target.value || null)}
            >
              <option value="">None</option>
              {availableSkyboxes.map((option) => (
                <option key={option.textureUrl} value={option.textureUrl}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2 text-xs text-zinc-600">
            <div className="flex items-center gap-2">
              <span className="w-16 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Height</span>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={skyboxHeight}
                onChange={(e) => setSkyboxHeight(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-sky-500"
              />
              <span className="w-10 text-right font-mono text-[12px] text-zinc-700">{skyboxHeight.toFixed(0)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Radius</span>
              <input
                type="range"
                min={20}
                max={200}
                step={5}
                value={skyboxRadius}
                onChange={(e) => setSkyboxRadius(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-sky-500"
              />
              <span className="w-10 text-right font-mono text-[12px] text-zinc-700">{skyboxRadius.toFixed(0)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Resolution</span>
              <select
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-800 focus:border-sky-400 focus:outline-none"
                value={skyboxResolution}
                onChange={(e) => setSkyboxResolution(Number(e.target.value))}
              >
                {[16, 32, 64, 96].map((res) => (
                  <option value={res} key={res}>
                    {res}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-md bg-emerald-50 p-2 text-[11px] text-emerald-800">
            Character objects tagged with <code className="rounded bg-emerald-100 px-1">type:character</code> render
            live bounding boxes for collision and layout checks.
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Skybox controls honor the Gemini panoramic prompt recipe and list any PNGs you drop under
            <code className="rounded bg-zinc-100 px-1">/public/assets/skyboxes</code> automatically (files are not
            stored in the repo).
          </p>
        </div>
      </div>
      {selectedId && (
        <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-black/70 px-4 py-2 text-xs font-medium uppercase tracking-wide text-white shadow-lg">
          Selected: {objects.find((o) => o.id === selectedId)?.name ?? selectedId}
        </div>
      )}
    </div>
  );
}

export default SceneEditorCanvas;

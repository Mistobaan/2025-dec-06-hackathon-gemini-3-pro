"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import {
  EditorCameraPreset,
  EditorTransformMode,
  SceneCameraState,
  SceneGraph,
  SceneObject,
} from "@/lib/scene/types";
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

type PerspectiveLike = THREE.Camera & {
  isPerspectiveCamera?: boolean;
  aspect: number;
  updateProjectionMatrix: () => void;
};
type OrthographicLike = THREE.Camera & {
  isOrthographicCamera?: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  updateProjectionMatrix: () => void;
};
type OrbitControlsCtor = new (
  object: THREE.Object3D,
  domElement?: HTMLElement | null
) => OrbitControls;
type TransformControlsCtor = new (
  camera: THREE.Camera,
  domElement?: HTMLElement | null
) => TransformControls;

const isCameraObject = (object: THREE.Object3D): object is THREE.Camera =>
  (object as { isCamera?: boolean }).isCamera === true;

const isPerspectiveCamera = (camera: THREE.Camera): camera is PerspectiveLike =>
  (camera as PerspectiveLike).isPerspectiveCamera === true;

const isOrthographicCamera = (
  camera: THREE.Camera
): camera is OrthographicLike =>
  (camera as OrthographicLike).isOrthographicCamera === true;

export type SceneEditorCapture = {
  dataUrl: string;
  camera: SceneCameraState;
};

export type SceneEditorHandle = {
  captureFrame: () => SceneEditorCapture | null;
  getCameraState: () => SceneCameraState | null;
  setCameraState: (state: SceneCameraState) => void;
};

type SceneEditorCanvasProps = {
  scene?: SceneGraph | null;
  defaultCameraTag?: string;
  selectableObjects?: SceneObject[];
  onEvent?: (event: SceneEditorEvent) => void;
};

const SceneEditorCanvas = forwardRef<SceneEditorHandle, SceneEditorCanvasProps>(
  function SceneEditorCanvas(
    {
      scene,
      defaultCameraTag,
      selectableObjects,
      onEvent,
    }: SceneEditorCanvasProps,
    ref
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const activeCameraRef = useRef<THREE.Camera | null>(null);
    const selectedRef = useRef<SceneObject | null>(null);
    const transformModeRef = useRef<EditorTransformMode>("translate");
    const orbitRef = useRef<OrbitControls | null>(null);
    const transformRef = useRef<TransformControls | null>(null);
    const orthoFrustumHeights = useRef<WeakMap<THREE.Camera, number>>(
      new WeakMap()
    );
    const controlConstructors = useRef<{
      OrbitControls: OrbitControlsCtor | null;
      TransformControls: TransformControlsCtor | null;
    }>({
      OrbitControls: null,
      TransformControls: null,
    });
    const sceneGraph = scene ?? null;

    const objects = useMemo<SceneObject[]>(() => {
      if (!sceneGraph?.objects) return [];
      if (selectableObjects?.length) return selectableObjects;

      return sceneGraph.objects.filter((child) => {
        if (
          child.object3d.type === "TransformControls" ||
          child.object3d.type === "OrbitControls"
        )
          return false;
        if ((child.object3d as { isCamera?: boolean }).isCamera) return false;
        return true;
      });
    }, [sceneGraph, selectableObjects]);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [transformMode, setTransformMode] =
      useState<EditorTransformMode>("translate");

    const cameras = useMemo<SceneObject[]>(() => {
      if (!sceneGraph?.objects) return [];
      return sceneGraph.objects.filter((child) =>
        isCameraObject(child.object3d)
      );
    }, [sceneGraph]);

    const emitEvent = useCallback(
      (event: SceneEditorEvent) => {
        sceneEditorEvents.emit(event);
        onEvent?.(event);
      },
      [onEvent]
    );

    const configureCameraForViewport = useCallback((camera: THREE.Camera) => {
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
          orthoFrustumHeights.current.get(camera) ??
          (Math.abs(camera.top - camera.bottom) || 10);
        orthoFrustumHeights.current.set(camera, storedHeight);
        const halfHeight = storedHeight / 2;
        const halfWidth = halfHeight * (width / height);
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
      }
    }, []);

    const transformHelperRef = useRef<THREE.Object3D | null>(null);
    const getAuxiliaryObjects = useCallback((): THREE.Object3D[] => {
      const auxiliary: THREE.Object3D[] = [];
      sceneGraph?.objects.forEach((entry) => {
        const tags = entry.tags ?? [];
        if (tags.some((tag) => tag.startsWith("type:helper") || tag.startsWith("helper:"))) {
          auxiliary.push(entry.object3d);
        }
      });
      if (transformHelperRef.current) {
        auxiliary.push(transformHelperRef.current);
      }
      return auxiliary;
    }, [sceneGraph]);

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
          orbitModule.OrbitControls ??
          (orbitModule as { default?: typeof OrbitControls }).default ??
          null;
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
        const transformConstructor =
          TransformCtor as unknown as TransformControlsCtor;

        if (!(transformConstructor.prototype instanceof THREE.Object3D)) {
          Object.setPrototypeOf(
            transformConstructor.prototype,
            THREE.Object3D.prototype
          );
          Object.defineProperty(transformConstructor.prototype, "constructor", {
            value: transformConstructor,
          });

          const transformPrototype =
            transformConstructor.prototype as unknown as THREE.Object3D;
          Object.defineProperty(transformPrototype, "isObject3D", {
            value: true,
          });
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

        const taggedDefault = defaultCameraTag
          ? sceneGraph?.getFirstByTag(defaultCameraTag)
          : null;
        const taggedCamera =
          taggedDefault && isCameraObject(taggedDefault.object3d)
            ? taggedDefault.object3d
            : null;
        const fallbackCamera =
          cameras.find((entry) => isCameraObject(entry.object3d))?.object3d ??
          null;

        const chosenCamera = taggedCamera ?? fallbackCamera;

        if (!chosenCamera || !isCameraObject(chosenCamera)) {
          console.error(
            "SceneEditorCanvas: no camera available in the provided scene"
          );
          return;
        }

        activeCameraRef.current = chosenCamera;
        configureCameraForViewport(chosenCamera);

        orbit = new orbitConstructor(
          activeCameraRef.current!,
          renderer.domElement
        );
        orbit.enableDamping = true;
        orbit.target.set(0, 1, 0);
        orbitRef.current = orbit;

        transform = new transformConstructor(
          activeCameraRef.current!,
          renderer.domElement
        );
        transform.setMode("translate");
        transform.addEventListener("mouseDown", () => {
          if (orbitRef.current) orbitRef.current.enabled = false;
          emitEvent({
            type: "transform-start",
            object: selectedRef.current,
            mode: transformModeRef.current,
          });
        });
        transform.addEventListener("mouseUp", () => {
          if (orbitRef.current) orbitRef.current.enabled = true;
          emitEvent({
            type: "transform-end",
            object: selectedRef.current,
            mode: transformModeRef.current,
          });
        });
        transform.addEventListener("objectChange", () => {
          emitEvent({
            type: "transform-change",
            object: selectedRef.current,
            mode: transformModeRef.current,
          });
        });

        const transformObject = transform as unknown as THREE.Object3D & {
          isObject3D?: boolean;
        };

        const helper =
          typeof (transform as { getHelper?: () => unknown }).getHelper ===
          "function"
            ? (transform as { getHelper: () => unknown }).getHelper()
            : null;
        const helperObject = helper as THREE.Object3D | null;
        const nodeToAdd = helperObject ?? transformObject;

        if ((nodeToAdd as { isObject3D?: boolean }).isObject3D ?? false) {
          graphScene.add(nodeToAdd);
          transformRef.current = transform;
          transformHelperRef.current = nodeToAdd;
        } else {
          console.error(
            "TransformControls did not initialize as an Object3D",
            transform
          );
        }

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();

        const onPointerDown = (event: PointerEvent) => {
          const rect = renderer!.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

          raycaster.setFromCamera(pointer, activeCameraRef.current!);
          const hits = raycaster.intersectObjects(
            objects.map((o) => o.object3d)
          );
          if (hits.length) {
            const hit = hits[0].object;
            const found = objects.find(
              (o) => o.object3d === hit || o.object3d.children.includes(hit)
            );
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
        cleanupListeners.push(() =>
          renderer?.domElement.removeEventListener("pointerdown", onPointerDown)
        );

        window.addEventListener("resize", handleResize);
        cleanupListeners.push(() =>
          window.removeEventListener("resize", handleResize)
        );

        const animate = () => {
          if (cancelled) return;
          requestAnimationFrame(animate);
          if (orbitRef.current) {
            orbitRef.current.update();
          }
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
        if (
          rendererRef.current &&
          mount &&
          rendererRef.current.domElement.parentElement === mount
        ) {
          mount.removeChild(rendererRef.current.domElement);
        }
        if (graphScene && transformHelperRef.current) {
          graphScene.remove(transformHelperRef.current);
        }
        transformHelperRef.current = null;
      };
    }, [
      cameras,
      configureCameraForViewport,
      defaultCameraTag,
      emitEvent,
      objects,
      sceneGraph,
    ]);

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
        const cameraCandidate =
          taggedCamera && isCameraObject(taggedCamera.object3d)
            ? taggedCamera.object3d
            : null;
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
          (
            transformRef.current as unknown as { camera?: THREE.Camera }
          ).camera = camera;
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

    const readCameraState = useCallback((): SceneCameraState | null => {
      const camera = activeCameraRef.current;
      if (!camera) return null;
      const target = orbitRef.current?.target ?? new THREE.Vector3(0, 0, 0);
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [target.x, target.y, target.z],
        up: [camera.up.x, camera.up.y, camera.up.z],
      };
    }, []);

    const setCameraState = useCallback(
      (state: SceneCameraState) => {
        const camera = activeCameraRef.current;
        if (!camera) return;
        camera.position.set(...state.position);
        camera.up.set(...state.up);
        camera.lookAt(...state.target);
        if (orbitRef.current) {
          orbitRef.current.target.set(...state.target);
          orbitRef.current.update();
        }
        configureCameraForViewport(camera);
      },
      [configureCameraForViewport]
    );

    const captureFrame = useCallback((): SceneEditorCapture | null => {
      const renderer = rendererRef.current;
      const camera = activeCameraRef.current;
      const graphScene = sceneGraph?.scene;
      if (!renderer || !camera || !graphScene) return null;

      const auxiliary = getAuxiliaryObjects();
      const previousVisibility = auxiliary.map((object) => object.visible);

      try {
        auxiliary.forEach((object) => {
          object.visible = false;
        });
        renderer.render(graphScene, camera);
        const dataUrl = renderer.domElement.toDataURL("image/png");
        const cameraState = readCameraState();
        if (!cameraState) return null;
        return { dataUrl, camera: cameraState };
      } finally {
        auxiliary.forEach((object, index) => {
          object.visible = previousVisibility[index];
        });
      }
    }, [getAuxiliaryObjects, readCameraState, sceneGraph]);

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
    }, [
      clearSelection,
      handleSelectByTag,
      handleSelectFromList,
      moveCameraToPreset,
      setActiveCameraByTag,
      setTransformMode,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        captureFrame,
        getCameraState: readCameraState,
        setCameraState,
      }),
      [captureFrame, readCameraState, setCameraState]
    );

    return (
      <div className="relative h-full w-full bg-zinc-50">
        {!sceneGraph && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
            No scene provided to SceneEditorCanvas.
          </div>
        )}
        <div ref={mountRef} className="absolute inset-0" />
        {/* <div className="pointer-events-none absolute left-4 top-4 w-[320px] max-w-[80vw] space-y-3 rounded-xl bg-white/80 p-4 text-sm text-zinc-800 shadow-md backdrop-blur">
          <div className="text-base font-semibold text-zinc-900">
            Three.js Editor
          </div>
          <p className="leading-relaxed text-zinc-700">
            Use the{" "}
            <code className="rounded bg-zinc-100 px-1">editorCommands</code> API
            to drive camera modes, presets, transforms, and selection
            programmatically. The viewport supports orbit (left drag), pan
            (right drag), and zoom (wheel or pinch).
          </p>
        </div> 
          */}
        {selectedId && (
          <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-black/70 px-4 py-2 text-xs font-medium uppercase tracking-wide text-white shadow-lg">
            Selected:{" "}
            {objects.find((o) => o.id === selectedId)?.name ?? selectedId}
          </div>
        )}
      </div>
    );
  }
);

export default SceneEditorCanvas;

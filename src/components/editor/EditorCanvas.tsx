"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  EditorCameraPreset,
  EditorCameraType,
  EditorTransformMode,
} from "@/lib/editor/types";
import { editorCommands } from "@/lib/editor/commands";

import type { EditorObject } from "@/lib/editor/types";

import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

const presets: Record<EditorCameraPreset, THREE.Vector3> = {
  home: new THREE.Vector3(6, 4, 6),
  front: new THREE.Vector3(0, 0, 10),
  side: new THREE.Vector3(10, 0, 0),
  top: new THREE.Vector3(0, 10, 0),
};

type EditorCanvasProps = {
  scene: THREE.Scene;
  perspectiveCamera?: THREE.PerspectiveCamera | null;
  orthographicCamera?: THREE.OrthographicCamera | null;
  selectableObjects?: EditorObject[];
};

export function EditorCanvas({
  scene,
  perspectiveCamera,
  orthographicCamera,
  selectableObjects,
}: EditorCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthographicCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const activeCameraRef = useRef<THREE.Camera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const controlConstructors = useRef<{
    OrbitControls: typeof import("three/examples/jsm/controls/OrbitControls.js")["OrbitControls"] | null;
    TransformControls: typeof import("three/examples/jsm/controls/TransformControls.js")["TransformControls"] | null;
  }>({
    OrbitControls: null,
    TransformControls: null,
  });
  const objects = useMemo<EditorObject[]>(() => {
    if (selectableObjects?.length) return selectableObjects;

    const gathered: EditorObject[] = [];
    scene.traverse((child) => {
      if (child.type === "TransformControls" || child.type === "OrbitControls") return;
      if (child instanceof THREE.Camera) return;
      if (child === scene) return;
      const id = child.uuid;
      gathered.push({ id, name: child.name || child.type, object3d: child });
    });
    return gathered;
  }, [scene, selectableObjects]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<EditorTransformMode>("translate");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let orbit: OrbitControls | null = null;
    let transform: TransformControls | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let cancelled = false;
    const cleanupListeners: Array<() => void> = [];

    (async () => {
      const [orbitModule, transformModule] = await Promise.all([
        import("three/examples/jsm/controls/OrbitControls.js"),
        import("three/examples/jsm/controls/TransformControls.js"),
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

      if (!(TransformCtor.prototype instanceof THREE.Object3D)) {
        Object.setPrototypeOf(TransformCtor.prototype, THREE.Object3D.prototype);
        Object.defineProperty(TransformCtor.prototype, "constructor", { value: TransformCtor });
        (TransformCtor.prototype as THREE.Object3D).isObject3D = true;
      }

      controlConstructors.current = { OrbitControls: OrbitCtor, TransformControls: TransformCtor };

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.shadowMap.enabled = true;
      mount.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      perspectiveCameraRef.current =
        perspectiveCamera ??
        scene.children.find((child): child is THREE.PerspectiveCamera => child instanceof THREE.PerspectiveCamera) ??
        (() => {
          const fallback = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 1000);
          fallback.position.copy(presets.home);
          fallback.lookAt(0, 1, 0);
          scene.add(fallback);
          return fallback;
        })();

      const aspect = mount.clientWidth / mount.clientHeight;
      const frustumSize = 16;
      orthographicCameraRef.current =
        orthographicCamera ??
        scene.children.find((child): child is THREE.OrthographicCamera => child instanceof THREE.OrthographicCamera) ??
        (() => {
          const fallback = new THREE.OrthographicCamera(
            (frustumSize * aspect) / -2,
            (frustumSize * aspect) / 2,
            frustumSize / 2,
            frustumSize / -2,
            -50,
            200
          );
          fallback.position.copy(presets.home);
          fallback.lookAt(0, 1, 0);
          scene.add(fallback);
          return fallback;
        })();

      activeCameraRef.current = perspectiveCameraRef.current;

      orbit = new OrbitCtor(activeCameraRef.current!, renderer.domElement);
      orbit.enableDamping = true;
      orbit.target.set(0, 1, 0);
      orbitRef.current = orbit;

      transform = new TransformCtor(activeCameraRef.current!, renderer.domElement);
      transform.setMode("translate");
      transform.addEventListener("mouseDown", () => {
        if (orbitRef.current) orbitRef.current.enabled = false;
      });
      transform.addEventListener("mouseUp", () => {
        if (orbitRef.current) orbitRef.current.enabled = true;
      });

      if (transform.isObject3D) {
        scene.add(transform);
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
            transformRef.current.attach(found.object3d);
          }
        } else {
          setSelectedId(null);
          transformRef.current?.detach();
        }
      };

      const handleResize = () => {
        const width = mount.clientWidth;
        const height = mount.clientHeight;
        renderer!.setSize(width, height);

        if (perspectiveCameraRef.current instanceof THREE.PerspectiveCamera) {
          perspectiveCameraRef.current.aspect = width / height;
          perspectiveCameraRef.current.updateProjectionMatrix();
        }

        const aspectRatio = width / height;
        if (orthographicCameraRef.current instanceof THREE.OrthographicCamera) {
          orthographicCameraRef.current.left = (-frustumSize * aspectRatio) / 2;
          orthographicCameraRef.current.right = (frustumSize * aspectRatio) / 2;
          orthographicCameraRef.current.top = frustumSize / 2;
          orthographicCameraRef.current.bottom = -frustumSize / 2;
          orthographicCameraRef.current.updateProjectionMatrix();
        }
      };

      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      cleanupListeners.push(() => renderer?.domElement.removeEventListener("pointerdown", onPointerDown));

      window.addEventListener("resize", handleResize);
      cleanupListeners.push(() => window.removeEventListener("resize", handleResize));

      const animate = () => {
        if (cancelled) return;
        requestAnimationFrame(animate);
        if (orbitRef.current) {
          orbitRef.current.update();
        }
        renderer!.render(scene, activeCameraRef.current!);
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
      if (transformRef.current && transformRef.current.parent === scene) {
        scene.remove(transformRef.current);
      }
    };
  }, [objects, orthographicCamera, perspectiveCamera, scene]);

  useEffect(() => {
    if (!transformRef.current) return;
    transformRef.current.setMode(transformMode);
  }, [transformMode]);

  const setActiveCamera = useCallback((type: EditorCameraType) => {
    if (!rendererRef.current) return;
    const OrbitCtor = controlConstructors.current.OrbitControls;
    if (!OrbitCtor) return;

    const renderer = rendererRef.current;
    const camera =
      type === "orthographic" ? orthographicCameraRef.current : perspectiveCameraRef.current;
    if (!camera) return;

    activeCameraRef.current = camera;

    if (orbitRef.current) {
      orbitRef.current.dispose();
    }

    const orbit = new OrbitCtor(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 1, 0);
    orbitRef.current = orbit;

    if (transformRef.current) {
      transformRef.current.camera = camera;
    }
  }, []);

  const moveCameraToPreset = useCallback((preset: EditorCameraPreset) => {
    const camera = activeCameraRef.current;
    if (!camera || !orbitRef.current) return;

    const target = presets[preset];
    camera.position.copy(target);
    orbitRef.current.target.set(0, 1, 0);
    camera.lookAt(0, 1, 0);
  }, []);

  const handleSelectFromList = useCallback((id: string) => {
    setSelectedId(id);
    const found = objects.find((o) => o.id === id);
    if (found && transformRef.current) {
      transformRef.current.attach(found.object3d);
    }
  }, [objects]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    if (transformRef.current) {
      transformRef.current.detach();
    }
  }, []);

  useEffect(() => {
    const handler = {
      setCameraType: setActiveCamera,
      setTransformMode,
      moveCameraToPreset,
      selectObject: handleSelectFromList,
      clearSelection,
    };

    editorCommands.register(handler);
    return () => editorCommands.unregister(handler);
  }, [clearSelection, handleSelectFromList, moveCameraToPreset, setActiveCamera, setTransformMode]);

  return (
    <div className="relative h-full w-full bg-zinc-50">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-4 top-4 w-[320px] max-w-[80vw] space-y-3 rounded-xl bg-white/80 p-4 text-sm text-zinc-800 shadow-md backdrop-blur">
        <div className="text-base font-semibold text-zinc-900">Three.js Editor</div>
        <p className="leading-relaxed text-zinc-700">
          Use the <code className="rounded bg-zinc-100 px-1">editorCommands</code> API to drive camera modes, presets,
          transforms, and selection programmatically. The viewport supports orbit (left drag), pan (right drag), and
          zoom (wheel or pinch).
        </p>
      </div>
      {selectedId && (
        <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-black/70 px-4 py-2 text-xs font-medium uppercase tracking-wide text-white shadow-lg">
          Selected: {objects.find((o) => o.id === selectedId)?.name ?? selectedId}
        </div>
      )}
    </div>
  );
}

export default EditorCanvas;

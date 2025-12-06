"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  EditorCameraPreset,
  EditorCameraType,
  EditorTransformMode,
} from "@/lib/editor/types";
import { editorCommands } from "@/lib/editor/commands";

const presets: Record<EditorCameraPreset, THREE.Vector3> = {
  home: new THREE.Vector3(6, 4, 6),
  front: new THREE.Vector3(0, 0, 10),
  side: new THREE.Vector3(10, 0, 0),
  top: new THREE.Vector3(0, 10, 0),
};

type EditorObject = {
  id: string;
  name: string;
  object3d: THREE.Object3D;
};

function buildSampleObjects(): EditorObject[] {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.5, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x6c8ffc })
  );
  box.position.set(-2, 0.75, 0);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b })
  );
  sphere.position.set(2, 1, 0);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, side: THREE.DoubleSide })
  );
  plane.rotation.x = -Math.PI / 2;

  return [
    { id: "box", name: "Box", object3d: box },
    { id: "sphere", name: "Sphere", object3d: sphere },
    { id: "ground", name: "Ground", object3d: plane },
  ];
}

export function EditorCanvas() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthographicCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const activeCameraRef = useRef<THREE.Camera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const objects = useMemo(() => buildSampleObjects(), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<EditorTransformMode>("translate");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    const perspectiveCamera = new THREE.PerspectiveCamera(
      60,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1000
    );
    perspectiveCamera.position.copy(presets.home);
    perspectiveCamera.lookAt(0, 1, 0);
    perspectiveCameraRef.current = perspectiveCamera;

    const aspect = mount.clientWidth / mount.clientHeight;
    const frustumSize = 16;
    const orthographicCamera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      -50,
      200
    );
    orthographicCamera.position.copy(presets.home);
    orthographicCamera.lookAt(0, 1, 0);
    orthographicCameraRef.current = orthographicCamera;

    activeCameraRef.current = perspectiveCamera;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(4, 8, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const grid = new THREE.GridHelper(40, 40, 0xd4d4d8, 0xe4e4e7);
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    objects.forEach((entry) => {
      entry.object3d.castShadow = true;
      entry.object3d.receiveShadow = true;
      scene.add(entry.object3d);
    });

    const orbit = new OrbitControls(perspectiveCamera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 1, 0);
    orbitRef.current = orbit;

    const transform = new TransformControls(perspectiveCamera, renderer.domElement);
    transform.setMode("translate");
    transform.addEventListener("mouseDown", () => {
      if (orbitRef.current) orbitRef.current.enabled = false;
    });
    transform.addEventListener("mouseUp", () => {
      if (orbitRef.current) orbitRef.current.enabled = true;
    });
    scene.add(transform);
    transformRef.current = transform;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, activeCameraRef.current!);
      const hits = raycaster.intersectObjects(objects.map((o) => o.object3d));
      if (hits.length) {
        const hit = hits[0].object;
        const found = objects.find((o) => o.object3d === hit || o.object3d.children.includes(hit));
        if (found) {
          setSelectedId(found.id);
          transform.attach(found.object3d);
        }
      } else {
        setSelectedId(null);
        transform.detach();
      }
    };

    const handleResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height);

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
    window.addEventListener("resize", handleResize);

    const animate = () => {
      requestAnimationFrame(animate);
      if (orbitRef.current) {
        orbitRef.current.update();
      }
      renderer.render(scene, activeCameraRef.current!);
    };

    animate();

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      scene.clear();
    };
  }, [objects]);

  useEffect(() => {
    if (!transformRef.current) return;
    transformRef.current.setMode(transformMode);
  }, [transformMode]);

  const setActiveCamera = useCallback((type: EditorCameraType) => {
    if (!rendererRef.current) return;
    const renderer = rendererRef.current;
    const camera =
      type === "orthographic" ? orthographicCameraRef.current : perspectiveCameraRef.current;
    if (!camera) return;

    activeCameraRef.current = camera;

    if (orbitRef.current) {
      orbitRef.current.dispose();
    }

    const orbit = new OrbitControls(camera, renderer.domElement);
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
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-lg font-semibold text-zinc-900">Three.js Editor</div>
        <p className="text-sm text-zinc-600">
          Drive camera modes, presets, and transforms through the programmatic editorCommands API.
        </p>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-inner">
          <div ref={mountRef} className="h-full w-full" />
        </div>
        <aside className="w-72 space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-zinc-900">Scene Overview</div>
          <ul className="space-y-2 text-sm text-zinc-700">
            {objects.map((entry) => (
              <li
                key={entry.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                  selectedId === entry.id ? "border-black bg-zinc-100" : "border-zinc-200"
                }`}
              >
                <span>{entry.name}</span>
                {selectedId === entry.id && <span className="text-xs uppercase text-zinc-500">Selected</span>}
              </li>
            ))}
          </ul>
          <div className="rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600">
            <p className="font-semibold text-zinc-800">Navigation</p>
            <ul className="list-disc space-y-1 pl-4 pt-1">
              <li>Orbit: left mouse drag</li>
              <li>Pan: right mouse drag</li>
              <li>Zoom: mouse wheel or pinch</li>
            </ul>
            <p className="pt-2 text-zinc-700">Use programmatic commands to change cameras, transforms, and presets.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default EditorCanvas;

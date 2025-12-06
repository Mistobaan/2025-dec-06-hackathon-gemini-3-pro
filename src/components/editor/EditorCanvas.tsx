"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

const presets = {
  home: new THREE.Vector3(6, 4, 6),
  front: new THREE.Vector3(0, 0, 10),
  side: new THREE.Vector3(10, 0, 0),
  top: new THREE.Vector3(0, 10, 0),
};

type CameraType = "perspective" | "orthographic";
type TransformMode = "translate" | "rotate" | "scale";

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
  const objects = useMemo(buildSampleObjects, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [cameraType, setCameraType] = useState<CameraType>("perspective");

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
    transform.setMode(transformMode);
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

  const setActiveCamera = (type: CameraType) => {
    if (!rendererRef.current) return;
    const renderer = rendererRef.current;
    const camera =
      type === "orthographic" ? orthographicCameraRef.current : perspectiveCameraRef.current;
    if (!camera) return;

    setCameraType(type);
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
  };

  const moveCameraToPreset = (preset: keyof typeof presets) => {
    const camera = activeCameraRef.current;
    if (!camera || !orbitRef.current) return;

    const target = presets[preset];
    camera.position.copy(target);
    orbitRef.current.target.set(0, 1, 0);
    camera.lookAt(0, 1, 0);
  };

  const handleSelectFromList = (id: string) => {
    setSelectedId(id);
    const found = objects.find((o) => o.id === id);
    if (found && transformRef.current) {
      transformRef.current.attach(found.object3d);
    }
  };

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[600px] flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-3">
        <div className="flex items-center gap-2 text-lg font-semibold">Three.js Editor</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 text-sm">
            <span className="text-xs uppercase text-zinc-600">Camera</span>
            <button
              className={`rounded px-2 py-1 ${cameraType === "perspective" ? "bg-black text-white" : "text-zinc-700"}`}
              onClick={() => setActiveCamera("perspective")}
            >
              Perspective
            </button>
            <button
              className={`rounded px-2 py-1 ${cameraType === "orthographic" ? "bg-black text-white" : "text-zinc-700"}`}
              onClick={() => setActiveCamera("orthographic")}
            >
              Orthographic
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-sm">
            <span className="text-xs uppercase text-zinc-600">Transform</span>
            {["translate", "rotate", "scale"].map((mode) => (
              <button
                key={mode}
                className={`rounded px-2 py-1 capitalize ${
                  transformMode === mode ? "bg-black text-white" : "text-zinc-700"
                }`}
                onClick={() => setTransformMode(mode as TransformMode)}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-sm">
            <span className="text-xs uppercase text-zinc-600">Presets</span>
            {Object.keys(presets).map((preset) => (
              <button
                key={preset}
                className="rounded px-2 py-1 capitalize text-zinc-700 hover:bg-zinc-200"
                onClick={() => moveCameraToPreset(preset as keyof typeof presets)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-4">
        <div className="flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
          <div ref={mountRef} className="h-full w-full" />
        </div>
        <div className="w-72 space-y-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="text-sm font-semibold text-zinc-800">Scene Objects</div>
          <div className="space-y-2 text-sm">
            {objects.map((entry) => (
              <button
                key={entry.id}
                onClick={() => handleSelectFromList(entry.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${
                  selectedId === entry.id ? "border-black bg-zinc-100" : "border-zinc-200"
                }`}
              >
                <span>{entry.name}</span>
                {selectedId === entry.id && <span className="text-xs uppercase text-zinc-500">Selected</span>}
              </button>
            ))}
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600">
            <p className="font-semibold text-zinc-800">Navigation</p>
            <ul className="list-disc space-y-1 pl-4 pt-1">
              <li>Orbit: left mouse drag</li>
              <li>Pan: right mouse drag</li>
              <li>Zoom: mouse wheel or pinch</li>
            </ul>
            <p className="pt-2 text-zinc-700">Use the transform controls to move, rotate, and scale the selection.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditorCanvas;

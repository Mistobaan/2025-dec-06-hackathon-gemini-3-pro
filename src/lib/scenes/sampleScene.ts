import * as THREE from "three";
import { SceneGraph, SceneObject } from "@/lib/scene/types";

const defaultCameraPosition = new THREE.Vector3(6, 4, 6);
const frustumSize = 16;

function buildTagIndex(objects: SceneObject[]) {
  const index = new Map<string, SceneObject[]>();
  objects.forEach((obj) => {
    (obj.tags ?? []).forEach((tag) => {
      const existing = index.get(tag);
      if (existing) {
        existing.push(obj);
      } else {
        index.set(tag, [obj]);
      }
    });
  });
  return index;
}

export function createSampleScene(): SceneGraph {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);

  const perspectiveCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  perspectiveCamera.name = "PerspectiveCamera";
  perspectiveCamera.position.copy(defaultCameraPosition);
  perspectiveCamera.lookAt(0, 1, 0);

  const orthographicCamera = new THREE.OrthographicCamera(
    frustumSize / -2,
    frustumSize / 2,
    frustumSize / 2,
    frustumSize / -2,
    -50,
    200
  );
  orthographicCamera.name = "OrthographicCamera";
  orthographicCamera.position.copy(defaultCameraPosition);
  orthographicCamera.lookAt(0, 1, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  ambient.name = "Ambient Light";
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
  keyLight.name = "Key Light";
  keyLight.position.set(4, 8, 6);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const grid = new THREE.GridHelper(40, 40, 0xd4d4d8, 0xe4e4e7);
  grid.name = "Grid";
  (grid.material as THREE.Material).transparent = true;
  scene.add(grid);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.5, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x6c8ffc })
  );
  box.position.set(-2, 0.75, 0);
  box.name = "Box";

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b })
  );
  sphere.position.set(2, 1, 0);
  sphere.name = "Sphere";

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, side: THREE.DoubleSide })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  plane.name = "Ground";

  box.castShadow = true;
  box.receiveShadow = true;
  sphere.castShadow = true;
  sphere.receiveShadow = true;

  scene.add(perspectiveCamera, orthographicCamera, box, sphere, plane);

  const objects: SceneObject[] = [
    { id: perspectiveCamera.uuid, name: perspectiveCamera.name, object3d: perspectiveCamera, tags: ["type:camera", "camera:perspective"] },
    { id: orthographicCamera.uuid, name: orthographicCamera.name, object3d: orthographicCamera, tags: ["type:camera", "camera:orthographic"] },
    { id: ambient.uuid, name: ambient.name, object3d: ambient, tags: ["type:light", "light:ambient"] },
    { id: keyLight.uuid, name: keyLight.name, object3d: keyLight, tags: ["type:light", "light:directional"] },
    { id: grid.uuid, name: grid.name, object3d: grid, tags: ["type:helper", "helper:grid"] },
    { id: box.uuid, name: box.name, object3d: box, tags: ["type:mesh", "shape:box"] },
    { id: sphere.uuid, name: sphere.name, object3d: sphere, tags: ["type:mesh", "shape:sphere"] },
    { id: plane.uuid, name: plane.name, object3d: plane, tags: ["type:mesh", "shape:plane"] },
  ];

  const tagIndex = buildTagIndex(objects);

  return {
    scene,
    objects,
    getByTag: (tag: string) => [...(tagIndex.get(tag) ?? [])],
    getFirstByTag: (tag: string) => tagIndex.get(tag)?.[0],
  } satisfies SceneGraph;
}

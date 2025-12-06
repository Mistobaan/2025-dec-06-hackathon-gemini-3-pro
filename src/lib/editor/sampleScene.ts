import * as THREE from "three";
import { EditorObject } from "./types";

const defaultCameraPosition = new THREE.Vector3(6, 4, 6);
const frustumSize = 16;

export type SampleSceneBundle = {
  scene: THREE.Scene;
  perspectiveCamera: THREE.PerspectiveCamera;
  orthographicCamera: THREE.OrthographicCamera;
  selectableObjects: EditorObject[];
};

export function createSampleScene(): SampleSceneBundle {
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

  const selectableObjects: EditorObject[] = [
    { id: box.uuid, name: box.name, object3d: box },
    { id: sphere.uuid, name: sphere.name, object3d: sphere },
    { id: plane.uuid, name: plane.name, object3d: plane },
  ];

  return {
    scene,
    perspectiveCamera,
    orthographicCamera,
    selectableObjects,
  };
}

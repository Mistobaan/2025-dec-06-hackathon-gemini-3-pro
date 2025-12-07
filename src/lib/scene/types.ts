import type * as THREE from "three";

export type EditorTransformMode = "translate" | "rotate" | "scale";
export type EditorCameraPreset = "home" | "front" | "side" | "top";

export type SceneObject = {
  id: string;
  name: string;
  object3d: THREE.Object3D;
  tags?: string[];
};

export type SceneGraph = {
  scene: THREE.Scene;
  objects: SceneObject[];
  getByTag: (tag: string) => SceneObject[];
  getFirstByTag: (tag: string) => SceneObject | undefined;
};

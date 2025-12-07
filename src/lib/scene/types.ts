import type * as THREE from "three";

export type EditorTransformMode = "translate" | "rotate" | "scale";
export type EditorCameraPreset = "home" | "front" | "side" | "top";

export type SceneSkybox = {
  type?: "general" | "interior";
  textureUrl?: string;
  height?: number;
  radius?: number;
  resolution?: number;
  aspectRatio?: string;
  negativePrompt?: string;
  availableTextures?: Array<{ label: string; textureUrl: string }>;
};

export type CharacterBoundingBox = {
  color?: number;
  padding?: number;
};

export type SceneObject = {
  id: string;
  name: string;
  object3d: THREE.Object3D;
  tags?: string[];
  bounds?: CharacterBoundingBox;
};

export type SceneGraph = {
  scene: THREE.Scene;
  objects: SceneObject[];
  skybox?: SceneSkybox;
  getByTag: (tag: string) => SceneObject[];
  getFirstByTag: (tag: string) => SceneObject | undefined;
};

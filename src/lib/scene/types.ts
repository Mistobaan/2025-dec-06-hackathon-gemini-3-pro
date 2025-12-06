export type EditorCameraType = "perspective" | "orthographic";
export type EditorTransformMode = "translate" | "rotate" | "scale";
export type EditorCameraPreset = "home" | "front" | "side" | "top";

export type EditorObject = {
  id: string;
  name: string;
  object3d: import("three").Object3D;
};

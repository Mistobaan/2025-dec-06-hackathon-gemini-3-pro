import { EditorCameraType, EditorTransformMode, EditorCameraPreset } from "../scene/types";

export type EditorCommandHandler = {
  setCameraType: (type: EditorCameraType) => void;
  setTransformMode: (mode: EditorTransformMode) => void;
  moveCameraToPreset: (preset: EditorCameraPreset) => void;
  selectObject: (id: string) => void;
  clearSelection: () => void;
};

class EditorCommandLibrary {
  private handler: EditorCommandHandler | null = null;

  register(handler: EditorCommandHandler) {
    this.handler = handler;
  }

  unregister(handler: EditorCommandHandler) {
    if (this.handler === handler) {
      this.handler = null;
    }
  }

  setCameraType(type: EditorCameraType) {
    this.handler?.setCameraType(type);
  }

  setTransformMode(mode: EditorTransformMode) {
    this.handler?.setTransformMode(mode);
  }

  moveCameraToPreset(preset: EditorCameraPreset) {
    this.handler?.moveCameraToPreset(preset);
  }

  selectObject(id: string) {
    this.handler?.selectObject(id);
  }

  clearSelection() {
    this.handler?.clearSelection();
  }
}

export const editorCommands = new EditorCommandLibrary();

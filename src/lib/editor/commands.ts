import { EditorTransformMode, EditorCameraPreset } from "../scene/types";

export type EditorCommandHandler = {
  setCameraByTag: (tag: string) => void;
  setTransformMode: (mode: EditorTransformMode) => void;
  moveCameraToPreset: (preset: EditorCameraPreset) => void;
  selectObject: (id: string) => void;
  selectObjectByTag: (tag: string) => void;
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

  setCameraByTag(tag: string) {
    this.handler?.setCameraByTag(tag);
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

  selectObjectByTag(tag: string) {
    this.handler?.selectObjectByTag(tag);
  }

  clearSelection() {
    this.handler?.clearSelection();
  }
}

export const editorCommands = new EditorCommandLibrary();

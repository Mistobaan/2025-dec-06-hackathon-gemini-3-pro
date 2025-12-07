import type { EditorTransformMode, SceneObject } from "@/lib/scene/types";

export type SceneEditorEvent =
  | { type: "select"; object: SceneObject }
  | { type: "deselect" }
  | { type: "transform-start"; object: SceneObject | null; mode: EditorTransformMode }
  | { type: "transform-change"; object: SceneObject | null; mode: EditorTransformMode }
  | { type: "transform-end"; object: SceneObject | null; mode: EditorTransformMode };

class SceneEditorEventBus {
  private listeners = new Set<(event: SceneEditorEvent) => void>();

  subscribe(listener: (event: SceneEditorEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: SceneEditorEvent) {
    this.listeners.forEach((listener) => listener(event));
  }
}

export const sceneEditorEvents = new SceneEditorEventBus();

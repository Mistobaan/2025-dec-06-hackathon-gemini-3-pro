"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { createSampleScene } from "@/lib/scenes/sampleScene";

const SceneEditorCanvas = dynamic(() => import("@/components/editor/SceneEditorCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-zinc-500">
      Loading editor...
    </div>
  ),
});

export default function EditorPage() {
  const sample = useMemo(() => createSampleScene(), []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-100">
      <SceneEditorCanvas
        scene={sample}
        defaultCameraTag="camera:perspective"
        selectableObjects={sample.objects.filter((o) => !o.tags?.includes("type:camera"))}
      />
    </div>
  );
}

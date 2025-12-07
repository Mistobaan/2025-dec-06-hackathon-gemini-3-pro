"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createSampleScene } from "@/lib/scenes/sampleScene";
import { TimelineFrame, TimelineFrameSlot } from "@/lib/timeline/types";
import { SceneEditorHandle } from "@/components/editor/SceneEditorCanvas";
import { TimelineFrameCard } from "@/components/editor/TimelineFrameCard";
import { GeneratedVideoCard } from "@/components/editor/GeneratedVideoCard";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const SceneEditorCanvas = dynamic(
  () => import("@/components/editor/SceneEditorCanvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-zinc-500">
        Loading editor...
      </div>
    ),
  }
);

type FrameState = Record<TimelineFrameSlot, TimelineFrame | null>;

const defaultPrompt =
  "Generate a smooth 4-second camera move that eases between the first and last frames. Blend motion naturally and preserve scene lighting.";

function dataUrlToPayload(dataUrl: string) {
  const [meta, base64] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  return { data: base64 ?? "", mimeType: mimeMatch?.[1] ?? "image/png" };
}

function base64ToObjectUrl(base64: string, mimeType: string) {
  const byteString = atob(base64);
  const buffer = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i += 1) {
    buffer[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}

export default function EditorPage() {
  const sample = useMemo(() => createSampleScene(), []);
  const editorRef = useRef<SceneEditorHandle | null>(null);
  const [frames, setFrames] = useState<FrameState>({ start: null, end: null });
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMime, setVideoMime] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const handleCapture = useCallback(
    (slot: TimelineFrameSlot) => {
      setError(null);
      const capture = editorRef.current?.captureFrame();
      if (!capture) return;
      setFrames((prev) => ({
        ...prev,
        [slot]: { slot, imageDataUrl: capture.dataUrl, camera: capture.camera },
      }));
    },
    []
  );

  const handleApplyFrame = useCallback((frame: TimelineFrame) => {
    editorRef.current?.setCameraState(frame.camera);
  }, []);

  const handleGenerate = useCallback(async () => {
    setError(null);
    if (!frames.start || !frames.end) {
      setError("Capture both start and end frames before generating.");
      return;
    }

    setIsGenerating(true);
    setVideoUrl(null);

    try {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          startFrame: { ...dataUrlToPayload(frames.start.imageDataUrl), camera: frames.start.camera },
          endFrame: { ...dataUrlToPayload(frames.end.imageDataUrl), camera: frames.end.camera },
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? "Video generation failed");
      }

      const payload = (await res.json()) as { videoBase64: string; mimeType: string };
      const url = base64ToObjectUrl(payload.videoBase64, payload.mimeType ?? "video/mp4");
      setVideoUrl(url);
      setVideoMime(payload.mimeType);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [frames.end, frames.start, prompt]);

  const canGenerate = Boolean(frames.start && frames.end && !isGenerating);

  return (
    <div className="grid h-screen grid-cols-1 gap-4 bg-gradient-to-br from-zinc-50 via-white to-zinc-100 p-4 lg:grid-cols-[2fr_1fr]">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
        <div className="absolute left-4 top-4 z-10 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          Scene Editor
        </div>
        <SceneEditorCanvas
          ref={editorRef}
          scene={sample}
          defaultCameraTag="camera:perspective"
          selectableObjects={sample.objects.filter((o) => !o.tags?.includes("type:camera"))}
        />
      </div>

      <div className="flex h-[calc(100vh-2rem)] flex-col gap-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-zinc-900">Timeline</div>
            <p className="text-sm text-zinc-600">Capture first/last frames from the scene camera, then send to Google.</p>
          </div>
          <div className="flex gap-2 text-xs text-zinc-500">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Start
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" /> End
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3">
            <TimelineFrameCard slot="start" frame={frames.start} onCapture={() => handleCapture("start")} onApply={handleApplyFrame} />
            <TimelineFrameCard slot="end" frame={frames.end} onCapture={() => handleCapture("end")} onApply={handleApplyFrame} />
          </div>

          <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-900">Video prompt</div>
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">Google Generative Video</span>
            </div>
            <Textarea
              className="mt-2 resize-none"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the motion between the two frames..."
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-zinc-500">
                The two captured frames are sent as keyframes to guide the generation.
              </div>
              <Button onClick={handleGenerate} disabled={!canGenerate}>
                {isGenerating ? "Creating..." : "Generate video"}
              </Button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <div className="text-sm font-semibold">Request failed</div>
              <div className="text-sm text-zinc-700">{error}</div>
            </Alert>
          )}

          <GeneratedVideoCard
            videoUrl={videoUrl}
            mimeType={videoMime}
            isLoading={isGenerating}
            prompt={prompt}
            onReset={() => {
              setVideoUrl(null);
              setVideoMime(undefined);
              setError(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}

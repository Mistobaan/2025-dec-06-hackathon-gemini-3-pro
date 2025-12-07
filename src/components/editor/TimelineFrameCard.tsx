"use client";

import type React from "react";
import { TimelineFrame, TimelineFrameSlot } from "@/lib/timeline/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type TimelineFrameCardProps = {
  slot: TimelineFrameSlot;
  frame?: TimelineFrame | null;
  onCapture: () => void;
  onApply?: (frame: TimelineFrame) => void;
  disabled?: boolean;
};

function formatVec(vec: [number, number, number]) {
  return vec.map((v) => v.toFixed(2)).join(", ");
}

const slotCopy: Record<TimelineFrameSlot, { title: string; accent: string }> = {
  start: { title: "Start Frame", accent: "from-emerald-500/20 to-emerald-500/0" },
  end: { title: "End Frame", accent: "from-blue-500/20 to-blue-500/0" },
};

export function TimelineFrameCard({ slot, frame, onCapture, onApply, disabled }: TimelineFrameCardProps) {
  const copy = slotCopy[slot];
  const canApply = Boolean(frame && onApply);

  const handleApply = () => {
    if (!frame || !onApply) return;
    onApply(frame);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canApply) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onApply?.(frame!);
    }
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm",
        canApply && "transition hover:-translate-y-[1px] hover:border-zinc-300 hover:shadow-md"
      )}
    >
      <div className={cn("absolute inset-0 bg-gradient-to-br", copy.accent)} aria-hidden />
      <div className="relative flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900">{copy.title}</div>
            <p className="text-xs text-zinc-600">Capture the current camera to anchor this end of the clip.</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              onCapture();
            }}
            disabled={disabled}
          >
            Capture
          </Button>
        </div>

        <div
          className={cn(
            "flex gap-3 rounded-lg",
            canApply && "cursor-pointer transition hover:bg-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500/50"
          )}
          onClick={canApply ? handleApply : undefined}
          onKeyDown={canApply ? handleKeyDown : undefined}
          role={canApply ? "button" : undefined}
          tabIndex={canApply ? 0 : undefined}
          aria-label={canApply ? `Set editor to ${copy.title.toLowerCase()} camera` : undefined}
        >
          <div className="aspect-video w-40 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
            {frame ? (
              <img src={frame.imageDataUrl} alt={`${copy.title} preview`} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-400">No frame yet</div>
            )}
          </div>
          <div className="flex-1 space-y-1 text-xs text-zinc-700">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-zinc-900">Camera pose</div>
              {canApply && <div className="text-[11px] font-medium text-emerald-700">Click to load</div>}
            </div>
            <div className="grid grid-cols-[80px_1fr] items-start gap-x-2 gap-y-1">
              <div className="text-zinc-500">Position</div>
              <div className="font-mono text-[11px]">{frame ? formatVec(frame.camera.position) : "—"}</div>
              <div className="text-zinc-500">Target</div>
              <div className="font-mono text-[11px]">{frame ? formatVec(frame.camera.target) : "—"}</div>
              <div className="text-zinc-500">Up</div>
              <div className="font-mono text-[11px]">{frame ? formatVec(frame.camera.up) : "—"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

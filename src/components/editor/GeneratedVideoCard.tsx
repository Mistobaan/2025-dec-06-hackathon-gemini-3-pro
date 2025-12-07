"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type GeneratedVideoCardProps = {
  videoUrl?: string | null;
  mimeType?: string;
  isLoading?: boolean;
  prompt: string;
  onReset?: () => void;
};

export function GeneratedVideoCard({ videoUrl, mimeType, isLoading, prompt, onReset }: GeneratedVideoCardProps) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900">Generated video</div>
          <p className="text-xs text-zinc-600">Result from the Google Video API using your timeline anchors.</p>
        </div>
        {onReset && (
          <Button size="sm" variant="ghost" onClick={onReset}>
            Clear
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
        {isLoading ? (
          <div className="aspect-video">
            <Skeleton className="h-full w-full" />
          </div>
        ) : videoUrl ? (
          <video key={videoUrl} controls className="h-full w-full bg-black" preload="metadata">
            <source src={videoUrl} type={mimeType ?? "video/mp4"} />
            Your browser does not support the video tag.
          </video>
        ) : (
          <div className="flex aspect-video items-center justify-center text-xs text-zinc-400">No output yet</div>
        )}
      </div>

      <div className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700">
        <div className="font-semibold text-zinc-900">Prompt</div>
        <div className="line-clamp-2">{prompt}</div>
      </div>
    </Card>
  );
}

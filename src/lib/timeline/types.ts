import { SceneCameraState } from "@/lib/scene/types";

export type TimelineFrameSlot = "start" | "end";

export type TimelineFrame = {
  slot: TimelineFrameSlot;
  imageDataUrl: string;
  camera: SceneCameraState;
};

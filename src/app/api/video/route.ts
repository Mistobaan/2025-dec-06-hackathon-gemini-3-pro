import { GoogleGenAI, Part } from '@google/genai';

import { NextResponse } from "next/server";
import type { SceneCameraState } from "@/lib/scene/types";

type FramePayload = {
  data: string;
  mimeType: string;
  camera: SceneCameraState;
};

const FALLBACK_PROMPT =
  "Generate a smooth 4-second camera motion that interpolates between the provided start and end frames while preserving lighting, composition, and subject placement.";

function buildPromptPart(prompt: string, startFrame: FramePayload, endFrame: FramePayload): Part {
  const startCam = JSON.stringify(startFrame.camera);
  const endCam = JSON.stringify(endFrame.camera);
  return {
    text: `${prompt}\n\nUse the first image as the start keyframe and the second image as the end keyframe. Respect the camera poses as JSON.\nStart camera: ${startCam}\nEnd camera: ${endCam}\nBlend motion naturally with minimal jitter.`,
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const { prompt, startFrame, endFrame } = (body ?? {}) as {
    prompt?: string;
    startFrame?: FramePayload;
    endFrame?: FramePayload;
  };

  if (!startFrame || !endFrame) {
    return NextResponse.json({ error: "Both startFrame and endFrame are required" }, { status: 400 });
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });

    const parts: Part[] = [
      buildPromptPart(prompt?.trim() || FALLBACK_PROMPT, startFrame, endFrame),
      { inlineData: { mimeType: startFrame.mimeType, data: startFrame.data } },
      { inlineData: { mimeType: endFrame.mimeType, data: endFrame.data } },
    ];

    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "video/mp4",
      },
    });

    const videoInline = result.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .find((part) => "inlineData" in part && part.inlineData?.data);

    if (!videoInline || !("inlineData" in videoInline) || !videoInline.inlineData?.data) {
      return NextResponse.json({ error: "No video payload returned from Google" }, { status: 502 });
    }

    return NextResponse.json({
      videoBase64: videoInline.inlineData.data,
      mimeType: videoInline.inlineData.mimeType ?? "video/mp4",
    });
  } catch (err) {
    console.error("Video generation failed", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

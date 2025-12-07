import { NextResponse } from "next/server";
import type { SceneCameraState } from "@/lib/scene/types";

type FramePayload = {
  data: string;
  mimeType: string;
  camera: SceneCameraState;
};

const FALLBACK_PROMPT =
  "Generate a smooth 4-second camera motion that interpolates between the provided start and end frames while preserving lighting, composition, and subject placement.";

function buildPromptText(prompt: string, startFrame: FramePayload, endFrame: FramePayload) {
  const startCam = JSON.stringify(startFrame.camera);
  const endCam = JSON.stringify(endFrame.camera);
  return `${prompt}\n\nUse the first image as the start keyframe and the second image as the end keyframe. Respect the camera poses as JSON.\nStart camera: ${startCam}\nEnd camera: ${endCam}\nBlend motion naturally with minimal jitter.`;
}

export async function POST(req: Request) {
  const requestId = `vid-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const startTime = Date.now();
  const log = (...args: unknown[]) => console.log(`[api/video ${requestId}]`, ...args);

  const body = await req.json().catch(() => null);
  const { prompt, startFrame, endFrame } = (body ?? {}) as {
    prompt?: string;
    startFrame?: FramePayload;
    endFrame?: FramePayload;
  };

  if (!startFrame || !endFrame) {
    log("Missing frame(s) in request body", { hasStart: Boolean(startFrame), hasEnd: Boolean(endFrame) });
    return NextResponse.json({ error: "Both startFrame and endFrame are required" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log("Missing API key environment variable");
    return NextResponse.json(
      { error: "Missing GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable" },
      { status: 500 }
    );
  }

  const projectId =
    process.env.VERTEX_PROJECT_ID ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    "oct-6-hackaton-leanmcp";
  const location = process.env.VERTEX_LOCATION_ID || "us-central1";
  const modelId = process.env.VERTEX_MODEL_ID || "veo-3.1-generate-001";

  const baseUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}`;
  const predictUrl = `${baseUrl}:predictLongRunning?key=${apiKey}`;
  const fetchUrl = `${baseUrl}:fetchPredictOperation?key=${apiKey}`;

  const promptText = buildPromptText(prompt?.trim() || FALLBACK_PROMPT, startFrame, endFrame);

  const predictPayload = {
    instances: [
      {
        'prompt': promptText,
        'image': {
          bytesBase64Encoded: startFrame.data,
          mimeType: startFrame.mimeType,
        },
        'lastFrame': {
          bytesBase64Encoded: endFrame.data,
          mimeType: endFrame.mimeType,
        },
      }
    ],
    parameters: {
      aspectRatio: "16:9",
      sampleCount: 1,
      durationSeconds: "4",
      personGeneration: "allow_all",
      addWatermark: true,
      includeRaiReason: true,
      generateAudio: false,
      resolution: "720p",
    },
  };

  try {
    log("Sending predictLongRunning request", {
      projectId,
      location,
      modelId,
      promptLength: promptText.length,
      startImageBytes: startFrame.data.length,
      endImageBytes: endFrame.data.length,
    });

    const predictRes = await fetch(predictUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(predictPayload),
    });

    if (!predictRes.ok) {
      const text = await predictRes.text().catch(() => "");
      log("predictLongRunning failed", { status: predictRes.status, body: text.slice(0, 500) });
      return NextResponse.json(
        { error: `predictLongRunning failed (${predictRes.status}): ${text}` },
        { status: 502 }
      );
    }

    const predictJson = (await predictRes.json()) as { name?: string };
    const operationName = predictJson?.name;

    if (!operationName) {
      log("predictLongRunning response missing operation name", { predictJson });
      return NextResponse.json({ error: "predictLongRunning did not return an operation name" }, { status: 502 });
    }

    log("Received operation name", { operationName });

    const startTime = Date.now();
    const timeoutMs = 3 * 60 * 1000;
    const pollInterval = 2000;

    let pollResponse: any = null;
    let polls = 0;

    for (; ;) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error("Video generation timed out");
      }

      const fetchRes = await fetch(fetchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operationName }),
      });

      if (!fetchRes.ok) {
        const text = await fetchRes.text().catch(() => "");
        return NextResponse.json(
          { error: `fetchPredictOperation failed (${fetchRes.status}): ${text}` },
          { status: 502 }
        );
      }

      pollResponse = await fetchRes.json();
      polls += 1;
      if (polls === 1 || pollResponse?.done || polls % 5 === 0) {
        log("Polled fetchPredictOperation", {
          polls,
          done: Boolean(pollResponse?.done),
          elapsedMs: Date.now() - startTime,
        });
      }
      if (pollResponse?.done) break;

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    const predictions = (pollResponse?.response?.predictions ?? []) as Array<Record<string, any>>;
    const videosField = (pollResponse?.response as { videos?: Array<Record<string, any>> } | undefined)?.videos ?? [];

    const candidates: Array<Record<string, any>> = [];
    if (Array.isArray(predictions)) candidates.push(...predictions);
    if (Array.isArray(videosField)) candidates.push(...videosField);
    // some responses nest under .video
    candidates.push(
      ...videosField
        .map((v) => (v && typeof v === "object" && "video" in v ? (v as { video?: Record<string, any> }).video : null))
        .filter(Boolean)
        .map((v) => v as Record<string, any>)
    );

    const pickBase64From = (entry: Record<string, any>) =>
      entry.videoBytesBase64 ||
      entry.bytesBase64Encoded ||
      entry.videoBytes ||
      entry.base64 ||
      entry.video?.bytesBase64Encoded ||
      entry.video?.videoBytes;

    const pickUriFrom = (entry: Record<string, any>) =>
      entry.videoUri || entry.uri || entry.video?.uri || entry.outputUri;

    let foundBase64: string | undefined;
    let foundMime: string | undefined;
    let foundUri: string | undefined;

    for (const entry of candidates) {
      const base64 = pickBase64From(entry);
      const uri = pickUriFrom(entry);
      if (base64 || uri) {
        foundBase64 = base64;
        foundUri = uri;
        foundMime = entry.mimeType || entry.video?.mimeType || "video/mp4";
        break;
      }
    }

    if (foundBase64) {
      log("Returning base64 video", {
        mimeType: foundMime,
        length: foundBase64.length,
        elapsedMs: Date.now() - startTime,
        fromVideosField: videosField.length > 0,
      });
      return NextResponse.json({ videoBase64: foundBase64, mimeType: foundMime ?? "video/mp4" });
    }

    if (foundUri) {
      log("Returning video URI", {
        mimeType: foundMime,
        videoUri: foundUri,
        elapsedMs: Date.now() - startTime,
        fromVideosField: videosField.length > 0,
      });
      return NextResponse.json({ videoUri: foundUri, mimeType: foundMime ?? "video/mp4" });
    }

    log("No video payload in poll response", { pollResponse, candidatesCount: candidates.length });
    return NextResponse.json({ error: "No video payload returned from Vertex" }, { status: 502 });
  } catch (err) {
    log("Video generation failed", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

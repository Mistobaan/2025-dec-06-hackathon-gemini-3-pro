/**
 * Gemini Skybox Generator Library
 * A TypeScript utility to generate seamless 360-degree equirectangular skybox textures
 * using Google's Imagen 3 model via the Gemini API.
 *
 * This mirrors the reference implementation provided in the brief and can be
 * consumed by UI layers to request AI generated skyboxes. The helper also exposes
 * recommended GroundedSkybox settings for interior vs general scenes.
 */
export interface SkyboxGenerationOptions {
  type: "general" | "interior";
  aspectRatio?: string;
  negativePrompt?: string;
}

export interface SkyboxResult {
  base64Image: string;
  enhancedPrompt: string;
  recommendedSettings: {
    radius: number;
    height: number;
  };
}

export class GeminiSkyboxGenerator {
  private apiKey: string;
  private modelEndpoint: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.modelEndpoint =
      "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict";
  }

  async generateSkybox(
    prompt: string,
    options: SkyboxGenerationOptions = { type: "general" }
  ): Promise<SkyboxResult> {
    const enhancedPrompt = this.constructPrompt(prompt, options.type);

    const response = await fetch(`${this.modelEndpoint}?key=${this.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt: enhancedPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: options.aspectRatio || "16:9",
          negativePrompt:
            options.negativePrompt ||
            "blurry, distortion, low quality, text, watermarks, frames, borders",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.predictions || data.predictions.length === 0) {
      throw new Error("No predictions returned from the model.");
    }

    const base64Image = data.predictions[0].bytesBase64Encoded as string;

    return {
      base64Image,
      enhancedPrompt,
      recommendedSettings: this.getRecommendedSettings(options.type),
    };
  }

  private constructPrompt(basePrompt: string, type: "general" | "interior"): string {
    const technicalKeywords = [
      "equirectangular projection",
      "360 degree panoramic view",
      "seamless",
      "8k resolution",
      "highly detailed",
    ];

    if (type === "interior") {
      technicalKeywords.push(
        "from center of room",
        "architectural photography",
        "wide angle",
        "clear floor",
        "symmetrical",
        "3-point perspective"
      );
    } else {
      technicalKeywords.push("horizon line", "epic scale", "environment design");
    }

    return `${basePrompt}, ${technicalKeywords.join(", ")}`;
  }

  getRecommendedSettings(type: "general" | "interior") {
    if (type === "interior") {
      return { radius: 25, height: 12 };
    }
    return { radius: 100, height: 15 };
  }
}

export function getRecommendedSkyboxSettings(type: "general" | "interior") {
  const generator = new GeminiSkyboxGenerator("");
  return generator.getRecommendedSettings(type);
}

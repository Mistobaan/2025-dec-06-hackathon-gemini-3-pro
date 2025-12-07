import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";

function labelFromFilename(filename: string) {
  const base = filename.replace(/\.png$/i, "");
  const words = base.split(/[-_\s]+/g).filter(Boolean);
  if (!words.length) return filename;
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function GET() {
  const skyboxDir = path.join(process.cwd(), "public", "assets", "skyboxes");

  try {
    const entries = await readdir(skyboxDir, { withFileTypes: true });
    const skyboxes = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
      .map((entry) => ({
        label: labelFromFilename(entry.name),
        textureUrl: `/assets/skyboxes/${entry.name}`,
      }));

    return NextResponse.json({ skyboxes });
  } catch (error) {
    console.warn("Failed to read /public/assets/skyboxes", error);
    return NextResponse.json({ skyboxes: [] });
  }
}

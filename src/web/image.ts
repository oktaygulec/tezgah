// Product photos: shrink a chosen picture in the browser before upload, and show thumbnails.

import { productImageUrl } from "../shared/types";
import { h } from "./ui";

const MAX_SIDE = 600;
const QUALITY = 0.85;

/** Reads an image file and returns a JPEG of at most 600 x 600 pixels (white behind transparent parts). */
export async function shrinkImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Bu dosya açılamadı. JPEG veya PNG bir fotoğraf seçin.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = h("canvas", { width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) throw new Error("Fotoğraf küçültülemedi.");
  return blob;
}

/** A square thumbnail: the photo, or the first letter of the name when there is no photo. */
export function thumbnail(p: { id: number; name: string; image_at: string | null }, size: "sm" | "md" | "lg" = "sm"): HTMLElement {
  const url = productImageUrl(p);
  if (url) return h("img", { class: `thumb thumb-${size}`, src: url, alt: "", loading: "lazy" });
  return h("span", { class: `thumb thumb-${size} thumb-empty`, "aria-hidden": "true" }, p.name.trim().charAt(0).toLocaleUpperCase("tr-TR") || "?");
}

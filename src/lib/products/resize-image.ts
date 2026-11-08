"use client";

// ============================================================
// Browser-side photo shrink before upload.
//
// Phone photos are 3–8 MB. A product photo only needs to be clear
// enough for (a) the customer on WhatsApp and (b) the AI comparing it
// with a customer's photo, so we resize to at most 1024 px on the long
// side and re-encode as JPEG. Typical result: 80–250 KB. That keeps
// storage small and the AI request fast and cheap.
// ============================================================

export const PRODUCT_PHOTO_MAX_SIDE = 1024;
export const PRODUCT_PHOTO_INPUT_MAX_BYTES = 20 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

export const PRODUCT_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    img.src = url;
  });
}

/**
 * Resize + re-encode a photo. Throws "unsupported" / "too_large" /
 * "unreadable" as the Error message so the caller can show the right
 * translated toast.
 */
export async function shrinkProductPhoto(file: File): Promise<File> {
  if (!PRODUCT_PHOTO_ACCEPT.split(",").includes(file.type)) {
    throw new Error("unsupported");
  }
  if (file.size > PRODUCT_PHOTO_INPUT_MAX_BYTES) {
    throw new Error("too_large");
  }
  const img = await loadImage(file);
  const scale = Math.min(
    1,
    PRODUCT_PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("unreadable");
  // White background so transparent PNGs don't turn black as JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("unreadable");
  const base = file.name.replace(/\.[^.]+$/, "") || "product";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

/** Read a File as base64 (no data: prefix) — used by the Playground
 *  photo test. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("unreadable"));
    reader.readAsDataURL(file);
  });
}

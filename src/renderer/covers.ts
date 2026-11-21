import { MAX_COVER_CHARS } from '../core';

const SIDE = 500;

/**
 * Turn a picked image into a small square-ish JPEG data URL that fits in settings.json.
 * Longest side is scaled down to 500px; quality steps down until it is small enough.
 */
export async function coverFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not read that image');
  }
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image');
  ctx.fillStyle = '#000'; // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= MAX_COVER_CHARS) return url;
  }
  throw new Error('That image is too detailed to keep; try a smaller one');
}

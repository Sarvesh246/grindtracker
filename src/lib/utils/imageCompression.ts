/**
 * Resizes and re-encodes an image client-side before upload, so progress
 * photos (logged indefinitely, unlike rare feedback screenshots) stay small
 * and fast to load on mobile. Always outputs JPEG.
 *
 * `imageOrientation: 'from-image'` is load-bearing, not decorative — without
 * it, cross-browser EXIF-rotation handling for createImageBitmap is
 * inconsistent and can silently produce sideways photos.
 */
export async function compressImage(
  file: File,
  maxDim = 1600,
  quality = 0.82
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        quality
      )
    })
  } finally {
    bitmap.close()
  }
}

/**
 * Best-effort compression with a raw-file fallback for images the browser
 * can't decode via createImageBitmap (e.g. unconverted HEIC on non-Safari
 * browsers). Returns null if neither path produces a file under maxBytes.
 */
export async function compressForUpload(
  file: File,
  maxBytes: number,
  maxDim = 1600,
  quality = 0.82
): Promise<Blob | null> {
  try {
    const compressed = await compressImage(file, maxDim, quality)
    if (compressed.size <= maxBytes) return compressed
  } catch {
    // Fall through to the raw-file fallback below.
  }
  if (file.size <= maxBytes) return file
  return null
}

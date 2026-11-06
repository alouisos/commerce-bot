export type SniffedImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  return bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
}

/** Identifies an image by its magic bytes; returns null for anything else. */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

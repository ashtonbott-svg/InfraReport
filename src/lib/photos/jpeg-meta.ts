/**
 * Read-only metadata from an original photo file (the file itself is never changed).
 * JPEG: segment list (APPn markers and their identifiers), EXIF Make / Model / DateTimeOriginal /
 * image size, and whether the file carries a large embedded data block typical of radiometric
 * thermal images (HIKMICRO and other thermal cameras store temperature data in extra APP segments).
 */
export interface PhotoMeta {
  format: "jpeg" | "png" | "heic" | "other";
  make?: string;
  model?: string;
  takenAt?: string;
  width?: number;
  height?: number;
  /** APPn segments: marker number, identifier text, size in bytes. */
  segments?: { app: number; id: string; size: number }[];
  /** Large non-EXIF data segments (likely thermal data). A hint only, never the sole basis for a match. */
  radiometric?: boolean;
}

const ascii = (b: Uint8Array, from: number, max: number) => {
  let s = "";
  for (let i = from; i < Math.min(b.length, from + max); i++) {
    const c = b[i];
    if (c === 0) break;
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : "";
  }
  return s;
};

function readExif(b: Uint8Array, start: number, end: number, out: PhotoMeta) {
  // start points at "Exif\0\0"; TIFF header follows.
  const t = start + 6;
  if (t + 8 > end) return;
  const le = b[t] === 0x49;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const str = (count: number, valueOff: number) => ascii(b, count <= 4 ? valueOff : t + u32(valueOff), Math.min(count, 64)).trim();
  const walk = (ifd: number, depth: number) => {
    if (depth > 2 || t + ifd + 2 > end) return;
    const n = u16(t + ifd);
    for (let i = 0; i < n && i < 200; i++) {
      const e = t + ifd + 2 + i * 12;
      if (e + 12 > end) return;
      const tag = u16(e), count = u32(e + 4), val = e + 8;
      if (tag === 0x010f) out.make = str(count, val);
      else if (tag === 0x0110) out.model = str(count, val);
      else if (tag === 0x9003) { const d = str(count, val); const m = d.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/); if (m) out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`; }
      else if (tag === 0xa002) out.width = count === 1 ? (u16(e + 2) === 3 ? u16(val) : u32(val)) : undefined;
      else if (tag === 0xa003) out.height = count === 1 ? (u16(e + 2) === 3 ? u16(val) : u32(val)) : undefined;
      else if (tag === 0x8769) walk(u32(val), depth + 1);
    }
  };
  walk(u32(t + 4), 0);
}

export function readPhotoMeta(bytes: Uint8Array): PhotoMeta {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { format: "png" };
  if (ascii(bytes, 4, 8).startsWith("ftyphei") || ascii(bytes, 4, 8).startsWith("ftypmif")) return { format: "heic" };
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return { format: "other" };
  const out: PhotoMeta = { format: "jpeg", segments: [] };
  let p = 2;
  while (p + 4 <= bytes.length && bytes[p] === 0xff) {
    const marker = bytes[p + 1];
    if (marker === 0xda || marker === 0xd9) break; // image data starts
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (len < 2) break;
    if (marker >= 0xe0 && marker <= 0xef) {
      const id = ascii(bytes, p + 4, 24);
      out.segments!.push({ app: marker - 0xe0, id, size: len });
      if (marker === 0xe1 && id.startsWith("Exif")) readExif(bytes, p + 4, p + 2 + len, out);
    } else if (marker === 0xc0 || marker === 0xc2) {
      out.height ??= (bytes[p + 5] << 8) | bytes[p + 6];
      out.width ??= (bytes[p + 7] << 8) | bytes[p + 8];
    }
    p += 2 + len;
  }
  const big = out.segments!.filter((s) => !(s.app === 1 && s.id.startsWith("Exif")) && s.app !== 0 && s.size > 16_000);
  out.radiometric = big.length > 0 || out.segments!.some((s) => /FLIR|HIK|IRIMG|THERM|RADIOMETR/i.test(s.id));
  return out;
}

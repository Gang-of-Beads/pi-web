/**
 * ThumbHash: a placeholder of about twenty bytes that decodes to a blurred image with the right aspect
 * ratio, so a file preview draws something before any image bytes arrive.
 *
 * A TypeScript port of the reference encoder and decoder of ThumbHash by Evan Wallace
 * (https://github.com/evanw/thumbhash), Copyright (c) 2023 Evan Wallace, MIT License. The bytes are the
 * reference format: the machine that has the image encodes, the browser decodes, and either side can
 * be swapped for the original implementation.
 */

/** The largest side the encoder takes; a larger image adds work and no detail. */
export const THUMBHASH_MAX_SIDE = 100;

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row by row, four bytes a pixel, not premultiplied by alpha. */
  readonly rgba: Uint8Array;
}

interface EncodedChannel {
  readonly dc: number;
  readonly ac: readonly number[];
  readonly scale: number;
}

export function rgbaToThumbHash(image: RgbaImage): Uint8Array {
  const { width: w, height: h, rgba } = image;
  if (w > THUMBHASH_MAX_SIDE || h > THUMBHASH_MAX_SIDE) {
    throw new RangeError(`${String(w)}x${String(h)} does not fit in ${String(THUMBHASH_MAX_SIDE)}x${String(THUMBHASH_MAX_SIDE)}`);
  }
  const pixels = w * h;
  const byte = (index: number): number => rgba[index] ?? 0;
  let averageR = 0;
  let averageG = 0;
  let averageB = 0;
  let averageA = 0;
  for (let i = 0, j = 0; i < pixels; i += 1, j += 4) {
    const alpha = byte(j + 3) / 255;
    averageR += (alpha / 255) * byte(j);
    averageG += (alpha / 255) * byte(j + 1);
    averageB += (alpha / 255) * byte(j + 2);
    averageA += alpha;
  }
  if (averageA > 0) {
    averageR /= averageA;
    averageG /= averageA;
    averageB /= averageA;
  }

  const hasAlpha = averageA < pixels;
  const luminanceLimit = hasAlpha ? 5 : 7;
  const lx = Math.max(1, Math.round((luminanceLimit * w) / Math.max(w, h)));
  const ly = Math.max(1, Math.round((luminanceLimit * h) / Math.max(w, h)));
  const luminance = new Float64Array(pixels);
  const yellowBlue = new Float64Array(pixels);
  const redGreen = new Float64Array(pixels);
  const opacity = new Float64Array(pixels);
  for (let i = 0, j = 0; i < pixels; i += 1, j += 4) {
    const alpha = byte(j + 3) / 255;
    const r = averageR * (1 - alpha) + (alpha / 255) * byte(j);
    const g = averageG * (1 - alpha) + (alpha / 255) * byte(j + 1);
    const b = averageB * (1 - alpha) + (alpha / 255) * byte(j + 2);
    luminance[i] = (r + g + b) / 3;
    yellowBlue[i] = (r + g) / 2 - b;
    redGreen[i] = r - g;
    opacity[i] = alpha;
  }

  const encode = (channel: Float64Array, nx: number, ny: number): EncodedChannel => {
    let dc = 0;
    let scale = 0;
    const ac: number[] = [];
    const fx = new Float64Array(w);
    for (let cy = 0; cy < ny; cy += 1) {
      for (let cx = 0; cx * ny < nx * (ny - cy); cx += 1) {
        let f = 0;
        for (let x = 0; x < w; x += 1) fx[x] = Math.cos((Math.PI / w) * cx * (x + 0.5));
        for (let y = 0; y < h; y += 1) {
          const fy = Math.cos((Math.PI / h) * cy * (y + 0.5));
          for (let x = 0; x < w; x += 1) f += (channel[x + y * w] ?? 0) * (fx[x] ?? 0) * fy;
        }
        f /= pixels;
        if (cx > 0 || cy > 0) {
          ac.push(f);
          scale = Math.max(scale, Math.abs(f));
        } else {
          dc = f;
        }
      }
    }
    return { dc, ac: scale > 0 ? ac.map((value) => 0.5 + (0.5 / scale) * value) : ac, scale };
  };
  const l = encode(luminance, Math.max(3, lx), Math.max(3, ly));
  const p = encode(yellowBlue, 3, 3);
  const q = encode(redGreen, 3, 3);
  const a = hasAlpha ? encode(opacity, 5, 5) : undefined;

  const isLandscape = w > h;
  const header24 = Math.round(63 * l.dc)
    | (Math.round(31.5 + 31.5 * p.dc) << 6)
    | (Math.round(31.5 + 31.5 * q.dc) << 12)
    | (Math.round(31 * l.scale) << 18)
    | ((hasAlpha ? 1 : 0) << 23);
  const header16 = (isLandscape ? ly : lx)
    | (Math.round(63 * p.scale) << 3)
    | (Math.round(63 * q.scale) << 9)
    | ((isLandscape ? 1 : 0) << 15);
  const hash = [header24 & 255, (header24 >> 8) & 255, header24 >> 16, header16 & 255, header16 >> 8];
  if (a !== undefined) hash.push(Math.round(15 * a.dc) | (Math.round(15 * a.scale) << 4));
  const acStart = hash.length;
  let acIndex = 0;
  for (const channel of a === undefined ? [l, p, q] : [l, p, q, a]) {
    for (const f of channel.ac) {
      const at = acStart + (acIndex >> 1);
      hash[at] = (hash[at] ?? 0) | (Math.round(15 * f) << ((acIndex & 1) << 2));
      acIndex += 1;
    }
  }
  return Uint8Array.from(hash);
}

/** The placeholder a hash describes, at most 32 pixels on its longer side. */
export function thumbHashToRgba(hash: Uint8Array): RgbaImage {
  const byte = (index: number): number => hash[index] ?? 0;
  const header24 = byte(0) | (byte(1) << 8) | (byte(2) << 16);
  const header16 = byte(3) | (byte(4) << 8);
  const lDc = (header24 & 63) / 63;
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = (header24 >> 23) !== 0;
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const isLandscape = (header16 >> 15) !== 0;
  const lx = Math.max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = Math.max(3, isLandscape ? header16 & 7 : (hasAlpha ? 5 : 7));
  const aDc = hasAlpha ? (byte(5) & 15) / 15 : 1;
  const aScale = (byte(5) >> 4) / 15;

  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  const decode = (nx: number, ny: number, scale: number): number[] => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy += 1) {
      for (let cx = cy > 0 ? 0 : 1; cx * ny < nx * (ny - cy); cx += 1) {
        ac.push((((byte(acStart + (acIndex >> 1)) >> ((acIndex & 1) << 2)) & 15) / 7.5 - 1) * scale);
        acIndex += 1;
      }
    }
    return ac;
  };
  const lAc = decode(lx, ly, lScale);
  const pAc = decode(3, 3, pScale * 1.25);
  const qAc = decode(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? decode(5, 5, aScale) : [];

  const ratio = thumbHashAspectRatio(hash);
  const w = Math.round(ratio > 1 ? 32 : 32 * ratio);
  const h = Math.round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8Array(w * h * 4);
  const fx = new Float64Array(Math.max(lx, 5));
  const fy = new Float64Array(Math.max(ly, 5));
  for (let y = 0, i = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1, i += 4) {
      let l = lDc;
      let p = pDc;
      let q = qDc;
      let a = aDc;
      for (let cx = 0, n = Math.max(lx, hasAlpha ? 5 : 3); cx < n; cx += 1) fx[cx] = Math.cos((Math.PI / w) * (x + 0.5) * cx);
      for (let cy = 0, n = Math.max(ly, hasAlpha ? 5 : 3); cy < n; cy += 1) fy[cy] = Math.cos((Math.PI / h) * (y + 0.5) * cy);
      for (let cy = 0, j = 0; cy < ly; cy += 1) {
        const fy2 = (fy[cy] ?? 0) * 2;
        for (let cx = cy > 0 ? 0 : 1; cx * ly < lx * (ly - cy); cx += 1, j += 1) l += (lAc[j] ?? 0) * (fx[cx] ?? 0) * fy2;
      }
      for (let cy = 0, j = 0; cy < 3; cy += 1) {
        const fy2 = (fy[cy] ?? 0) * 2;
        for (let cx = cy > 0 ? 0 : 1; cx < 3 - cy; cx += 1, j += 1) {
          const f = (fx[cx] ?? 0) * fy2;
          p += (pAc[j] ?? 0) * f;
          q += (qAc[j] ?? 0) * f;
        }
      }
      if (hasAlpha) {
        for (let cy = 0, j = 0; cy < 5; cy += 1) {
          const fy2 = (fy[cy] ?? 0) * 2;
          for (let cx = cy > 0 ? 0 : 1; cx < 5 - cy; cx += 1, j += 1) a += (aAc[j] ?? 0) * (fx[cx] ?? 0) * fy2;
        }
      }
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = Math.max(0, 255 * Math.min(1, r));
      rgba[i + 1] = Math.max(0, 255 * Math.min(1, g));
      rgba[i + 2] = Math.max(0, 255 * Math.min(1, b));
      rgba[i + 3] = Math.max(0, 255 * Math.min(1, a));
    }
  }
  return { width: w, height: h, rgba };
}

/** The original image's width over its height, as closely as the hash records it. */
export function thumbHashAspectRatio(hash: Uint8Array): number {
  const header = hash[3] ?? 0;
  const hasAlpha = ((hash[2] ?? 0) & 0x80) !== 0;
  const isLandscape = ((hash[4] ?? 0) & 0x80) !== 0;
  const lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7;
  const ly = isLandscape ? header & 7 : (hasAlpha ? 5 : 7);
  return lx / ly;
}

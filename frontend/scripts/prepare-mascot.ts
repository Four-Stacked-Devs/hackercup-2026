/**
 * Turns the delivered EDU renders into web-ready sprites.
 *
 * The source files in public/Asset are 1254px RGB PNGs on an off-white studio
 * background with a soft drop shadow, ~1.5 MB each. Shipping those to a phone
 * on 4G is not an option, and the studio background would read as a grey square
 * on a white card. So this:
 *
 *   1. flood-fills the background inwards from the border, which removes the
 *      backdrop and its shadow while leaving the whites *inside* the character
 *      (the eye, the pencil ferrule, the body stripe) untouched;
 *   2. feathers and un-premultiplies the edge, so no pale halo survives;
 *   3. crops to the character and writes 256px and 96px RGBA sprites.
 *
 * Pure Node — PNG in, PNG out, zlib from the standard library. Run: npm run mascot
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(here, '../public/Asset');
const outDir = resolve(here, '../public/mascot');

/**
 * What counts as part of the character rather than the room it was shot in.
 *
 * The backdrop and its shadow are pale and colourless; every part of EDU is
 * either dark (the body outline) or coloured (pencil, eraser, lime). Using that
 * as the wall — instead of "how close is this to the backdrop colour" — is what
 * lets the fill swallow the drop shadow without eating the white of the eye or
 * the pencil's ferrule, which sit inside a closed dark outline.
 */
const SOLID_MIN_SATURATION = 28;
const SOLID_MAX_LUMA = 168;
const OUTPUT_SIZES = [256, 96];

interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

// ── PNG decode ───────────────────────────────────────────────────────────────

function decodePng(buffer: Buffer): Raster {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (data.readUInt8(12) !== 0) throw new Error('interlaced PNGs not supported');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);

  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    raw.copy(line, 0, cursor, cursor + stride);
    cursor += stride;

    unfilter(filter ?? 0, line, previous, channels);

    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = line[from] ?? 0;
      out[to + 1] = line[from + 1] ?? 0;
      out[to + 2] = line[from + 2] ?? 0;
      out[to + 3] = channels === 4 ? (line[from + 3] ?? 255) : 255;
    }

    previous.set(line);
  }

  return { width, height, data: out };
}

function unfilter(filter: number, line: Uint8Array, previous: Uint8Array, bpp: number): void {
  for (let i = 0; i < line.length; i += 1) {
    const a = i >= bpp ? (line[i - bpp] ?? 0) : 0;
    const b = previous[i] ?? 0;
    const c = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
    const x = line[i] ?? 0;

    switch (filter) {
      case 1:
        line[i] = (x + a) & 0xff;
        break;
      case 2:
        line[i] = (x + b) & 0xff;
        break;
      case 3:
        line[i] = (x + ((a + b) >> 1)) & 0xff;
        break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (x + predictor) & 0xff;
        break;
      }
      default:
        break;
    }
  }
}

// ── PNG encode ───────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng({ width, height, data }: Raster): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width * 4; x += 1) {
      raw[rowStart + 1 + x] = data[y * width * 4 + x] ?? 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Cut-out ──────────────────────────────────────────────────────────────────

/**
 * Alpha from a border flood fill. Connectivity is what protects the character's
 * own whites: they are enclosed by the outline, so the fill never reaches them.
 */
function cutOut(image: Raster): Raster {
  const { width, height, data } = image;
  const at = (x: number, y: number) => (y * width + x) * 4;

  // The backdrop colour, read from the corners.
  const corners = [
    at(2, 2),
    at(width - 3, 2),
    at(2, height - 3),
    at(width - 3, height - 3),
  ];
  const bg = [0, 1, 2].map(
    (channel) =>
      corners.reduce((total, index) => total + (data[index + channel] ?? 0), 0) / corners.length,
  ) as [number, number, number];

  const isSolid = (index: number) => {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    return saturation >= SOLID_MIN_SATURATION || luma <= SOLID_MAX_LUMA;
  };

  const isBackground = new Uint8Array(width * height);
  const queue: number[] = [];

  const push = (x: number, y: number) => {
    const pixel = y * width + x;
    if (isBackground[pixel]) return;
    if (isSolid(pixel * 4)) return;
    isBackground[pixel] = 1;
    queue.push(pixel);
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  while (queue.length > 0) {
    const pixel = queue.pop() as number;
    const x = pixel % width;
    const y = (pixel - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  // Alpha, feathered so the silhouette does not look cut with scissors.
  const alpha = new Float32Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    alpha[pixel] = isBackground[pixel] ? 0 : 1;
  }

  const blurred = boxBlur(alpha, width, height, 1);

  const out = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const a = blurred[pixel] ?? 0;
    const index = pixel * 4;

    if (a <= 0.004) continue;

    // Un-premultiply against the backdrop: an edge pixel is part character,
    // part studio wall, and only the character should survive.
    for (let channel = 0; channel < 3; channel += 1) {
      const mixed = data[index + channel] ?? 0;
      const recovered = a >= 0.999 ? mixed : (mixed - bg[channel]! * (1 - a)) / a;
      out[index + channel] = recovered;
    }
    out[index + 3] = Math.round(a * 255);
  }

  return { width, height, data: out };
}

function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const out = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          total += source[ny * width + nx] ?? 0;
          count += 1;
        }
      }
      out[y * width + x] = count === 0 ? 0 : total / count;
    }
  }
  return out;
}

/** Crop to the visible character, keeping a little air around it. */
function trim(image: Raster, padding = 0.02): Raster {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return image;

  // Square the crop so every expression lines up at the same scale.
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const size = Math.ceil(Math.max(boxWidth, boxHeight) * (1 + padding * 2));
  const centreX = minX + boxWidth / 2;
  const centreY = minY + boxHeight / 2;
  const left = Math.round(centreX - size / 2);
  const top = Math.round(centreY - size / 2);

  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = left + x;
      const sy = top + y;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const from = (sy * width + sx) * 4;
      const to = (y * size + x) * 4;
      out[to] = data[from] ?? 0;
      out[to + 1] = data[from + 1] ?? 0;
      out[to + 2] = data[from + 2] ?? 0;
      out[to + 3] = data[from + 3] ?? 0;
    }
  }

  return { width: size, height: size, data: out };
}

/** Box downscale, weighting colour by alpha so edges keep their hue. */
function resize(image: Raster, size: number): Raster {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(size * size * 4);
  const scale = width / size;

  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(height, Math.floor((y + 1) * scale));

    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(width, Math.floor((x + 1) * scale));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      let samples = 0;

      for (let sy = y0; sy < Math.max(y1, y0 + 1); sy += 1) {
        for (let sx = x0; sx < Math.max(x1, x0 + 1); sx += 1) {
          const index = (sy * width + sx) * 4;
          const alpha = (data[index + 3] ?? 0) / 255;
          r += (data[index] ?? 0) * alpha;
          g += (data[index + 1] ?? 0) * alpha;
          b += (data[index + 2] ?? 0) * alpha;
          a += alpha;
          weight += alpha;
          samples += 1;
        }
      }

      const to = (y * size + x) * 4;
      if (weight > 0) {
        out[to] = r / weight;
        out[to + 1] = g / weight;
        out[to + 2] = b / weight;
      }
      out[to + 3] = samples === 0 ? 0 : (a / samples) * 255;
    }
  }

  return { width: size, height: size, data: out };
}

// ── Run ──────────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });

const sources = readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith('.png'));

for (const name of sources) {
  const slug = name.replace(/\.png$/i, '').toLowerCase();
  const decoded = decodePng(readFileSync(join(sourceDir, name)));
  const cut = trim(cutOut(decoded));

  for (const size of OUTPUT_SIZES) {
    const target = join(outDir, `edu-${slug}-${size}.png`);
    const bytes = encodePng(resize(cut, size));
    writeFileSync(target, bytes);
    console.log(`${target} — ${(bytes.length / 1024).toFixed(1)} KB`);
  }
}

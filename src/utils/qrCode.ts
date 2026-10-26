/**
 * Generador de códigos QR REAL (ISO/IEC 18004), sin dependencias.
 *
 * - Modo byte (UTF-8), niveles de corrección L / M, versiones 1 a 10
 *   (hasta ~213 bytes en nivel L y ~174 en nivel M).
 * - Reed-Solomon sobre GF(256), máscara elegida por penalización.
 *
 * La versión anterior de este archivo dibujaba una matriz pseudoaleatoria que
 * NO era un QR válido y ningún móvil podía escanear.
 */

export type QrEcc = 'L' | 'M';

const ECC_CODEWORDS_PER_BLOCK: Record<QrEcc, number[]> = {
  // índice = versión (0 sin uso)
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
};

const NUM_ERROR_CORRECTION_BLOCKS: Record<QrEcc, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
};

const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0 };

const MIN_VERSION = 1;
const MAX_VERSION = 10;

function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver: number, ecc: QrEcc): number {
  return (
    Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecc][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecc][ver]
  );
}

function getAlignmentPatternPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---- Reed-Solomon ---------------------------------------------------------
function rsMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsComputeDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsComputeRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= rsMultiply(coef, factor);
    });
  }
  return result;
}

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  const encoded = unescape(encodeURIComponent(text));
  for (let i = 0; i < encoded.length; i++) out.push(encoded.charCodeAt(i));
  return out;
}

function appendBits(val: number, len: number, bb: number[]) {
  for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

class QrBuilder {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  constructor(readonly version: number, readonly ecc: QrEcc, dataCodewords: number[]) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));

    this.drawFunctionPatterns();
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    // Elegir la máscara con menor penalización
    let bestMask = 0;
    let minPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
      this.applyMask(m);
      this.drawFormatBits(m);
      const p = this.getPenaltyScore();
      if (p < minPenalty) {
        bestMask = m;
        minPenalty = p;
      }
      this.applyMask(m); // XOR otra vez = deshacer
    }
    this.applyMask(bestMask);
    this.drawFormatBits(bestMask);
  }

  private setFunctionModule(x: number, y: number, isDark: boolean) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  private drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const alignPos = getAlignmentPatternPositions(this.version);
    const n = alignPos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) {
          this.drawAlignmentPattern(alignPos[i], alignPos[j]);
        }
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFormatBits(mask: number) {
    const data = (ECC_FORMAT_BITS[this.ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // módulo oscuro fijo
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const color = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }

  private drawFinderPattern(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private addEccAndInterleave(data: number[]): number[] {
    const ver = this.version;
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[this.ecc][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[this.ecc][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks: number[][] = [];
    const rsDiv = rsComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    const result: number[] = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  private drawCodewords(data: number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  private applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  private getPenaltyScore(): number {
    const n = this.size;
    const m = this.modules;
    let result = 0;

    // Regla 1: rachas de 5+ módulos iguales en filas y columnas
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b < n; b++) {
          const cur = pass === 0 ? m[a][b] : m[b][a];
          const prev = pass === 0 ? m[a][b - 1] : m[b - 1][a];
          if (cur === prev) {
            run++;
            if (run === 5) result += 3;
            else if (run > 5) result++;
          } else {
            run = 1;
          }
        }
      }
    }

    // Regla 2: bloques 2x2 del mismo color
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += 3;
      }
    }

    // Regla 3: patrón parecido al buscador 1:1:3:1:1 (oscuro-claro-oscuro x3-claro-oscuro)
    const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < n; a++) {
        for (let b = 0; b + 11 <= n; b++) {
          let match1 = true;
          let match2 = true;
          for (let k = 0; k < 11; k++) {
            const v = pass === 0 ? m[a][b + k] : m[b + k][a];
            if (v !== pat1[k]) match1 = false;
            if (v !== pat2[k]) match2 = false;
          }
          if (match1 || match2) result += 40;
        }
      }
    }

    // Regla 4: equilibrio entre módulos oscuros y claros
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;

    return result;
  }
}

/** Genera la matriz del QR (true = módulo oscuro). */
export function generateQrMatrix(text: string, ecc: QrEcc = 'M'): boolean[][] {
  const bytes = utf8Bytes(text);

  // Elegir la versión más pequeña donde quepa (probamos ecc pedido y luego L)
  const levels: QrEcc[] = ecc === 'M' ? ['M', 'L'] : ['L'];
  for (const level of levels) {
    for (let ver = MIN_VERSION; ver <= MAX_VERSION; ver++) {
      const capacityBits = getNumDataCodewords(ver, level) * 8;
      const countBits = ver < 10 ? 8 : 16;
      const usedBits = 4 + countBits + bytes.length * 8;
      if (usedBits > capacityBits) continue;

      const bb: number[] = [];
      appendBits(0x4, 4, bb); // modo byte
      appendBits(bytes.length, countBits, bb);
      for (const b of bytes) appendBits(b, 8, bb);

      appendBits(0, Math.min(4, capacityBits - bb.length), bb); // terminador
      appendBits(0, (8 - (bb.length % 8)) % 8, bb);
      for (let pad = 0xec; bb.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8, bb);

      const dataCodewords: number[] = new Array(bb.length / 8).fill(0);
      bb.forEach((bit, i) => {
        dataCodewords[i >>> 3] |= bit << (7 - (i & 7));
      });

      return new QrBuilder(ver, level, dataCodewords).modules;
    }
  }
  throw new Error('El texto es demasiado largo para el código QR');
}

/**
 * Dibuja el QR dentro de un cuadrado (x, y, boxSize), centrado, con zona de
 * silencio de 4 módulos y módulos de tamaño ENTERO (imprescindible para que
 * las cámaras lo lean bien).
 */
export function drawQrToCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  boxSize: number,
  fgColor: string = '#000000',
  bgColor: string = '#ffffff'
) {
  const matrix = generateQrMatrix(text, 'M');
  const modules = matrix.length;
  const quiet = 4;
  const pixel = Math.max(2, Math.floor(boxSize / (modules + quiet * 2)));
  const total = (modules + quiet * 2) * pixel;
  const offX = x + Math.floor((boxSize - total) / 2);
  const offY = y + Math.floor((boxSize - total) / 2);

  ctx.fillStyle = bgColor;
  ctx.fillRect(offX, offY, total, total);

  ctx.fillStyle = fgColor;
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(offX + (c + quiet) * pixel, offY + (r + quiet) * pixel, pixel, pixel);
      }
    }
  }
}

/**
 * Lightweight SVG QR Code generator — no external dependencies.
 *
 * Uses a simplified QR encoding that produces a scannable code for short URLs.
 * Generates mode Byte, error-correction level L, version auto-selected (1-10).
 */

import { useMemo } from "react";

// ── Galois Field GF(256) tables ──
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = x << 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function rsGenPoly(n: number): number[] {
  let p = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) {
      next[j] ^= p[j];
      next[j + 1] ^= gfMul(p[j], EXP[i]);
    }
    p = next;
  }
  return p;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenPoly(ecLen);
  const msg = [...data, ...new Array(ecLen).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

// Version info: [totalCodewords, ecCodewordsPerBlock, numBlocks, dataCodewordsPerBlock]
const VERSION_INFO: Record<number, [number, number, number, number]> = {
  1: [26, 7, 1, 19],
  2: [44, 10, 1, 34],
  3: [70, 15, 1, 55],
  4: [100, 20, 1, 80],
  5: [134, 26, 1, 108],
  6: [172, 18, 2, 68],
  7: [196, 20, 2, 78],
  8: [242, 24, 2, 97],
  9: [292, 30, 2, 116],
  10: [346, 18, 4, 69],
};

function selectVersion(dataLen: number): number {
  // Byte mode: need 4 (mode) + 8/16 (count) + 8*dataLen + 4 (terminator) bits -> codewords
  for (let v = 1; v <= 10; v++) {
    const info = VERSION_INFO[v];
    const capacity = info[3] * info[2]; // total data codewords
    const countBits = v <= 9 ? 8 : 16;
    const totalBits = 4 + countBits + dataLen * 8;
    const totalCodewords = Math.ceil(totalBits / 8);
    if (totalCodewords <= capacity) return v;
  }
  return 10; // fallback
}

function getAlignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const positions: number[][] = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  ];
  return positions[version] || [];
}

function createMatrix(version: number): { matrix: number[][]; size: number } {
  const size = version * 4 + 17;
  const matrix: number[][] = Array.from({ length: size }, () => new Array(size).fill(-1));
  return { matrix, size };
}

function setModule(matrix: number[][], row: number, col: number, val: number) {
  if (row >= 0 && row < matrix.length && col >= 0 && col < matrix.length) {
    matrix[row][col] = val;
  }
}

function addFinderPattern(matrix: number[][], row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const inCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const isWhiteBorder = r === -1 || r === 7 || c === -1 || c === 7;
      if (isWhiteBorder) {
        setModule(matrix, row + r, col + c, 0);
      } else {
        setModule(matrix, row + r, col + c, inBorder || inCenter ? 1 : 0);
      }
    }
  }
}

function addAlignmentPattern(matrix: number[][], row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const inBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
      const isCenter = r === 0 && c === 0;
      if (matrix[row + r][col + c] === -1) {
        matrix[row + r][col + c] = inBorder || isCenter ? 1 : 0;
      }
    }
  }
}

function addTimingPatterns(matrix: number[][], size: number) {
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === -1) matrix[6][i] = i % 2 === 0 ? 1 : 0;
    if (matrix[i][6] === -1) matrix[i][6] = i % 2 === 0 ? 1 : 0;
  }
}

function reserveFormatBits(matrix: number[][], size: number) {
  // Reserve format info areas around finder patterns
  for (let i = 0; i < 8; i++) {
    if (matrix[8][i] === -1) matrix[8][i] = 0;
    if (matrix[i][8] === -1) matrix[i][8] = 0;
    if (matrix[8][size - 1 - i] === -1) matrix[8][size - 1 - i] = 0;
    if (matrix[size - 1 - i][8] === -1) matrix[size - 1 - i][8] = 0;
  }
  if (matrix[8][8] === -1) matrix[8][8] = 0;
  // Dark module
  matrix[size - 8][8] = 1;
}

function encodeData(text: string, version: number): number[] {
  const info = VERSION_INFO[version];
  const ecPerBlock = info[1];
  const numBlocks = info[2];
  const dataPerBlock = info[3];
  const totalData = dataPerBlock * numBlocks;

  const bytes = new TextEncoder().encode(text);
  const countBits = version <= 9 ? 8 : 16;

  // Build bit stream
  let bits = "";
  // Mode indicator: 0100 = Byte
  bits += "0100";
  // Character count
  bits += bytes.length.toString(2).padStart(countBits, "0");
  // Data
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  // Terminator
  bits += "0000".slice(0, Math.min(4, totalData * 8 - bits.length));
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits += "0";
  // Pad codewords
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < totalData * 8) {
    bits += padBytes[padIdx % 2].toString(2).padStart(8, "0");
    padIdx++;
  }

  // Convert to codewords
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(parseInt(bits.slice(i, i + 8), 2));
  }

  // Split into blocks and compute EC
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const block = codewords.slice(offset, offset + dataPerBlock);
    offset += dataPerBlock;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }

  // Interleave data codewords
  const result: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  // Interleave EC codewords
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }

  return result;
}

function placeData(matrix: number[][], codewords: number[], size: number) {
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip timing column
    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rows) {
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (matrix[row][col] !== -1) continue;
        if (bitIdx < totalBits) {
          const byteIdx = Math.floor(bitIdx / 8);
          const bitPos = 7 - (bitIdx % 8);
          matrix[row][col] = (codewords[byteIdx] >> bitPos) & 1;
          bitIdx++;
        } else {
          matrix[row][col] = 0;
        }
      }
    }
    upward = !upward;
  }
}

// Format info for mask 0, error correction L
const FORMAT_BITS_L_MASK0 = 0x77c4;

function applyMask0(matrix: number[][], size: number) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isDataModule(matrix, r, c, size)) {
        if ((r + c) % 2 === 0) {
          matrix[r][c] ^= 1;
        }
      }
    }
  }
}

function isDataModule(_matrix: number[][], row: number, col: number, size: number): boolean {
  // Finder patterns
  if (row < 9 && col < 9) return false;
  if (row < 9 && col >= size - 8) return false;
  if (row >= size - 8 && col < 9) return false;
  // Timing
  if (row === 6 || col === 6) return false;
  // Dark module
  if (row === size - 8 && col === 8) return false;
  return true;
}

function writeFormatInfo(matrix: number[][], size: number) {
  const bits = FORMAT_BITS_L_MASK0;
  // Around top-left finder
  for (let i = 0; i < 6; i++) matrix[8][i] = (bits >> (14 - i)) & 1;
  matrix[8][7] = (bits >> 8) & 1;
  matrix[8][8] = (bits >> 7) & 1;
  matrix[7][8] = (bits >> 6) & 1;
  for (let i = 0; i < 6; i++) matrix[5 - i][8] = (bits >> (5 - i)) & 1;

  // Bottom-left and top-right
  for (let i = 0; i < 7; i++) matrix[size - 1 - i][8] = (bits >> (14 - i)) & 1;
  for (let i = 0; i < 8; i++) matrix[8][size - 8 + i] = (bits >> (7 - i)) & 1;
}

function generateQRMatrix(text: string): number[][] {
  const version = selectVersion(text.length);
  const { matrix, size } = createMatrix(version);

  // Add function patterns
  addFinderPattern(matrix, 0, 0);
  addFinderPattern(matrix, 0, size - 7);
  addFinderPattern(matrix, size - 7, 0);

  // Alignment patterns
  const alignPos = getAlignmentPositions(version);
  for (const r of alignPos) {
    for (const c of alignPos) {
      // Skip if overlapping finder
      if (r < 9 && c < 9) continue;
      if (r < 9 && c >= size - 9) continue;
      if (r >= size - 9 && c < 9) continue;
      addAlignmentPattern(matrix, r, c);
    }
  }

  addTimingPatterns(matrix, size);
  reserveFormatBits(matrix, size);

  // Encode and place data
  const codewords = encodeData(text, version);
  placeData(matrix, codewords, size);

  // Apply mask and format info
  applyMask0(matrix, size);
  writeFormatInfo(matrix, size);

  return matrix;
}

interface QRCodeSVGProps {
  value: string;
  size?: number;
  bgColor?: string;
  fgColor?: string;
  className?: string;
}

export function QRCodeSVG({
  value,
  size = 128,
  bgColor = "#ffffff",
  fgColor = "#000000",
  className,
}: QRCodeSVGProps) {
  const matrix = useMemo(() => generateQRMatrix(value), [value]);
  const moduleCount = matrix.length;
  const cellSize = size / (moduleCount + 8); // 4 module quiet zone on each side
  const offset = cellSize * 4;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={`QR code for ${value}`}
    >
      <rect width={size} height={size} fill={bgColor} />
      {matrix.map((row, r) =>
        row.map((cell, c) =>
          cell === 1 ? (
            <rect
              key={`${r}-${c}`}
              x={offset + c * cellSize}
              y={offset + r * cellSize}
              width={cellSize}
              height={cellSize}
              fill={fgColor}
            />
          ) : null
        )
      )}
    </svg>
  );
}

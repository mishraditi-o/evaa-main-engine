import fs from 'node:fs/promises';
import zlib from 'node:zlib';

/*
 * MATLAB v5 MAT-file parser -> EVAA events { t, x, y, p }
 *
 * Supports:
 *  - real MAT v5 files (MATLAB, scipy.io.savemat), compressed or not
 *  - any numeric type (double, single, int8..uint64)
 *  - N x 4 (columns t, x, y, p) or 4 x N arrays
 *
 * Not supported: MATLAB v7.3 files (they are HDF5 files).
 */

// MAT data element types
const miMATRIX = 14;
const miCOMPRESSED = 15;

const READERS = {
  1: { size: 1, read: (b, o) => b.readInt8(o) },
  2: { size: 1, read: (b, o) => b.readUInt8(o) },
  3: { size: 2, read: (b, o) => b.readInt16LE(o) },
  4: { size: 2, read: (b, o) => b.readUInt16LE(o) },
  5: { size: 4, read: (b, o) => b.readInt32LE(o) },
  6: { size: 4, read: (b, o) => b.readUInt32LE(o) },
  7: { size: 4, read: (b, o) => b.readFloatLE(o) },
  9: { size: 8, read: (b, o) => b.readDoubleLE(o) },
  12: { size: 8, read: (b, o) => Number(b.readBigInt64LE(o)) },
  13: { size: 8, read: (b, o) => Number(b.readBigUInt64LE(o)) }
};

// Array classes that hold plain numbers
// 6 double, 7 single, 8 int8, 9 uint8, 10 int16, 11 uint16,
// 12 int32, 13 uint32, 14 int64, 15 uint64
const isNumericClass = (cls) => cls >= 6 && cls <= 15;

/*
 * Reads the tag of a data element.
 * Small elements (up to 4 bytes) keep the size in the upper
 * 16 bits of the first word and the data right after it.
 */
function readElement(buf, offset) {
  if (offset + 8 > buf.length) {
    throw new Error('Invalid MAT file: truncated data element');
  }

  const word = buf.readUInt32LE(offset);
  const smallSize = word >>> 16;

  if (smallSize !== 0) {
    return {
      type: word & 0xffff,
      size: smallSize,
      dataStart: offset + 4,
      next: offset + 8
    };
  }

  const size = buf.readUInt32LE(offset + 4);
  const padded =
    word === miCOMPRESSED ? size : Math.ceil(size / 8) * 8;

  return {
    type: word,
    size,
    dataStart: offset + 8,
    next: offset + 8 + padded
  };
}

function parseMatrix(buf, start, end) {
  let offset = start;

  // 1. Array flags
  const flagsEl = readElement(buf, offset);
  offset = flagsEl.next;
  const flagsWord = buf.readUInt32LE(flagsEl.dataStart);
  const cls = flagsWord & 0xff;
  const isComplex = ((flagsWord >>> 8) & 0x08) !== 0;

  if (!isNumericClass(cls) || isComplex) {
    return null; // cell, struct, char, sparse, complex ... not events
  }

  // 2. Dimensions
  const dimsEl = readElement(buf, offset);
  offset = dimsEl.next;
  const dims = [];
  for (let i = 0; i < dimsEl.size / 4; i++) {
    dims.push(buf.readInt32LE(dimsEl.dataStart + 4 * i));
  }

  // 3. Variable name
  const nameEl = readElement(buf, offset);
  offset = nameEl.next;
  const name = buf.toString(
    'ascii',
    nameEl.dataStart,
    nameEl.dataStart + nameEl.size
  );

  // 4. Real data (stored column by column)
  if (offset >= end) {
    return null;
  }

  const dataEl = readElement(buf, offset);
  const reader = READERS[dataEl.type];

  if (!reader) {
    return null;
  }

  return {
    name,
    dims,
    buf,
    dataStart: dataEl.dataStart,
    count: Math.floor(dataEl.size / reader.size),
    reader
  };
}

function collectVariables(buf) {
  const variables = [];
  let offset = 128;

  while (offset + 8 <= buf.length) {
    const el = readElement(buf, offset);

    if (el.type === miCOMPRESSED) {
      const inflated = zlib.inflateSync(
        buf.subarray(el.dataStart, el.dataStart + el.size)
      );
      const inner = readElement(inflated, 0);

      if (inner.type === miMATRIX) {
        const v = parseMatrix(
          inflated,
          inner.dataStart,
          inner.dataStart + inner.size
        );
        if (v) variables.push(v);
      }
    } else if (el.type === miMATRIX) {
      const v = parseMatrix(buf, el.dataStart, el.dataStart + el.size);
      if (v) variables.push(v);
    }

    offset = el.next;
  }

  return variables;
}

export async function parseMat(filePath) {
  if (!filePath) {
    throw new Error('MAT file path is required');
  }

  const buf = await fs.readFile(filePath);

  if (buf.length < 128) {
    throw new Error('Invalid MAT file: file is too small');
  }

  const header = buf.toString('ascii', 0, 116);

  if (!header.includes('MATLAB')) {
    throw new Error(
      'Invalid MAT file header. Must be a MATLAB v5 format file.'
    );
  }

  if (header.includes('7.3')) {
    throw new Error(
      'MATLAB v7.3 files (HDF5-based) are not supported. Re-save with: save(file, "events", "-v7")'
    );
  }

  if (buf.toString('ascii', 126, 128) !== 'IM') {
    throw new Error('Big-endian MAT files are not supported.');
  }

  const variables = collectVariables(buf).filter(
    (v) => v.dims.length === 2
  );

  if (variables.length === 0) {
    throw new Error('No numeric 2D array found in MAT file.');
  }

  // Prefer a variable called "events", otherwise the first one
  const chosen =
    variables.find((v) => v.name.toLowerCase() === 'events') ||
    variables[0];

  const [rows, cols] = chosen.dims;

  let at; // position of element (row, col) in column-major data
  let n;

  if (cols === 4) {
    n = rows; // N x 4
    at = (i, c) => c * rows + i;
  } else if (rows === 4) {
    n = cols; // 4 x N
    at = (i, c) => i * rows + c;
  } else {
    throw new Error(
      `MAT variable "${chosen.name}" has shape ${rows} x ${cols}. Expected N x 4 with columns t, x, y, p.`
    );
  }

  if (chosen.count < rows * cols) {
    throw new Error('Invalid MAT file: data is shorter than its dimensions');
  }

  const { buf: data, dataStart, reader } = chosen;
  const value = (i, c) =>
    reader.read(data, dataStart + at(i, c) * reader.size);

  const events = [];

  for (let i = 0; i < n; i++) {
    const t = value(i, 0);
    const x = value(i, 1);
    const y = value(i, 2);
    const p = value(i, 3);

    if (
      Number.isFinite(t) &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(p)
    ) {
      events.push({
        t,
        x: Math.floor(x),
        y: Math.floor(y),
        p: Math.floor(p)
      });
    }
  }

  if (events.length === 0) {
    throw new Error('No valid event data found in MAT file.');
  }

  return events;
}
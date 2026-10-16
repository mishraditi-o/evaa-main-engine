import fs from 'node:fs/promises';
import zlib from 'node:zlib';

/*
 * MATLAB v5 MAT-file parser -> EVAA events { t, x, y, p }
 *
 * Supports:
 *  - real MAT v5 files (MATLAB, scipy.io.savemat), compressed or not
 *  - any numeric type (double, single, int8..uint64)
 *  - N x 4 (columns t, x, y, p) or 4 x N arrays
 *  - a struct with one array per field, e.g. TD.x, TD.y, TD.p, TD.ts
 *    (the layout used by many neuromorphic datasets)
 *
 * Not supported: MATLAB v7.3 files (they are HDF5 files).
 */

// MAT data element types
const miINT8 = 1;
const miINT32 = 5;
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

// Array classes
// 1 cell, 2 struct, 3 object, 4 char, 5 sparse,
// 6 double, 7 single, 8 int8, 9 uint8, 10 int16, 11 uint16,
// 12 int32, 13 uint32, 14 int64, 15 uint64
const mxSTRUCT_CLASS = 2;
const isNumericClass = (cls) => cls >= 6 && cls <= 15;

// Names we accept for each event column inside a struct (lower case)
const FIELD_NAMES = {
  t: ['t', 'ts', 'time', 'timestamp', 'timestamps'],
  x: ['x'],
  y: ['y'],
  p: ['p', 'pol', 'polarity']
};

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

/*
 * Reads the parts every array starts with:
 * array flags, dimensions and name.
 */
function readArrayHeader(buf, start) {
  let offset = start;

  const flagsEl = readElement(buf, offset);
  offset = flagsEl.next;
  const flagsWord = buf.readUInt32LE(flagsEl.dataStart);
  const cls = flagsWord & 0xff;
  const isComplex = ((flagsWord >>> 8) & 0x08) !== 0;

  const dimsEl = readElement(buf, offset);
  offset = dimsEl.next;
  const dims = [];
  for (let i = 0; i < dimsEl.size / 4; i++) {
    dims.push(buf.readInt32LE(dimsEl.dataStart + 4 * i));
  }

  const nameEl = readElement(buf, offset);
  offset = nameEl.next;
  const name = buf.toString(
    'ascii',
    nameEl.dataStart,
    nameEl.dataStart + nameEl.size
  );

  return { cls, isComplex, dims, name, offset };
}

/*
 * A struct stores: the length of one field name, all field names
 * packed together, then one array per field (for a 1 x 1 struct).
 */
function parseStruct(buf, header, end) {
  const { dims, name } = header;
  let offset = header.offset;

  // Only a single struct (1 x 1) can describe one recording
  if (dims.length !== 2 || dims[0] !== 1 || dims[1] !== 1) {
    return null;
  }

  const lenEl = readElement(buf, offset);
  offset = lenEl.next;
  const nameLen = buf.readInt32LE(lenEl.dataStart);

  const namesEl = readElement(buf, offset);
  offset = namesEl.next;

  if (namesEl.type !== miINT8 || nameLen <= 0) {
    return null;
  }

  const fieldCount = Math.floor(namesEl.size / nameLen);
  const fieldNames = [];
  for (let i = 0; i < fieldCount; i++) {
    const from = namesEl.dataStart + i * nameLen;
    const raw = buf.toString('ascii', from, from + nameLen);
    fieldNames.push(raw.replace(/\0.*$/, ''));
  }

  const fields = {};

  for (let i = 0; i < fieldCount && offset + 8 <= end; i++) {
    const el = readElement(buf, offset);
    offset = el.next;

    if (el.type !== miMATRIX) continue;

    const v = parseMatrix(buf, el.dataStart, el.dataStart + el.size);
    if (v && v.reader) {
      fields[fieldNames[i]] = v;
    }
  }

  return { name, dims, fields };
}

function parseMatrix(buf, start, end) {
  const header = readArrayHeader(buf, start);

  if (header.cls === mxSTRUCT_CLASS) {
    return parseStruct(buf, header, end);
  }

  // cell, char, sparse, complex ... not events
  if (!isNumericClass(header.cls) || header.isComplex) {
    return null;
  }

  // Real data (stored column by column)
  if (header.offset >= end) {
    return null;
  }

  const dataEl = readElement(buf, header.offset);
  const reader = READERS[dataEl.type];

  if (!reader) {
    return null;
  }

  return {
    name: header.name,
    dims: header.dims,
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

// Finds a struct field by any of its accepted names
function findField(fields, names) {
  const wanted = new Set(names);
  const key = Object.keys(fields).find((k) => wanted.has(k.toLowerCase()));
  return key ? fields[key] : null;
}

// Number of values in a numeric array (vector or matrix)
const lengthOf = (v) => v.dims.reduce((a, b) => a * b, 1);

/*
 * Turns a struct like TD.x, TD.y, TD.p, TD.ts into events.
 * Returns null when the struct does not look like event data.
 */
function eventsFromStruct(struct) {
  const t = findField(struct.fields, FIELD_NAMES.t);
  const x = findField(struct.fields, FIELD_NAMES.x);
  const y = findField(struct.fields, FIELD_NAMES.y);
  const p = findField(struct.fields, FIELD_NAMES.p);

  if (!t || !x || !y || !p) return null;

  const n = lengthOf(t);

  if (n === 0 || lengthOf(x) !== n || lengthOf(y) !== n || lengthOf(p) !== n) {
    throw new Error(
      `MAT struct "${struct.name}" has columns of different lengths. x, y, p and time must have the same number of values.`
    );
  }

  for (const v of [t, x, y, p]) {
    if (v.count < n) {
      throw new Error('Invalid MAT file: data is shorter than its dimensions');
    }
  }

  const get = (v, i) => v.reader.read(v.buf, v.dataStart + i * v.reader.size);

  const events = new Array(n);
  let kept = 0;
  let minX = Infinity;
  let minY = Infinity;

  for (let i = 0; i < n; i++) {
    const tv = get(t, i);
    const xv = get(x, i);
    const yv = get(y, i);
    const pv = get(p, i);

    if (
      Number.isFinite(tv) &&
      Number.isFinite(xv) &&
      Number.isFinite(yv) &&
      Number.isFinite(pv)
    ) {
      events[kept++] = {
        t: tv,
        x: Math.floor(xv),
        y: Math.floor(yv),
        p: Math.floor(pv)
      };

      if (xv < minX) minX = xv;
      if (yv < minY) minY = yv;
    }
  }

  events.length = kept;

  /*
   * MATLAB counts pixels from 1, the rest of EVAA from 0.
   * If the smallest x and y are exactly 1 (and nothing is at 0), the file
   * is 1-based, so we move it down by one. This keeps the sensor size right
   * (e.g. 240 x 180, not 241 x 181).
   */
  if (kept > 0 && minX === 1 && minY === 1) {
    for (const e of events) {
      e.x -= 1;
      e.y -= 1;
    }
  }

  return events;
}

// Old layout: one numeric array, N x 4 or 4 x N (columns t, x, y, p)
function eventsFromMatrix(chosen) {
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

  return events;
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

  const all = collectVariables(buf);

  // 1. A struct with x, y, p and time fields (e.g. TD)
  const structs = all.filter((v) => v.fields);
  const preferred = ['td', 'events', 'event', 'data'];

  const orderedStructs = [
    ...structs.filter((s) => preferred.includes(s.name.toLowerCase())),
    ...structs.filter((s) => !preferred.includes(s.name.toLowerCase()))
  ];

  for (const s of orderedStructs) {
    const events = eventsFromStruct(s);
    if (events) {
      if (events.length === 0) {
        throw new Error('No valid event data found in MAT file.');
      }
      return events;
    }
  }

  // 2. A single N x 4 (or 4 x N) array
  const matrices = all.filter((v) => v.reader && v.dims.length === 2);

  if (matrices.length === 0) {
    throw new Error(
      'No event data found in MAT file. Expected a struct with x, y, p and time fields, or an N x 4 array (t, x, y, p).'
    );
  }

  // Prefer a variable called "events", otherwise one that is N x 4
  const chosen =
    matrices.find((v) => v.name.toLowerCase() === 'events') ||
    matrices.find((v) => v.dims[0] === 4 || v.dims[1] === 4) ||
    matrices[0];

  const events = eventsFromMatrix(chosen);

  if (events.length === 0) {
    throw new Error('No valid event data found in MAT file.');
  }

  return events;
}

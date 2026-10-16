import fs from 'node:fs/promises';

function getTypeInfo(typeStr) {
  const littleEndian = !typeStr.startsWith('>');

  const code = typeStr.replace(/^[<>=|]/, '');
  const kind = code[0];
  const size = parseInt(code.slice(1), 10) || 4;

  return {
    kind,
    size,
    littleEndian
  };
}

function readValue(view, offset, typeInfo) {
  const { kind, size, littleEndian } = typeInfo;

  switch (kind) {
    case 'f':
      if (size === 8) {
        return view.getFloat64(offset, littleEndian);
      }

      if (size === 4) {
        return view.getFloat32(offset, littleEndian);
      }

      break;

    case 'i':
      if (size === 8) {
        return Number(
          view.getBigInt64(offset, littleEndian)
        );
      }

      if (size === 4) {
        return view.getInt32(offset, littleEndian);
      }

      if (size === 2) {
        return view.getInt16(offset, littleEndian);
      }

      if (size === 1) {
        return view.getInt8(offset);
      }

      break;

    case 'u':
      if (size === 8) {
        return Number(
          view.getBigUint64(offset, littleEndian)
        );
      }

      if (size === 4) {
        return view.getUint32(offset, littleEndian);
      }

      if (size === 2) {
        return view.getUint16(offset, littleEndian);
      }

      if (size === 1) {
        return view.getUint8(offset);
      }

      break;

    case 'b':
      return view.getUint8(offset) ? 1 : 0;
  }

  return view.getFloat64(offset, littleEndian);
}

function findColumn(fields, keywords) {
  for (const keyword of keywords) {
    const found = fields.find(
      field => field.name === keyword
    );

    if (found) {
      return found;
    }
  }

  return null;
}

export async function parseNpy(filePath) {
  const buffer = await fs.readFile(filePath);

  const u8 = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  // NPY magic header
  const magic = [
    0x93,
    0x4e,
    0x55,
    0x4d,
    0x50,
    0x59
  ];

  for (let i = 0; i < magic.length; i++) {
    if (u8[i] !== magic[i]) {
      throw new Error(
        'Invalid NPY file header. File must start with \\x93NUMPY.'
      );
    }
  }

  const major = u8[6];

  let headerLength;
  let dataOffset;

  if (major === 1) {
    headerLength =
      u8[8] |
      (u8[9] << 8);

    dataOffset =
      10 + headerLength;

  } else if (
    major === 2 ||
    major === 3
  ) {
    headerLength =
      u8[8] |
      (u8[9] << 8) |
      (u8[10] << 16) |
      (u8[11] << 24);

    dataOffset =
      12 + headerLength;

  } else {
    throw new Error(
      `Unsupported NPY version: ${major}`
    );
  }

  const headerStart =
    dataOffset - headerLength;

  const headerText =
    new TextDecoder('latin1').decode(
      u8.subarray(
        headerStart,
        dataOffset
      )
    );

  // Parse shape
  const shapeMatch =
    headerText.match(
      /['"]shape['"]\s*:\s*\(([^)]*)\)/
    );

  if (!shapeMatch) {
    throw new Error(
      'Could not parse shape from NPY header.'
    );
  }

  const shape =
    shapeMatch[1]
      .split(',')
      .map(value =>
        parseInt(value.trim(), 10)
      )
      .filter(Number.isFinite);

  // Parse dtype
  const descrMatch =
    headerText.match(
      /['"]descr['"]\s*:\s*(\[[^\]]+\]|'[^']+'|"[^"]+")/
    );

  if (!descrMatch) {
    throw new Error(
      'Could not parse descr from NPY header.'
    );
  }

  const descrRaw =
    descrMatch[1].trim();

  const fortranMatch =
    headerText.match(
      /['"]fortran_order['"]\s*:\s*(True|False)/
    );

  const fortranOrder =
    fortranMatch
      ? fortranMatch[1] === 'True'
      : false;

  const dataBuffer =
    buffer.buffer.slice(
      buffer.byteOffset + dataOffset,
      buffer.byteOffset + buffer.byteLength
    );

  const view =
    new DataView(dataBuffer);

  const rows = [];

  /*
   * Structured NPY array
   *
   * Example:
   * [
   *   ('timestamp', '<f8'),
   *   ('x', '<i4'),
   *   ('y', '<i4'),
   *   ('polarity', '<i1')
   * ]
   */
  if (descrRaw.startsWith('[')) {

    const fieldMatches = [
      ...descrRaw.matchAll(
        /\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g
      )
    ];

    if (fieldMatches.length === 0) {
      throw new Error(
        'Failed to parse structured NPY fields.'
      );
    }

    let totalRecordSize = 0;

    const fields =
      fieldMatches.map(match => {
        const name =
          match[1].toLowerCase();

        const typeStr =
          match[2];

        const typeInfo =
          getTypeInfo(typeStr);

        const offset =
          totalRecordSize;

        totalRecordSize +=
          typeInfo.size;

        return {
          name,
          typeInfo,
          offset
        };
      });

    const numRecords =
      shape[0] ||
      Math.floor(
        view.byteLength /
        totalRecordSize
      );

    const stride =
      numRecords > 0 &&
      view.byteLength >=
        numRecords * totalRecordSize
        ? Math.floor(
            view.byteLength /
            numRecords
          )
        : totalRecordSize;

    const tKeywords = [
      't',
      'ts',
      'time',
      'timestamp',
      'timestamp_us',
      't_us'
    ];

    const xKeywords = [
      'x',
      'pos_x',
      'coord_x'
    ];

    const yKeywords = [
      'y',
      'pos_y',
      'coord_y'
    ];

    const pKeywords = [
      'p',
      'pol',
      'polarity'
    ];

    const colMap = {
      t: findColumn(fields, tKeywords),
      x: findColumn(fields, xKeywords),
      y: findColumn(fields, yKeywords),
      p: findColumn(fields, pKeywords)
    };

    // If names are not recognised, accept exactly 4 fields in the
    // order t, x, y, p. Any other layout is rejected.
    if (
      !colMap.t ||
      !colMap.x ||
      !colMap.y ||
      !colMap.p
    ) {
      if (fields.length === 4) {
        colMap.t = fields[0];
        colMap.x = fields[1];
        colMap.y = fields[2];
        colMap.p = fields[3];
      } else {
        throw new Error(
          `Structured NPY must have fields t, x, y, p (or exactly 4 fields in that order). Found: ${fields
            .map(field => field.name)
            .join(', ')}`
        );
      }
    }

    for (
      let i = 0;
      i < numRecords;
      i++
    ) {
      const recordOffset =
        i * stride;

      if (
        recordOffset +
          totalRecordSize >
        view.byteLength
      ) {
        break;
      }

      const t =
        readValue(
          view,
          recordOffset +
            colMap.t.offset,
          colMap.t.typeInfo
        );

      const x =
        readValue(
          view,
          recordOffset +
            colMap.x.offset,
          colMap.x.typeInfo
        );

      const y =
        readValue(
          view,
          recordOffset +
            colMap.y.offset,
          colMap.y.typeInfo
        );

      const p =
        readValue(
          view,
          recordOffset +
            colMap.p.offset,
          colMap.p.typeInfo
        );

      rows.push({
        t,
        x: Math.floor(x),
        y: Math.floor(y),
        p: Math.floor(p)
      });
    }

    return rows;
  }

  /*
   * Regular numeric NPY array
   */
  const typeStr =
    descrRaw.replace(/['"]/g, '');

  const typeInfo =
    getTypeInfo(typeStr);

  const elementSize =
    typeInfo.size;

  const totalElements =
    Math.floor(
      view.byteLength /
      elementSize
    );

  // N x 4 or 4 x N
  if (shape.length === 2) {
    const rowsCount = shape[0];
    const colsCount = shape[1];

    // Position of element (row, col) in the file
    const at = (row, col) =>
      fortranOrder
        ? col * rowsCount + row
        : row * colsCount + col;

    const val = (row, col) =>
      readValue(
        view,
        at(row, col) * elementSize,
        typeInfo
      );

    if (colsCount === 4) {
      for (let i = 0; i < rowsCount; i++) {
        rows.push({
          t: val(i, 0),
          x: Math.floor(val(i, 1)),
          y: Math.floor(val(i, 2)),
          p: Math.floor(val(i, 3))
        });
      }
    } else if (rowsCount === 4) {
      for (let i = 0; i < colsCount; i++) {
        rows.push({
          t: val(0, i),
          x: Math.floor(val(1, i)),
          y: Math.floor(val(2, i)),
          p: Math.floor(val(3, i))
        });
      }
    } else {
      throw new Error(
        `NPY array has shape (${rowsCount}, ${colsCount}). Expected N x 4 with columns t, x, y, p.`
      );
    }

    // Flat array: [t,x,y,p,t,x,y,p,...]
  } else if (shape.length === 1) {

    if (totalElements % 4 !== 0) {
      throw new Error(
        `NPY array has ${totalElements} values, which is not a multiple of 4 (t, x, y, p).`
      );
    }

    const N =
      Math.floor(
        totalElements / 4
      );

    for (
      let i = 0;
      i < N;
      i++
    ) {
      const index =
        i * 4;

      rows.push({
        t: readValue(
          view,
          index * elementSize,
          typeInfo
        ),

        x: Math.floor(
          readValue(
            view,
            (index + 1) *
              elementSize,
            typeInfo
          )
        ),

        y: Math.floor(
          readValue(
            view,
            (index + 2) *
              elementSize,
            typeInfo
          )
        ),

        p: Math.floor(
          readValue(
            view,
            (index + 3) *
              elementSize,
            typeInfo
          )
        )
      });
    }
  }

  if (rows.length === 0) {
    throw new Error(
      `Could not map NPY array to (t, x, y, p). Shape: (${shape.join(
        ', '
      )}), dtype: ${descrRaw}`
    );
  }

  return rows;
}
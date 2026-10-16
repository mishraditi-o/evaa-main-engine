import path from 'node:path';

import { parseTxt } from './parsers/txt.parser.js';
import { parseCsv } from './parsers/csv.parser.js';
import { parseNpy } from './parsers/npy.parser.js';
import { parseMat } from './parsers/mat.parser.js';
import { parseH5 } from './parsers/h5.parser.js';

export async function parseFile(filePath) {
  const extension = path
    .extname(filePath)
    .toLowerCase()
    .replace('.', '');

  switch (extension) {
    case 'txt':
      return parseTxt(filePath);

    case 'csv':
      return parseCsv(filePath);

    case 'npy':
      return parseNpy(filePath);

    case 'mat':
      return parseMat(filePath);

    case 'h5':
    case 'hdf5':
      return parseH5(filePath);

    default:
      throw new Error(`Unsupported file format: .${extension}`);
  }
}
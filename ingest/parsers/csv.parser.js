import fs from 'node:fs/promises';

// Accepted header names for each event field.
// Anything else is rejected, so other tables are never read as events.
const COLUMN_ALIASES = {
  t: ['t', 'time', 'timestamp', 'ts', 'timestamp_us', 't_us'],
  x: ['x', 'pos_x', 'coord_x'],
  y: ['y', 'pos_y', 'coord_y'],
  p: ['p', 'pol', 'polarity']
};

const FIELDS = ['t', 'x', 'y', 'p'];

const clean = (value) =>
  value.trim().replace(/^["']|["']$/g, '');

export async function parseCsv(filePath) {
  if (!filePath) {
    throw new Error('CSV file path is required');
  }

  const text = await fs.readFile(filePath, 'utf8');

  // Ignore empty lines and comments
  const lines = text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();

    return trimmed.length > 0 && !trimmed.startsWith('#');
  });

  if (lines.length === 0) {
    throw new Error('CSV file is empty or contains no valid lines');
  }

  const firstRow = lines[0].split(',').map(clean);

  // A first row with any non-numeric value is a header
  const hasHeader = firstRow.some(
    (token) => token !== '' && Number.isNaN(Number(token))
  );

  let idx;
  let dataLines;

  if (hasHeader) {
    const names = firstRow.map((name) => name.toLowerCase());

    idx = {};
    for (const field of FIELDS) {
      idx[field] = names.findIndex((name) =>
        COLUMN_ALIASES[field].includes(name)
      );
    }

    const missing = FIELDS.filter((field) => idx[field] === -1);

    if (missing.length > 0) {
      throw new Error(
        `CSV header must name the columns t, x, y, p. Missing: ${missing.join(', ')}. Found: ${firstRow.join(', ')}`
      );
    }

    dataLines = lines.slice(1);
  } else {
    if (firstRow.length !== 4) {
      throw new Error(
        `No header found. Expected 4 columns (t, x, y, p), found ${firstRow.length}`
      );
    }

    idx = { t: 0, x: 1, y: 2, p: 3 };
    dataLines = lines;
  }

  const parsedData = [];
  let skippedRows = 0;

  for (const line of dataLines) {
    const tokens = line.split(',').map(clean);

    if (tokens.length < 4) {
      skippedRows++;
      continue;
    }

    const t = Number(tokens[idx.t]);
    const x = Number(tokens[idx.x]);
    const y = Number(tokens[idx.y]);
    const p = Number(tokens[idx.p]);

    if (
      Number.isFinite(t) &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(p)
    ) {
      parsedData.push({
        t,
        x: Math.floor(x),
        y: Math.floor(y),
        p: Math.floor(p)
      });
    } else {
      skippedRows++;
    }
  }

  // Rows that could not be read are counted, never dropped silently.
  // ingest() reports this number in metadata.skippedRows.
  parsedData.skippedRows = skippedRows;

  return parsedData;
}
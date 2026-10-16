import fs from 'node:fs/promises';

const REQUIRED = ['t', 'x', 'y', 'p'];

const COLUMN_ALIASES = {
  t: ['t', 'time', 'timestamp', 'ts', 'timestamp_s'],
  x: ['x', 'pos_x', 'coord_x'],
  y: ['y', 'pos_y', 'coord_y'],
  p: ['p', 'pol', 'polarity']
};

function splitTokens(line) {
  return line.trim().split(/[\s,\t]+/);
}

function looksLikeHeader(tokens) {
  return tokens.some(token => /[a-zA-Z]/.test(token));
}

function matchesAnyAlias(tokens) {
  return tokens.some(token =>
    REQUIRED.some(key =>
      COLUMN_ALIASES[key].includes(token.toLowerCase())
    )
  );
}

export async function parseTxt(filePath) {
  const text = await fs.readFile(filePath, 'utf8');

  let headerTokens = null;
  const dataLines = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line) continue;

    const atTop =
      !headerTokens &&
      dataLines.length === 0;

    const isComment =
      line.startsWith('#') ||
      line.startsWith('%');

    if (isComment) {
      if (atTop) {
        const cleaned = line.replace(/^[#%]+\s*/, '');
        const tokens = splitTokens(cleaned);

        if (
          looksLikeHeader(tokens) &&
          matchesAnyAlias(tokens)
        ) {
          headerTokens = tokens;
        }
      }

      continue;
    }

    const tokens = splitTokens(line);

    if (
      atTop &&
      looksLikeHeader(tokens)
    ) {
      headerTokens = tokens;
      continue;
    }

    dataLines.push(line);
  }

  if (dataLines.length === 0) {
    throw new Error(
      'File is empty or contains only comments'
    );
  }

  let idx;

  if (headerTokens) {
    const names = headerTokens.map(
      name => name.toLowerCase()
    );

    idx = {};

    for (const key of REQUIRED) {
      idx[key] = names.findIndex(
        name => COLUMN_ALIASES[key].includes(name)
      );
    }

    const missing = REQUIRED.filter(
      key => idx[key] === -1
    );

    if (missing.length > 0) {
      throw new Error(
        `Missing required columns: ${missing.join(', ')}`
      );
    }
  } else {
    const columnCount =
      splitTokens(dataLines[0]).length;

    if (columnCount !== 4) {
      throw new Error(
        `No header found. Expected 4 columns (t x y p), found ${columnCount}`
      );
    }

    idx = {
      t: 0,
      x: 1,
      y: 2,
      p: 3
    };
  }

  const needed =
    Math.max(
      idx.t,
      idx.x,
      idx.y,
      idx.p
    ) + 1;

  const events = [];

  for (const line of dataLines) {
    const tokens = splitTokens(line);

    if (tokens.length < needed) {
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
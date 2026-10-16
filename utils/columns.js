// Converts the parsed events (array of objects) into compact columns.
// Columns use far less memory and are what HDF5 and Parquet store.

const MAX_UINT16 = 65535;

export function toColumns(events) {
  const n = events.length;

  const t = new Float64Array(n);
  const x = new Uint16Array(n);
  const y = new Uint16Array(n);
  const p = new Int8Array(n);

  for (let i = 0; i < n; i++) {
    const e = events[i];

    if (e.x > MAX_UINT16 || e.y > MAX_UINT16) {
      throw new Error(
        `Event position (${e.x}, ${e.y}) is larger than ${MAX_UINT16}. The sensor size looks wrong.`
      );
    }

    if (e.p < -128 || e.p > 127) {
      throw new Error(
        `Event polarity ${e.p} is out of range.`
      );
    }

    t[i] = e.t;
    x[i] = e.x;
    y[i] = e.y;
    p[i] = e.p;
  }

  return { n, t, x, y, p };
}

export function isSortedByTime(t) {
  for (let i = 1; i < t.length; i++) {
    if (t[i] < t[i - 1]) {
      return false;
    }
  }

  return true;
}

// Stable sort by timestamp (events with equal t keep their order)
export function sortColumns(columns) {
  const { n, t, x, y, p } = columns;

  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;

  order.sort((a, b) => t[a] - t[b] || a - b);

  const sorted = {
    n,
    t: new Float64Array(n),
    x: new Uint16Array(n),
    y: new Uint16Array(n),
    p: new Int8Array(n)
  };

  for (let i = 0; i < n; i++) {
    const j = order[i];
    sorted.t[i] = t[j];
    sorted.x[i] = x[j];
    sorted.y[i] = y[j];
    sorted.p[i] = p[j];
  }

  return sorted;
}

export function previewRows(columns, count = 10) {
  const rows = [];
  const limit = Math.min(count, columns.n);

  for (let i = 0; i < limit; i++) {
    rows.push({
      t: columns.t[i],
      x: columns.x[i],
      y: columns.y[i],
      p: columns.p[i]
    });
  }

  return rows;
}
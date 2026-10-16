// import {
//   asyncBufferFromFile,
//   parquetMetadataAsync,
//   parquetReadObjects
// } from 'hyparquet';

// const CHUNK_ROWS = 500000;

// const DEFAULTS = {
//   timeBins: 200,   // points in the event-rate chart
//   gridSize: 128,   // longest side of the heatmap / frame grids
//   frameCount: 20   // number of frames in the player
// };

// const COLUMNS = ['t', 'x', 'y', 'p'];

// function positiveInt(value, fallback, name, max) {
//   if (value === undefined) return fallback;

//   if (!Number.isInteger(value) || value < 1 || value > max) {
//     throw new Error(`${name} must be an integer between 1 and ${max}`);
//   }

//   return value;
// }

// // Reads the Parquet file in chunks so memory stays small for big files.
// async function forEachChunk(file, totalRows, callback) {
//   for (let start = 0; start < totalRows; start += CHUNK_ROWS) {
//     const rows = await parquetReadObjects({
//       file,
//       columns: COLUMNS,
//       rowStart: start,
//       rowEnd: Math.min(start + CHUNK_ROWS, totalRows)
//     });

//     callback(rows);
//   }
// }

// /*
//  * visualize(inputPath, options)
//  *
//  * inputPath: the data.parquet file made by ingest().
//  * options:   { timeBins, gridSize, frameCount, width, height }
//  *
//  * Returns binned data only (never raw events), so the result stays
//  * small however large the dataset is. Errors are thrown.
//  */
// export async function visualize(inputPath, options = {}) {
//   if (!inputPath) {
//     throw new Error('inputPath is required');
//   }

//   if (!inputPath.toLowerCase().endsWith('.parquet')) {
//     throw new Error('visualize() needs the data.parquet file made by ingest()');
//   }

//   const timeBins = positiveInt(options.timeBins, DEFAULTS.timeBins, 'timeBins', 2000);
//   const gridSize = positiveInt(options.gridSize, DEFAULTS.gridSize, 'gridSize', 512);
//   const frameCount = positiveInt(options.frameCount, DEFAULTS.frameCount, 'frameCount', 200);

//   const file = await asyncBufferFromFile(inputPath);
//   const parquet = await parquetMetadataAsync(file);
//   const totalRows = Number(parquet.num_rows);

//   if (totalRows === 0) {
//     throw new Error('The dataset has no events');
//   }

//   // Pass 1: time range and sensor size
//   let minT = Infinity;
//   let maxT = -Infinity;
//   let maxX = -1;
//   let maxY = -1;

//   await forEachChunk(file, totalRows, (rows) => {
//     for (const r of rows) {
//       if (r.t < minT) minT = r.t;
//       if (r.t > maxT) maxT = r.t;
//       if (r.x > maxX) maxX = r.x;
//       if (r.y > maxY) maxY = r.y;
//     }
//   });

//   const width = options.width ?? maxX + 1;
//   const height = options.height ?? maxY + 1;
//   const durationUs = maxT - minT;
//   const span = durationUs > 0 ? durationUs : 1;

//   // Grid keeps the sensor aspect ratio; the longest side is gridSize.
//   const scale = Math.min(1, gridSize / Math.max(width, height));
//   const gridW = Math.max(1, Math.ceil(width * scale));
//   const gridH = Math.max(1, Math.ceil(height * scale));
//   const cells = gridW * gridH;

//   const rateOn = new Uint32Array(timeBins);
//   const rateOff = new Uint32Array(timeBins);
//   const heatmap = new Uint32Array(cells);
//   const frames = Array.from({ length: frameCount }, () => new Int32Array(cells));

//   let on = 0;
//   let off = 0;

//   // Pass 2: fill every chart in one go
//   await forEachChunk(file, totalRows, (rows) => {
//     for (const r of rows) {
//       const rel = (r.t - minT) / span;
//       const bin = Math.min(timeBins - 1, Math.floor(rel * timeBins));
//       const frame = Math.min(frameCount - 1, Math.floor(rel * frameCount));

//       const gx = Math.min(gridW - 1, Math.floor(r.x * scale));
//       const gy = Math.min(gridH - 1, Math.floor(r.y * scale));
//       const cell = gy * gridW + gx;

//       const isOn = r.p > 0;

//       if (isOn) {
//         on++;
//         rateOn[bin]++;
//         frames[frame][cell]++;
//       } else {
//         off++;
//         rateOff[bin]++;
//         frames[frame][cell]--;
//       }

//       heatmap[cell]++;
//     }
//   });

//   const binUs = span / timeBins;
//   const frameUs = span / frameCount;

//   return {
//     success: true,

//     metadata: {
//       width,
//       height,
//       eventCount: totalRows,
//       durationUs
//     },

//     // Events per time bin (ON and OFF kept apart for stacked charts)
//     eventRate: {
//       binUs,
//       on: Array.from(rateOn),
//       off: Array.from(rateOff)
//     },

//     polarity: { on, off },

//     // Event count per grid cell, row by row (index = y * gridW + x)
//     heatmap: {
//       gridW,
//       gridH,
//       max: heatmap.reduce((a, b) => (b > a ? b : a), 0),
//       values: Array.from(heatmap)
//     },

//     // ON minus OFF per cell for each time window
//     frames: frames.map((values, i) => ({
//       tStartUs: Math.round(i * frameUs),
//       tEndUs: Math.round((i + 1) * frameUs),
//       gridW,
//       gridH,
//       values: Array.from(values)
//     })),

//     files: []
//   };
// }


import {
  asyncBufferFromFile,
  parquetMetadataAsync,
  parquetReadObjects
} from 'hyparquet';

const CHUNK_ROWS = 500000;

// Per-pixel counting needs one number per sensor pixel (4 bytes each).
// Above this size we skip it instead of risking memory.
const MAX_TRACKED_PIXELS = 16_000_000;

const DEFAULTS = {
  timeBins: 200,   // points in the event-rate chart
  gridSize: 128,   // longest side of the heatmap / frame grids
  frameCount: 20   // number of frames in the player
};

const COLUMNS = ['t', 'x', 'y', 'p'];

function positiveInt(value, fallback, name, max) {
  if (value === undefined) return fallback;

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }

  return value;
}

// Reads the Parquet file in chunks so memory stays small for big files.
async function forEachChunk(file, totalRows, callback) {
  for (let start = 0; start < totalRows; start += CHUNK_ROWS) {
    const rows = await parquetReadObjects({
      file,
      columns: COLUMNS,
      rowStart: start,
      rowEnd: Math.min(start + CHUNK_ROWS, totalRows)
    });

    callback(rows);
  }
}

/*
 * Data-quality scores, made from the per-pixel counts and the checks
 * collected while reading the events.
 *
 *  sparsity      share of sensor pixels that never fired (0 to 1)
 *  density       how busy the sensor was
 *  completeness  share of events that are usable (finite values, inside
 *                the sensor area). 1 means every event is valid.
 *  hotPixels     pixels far busier than the rest (mean + 5 standard
 *                deviations of the active pixels)
 */
function buildQuality({
  pixels,
  width,
  height,
  totalRows,
  durationUs,
  nonFinite,
  outOfBounds,
  outOfOrder
}) {
  const totalPixels = width * height;
  const seconds = durationUs / 1e6;

  let activePixels = null;
  let inactivePixels = null;
  let sparsity = null;
  let hotPixels = null;

  if (pixels) {
    let active = 0;
    let sum = 0;
    let sumSq = 0;

    for (let i = 0; i < pixels.length; i++) {
      const c = pixels[i];
      if (c > 0) {
        active++;
        sum += c;
        sumSq += c * c;
      }
    }

    activePixels = active;
    inactivePixels = totalPixels - active;
    sparsity = totalPixels > 0 ? inactivePixels / totalPixels : null;

    if (active > 0) {
      const mean = sum / active;
      const variance = Math.max(0, sumSq / active - mean * mean);
      const limit = mean + 5 * Math.sqrt(variance);

      let hot = 0;
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] > limit) hot++;
      }
      hotPixels = hot;
    } else {
      hotPixels = 0;
    }
  }

  const validEvents = totalRows - nonFinite - outOfBounds;

  return {
    sparsity,
    activePixels,
    inactivePixels,
    totalPixels,
    hotPixels,

    density: {
      eventsPerPixel: totalPixels > 0 ? totalRows / totalPixels : null,
      eventsPerActivePixel:
        activePixels > 0 ? totalRows / activePixels : null,
      eventsPerSecond: seconds > 0 ? totalRows / seconds : null
    },

    completeness: totalRows > 0 ? validEvents / totalRows : null,

    checks: {
      nonFiniteEvents: nonFinite,
      outOfBoundsEvents: outOfBounds,
      outOfOrderTimestamps: outOfOrder
    }
  };
}

/*
 * visualize(inputPath, options)
 *
 * inputPath: the data.parquet file made by ingest().
 * options:   { timeBins, gridSize, frameCount, width, height }
 *
 * Returns binned data only (never raw events), so the result stays
 * small however large the dataset is. Errors are thrown.
 */
export async function visualize(inputPath, options = {}) {
  if (!inputPath) {
    throw new Error('inputPath is required');
  }

  if (!inputPath.toLowerCase().endsWith('.parquet')) {
    throw new Error('visualize() needs the data.parquet file made by ingest()');
  }

  const timeBins = positiveInt(options.timeBins, DEFAULTS.timeBins, 'timeBins', 2000);
  const gridSize = positiveInt(options.gridSize, DEFAULTS.gridSize, 'gridSize', 512);
  const frameCount = positiveInt(options.frameCount, DEFAULTS.frameCount, 'frameCount', 200);

  const file = await asyncBufferFromFile(inputPath);
  const parquet = await parquetMetadataAsync(file);
  const totalRows = Number(parquet.num_rows);

  if (totalRows === 0) {
    throw new Error('The dataset has no events');
  }

  // Pass 1: time range and sensor size
  let minT = Infinity;
  let maxT = -Infinity;
  let maxX = -1;
  let maxY = -1;

  await forEachChunk(file, totalRows, (rows) => {
    for (const r of rows) {
      if (r.t < minT) minT = r.t;
      if (r.t > maxT) maxT = r.t;
      if (r.x > maxX) maxX = r.x;
      if (r.y > maxY) maxY = r.y;
    }
  });

  const width = options.width ?? maxX + 1;
  const height = options.height ?? maxY + 1;
  const durationUs = maxT - minT;
  const span = durationUs > 0 ? durationUs : 1;

  // Grid keeps the sensor aspect ratio; the longest side is gridSize.
  const scale = Math.min(1, gridSize / Math.max(width, height));
  const gridW = Math.max(1, Math.ceil(width * scale));
  const gridH = Math.max(1, Math.ceil(height * scale));
  const cells = gridW * gridH;

  const rateOn = new Uint32Array(timeBins);
  const rateOff = new Uint32Array(timeBins);
  const heatmap = new Uint32Array(cells);
  const frames = Array.from({ length: frameCount }, () => new Int32Array(cells));

  // Full-resolution event count per sensor pixel (for the quality scores)
  const pixelCount = width * height;
  const pixels =
    pixelCount > 0 && pixelCount <= MAX_TRACKED_PIXELS
      ? new Uint32Array(pixelCount)
      : null;

  let nonFinite = 0;
  let outOfBounds = 0;
  let outOfOrder = 0;
  let prevT = -Infinity;

  let on = 0;
  let off = 0;

  // Pass 2: fill every chart in one go
  await forEachChunk(file, totalRows, (rows) => {
    for (const r of rows) {
      // Unusable values would corrupt the charts, so count and skip them.
      if (
        !Number.isFinite(r.t) ||
        !Number.isFinite(r.x) ||
        !Number.isFinite(r.y)
      ) {
        nonFinite++;
        continue;
      }

      if (r.t < prevT) outOfOrder++;
      prevT = r.t;

      if (r.x < 0 || r.y < 0 || r.x >= width || r.y >= height) {
        outOfBounds++;
      } else if (pixels) {
        pixels[Math.floor(r.y) * width + Math.floor(r.x)]++;
      }

      const rel = (r.t - minT) / span;
      const bin = Math.min(timeBins - 1, Math.floor(rel * timeBins));
      const frame = Math.min(frameCount - 1, Math.floor(rel * frameCount));

      const gx = Math.min(gridW - 1, Math.floor(r.x * scale));
      const gy = Math.min(gridH - 1, Math.floor(r.y * scale));
      const cell = gy * gridW + gx;

      const isOn = r.p > 0;

      if (isOn) {
        on++;
        rateOn[bin]++;
        frames[frame][cell]++;
      } else {
        off++;
        rateOff[bin]++;
        frames[frame][cell]--;
      }

      heatmap[cell]++;
    }
  });

  const binUs = span / timeBins;
  const frameUs = span / frameCount;

  return {
    success: true,

    metadata: {
      width,
      height,
      eventCount: totalRows,
      durationUs
    },

    // Data-quality scores: sparsity, density, completeness, hot pixels
    quality: buildQuality({
      pixels,
      width,
      height,
      totalRows,
      durationUs,
      nonFinite,
      outOfBounds,
      outOfOrder
    }),

    // Events per time bin (ON and OFF kept apart for stacked charts)
    eventRate: {
      binUs,
      on: Array.from(rateOn),
      off: Array.from(rateOff)
    },

    polarity: { on, off },

    // Event count per grid cell, row by row (index = y * gridW + x)
    heatmap: {
      gridW,
      gridH,
      max: heatmap.reduce((a, b) => (b > a ? b : a), 0),
      values: Array.from(heatmap)
    },

    // ON minus OFF per cell for each time window
    frames: frames.map((values, i) => ({
      tStartUs: Math.round(i * frameUs),
      tEndUs: Math.round((i + 1) * frameUs),
      gridW,
      gridH,
      values: Array.from(values)
    })),

    files: []
  };
}
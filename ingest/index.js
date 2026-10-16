import path from 'node:path';
import fs from 'node:fs/promises';

import { parseFile } from './parser.js';
import { validateEvents } from '../utils/validation.js';
import { buildMetadata } from '../utils/metadata.js';
import {
  toColumns,
  isSortedByTime,
  sortColumns,
  previewRows
} from '../utils/columns.js';
import { writeHdf5 } from '../writers/hdf5.writer.js';
import { writeParquet } from '../writers/parquet.writer.js';
import { verifyOutputs } from '../utils/output-verification.js';

const MB = 1024 * 1024;

const round = (value) => Number(value.toFixed(2));

const perSecond = (count, ms) =>
  ms > 0 ? round((count * 1000) / ms) : null;

// Runs an async or sync step and returns its result with the time taken.
async function timed(step) {
  const start = performance.now();
  const value = await step();

  return { value, ms: performance.now() - start };
}

export async function ingest(
  inputPath,
  outputDir,
  options = {}
) {
  if (!inputPath) {
    throw new Error('inputPath is required');
  }

  if (!outputDir) {
    throw new Error('outputDir is required');
  }

  const totalStart = performance.now();

  const format = path
    .extname(inputPath)
    .replace('.', '')
    .toLowerCase();

  if (options.log !== false) {
    console.log(`[EVAA] Ingesting: ${inputPath}`);
    console.log(`[EVAA] Format: ${format}`);
  }

  // Parse and validate
  const parsed = await timed(() => parseFile(inputPath));
  const events = parsed.value;

  const validation = await timed(() => validateEvents(events));

  const metadata = buildMetadata(events, format, options);

  if (events.skippedRows > 0) {
    metadata.skippedRows = events.skippedRows;
  }

  // Compact columns, sorted by time
  const prepared = await timed(() => {
    let cols = toColumns(events);

    metadata.sortedInput = isSortedByTime(cols.t);

    if (!metadata.sortedInput) {
      cols = sortColumns(cols);
    }

    return cols;
  });
  const columns = prepared.value;

  // Write the output files
  await fs.mkdir(outputDir, { recursive: true });

  const hdf5Path = path.join(outputDir, 'events.h5');
  const parquetPath = path.join(outputDir, 'data.parquet');

  const hdf5 = await timed(() =>
    writeHdf5(columns, hdf5Path, metadata)
  );
  const parquet = await timed(() =>
    writeParquet(columns, parquetPath)
  );

  // Read both files back and compare with the input
  const verification = await timed(() =>
    verifyOutputs({
      hdf5Path,
      parquetPath,
      columns,
      eventCount: columns.n
    })
  );

  const [hdf5Stat, parquetStat] = await Promise.all([
    fs.stat(hdf5Path),
    fs.stat(parquetPath)
  ]);

  if (hdf5Stat.size === 0 || parquetStat.size === 0) {
    throw new Error(
      'Output verification failed: an output file is empty'
    );
  }

  const totalMs = performance.now() - totalStart;

  const benchmark = {
    parsing: {
      durationMs: round(parsed.ms),
      eventsPerSecond: perSecond(columns.n, parsed.ms)
    },
    validationMs: round(validation.ms),
    transformMs: round(prepared.ms),
    hdf5WriteMs: round(hdf5.ms),
    parquetWriteMs: round(parquet.ms),
    verificationMs: round(verification.ms),
    total: {
      durationMs: round(totalMs),
      eventsPerSecond: perSecond(columns.n, totalMs)
    },
    memory: {
      metric: 'peak RSS of this process (process.resourceUsage().maxRSS)',
      peakMB: round(process.resourceUsage().maxRSS / 1024)
    },
    outputFiles: {
      hdf5MB: round(hdf5Stat.size / MB),
      parquetMB: round(parquetStat.size / MB)
    },
    outputCorrectness: verification.value
  };

  if (options.log !== false && options.benchmarkLog) {
    console.log('[EVAA] Benchmark:', JSON.stringify(benchmark));
  }

  return {
    success: true,

    metadata,

    preview: previewRows(columns, 10),

    eventCount: columns.n,

    files: [
      { kind: 'HDF5', path: hdf5Path },
      { kind: 'PARQUET', path: parquetPath }
    ],

    benchmark
  };
}

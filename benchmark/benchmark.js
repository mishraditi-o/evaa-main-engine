import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ingest } from '../ingest/index.js';

// Runs a full ingest into a temporary folder and returns the benchmark block.
export async function benchmark(filePath) {
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'evaa-benchmark-')
  );

  try {
    const result = await ingest(filePath, outputDir);

    return { filePath, ...result.benchmark };
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

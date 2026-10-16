import fs from 'node:fs/promises';
import h5wasm from 'h5wasm/node';

const CHUNK_ROWS = 262144;

/*
 * Canonical EVAA file.
 *
 *   /events/t   float64   timestamps
 *   /events/x   uint16
 *   /events/y   uint16
 *   /events/p   int8      polarity
 *
 * Attributes on /events: width, height, event_count, duration_us, format
 */
export async function writeHdf5(columns, outputPath, metadata = {}) {
  await h5wasm.ready;
  await fs.rm(outputPath, { force: true });

  const file = new h5wasm.File(outputPath, 'w');

  try {
    const { n } = columns;
    const chunks = [Math.min(n, CHUNK_ROWS)];
    const group = file.create_group('events');

    const datasets = [
      ['t', columns.t, '<d'],
      ['x', columns.x, '<H'],
      ['y', columns.y, '<H'],
      ['p', columns.p, '<b']
    ];

    for (const [name, data, dtype] of datasets) {
      group.create_dataset({
        name,
        data,
        shape: [n],
        dtype,
        chunks,
        compression: 4
      });
    }

    group.create_attribute('width', metadata.width ?? 0, null, '<i');
    group.create_attribute('height', metadata.height ?? 0, null, '<i');
    group.create_attribute('event_count', n, null, '<d');
    group.create_attribute('duration_us', metadata.durationUs ?? 0, null, '<d');
    group.create_attribute('format', String(metadata.format ?? ''));
  } finally {
    file.close();
  }

  return outputPath;
}
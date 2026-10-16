
import h5wasm from 'h5wasm/node';
import {
  asyncBufferFromFile,
  parquetMetadataAsync,
  parquetSchema,
  parquetReadObjects
} from 'hyparquet';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Output verification failed: ${message}`);
  }
}

function valuesMatch(actual, expected) {
  if (actual == null || expected == null) return false;

  // Exact comparison for integer coordinates/polarity;
  // small tolerance for floating-point timestamps.
  const a = Number(actual);
  const e = Number(expected);

  if (!Number.isFinite(a) || !Number.isFinite(e)) return false;

  return a === e || Math.abs(a - e) <= 1e-9;
}

export async function verifyOutputs({
  hdf5Path,
  parquetPath,
  columns,
  eventCount
}) {
  const checks = {};

  // Verify the HDF5 structure and dataset row counts.
  await h5wasm.ready;

  const h5 = new h5wasm.File(hdf5Path, 'r');

  try {
    const names = ['t', 'x', 'y', 'p'];

    for (const name of names) {
      const dataset = h5.get(`events/${name}`);

      assert(dataset, `HDF5 dataset events/${name} is missing`);
      assert(
        dataset.shape?.length === 1 &&
          dataset.shape[0] === eventCount,
        `HDF5 dataset events/${name} has an unexpected shape`
      );
    }

    checks.hdf5DatasetsPresent = true;
    checks.hdf5DatasetRowCountsMatch = true;
  } finally {
    h5.close();
  }

  // Verify the Parquet footer, schema and total row count.
  const parquetFile = await asyncBufferFromFile(parquetPath);
  const metadata = await parquetMetadataAsync(parquetFile);
  const schema = parquetSchema(metadata);

  const parquetColumns = (schema.children ?? [])
    .map((child) => child.element?.name)
    .filter(Boolean);

  for (const name of ['t', 'x', 'y', 'p']) {
    assert(
      parquetColumns.includes(name),
      `Parquet column ${name} is missing`
    );
  }

  assert(
    Number(metadata.num_rows) === eventCount,
    `Parquet row count ${metadata.num_rows} does not match ${eventCount}`
  );

  checks.parquetSchemaValid = true;
  checks.parquetRowCountMatches = true;

  // Read only the first and last rows to avoid loading the whole file.
  if (eventCount > 0) {
    const sampleIndices = [...new Set([0, eventCount - 1])];

    for (const index of sampleIndices) {
      const rows = await parquetReadObjects({
        file: parquetFile,
        columns: ['t', 'x', 'y', 'p'],
        rowStart: index,
        rowEnd: index + 1
      });

      assert(rows.length === 1, `Could not read Parquet row ${index}`);

      const row = rows[0];

      for (const name of ['t', 'x', 'y', 'p']) {
        assert(
          valuesMatch(row[name], columns[name][index]),
          `Parquet value mismatch in ${name} at row ${index}`
        );
      }
    }
  }

  checks.parquetSampleValuesMatch = true;

  return {
    passed: true,
    checks
  };
}

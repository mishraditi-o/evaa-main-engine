import { parquetWriteFile } from 'hyparquet-writer';

const ROW_GROUP_SIZE = 1000000;

/*
 * One Parquet file with columns t, x, y, p.
 * Row groups of 1,000,000 events keep min/max timestamps per group,
 * so readers can fetch a time range without reading the whole file.
 */
export async function writeParquet(columns, outputPath) {
  parquetWriteFile({
    filename: outputPath,
    columnData: [
      { name: 't', data: columns.t, type: 'DOUBLE' },
      { name: 'x', data: columns.x, type: 'INT32' },
      { name: 'y', data: columns.y, type: 'INT32' },
      { name: 'p', data: columns.p, type: 'INT32' }
    ],
    rowGroupSize: ROW_GROUP_SIZE,
    codec: 'SNAPPY'
  });

  return outputPath;
}
import h5wasm from 'h5wasm/node';

const FIELDS = ['t', 'x', 'y', 'p'];

// Reads an HDF5 file with the EVAA layout: /events/t, /events/x, /events/y, /events/p
// (the same layout that writers/hdf5.writer.js produces).
export async function parseH5(filePath) {
  if (!filePath) {
    throw new Error('H5 file path is required');
  }

  await h5wasm.ready;

  let file;
  try {
    file = new h5wasm.File(filePath, 'r');
  } catch (error) {
    throw new Error(`Cannot open HDF5 file: ${error.message}`);
  }

  try {
    let keys = [];
    try {
      keys = file.keys();
    } catch {
      // not a valid HDF5 file
    }

    if (!keys.includes('events')) {
      throw new Error(
        'Not an EVAA HDF5 file: the group /events was not found (or the file is not valid HDF5)'
      );
    }

    const columns = {};

    for (const name of FIELDS) {
      const dataset = file.get(`events/${name}`);

      if (!dataset || !dataset.shape) {
        throw new Error(
          `HDF5 file must contain the datasets /events/t, /events/x, /events/y and /events/p. Missing: /events/${name}`
        );
      }

      if (dataset.shape.length !== 1) {
        throw new Error(
          `HDF5 dataset /events/${name} must be one-dimensional`
        );
      }

      columns[name] = dataset.value;
    }

    const n = columns.t.length;

    for (const name of FIELDS) {
      if (columns[name].length !== n) {
        throw new Error(
          'HDF5 datasets /events/t, x, y and p must have the same length'
        );
      }
    }

    const events = new Array(n);

    for (let i = 0; i < n; i++) {
      events[i] = {
        t: Number(columns.t[i]),
        x: Number(columns.x[i]),
        y: Number(columns.y[i]),
        p: Number(columns.p[i])
      };
    }

    return events;
  } finally {
    file.close();
  }
}

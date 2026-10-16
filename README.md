# EVAA Engine (stand-in)

Event-camera ingestion engine used by the EVAA backend. It reads raw event files, checks them, and writes two standard files: HDF5 and Parquet.

> **Status:** this is a stand-in engine for testing the EVAA backend end to end. The production engine comes from the Zoove data team. The backend talks to the engine through one function, `ingest()`, so the real engine can replace this one without backend changes as long as it keeps the contract below.

## Install

```bash
npm install github:Mridul9A/evaa-engine#v0.1.0
```

Always install a release tag (`#v0.1.0`), never `#main`.

- ES module package (`"type": "module"`).
- Node 18 or newer. A CommonJS app (like the NestJS backend) can `require()` it on Node 22.12 or newer.
- Pure JavaScript and WebAssembly. No native builds, no system libraries.

## Usage

```js
import { ingest } from 'evaa-engine';

const result = await ingest('./events.csv', './out', {
  width: 640,   // optional
  height: 480,  // optional
});
```

`ingest(inputPath, outputDir, options)`:

| Argument | Meaning |
| --- | --- |
| `inputPath` | Path to the input file. The format comes from the file extension. |
| `outputDir` | Folder for the output files. Created if missing. |
| `options.width`, `options.height` | Optional sensor size. If not given, it is inferred from the data (see below). |

### Return value

```js
{
  success: true,
  eventCount: 3769468,
  metadata: { width, height, eventCount, durationUs },
  preview: [ { t, x, y, p }, /* first 10 events */ ],
  files: [
    { kind: 'HDF5',    path: '<outputDir>/events.h5' },
    { kind: 'PARQUET', path: '<outputDir>/data.parquet' }
  ]
}
```

`metadata` may carry extra fields. Errors are **thrown** as `Error` with a readable message; `ingest` does not return `success: false`.

## Data model

Every event is `{ t, x, y, p }`:

| Field | Meaning |
| --- | --- |
| `t` | Timestamp in microseconds |
| `x`, `y` | Pixel coordinates (whole numbers, 0 or more) |
| `p` | Polarity, 0 or 1 |

Conventions:
- **Sorting:** events are sorted by `t` (stable sort). If the input was unsorted, `metadata.sortedInput` records that.
- **Resolution:** `width = max x + 1`, `height = max y + 1`, unless `options.width` / `options.height` are passed. A small slice of a file may not reach the sensor edge, so pass the real size when you know it.
- **Duration:** `durationUs = max t - min t`.

## Supported input formats

| Extension | Status | Accepted layout |
| --- | --- | --- |
| `.csv` | Supported | Header naming `t, x, y, p` (aliases such as `timestamp`, `pol` are accepted), or exactly 4 columns without a header |
| `.txt` | Supported | Parsed by its own text parser (`ingest/parsers/txt.parser.js`) |
| `.npy` | Supported | N×4 or 4×N array (`fortran_order` handled), a structured array with fields `t, x, y, p`, or a flat array whose length is a multiple of 4 |
| `.mat` | Supported | MAT v5 (compressed files too), numeric types incl. uint32, N×4 or 4×N; prefers a variable named `events`. MAT v7.3 and big-endian files are rejected |
| `.h5`, `.hdf5` | Not implemented yet | Parser is a stub |
| `.parquet`, `.zarr`, `.aedat4` | Not supported | Throws `Unsupported file format: .<ext>` |

Tables that are not event data (for example a 500×6 array) are rejected with a clear shape error. Negative `x` or `y` and out-of-range values are rejected during validation.

## Output files

| File | Contents |
| --- | --- |
| `events.h5` | HDF5 with datasets `/events/t`, `/events/x`, `/events/y`, `/events/p` |
| `data.parquet` | One Parquet file with columns `t, x, y, p`, 1,000,000 rows per row group |

CSV, MAT and NPY versions of the same events produce identical Parquet output.

## Libraries

| Library | Used for | Notes |
| --- | --- | --- |
| `h5wasm` | Writing HDF5 | WebAssembly, no native build |
| `hyparquet-writer` | Writing Parquet | Pure JavaScript |
| `node:zlib` | Reading compressed MAT v5 | Built into Node |
| `express`, `multer` | Demo HTTP server (`npm start`) | Not needed by the backend |

## Performance and limits

- Tested on a 3,769,468-event file (640×480). Peak memory was about **1 GB**, because files are read whole into memory. There is no streaming yet.
- Run it in a worker with enough memory (2 GB or more for files of that size).

## Not finished

- `.h5` / `.hdf5` input parser
- `benchmark()`: only parse timing, not real analysis
- `visualize()`: stub
- Streaming for very large files
- Tests and CI

## Project layout

```
index.js                 exports ingest, benchmark, visualize
ingest/index.js          parse → validate → metadata → columns → write
ingest/parser.js         picks a parser from the file extension
ingest/parsers/          csv, txt, npy, mat, h5 (stub)
utils/                   metadata, validation, column helpers
writers/                 hdf5.writer.js, parquet.writer.js
benchmark/, visualize/   not finished
server.js                demo HTTP server
test/                    sample files
```

## Versioning

Releases are git tags (`v0.1.0`). The `ingest()` contract above is what the backend depends on; change it only with a new tag and a note here.

## License

To be added.
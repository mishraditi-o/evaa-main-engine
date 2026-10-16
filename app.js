import express from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { ingest, visualize } from './index.js';

const app = express();

app.use(express.json());

const upload = multer({
  dest: path.join(
    os.tmpdir(),
    'evaa-upload'
  )
});

/*
 * Health check
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'success',
    message:
      'EVAA Engine is running'
  });
});

/*
 * Upload + ingest
 */
app.post(
  '/api/ingest',
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      const outputDir =
        await fs.mkdtemp(
          path.join(
            os.tmpdir(),
            'evaa-output-'
          )
        );

      const result =
        await ingest(
          req.file.path,
          outputDir
        );

      return res.json(result);

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
 * Upload a data.parquet file (made by ingest) + visualize
 * Optional form fields: timeBins, gridSize, frameCount
 */
app.post(
  '/api/visualize',
  upload.single('file'),
  async (req, res) => {
    let parquetPath;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      // visualize() checks the .parquet extension; multer drops it
      parquetPath = `${req.file.path}.parquet`;
      await fs.rename(req.file.path, parquetPath);

      const options = {};

      for (const key of ['timeBins', 'gridSize', 'frameCount']) {
        if (req.body[key] !== undefined) {
          options[key] = Number(req.body[key]);
        }
      }

      const result = await visualize(parquetPath, options);

      return res.json(result);

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        error: error.message
      });
    } finally {
      if (parquetPath) {
        await fs.rm(parquetPath, { force: true });
      }
    }
  }
);

export default app;
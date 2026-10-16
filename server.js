import app from './app.js';

const PORT =
  process.env.PORT || 3004;

app.listen(PORT, () => {
  console.log(
    `🚀 EVAA Engine running at http://localhost:${PORT}`
  );

  console.log(
    `📡 Status: http://localhost:${PORT}/api/status`
  );

  console.log(
    `📤 Ingest: POST http://localhost:${PORT}/api/ingest`
  );
});
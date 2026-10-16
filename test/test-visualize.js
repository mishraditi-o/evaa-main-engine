// Usage: node test/test-visualize.js <path to data.parquet> <output.json>
import fs from 'node:fs';
import { visualize } from '../index.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node test/test-visualize.js <data.parquet> <output.json>');
  process.exit(1);
}

const start = performance.now();
const r = await visualize(input);
const json = JSON.stringify(r);

const rateTotal =
  r.eventRate.on.reduce((a, b) => a + b, 0) +
  r.eventRate.off.reduce((a, b) => a + b, 0);
const heatTotal = r.heatmap.values.reduce((a, b) => a + b, 0);

console.log('events        ', r.metadata.eventCount);
console.log('rate total    ', rateTotal, rateTotal === r.metadata.eventCount ? 'OK' : 'MISMATCH');
console.log('heatmap total ', heatTotal, heatTotal === r.metadata.eventCount ? 'OK' : 'MISMATCH');
console.log('ON / OFF      ', r.polarity.on, r.polarity.off);
console.log('grid          ', r.heatmap.gridW + 'x' + r.heatmap.gridH, 'frames', r.frames.length);
console.log('json size KB  ', Math.round(json.length / 1024));
console.log('time ms       ', Math.round(performance.now() - start));

fs.writeFileSync(output, json);
console.log('saved', output);

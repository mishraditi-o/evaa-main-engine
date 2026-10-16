export function buildMetadata(events, format, options = {}) {
  let minT = Infinity;
  let maxT = -Infinity;
  let maxX = -1;
  let maxY = -1;
  const polarities = new Set();

  for (const e of events) {
    if (e.t < minT) minT = e.t;
    if (e.t > maxT) maxT = e.t;
    if (e.x > maxX) maxX = e.x;
    if (e.y > maxY) maxY = e.y;
    polarities.add(e.p);
  }

  return {
    format,
    width: options.width ?? maxX + 1,
    height: options.height ?? maxY + 1,
    eventCount: events.length,
    durationUs: maxT - minT,
    minTimestamp: minT,
    maxTimestamp: maxT,
    timestampUnit: 'microseconds',
    polarityValues: [...polarities].sort((a, b) => a - b),
    eventModel: ['t', 'x', 'y', 'p']
  };
}
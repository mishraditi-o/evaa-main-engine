export function validateEvents(events) {
  if (!Array.isArray(events)) {
    throw new Error(
      'Parser must return an array of events'
    );
  }

  if (events.length === 0) {
    throw new Error(
      'No valid events found'
    );
  }

  for (const event of events) {
    if (
      typeof event.t !== 'number' ||
      typeof event.x !== 'number' ||
      typeof event.y !== 'number' ||
      typeof event.p !== 'number'
    ) {
      throw new Error(
        'Invalid event. Expected { t, x, y, p }'
      );
    }

    if (event.p !== 0 && event.p !== 1 && event.p !== -1) {
      throw new Error(
        `Invalid polarity ${event.p}. p must be 0, 1 or -1.`
      );
    }

    if (event.x > 65535 || event.y > 65535) {
      throw new Error(
        `Invalid event position (${event.x}, ${event.y}). x and y must be 65535 or less.`
      );
    }

    if (event.x < 0 || event.y < 0) {
      throw new Error(
        `Invalid event position (${event.x}, ${event.y}). x and y must not be negative.`
      );
    }
  }

  return true;
}
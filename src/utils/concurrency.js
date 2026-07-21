const CONCURRENCY_LIMIT = 10;

export async function withConcurrencyLimit(items, fn, limit = CONCURRENCY_LIMIT) {
  const results = [];
  const queue = [...items];
  const inFlight = new Set();

  while (queue.length > 0 || inFlight.size > 0) {
    while (queue.length > 0 && inFlight.size < limit) {
      const item = queue.shift();
      const promise = fn(item)
        .then(result => { inFlight.delete(promise); return result; })
        .catch(err => { inFlight.delete(promise); return null; });
      inFlight.add(promise);
      results.push(promise);
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  return Promise.all(results);
}

export function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

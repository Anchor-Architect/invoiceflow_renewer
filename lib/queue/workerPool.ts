export const workerPool = async <T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>
): Promise<void> => {
  const queue = [...items];
  let currentIndex = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const idx = currentIndex;
      currentIndex += 1;
      await handler(item, idx);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, worker));
};

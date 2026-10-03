export function createDeferred() {
  let resolve!: (value: number) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<number>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

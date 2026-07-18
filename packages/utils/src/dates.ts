const DATE_GET_TIME = Date.prototype.getTime;

/** Returns a finite intrinsic Date timestamp without dispatching its methods. */
export function finiteDateMilliseconds(value: unknown): number | undefined {
  try {
    if (!(value instanceof Date)) return undefined;
    const milliseconds = DATE_GET_TIME.call(value);
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  } catch {
    return undefined;
  }
}

/** Returns an owned plain Date snapshot of a valid same-realm Date. */
export function copyFiniteDate(value: unknown): Date | undefined {
  const milliseconds = finiteDateMilliseconds(value);
  return milliseconds === undefined ? undefined : new Date(milliseconds);
}

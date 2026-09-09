/** Exact declaration multiplicities, including unchanged duplicate titles. */
export function matchesProductCoverage(expected: readonly string[], executed: readonly string[]): boolean {
  if (expected.length !== executed.length) return false;
  const remaining = new Map<string, number>();
  for (const name of expected) remaining.set(name, (remaining.get(name) ?? 0) + 1);
  for (const name of executed) {
    const count = remaining.get(name);
    if (count === undefined || count === 0) return false;
    remaining.set(name, count - 1);
  }
  return true;
}

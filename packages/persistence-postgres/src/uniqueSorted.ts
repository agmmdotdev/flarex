export function uniqueSorted<T extends string | number>(
  values: readonly T[],
): T[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

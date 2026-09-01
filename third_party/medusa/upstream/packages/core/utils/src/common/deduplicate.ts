export function deduplicate<T = unknown>(collection: T[]): T[] {
  return [...new Set(collection)]
}

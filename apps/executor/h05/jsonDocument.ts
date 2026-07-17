/** Formats one H05 evidence value as a two-space JSON document. */
export function formatH05JsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

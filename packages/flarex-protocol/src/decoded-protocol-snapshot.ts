/**
 * Detach strictly decoded, acyclic plain protocol data from its source and
 * recursively freeze the owned snapshot.
 *
 * This is not an unknown-input validator or a universal deep-freeze helper.
 * Callers retain ownership of proving that the value contains only the plain
 * data shapes accepted by their protocol decoder.
 */
export function snapshotDecodedProtocolPlainData<T>(value: T): T {
  const snapshot = structuredClone(value);
  freezeDecodedProtocolPlainData(snapshot);
  return snapshot;
}

function freezeDecodedProtocolPlainData(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) freezeDecodedProtocolPlainData(child);
  Object.freeze(value);
}

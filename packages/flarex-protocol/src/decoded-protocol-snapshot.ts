/**
 * Detach strictly decoded, acyclic plain protocol data from its source and
 * recursively freeze the owned snapshot.
 *
 * This is not an unknown-input validator or a universal deep-freeze helper.
 * Callers retain ownership of proving that the value contains only the plain
 * data shapes accepted by their protocol decoder.
 */
export function snapshotDecodedProtocolPlainData<T>(value: T): T;
export function snapshotDecodedProtocolPlainData(value: unknown): unknown {
  const copies = new WeakMap<object, object>();
  const pending: Array<Readonly<{ source: object; target: object }>> = [];
  function copy(current: unknown): unknown {
    if (typeof current === "function" || typeof current === "symbol") {
      throw new TypeError("Decoded protocol snapshots require plain data.");
    }
    if (current === null || typeof current !== "object") return current;
    const previous = copies.get(current);
    if (previous !== undefined) return previous;
    // Like structuredClone, decoded null-prototype records become ordinary
    // records. Define properties explicitly to preserve an own __proto__ key.
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Decoded protocol snapshots require plain records or arrays.");
    }
    const target = array ? [] : {};
    if (array) Object.defineProperty(target, "length", { value: current.length });
    copies.set(current, target);
    pending.push({ source: current, target });
    return target;
  }
  const snapshot = copy(value);
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) throw new Error("Decoded protocol snapshot lost a frame.");
    for (const key of Object.keys(frame.source)) {
      const descriptor = Object.getOwnPropertyDescriptor(frame.source, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError("Decoded protocol snapshots require own data properties.");
      }
      Object.defineProperty(frame.target, key, {
        value: copy(descriptor.value), enumerable: true, configurable: true, writable: true,
      });
    }
    Object.freeze(frame.target);
  }
  return snapshot;
}

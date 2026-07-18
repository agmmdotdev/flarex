/**
 * Recursively freeze an acyclic protocol projection already owned by its
 * caller. Mutable byte storage retains its existing ownership contract and is
 * deliberately not frozen; callers must copy bytes separately when required.
 *
 * This helper does not validate unknown input, establish ownership, traverse
 * accessors, or support cyclic object graphs.
 */
export function freezeOwnedProtocolProjection<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      freezeOwnedProtocolProjection(descriptor.value);
    }
  }
  Object.freeze(value);
  return value;
}

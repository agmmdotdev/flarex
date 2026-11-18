/**
 * Narrows an ordinary object to an exact set of enumerable own data keys.
 *
 * This rejects arrays, non-ordinary prototypes, symbol keys, accessors, and
 * non-enumerable properties without reading any property value. Native
 * reflection errors, including errors thrown by Proxy traps, propagate.
 */
export function hasExactOwnDataKeys(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
): value is Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length) return false;
  const expected = new Set(expectedKeys);
  for (const key of keys) {
    if (typeof key !== "string" || !expected.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return false;
    }
  }
  return true;
}

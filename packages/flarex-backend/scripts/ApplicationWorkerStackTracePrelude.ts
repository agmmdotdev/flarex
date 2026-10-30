/** Runs before the core dependency graph, using only trusted realm intrinsics. */
(() => {
  const error = Error;
  const descriptorOf = Object.getOwnPropertyDescriptor;
  const isExtensible = Object.isExtensible;
  const defineProperty = Object.defineProperty;
  const get = Reflect.get;
  const descriptor = descriptorOf(error, "stackTraceLimit");
  if (descriptor === undefined && !isExtensible(error)) return;
  const value: unknown = get(error, "stackTraceLimit");
  // Effect caches this descriptor at module evaluation. Its existing frozen-
  // environment guard must observe the restriction before later full hardening.
  defineProperty(error, "stackTraceLimit", {
    value,
    writable: false,
    configurable: false,
    enumerable: descriptor?.enumerable ?? false,
  });
})();

/** Test-only inspection of the preserved driver cause chain. */
export function postgresFailureCode(cause: unknown): string | undefined {
  const visited = new Set<object>();
  let current = cause;
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    const code: unknown = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

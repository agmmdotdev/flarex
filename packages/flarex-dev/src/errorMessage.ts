/**
 * Preserves Flarex-dev's message-only compatibility projection for unknown
 * exceptions.
 *
 * This deliberately uses realm-sensitive `instanceof Error` and otherwise
 * invokes `String`. Non-Error coercion may therefore execute caller code and
 * throw; boundaries needing safer, stack-bearing, redacted, or typed output
 * must retain their own policy.
 */
export function errorMessageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

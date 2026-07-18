export type StoredAuthorityCorruptionResult<Reason> = Readonly<{
  readonly kind: "corrupt";
  readonly reason: Reason;
  readonly cause?: unknown;
}>;

/** Constructs the shared shallow-frozen corruption facet for authority loads. */
export function storedAuthorityCorruptionResult<Reason>(
  reason: Reason,
  cause?: unknown,
): StoredAuthorityCorruptionResult<Reason> {
  return Object.freeze({
    kind: "corrupt",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

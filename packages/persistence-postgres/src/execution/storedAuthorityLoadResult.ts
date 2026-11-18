export type StoredAuthorityMismatchResult<Reason> = Readonly<{
  readonly kind: "authorityMismatch";
  readonly reason: Reason;
}>;

/** Constructs the shared shallow-frozen mismatch facet for authority loads. */
export function storedAuthorityMismatchResult<Reason>(
  reason: Reason,
): StoredAuthorityMismatchResult<Reason> {
  return Object.freeze({ kind: "authorityMismatch", reason });
}

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

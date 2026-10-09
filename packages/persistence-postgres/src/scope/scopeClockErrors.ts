import type { ScopeId } from "flarex-protocol/storage-authority";

export class ScopeClockNotFoundError extends Error {
  readonly _tag = "ScopeClockNotFoundError" as const;

  constructor(readonly scopeId: ScopeId) {
    super(`Scope clock does not exist: ${scopeId}`);
    this.name = "ScopeClockNotFoundError";
  }
}

export class ScopeClockCorruptionError extends Error {
  readonly _tag = "ScopeClockCorruptionError" as const;

  constructor(
    readonly scopeId: string,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Scope clock ${scopeId} is invalid: ${reason}`, options);
    this.name = "ScopeClockCorruptionError";
  }
}

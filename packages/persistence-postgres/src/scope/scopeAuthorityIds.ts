import { Result } from "effect";
import {
  ScopeEpochSchema,
  ScopeIdSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";

export class InvalidGeneratedScopeAuthorityIdError extends Error {
  readonly _tag = "InvalidGeneratedScopeAuthorityIdError" as const;

  constructor(
    readonly field: "scopeId" | "epoch",
    readonly value: string,
  ) {
    super(
      `Generated scope authority ${field} is not a lowercase RFC 4122 UUID v4: ${value}`,
    );
    this.name = "InvalidGeneratedScopeAuthorityIdError";
  }
}

export class ScopeAuthorityIdGenerationExhaustedError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly attempts: number,
  ) {
    super(
      `Could not generate a collision-free scope ID for deployment ${deploymentId} after ${attempts} attempts`,
    );
    this.name = "ScopeAuthorityIdGenerationExhaustedError";
  }
}

export const MAX_SCOPE_AUTHORITY_ID_GENERATION_ATTEMPTS = 8;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function generateScopeAuthorityScopeId(
  randomUuid: () => string,
): ScopeId {
  const uuid = requireGeneratedUuid("scopeId", randomUuid());
  return ScopeIdSchema.make(`scope_${uuid}`);
}

/**
 * Throwing compatibility projection for the split-scope provisioner. Delete
 * it when that caller consumes the Result authority directly.
 */
export function generateScopeAuthorityEpoch(
  randomUuid: () => string,
): ScopeEpoch {
  return Result.getOrThrow(generateScopeAuthorityEpochResult(randomUuid));
}

export function generateScopeAuthorityEpochResult(
  randomUuid: () => string,
): Result.Result<ScopeEpoch, InvalidGeneratedScopeAuthorityIdError> {
  return requireGeneratedUuidResult("epoch", randomUuid()).pipe(
    Result.map((uuid) => ScopeEpochSchema.make(`epoch_${uuid}`)),
  );
}

function requireGeneratedUuid(
  field: "scopeId" | "epoch",
  value: string,
): string {
  return Result.getOrThrow(requireGeneratedUuidResult(field, value));
}

function requireGeneratedUuidResult(
  field: "scopeId" | "epoch",
  value: string,
): Result.Result<string, InvalidGeneratedScopeAuthorityIdError> {
  if (!UUID_V4_PATTERN.test(value)) {
    return Result.fail(new InvalidGeneratedScopeAuthorityIdError(field, value));
  }
  return Result.succeed(value);
}

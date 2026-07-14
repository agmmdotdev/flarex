import { Data, Effect, Schema } from "effect";
import {
  PointMutationTargetSelectionV1Error,
  decodeActivePointMutationTargetMetadataV1,
  decodePointMutationCurrentScopeAuthorityV1,
  preparePointMutationStartEvidenceV1,
  type PreparedPointMutationStartEvidenceV1,
} from "flarex-protocol/point-mutation-start";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import {
  FlarexValueCodecV1Error,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";
import { ValidatorValueErrorV1 } from "flarex-protocol/validator-engine";

const serverPreparedTransactionRequestKeyBrand: unique symbol = Symbol(
  "FlarexBackend/ServerPreparedTransactionRequestKeyV1",
);
const decodeTransactionRequestKeyV1 = Schema.decodeUnknownSync(
  TransactionRequestKeyV1Schema,
);

export interface ServerPreparedTransactionRequestKeyV1 {
  readonly [serverPreparedTransactionRequestKeyBrand]: true;
}

const transactionRequestKeyByHandle = new WeakMap<
  object,
  TransactionRequestKeyV1
>();

export class InvalidServerPreparedTransactionRequestKeyV1Error
  extends Data.TaggedError("InvalidServerPreparedTransactionRequestKeyV1Error")<{}> {}

/**
 * Package-private trusted-host boundary. The production namespace derivation
 * remains deferred; this does not authorize a public idempotency key.
 */
export function createServerPreparedTransactionRequestKeyV1(
  value: unknown,
): ServerPreparedTransactionRequestKeyV1 {
  let requestKey: TransactionRequestKeyV1;
  try {
    requestKey = decodeTransactionRequestKeyV1(value);
  } catch {
    throw new InvalidServerPreparedTransactionRequestKeyV1Error();
  }
  const handle = Object.freeze({
    [serverPreparedTransactionRequestKeyBrand]: true as const,
  });
  transactionRequestKeyByHandle.set(handle, requestKey);
  return handle;
}

export function inspectServerPreparedTransactionRequestKeyV1(
  value: unknown,
): TransactionRequestKeyV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidServerPreparedTransactionRequestKeyV1Error();
  }
  const requestKey = transactionRequestKeyByHandle.get(value);
  if (requestKey === undefined) {
    throw new InvalidServerPreparedTransactionRequestKeyV1Error();
  }
  return requestKey;
}

export interface IssuerPointMutationStartCandidateV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly functionPath: TransactionFunctionPathV1;
  readonly args: unknown;
  readonly requestKey: ServerPreparedTransactionRequestKeyV1;
}

export interface IssuerPointMutationGrantPreparationRuntimeV1 {
  readonly loadActiveTargetMetadata: (
    deploymentId: TransactionGrantDeploymentIdV1,
    functionPath: TransactionFunctionPathV1,
  ) => Effect.Effect<
    unknown | null,
    PointMutationGrantPreparationSourceV1Error
  >;
  readonly loadCurrentScopeAuthority: (
    deploymentId: TransactionGrantDeploymentIdV1,
  ) => Effect.Effect<unknown, PointMutationGrantPreparationSourceV1Error>;
}

export type PointMutationGrantPreparationSourceV1 =
  | "targetMetadata"
  | "scopeAuthority"
  | "canonicalization";

export class PointMutationGrantPreparationSourceV1Error
  extends Data.TaggedError("PointMutationGrantPreparationSourceV1Error")<{
    readonly source: PointMutationGrantPreparationSourceV1;
  }> {}

export type PointMutationTargetMetadataV1Issue = "missing" | "corrupt";

export class PointMutationTargetMetadataV1Error extends Data.TaggedError(
  "PointMutationTargetMetadataV1Error",
)<{
  readonly issue: PointMutationTargetMetadataV1Issue;
}> {}

export type PointMutationScopeAuthorityV1Issue =
  | "corrupt"
  | "deploymentMismatch"
  | "scopeMismatch";

export class PointMutationScopeAuthorityV1Error extends Data.TaggedError(
  "PointMutationScopeAuthorityV1Error",
)<{
  readonly issue: PointMutationScopeAuthorityV1Issue;
}> {}

const issuerPreparedPointMutationStartBrand: unique symbol = Symbol(
  "FlarexBackend/IssuerPreparedPointMutationStartV1",
);

export interface IssuerPreparedPointMutationStartV1 {
  readonly [issuerPreparedPointMutationStartBrand]: true;
}

const issuerPreparedEvidenceByHandle = new WeakMap<
  object,
  PreparedPointMutationStartEvidenceV1
>();

export class InvalidIssuerPreparedPointMutationStartV1Error
  extends Data.TaggedError("InvalidIssuerPreparedPointMutationStartV1Error")<{}> {}

export type PrepareIssuerPointMutationStartV1Error =
  | InvalidServerPreparedTransactionRequestKeyV1Error
  | PointMutationGrantPreparationSourceV1Error
  | PointMutationTargetMetadataV1Error
  | PointMutationScopeAuthorityV1Error
  | PointMutationTargetSelectionV1Error
  | ValidatorValueErrorV1
  | FlarexValueCodecV1Error;

export interface IssuerPointMutationGrantPreparationV1 {
  readonly prepare: (
    candidate: IssuerPointMutationStartCandidateV1,
  ) => Effect.Effect<
    IssuerPreparedPointMutationStartV1,
    PrepareIssuerPointMutationStartV1Error
  >;
}

export function makeIssuerPointMutationGrantPreparationV1(
  runtime: IssuerPointMutationGrantPreparationRuntimeV1,
): IssuerPointMutationGrantPreparationV1 {
  const prepare = Effect.fn(
    "PointMutationGrantPreparation.prepare",
  )(function* (
    candidate: IssuerPointMutationStartCandidateV1,
  ): Effect.fn.Return<
    IssuerPreparedPointMutationStartV1,
    PrepareIssuerPointMutationStartV1Error
  > {
    const deploymentId = candidate.deploymentId;
    const functionPath = candidate.functionPath;
    const requestKeyHandle = candidate.requestKey;
    const args = candidate.args;
    const requestKey = yield* Effect.try({
      try: () => inspectServerPreparedTransactionRequestKeyV1(
        requestKeyHandle,
      ),
      catch: () => new InvalidServerPreparedTransactionRequestKeyV1Error(),
    });
    const snapshottedArgs = yield* Effect.try({
      try: () => normalizeFlarexValueV1(args).value,
      catch: (cause) =>
        cause instanceof FlarexValueCodecV1Error
          ? cause
          : new PointMutationGrantPreparationSourceV1Error({
              source: "canonicalization",
            }),
    });
    const unresolvedMetadata = yield* runtime.loadActiveTargetMetadata(
      deploymentId,
      functionPath,
    );
    if (unresolvedMetadata === null) {
      return yield* Effect.fail(
        new PointMutationTargetMetadataV1Error({ issue: "missing" }),
      );
    }
    const metadata = yield* Effect.try({
      try: () => decodeActivePointMutationTargetMetadataV1(
        unresolvedMetadata,
      ),
      catch: () => new PointMutationTargetMetadataV1Error({
        issue: "corrupt",
      }),
    });
    const unresolvedAuthority = yield* runtime.loadCurrentScopeAuthority(
      deploymentId,
    );
    const authority = yield* Effect.try({
      try: () => decodePointMutationCurrentScopeAuthorityV1(
        unresolvedAuthority,
      ),
      catch: () => new PointMutationScopeAuthorityV1Error({
        issue: "corrupt",
      }),
    });
    if (authority.deploymentId !== metadata.deploymentId) {
      return yield* Effect.fail(
        new PointMutationScopeAuthorityV1Error({
          issue: "deploymentMismatch",
        }),
      );
    }
    if (authority.scopeId !== metadata.scopeId) {
      return yield* Effect.fail(
        new PointMutationScopeAuthorityV1Error({ issue: "scopeMismatch" }),
      );
    }

    const evidence = yield* Effect.tryPromise({
      try: () => preparePointMutationStartEvidenceV1(
        metadata,
        {
          deploymentId,
          functionPath,
          args: snapshottedArgs,
          requestKey,
        },
        authority.authorizationRevocationEpoch,
      ),
      catch: preparationFailure,
    });
    const handle = Object.freeze({
      [issuerPreparedPointMutationStartBrand]: true as const,
    });
    issuerPreparedEvidenceByHandle.set(handle, evidence);
    return handle;
  });

  return Object.freeze({ prepare });
}

export function inspectIssuerPreparedPointMutationStartV1(
  value: unknown,
): PreparedPointMutationStartEvidenceV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidIssuerPreparedPointMutationStartV1Error();
  }
  const evidence = issuerPreparedEvidenceByHandle.get(value);
  if (evidence === undefined) {
    throw new InvalidIssuerPreparedPointMutationStartV1Error();
  }
  return evidence;
}

function preparationFailure(
  cause: unknown,
): PrepareIssuerPointMutationStartV1Error {
  if (
    cause instanceof PointMutationTargetSelectionV1Error ||
    cause instanceof ValidatorValueErrorV1 ||
    cause instanceof FlarexValueCodecV1Error
  ) {
    return cause;
  }
  return new PointMutationGrantPreparationSourceV1Error({
    source: "canonicalization",
  });
}

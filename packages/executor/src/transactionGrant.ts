import { Effect, Result } from "effect";

import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  isNonNegativeTransactionGrantDurationMillisecondsV1,
  isPositiveTransactionGrantDurationMillisecondsV1,
  isTransactionGrantEpochMillisecondsV1,
  type TransactionGrantDeploymentIdV1,
  type TransactionGrantKeyIdV1,
  type TransactionGrantPayloadV1,
} from "flarex-protocol/transaction-grant";
import type {
  PreparedPointMutationStartEvidenceV1,
} from "flarex-protocol/point-mutation-start";
import type { ScopeId } from "flarex-protocol/storage-authority";

import {
  InvalidExecutorPreparedPointMutationStartV1Error,
  inspectExecutorPreparedPointMutationStartV1,
  type ExecutorPreparedPointMutationStartV1,
} from "./pointMutationStartPreparation";
import {
  createTransactionGrantVerificationKernelV1,
  registerTransactionGrantVerificationKernelV1,
  verificationFailure,
  type TransactionGrantVerificationV1Error,
  type VerifiedTransactionGrantInspectionV1,
} from "./transactionGrantVerificationKernel";

export {
  TransactionGrantVerificationV1Error,
  type ExpectedTransactionGrantLogicalPinFieldV1,
  type ExpectedTransactionGrantLogicalPinsV1,
  type TransactionGrantVerificationV1Issue,
  type VerifiedTransactionGrantInspectionV1,
} from "./transactionGrantVerificationKernel";

export interface TransactionGrantVerificationClockV1 {
  readonly now: () => Date;
}

export type TransactionGrantSignatureVerifierV1 = (
  signingInput: Uint8Array,
  signature: Uint8Array,
) => Promise<boolean>;

interface TransactionGrantVerificationKeyBaseV1 {
  readonly kid: TransactionGrantKeyIdV1;
  readonly purpose: string;
}

export interface ActiveTransactionGrantVerificationKeyV1
  extends TransactionGrantVerificationKeyBaseV1 {
  readonly state: "active";
  readonly issuedAtInclusiveEpochMilliseconds: number;
  readonly issuedAtExclusiveEpochMilliseconds?: number;
  readonly verificationEndsAtExclusiveEpochMilliseconds?: number;
  readonly verify: TransactionGrantSignatureVerifierV1;
}

export interface PrepublishedTransactionGrantVerificationKeyV1
  extends TransactionGrantVerificationKeyBaseV1 {
  readonly state: "verifyOnly";
  readonly phase: "prepublished";
  readonly verify: TransactionGrantSignatureVerifierV1;
}

export interface RetiredTransactionGrantVerificationKeyV1
  extends TransactionGrantVerificationKeyBaseV1 {
  readonly state: "verifyOnly";
  readonly phase: "retired";
  readonly issuedAtInclusiveEpochMilliseconds: number;
  readonly issuedAtExclusiveEpochMilliseconds: number;
  readonly verificationEndsAtExclusiveEpochMilliseconds: number;
  readonly verify: TransactionGrantSignatureVerifierV1;
}

export interface DisabledTransactionGrantVerificationKeyV1
  extends TransactionGrantVerificationKeyBaseV1 {
  readonly state: "disabled";
}

export type TransactionGrantVerificationKeyV1 =
  | ActiveTransactionGrantVerificationKeyV1
  | PrepublishedTransactionGrantVerificationKeyV1
  | RetiredTransactionGrantVerificationKeyV1
  | DisabledTransactionGrantVerificationKeyV1;

export interface CreateTransactionGrantVerificationKeyNamespaceV1Input {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly keys: ReadonlyArray<TransactionGrantVerificationKeyV1>;
}

const transactionGrantVerificationKeyNamespaceBrand: unique symbol = Symbol(
  "FlarexExecutor/TransactionGrantVerificationKeyNamespaceV1",
);

export interface TransactionGrantVerificationKeyNamespaceV1 {
  readonly [transactionGrantVerificationKeyNamespaceBrand]: true;
}

interface StoredTransactionGrantVerificationKeyBaseV1 {
  readonly kid: TransactionGrantKeyIdV1;
  readonly purpose: typeof TRANSACTION_GRANT_KEY_PURPOSE_V1;
}

type StoredTransactionGrantVerificationKeyV1 =
  | (StoredTransactionGrantVerificationKeyBaseV1 & {
      readonly state: "active";
      readonly issuedAtInclusiveEpochMilliseconds: number;
      readonly issuedAtExclusiveEpochMilliseconds?: number;
      readonly verificationEndsAtExclusiveEpochMilliseconds?: number;
      readonly verify: TransactionGrantSignatureVerifierV1;
    })
  | (StoredTransactionGrantVerificationKeyBaseV1 & {
      readonly state: "verifyOnly";
      readonly phase: "prepublished";
      readonly verify: TransactionGrantSignatureVerifierV1;
    })
  | (StoredTransactionGrantVerificationKeyBaseV1 & {
      readonly state: "verifyOnly";
      readonly phase: "retired";
      readonly issuedAtInclusiveEpochMilliseconds: number;
      readonly issuedAtExclusiveEpochMilliseconds: number;
      readonly verificationEndsAtExclusiveEpochMilliseconds: number;
      readonly verify: TransactionGrantSignatureVerifierV1;
    })
  | (StoredTransactionGrantVerificationKeyBaseV1 & {
      readonly state: "disabled";
    });

interface StoredTransactionGrantVerificationKeyNamespaceV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly keysById: ReadonlyMap<string, StoredTransactionGrantVerificationKeyV1>;
}

const verificationKeyNamespaceByHandle = new WeakMap<
  object,
  StoredTransactionGrantVerificationKeyNamespaceV1
>();

export type TransactionGrantAuthorityConfigurationV1Issue =
  | "invalidMaximumGrantLifetime"
  | "invalidMaximumFutureIssuedAtSkew"
  | "invalidKeyNamespace"
  | "duplicateKeyId"
  | "wrongKeyPurpose"
  | "invalidKeyWindow"
  | "wrongActiveKeyCount";

export class TransactionGrantAuthorityConfigurationV1Error extends Error {
  readonly name = "TransactionGrantAuthorityConfigurationV1Error";

  constructor(readonly issue: TransactionGrantAuthorityConfigurationV1Issue) {
    super(`Invalid transaction-grant authority configuration: ${issue}.`);
  }
}

export class InvalidVerifiedTransactionGrantV1Error extends Error {
  readonly _tag = "InvalidVerifiedTransactionGrantV1Error" as const;
  readonly name = "InvalidVerifiedTransactionGrantV1Error";

  constructor() {
    super("Value is not a process-local verified transaction grant.");
  }
}

const verifiedTransactionGrantBrand: unique symbol = Symbol(
  "FlarexExecutor/VerifiedTransactionGrantV1",
);

export interface VerifiedTransactionGrantV1 {
  readonly [verifiedTransactionGrantBrand]: true;
}

const verifiedTransactionGrantInspectionByHandle = new WeakMap<
  object,
  VerifiedTransactionGrantInspectionV1
>();
const expectedStartByVerifiedTransactionGrantHandle = new WeakMap<
  object,
  ExecutorPreparedPointMutationStartV1
>();

export interface CurrentScopeAuthorizationEpochV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ScopeId;
  readonly authorizationRevocationEpoch:
    TransactionGrantPayloadV1["authorizationRevocationEpoch"];
}

export interface CurrentScopeAuthorizationEpochResolverV1<
  ResolverError = never,
> {
  readonly resolveCurrent: (
    deploymentId: TransactionGrantDeploymentIdV1,
  ) => Effect.Effect<CurrentScopeAuthorizationEpochV1, ResolverError>;
}

export type CurrentEpochTransactionGrantAdmissionV1Issue =
  | {
      readonly reason: "locatedDeploymentMismatch";
      readonly expected: TransactionGrantDeploymentIdV1;
      readonly actual: TransactionGrantDeploymentIdV1;
    }
  | {
      readonly reason: "locatedScopeMismatch";
      readonly expected: TransactionGrantPayloadV1["scopeId"];
      readonly actual: ScopeId;
    }
  | {
      readonly reason: "authorizationRevocationEpochMismatch";
      readonly expected:
        TransactionGrantPayloadV1["authorizationRevocationEpoch"];
      readonly actual:
        TransactionGrantPayloadV1["authorizationRevocationEpoch"];
    };

export class CurrentEpochTransactionGrantAdmissionV1Error extends Error {
  readonly _tag = "CurrentEpochTransactionGrantAdmissionV1Error" as const;
  readonly name = "CurrentEpochTransactionGrantAdmissionV1Error";

  constructor(readonly issue: CurrentEpochTransactionGrantAdmissionV1Issue) {
    super(`Current-epoch transaction-grant admission failed: ${issue.reason}.`);
  }
}

export class InvalidCurrentEpochVerifiedTransactionGrantV1Error extends Error {
  readonly name = "InvalidCurrentEpochVerifiedTransactionGrantV1Error";

  constructor() {
    super("Value is not a process-local current-epoch transaction grant.");
  }
}

const currentEpochVerifiedTransactionGrantBrand: unique symbol = Symbol(
  "FlarexExecutor/CurrentEpochVerifiedTransactionGrantV1",
);

export interface CurrentEpochVerifiedTransactionGrantV1 {
  readonly [currentEpochVerifiedTransactionGrantBrand]: true;
}

export interface CurrentEpochVerifiedTransactionGrantInspectionV1 {
  readonly verifiedGrant: VerifiedTransactionGrantInspectionV1;
  readonly currentAuthority: CurrentScopeAuthorizationEpochV1;
}

const currentEpochVerifiedTransactionGrantInspectionByHandle = new WeakMap<
  object,
  CurrentEpochVerifiedTransactionGrantInspectionV1
>();

export interface CurrentEpochTransactionGrantAdmissionV1<
  ResolverError = never,
> {
  readonly admit: (
    verifiedGrant: VerifiedTransactionGrantV1,
  ) => Effect.Effect<
    CurrentEpochVerifiedTransactionGrantV1,
    | ResolverError
    | InvalidVerifiedTransactionGrantV1Error
    | CurrentEpochTransactionGrantAdmissionV1Error
  >;
}

/**
 * Adds one located current-epoch check to an already A2b-verified grant. The
 * returned capability is preliminary: O03-B must recheck the epoch inside its
 * short session-activation transaction before creating durable authority.
 */
export function createCurrentEpochTransactionGrantAdmissionV1<ResolverError>(
  resolver: CurrentScopeAuthorizationEpochResolverV1<ResolverError>,
): CurrentEpochTransactionGrantAdmissionV1<ResolverError> {
  const resolveCurrent = resolver.resolveCurrent;
  const admit: CurrentEpochTransactionGrantAdmissionV1<ResolverError>["admit"] =
    Effect.fn("TransactionGrant.admitCurrentEpoch")(function* (
      verifiedGrant,
    ) {
      const verifiedGrantInspection = yield* Effect.fromResult(
        inspectVerifiedTransactionGrantResultV1(verifiedGrant),
      );
      const payload = verifiedGrantInspection.evidence.payload;
      const unresolvedCurrentAuthority = yield* resolveCurrent(
        payload.deploymentId,
      );
      const currentAuthority = Object.freeze({
        deploymentId: unresolvedCurrentAuthority.deploymentId,
        scopeId: unresolvedCurrentAuthority.scopeId,
        authorizationRevocationEpoch:
          unresolvedCurrentAuthority.authorizationRevocationEpoch,
      }) satisfies CurrentScopeAuthorizationEpochV1;

      if (currentAuthority.deploymentId !== payload.deploymentId) {
        return yield* Effect.fail(currentEpochAdmissionFailure({
          reason: "locatedDeploymentMismatch",
          expected: payload.deploymentId,
          actual: currentAuthority.deploymentId,
        }));
      }
      if (currentAuthority.scopeId !== payload.scopeId) {
        return yield* Effect.fail(currentEpochAdmissionFailure({
          reason: "locatedScopeMismatch",
          expected: payload.scopeId,
          actual: currentAuthority.scopeId,
        }));
      }
      if (
        currentAuthority.authorizationRevocationEpoch !==
          payload.authorizationRevocationEpoch
      ) {
        return yield* Effect.fail(currentEpochAdmissionFailure({
          reason: "authorizationRevocationEpochMismatch",
          expected: payload.authorizationRevocationEpoch,
          actual: currentAuthority.authorizationRevocationEpoch,
        }));
      }

      const inspection = Object.freeze({
        verifiedGrant: verifiedGrantInspection,
        currentAuthority,
      }) satisfies CurrentEpochVerifiedTransactionGrantInspectionV1;
      const handle = Object.freeze({
        [currentEpochVerifiedTransactionGrantBrand]: true as const,
      });
      currentEpochVerifiedTransactionGrantInspectionByHandle.set(
        handle,
        inspection,
      );
      return handle;
    });

  return Object.freeze({ admit });
}

export function inspectCurrentEpochVerifiedTransactionGrantV1(
  value: unknown,
): CurrentEpochVerifiedTransactionGrantInspectionV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidCurrentEpochVerifiedTransactionGrantV1Error();
  }
  const inspection =
    currentEpochVerifiedTransactionGrantInspectionByHandle.get(value);
  if (inspection === undefined) {
    throw new InvalidCurrentEpochVerifiedTransactionGrantV1Error();
  }
  return inspection;
}

const admittedPointMutationStartBrand: unique symbol = Symbol(
  "FlarexExecutor/AdmittedPointMutationStartV1",
);

/** Final private O03-A capability and the only prepared input accepted by O03-B. */
export interface AdmittedPointMutationStartV1 {
  readonly [admittedPointMutationStartBrand]: true;
}

export interface AdmittedPointMutationStartInspectionV1 {
  readonly preparedStart: PreparedPointMutationStartEvidenceV1;
  readonly verifiedGrant: VerifiedTransactionGrantInspectionV1;
  readonly currentAuthority: CurrentScopeAuthorizationEpochV1;
}

const admittedPointMutationStartInspectionByHandle = new WeakMap<
  object,
  AdmittedPointMutationStartInspectionV1
>();

export class InvalidAdmittedPointMutationStartV1Error extends Error {
  readonly _tag = "InvalidAdmittedPointMutationStartV1Error" as const;
  readonly name = "InvalidAdmittedPointMutationStartV1Error";

  constructor() {
    super("Value is not a process-local admitted point-mutation start.");
  }
}

export interface PointMutationStartAdmissionV1<ResolverError = never> {
  readonly admit: (
    verifiedGrant: VerifiedTransactionGrantV1,
  ) => Effect.Effect<
    AdmittedPointMutationStartV1,
    | ResolverError
    | CurrentEpochTransactionGrantAdmissionV1Error
    | TransactionGrantVerificationV1Error
  >;
}

export function createPointMutationStartAdmissionV1<ResolverError>(
  resolver: CurrentScopeAuthorizationEpochResolverV1<ResolverError>,
): PointMutationStartAdmissionV1<ResolverError> {
  const currentEpochAdmission =
    createCurrentEpochTransactionGrantAdmissionV1(resolver);
  const admit: PointMutationStartAdmissionV1<ResolverError>["admit"] =
    Effect.fn("TransactionGrant.admitPointMutationStart")(function* (
      verifiedGrant,
    ) {
      const expectedStart =
        expectedStartByVerifiedTransactionGrantHandle.get(verifiedGrant);
      if (expectedStart === undefined) {
        return yield* Effect.fail(verificationFailure("invalidPreparedStart"));
      }
      const currentEpochGrant = yield* currentEpochAdmission.admit(
        verifiedGrant,
      ).pipe(
        Effect.catchTag(
          "InvalidVerifiedTransactionGrantV1Error",
          Effect.die,
        ),
      );
      const currentEpochInspection =
        currentEpochVerifiedTransactionGrantInspectionByHandle.get(
          currentEpochGrant,
        );
      if (currentEpochInspection === undefined) {
        return yield* Effect.die(
          new InvalidCurrentEpochVerifiedTransactionGrantV1Error(),
        );
      }
      const inspection = Object.freeze({
        preparedStart: inspectExecutorPreparedPointMutationStartV1(
          expectedStart,
        ),
        verifiedGrant: currentEpochInspection.verifiedGrant,
        currentAuthority: currentEpochInspection.currentAuthority,
      } satisfies AdmittedPointMutationStartInspectionV1);
      const handle = Object.freeze({
        [admittedPointMutationStartBrand]: true as const,
      });
      admittedPointMutationStartInspectionByHandle.set(handle, inspection);
      return handle;
    });
  return Object.freeze({ admit });
}

export function inspectAdmittedPointMutationStartV1(
  value: unknown,
): AdmittedPointMutationStartInspectionV1 {
  return Result.getOrThrow(inspectAdmittedPointMutationStartResultV1(value));
}

export function inspectAdmittedPointMutationStartResultV1(
  value: unknown,
): Result.Result<
  AdmittedPointMutationStartInspectionV1,
  InvalidAdmittedPointMutationStartV1Error
> {
  if (typeof value !== "object" || value === null) {
    return Result.fail(new InvalidAdmittedPointMutationStartV1Error());
  }
  const inspection = admittedPointMutationStartInspectionByHandle.get(value);
  if (inspection === undefined) {
    return Result.fail(new InvalidAdmittedPointMutationStartV1Error());
  }
  return Result.succeed(inspection);
}

export interface TransactionGrantVerifierV1Config {
  readonly clock: TransactionGrantVerificationClockV1;
  readonly verificationKeyNamespace:
    TransactionGrantVerificationKeyNamespaceV1;
  readonly maximumGrantLifetimeMilliseconds: number;
  readonly maximumFutureIssuedAtSkewMilliseconds: number;
}

export interface VerifyTransactionGrantV1Input {
  readonly jws: unknown;
  readonly expectedStart: ExecutorPreparedPointMutationStartV1;
}

export interface TransactionGrantVerifierV1 {
  readonly verify: (
    input: VerifyTransactionGrantV1Input,
  ) => Promise<VerifiedTransactionGrantV1>;
}

export function createTransactionGrantVerificationKeyNamespaceV1(
  input: CreateTransactionGrantVerificationKeyNamespaceV1Input,
): TransactionGrantVerificationKeyNamespaceV1 {
  const keysById = new Map<string, StoredTransactionGrantVerificationKeyV1>();
  let activeKeyCount = 0;
  for (const key of [...input.keys]) {
    if (keysById.has(key.kid)) {
      throw new TransactionGrantAuthorityConfigurationV1Error(
        "duplicateKeyId",
      );
    }
    if (key.purpose !== TRANSACTION_GRANT_KEY_PURPOSE_V1) {
      throw new TransactionGrantAuthorityConfigurationV1Error(
        "wrongKeyPurpose",
      );
    }
    const storedKey = copyAndValidateKey(key);
    if (storedKey.state === "active") activeKeyCount += 1;
    keysById.set(storedKey.kid, storedKey);
  }
  if (activeKeyCount !== 1) {
    throw new TransactionGrantAuthorityConfigurationV1Error(
      "wrongActiveKeyCount",
    );
  }

  const handle = Object.freeze({
    [transactionGrantVerificationKeyNamespaceBrand]: true as const,
  });
  verificationKeyNamespaceByHandle.set(handle, Object.freeze({
    deploymentId: input.deploymentId,
    keysById,
  }));
  return handle;
}

export function createTransactionGrantVerifierV1(
  config: TransactionGrantVerifierV1Config,
): TransactionGrantVerifierV1 {
  if (!isPositiveTransactionGrantDurationMillisecondsV1(
    config.maximumGrantLifetimeMilliseconds,
  )) {
    throw new TransactionGrantAuthorityConfigurationV1Error(
      "invalidMaximumGrantLifetime",
    );
  }
  if (!isNonNegativeTransactionGrantDurationMillisecondsV1(
    config.maximumFutureIssuedAtSkewMilliseconds,
  )) {
    throw new TransactionGrantAuthorityConfigurationV1Error(
      "invalidMaximumFutureIssuedAtSkew",
    );
  }
  const keyNamespace = verificationKeyNamespaceByHandle.get(
    config.verificationKeyNamespace,
  );
  if (keyNamespace === undefined) {
    throw new TransactionGrantAuthorityConfigurationV1Error(
      "invalidKeyNamespace",
    );
  }

  const readCurrentTime = config.clock.now;
  const kernel = createTransactionGrantVerificationKernelV1({
    deploymentId: keyNamespace.deploymentId,
    keysById: keyNamespace.keysById,
    maximumGrantLifetimeMilliseconds:
      config.maximumGrantLifetimeMilliseconds,
    maximumFutureIssuedAtSkewMilliseconds:
      config.maximumFutureIssuedAtSkewMilliseconds,
  });
  const verifier: TransactionGrantVerifierV1 = Object.freeze({
    verify: async (
      input: VerifyTransactionGrantV1Input,
    ): Promise<VerifiedTransactionGrantV1> => {
      const expectedStart = input.expectedStart;
      let preparedStart: PreparedPointMutationStartEvidenceV1;
      try {
        preparedStart = inspectExecutorPreparedPointMutationStartV1(
          expectedStart,
        );
      } catch (cause) {
        if (cause instanceof InvalidExecutorPreparedPointMutationStartV1Error) {
          throw verificationFailure("invalidPreparedStart");
        }
        throw cause;
      }
      const expectedPins = preparedStart.logicalPins;
      const inspection = await Effect.runPromise(kernel.verify({
        jws: input.jws,
        expectedLogicalPins: expectedPins,
        trustedNowEpochMilliseconds: Effect.try({
          try: () => readCurrentTime().getTime(),
          catch: () => verificationFailure("invalidClockReading"),
        }),
      }));
      const handle = Object.freeze({
        [verifiedTransactionGrantBrand]: true as const,
      });
      verifiedTransactionGrantInspectionByHandle.set(handle, inspection);
      expectedStartByVerifiedTransactionGrantHandle.set(
        handle,
        expectedStart,
      );
      return handle;
    },
  });
  registerTransactionGrantVerificationKernelV1(verifier, kernel);
  return verifier;
}

export function inspectVerifiedTransactionGrantV1(
  value: unknown,
): VerifiedTransactionGrantInspectionV1 {
  return Result.getOrThrow(inspectVerifiedTransactionGrantResultV1(value));
}

function inspectVerifiedTransactionGrantResultV1(
  value: unknown,
): Result.Result<
  VerifiedTransactionGrantInspectionV1,
  InvalidVerifiedTransactionGrantV1Error
> {
  if (typeof value !== "object" || value === null) {
    return Result.fail(new InvalidVerifiedTransactionGrantV1Error());
  }
  const inspection = verifiedTransactionGrantInspectionByHandle.get(value);
  if (inspection === undefined) {
    return Result.fail(new InvalidVerifiedTransactionGrantV1Error());
  }
  return Result.succeed(inspection);
}

function copyAndValidateKey(
  key: TransactionGrantVerificationKeyV1,
): StoredTransactionGrantVerificationKeyV1 {
  if (key.state === "disabled") {
    return Object.freeze({
      state: key.state,
      kid: key.kid,
      purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
    });
  }
  if (key.state === "verifyOnly" && key.phase === "prepublished") {
    return Object.freeze({
      state: key.state,
      phase: key.phase,
      kid: key.kid,
      purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
      verify: key.verify,
    });
  }
  if (!isValidIssuedAtWindow(
    key.issuedAtInclusiveEpochMilliseconds,
    key.issuedAtExclusiveEpochMilliseconds,
    key.verificationEndsAtExclusiveEpochMilliseconds,
  )) {
    throw new TransactionGrantAuthorityConfigurationV1Error(
      "invalidKeyWindow",
    );
  }
  if (key.state === "verifyOnly") {
    return Object.freeze({
      state: key.state,
      phase: key.phase,
      kid: key.kid,
      purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
      issuedAtInclusiveEpochMilliseconds:
        key.issuedAtInclusiveEpochMilliseconds,
      issuedAtExclusiveEpochMilliseconds:
        key.issuedAtExclusiveEpochMilliseconds,
      verificationEndsAtExclusiveEpochMilliseconds:
        key.verificationEndsAtExclusiveEpochMilliseconds,
      verify: key.verify,
    });
  }
  return Object.freeze({
    state: key.state,
    kid: key.kid,
    purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
    issuedAtInclusiveEpochMilliseconds:
      key.issuedAtInclusiveEpochMilliseconds,
    ...(key.issuedAtExclusiveEpochMilliseconds === undefined
      ? {}
      : {
          issuedAtExclusiveEpochMilliseconds:
            key.issuedAtExclusiveEpochMilliseconds,
        }),
    ...(key.verificationEndsAtExclusiveEpochMilliseconds === undefined
      ? {}
      : {
          verificationEndsAtExclusiveEpochMilliseconds:
            key.verificationEndsAtExclusiveEpochMilliseconds,
        }),
    verify: key.verify,
  });
}

function isValidIssuedAtWindow(
  start: number,
  issuanceEnd: number | undefined,
  verificationEnd: number | undefined,
): boolean {
  return isTransactionGrantEpochMillisecondsV1(start) &&
    (issuanceEnd === undefined ||
      (isTransactionGrantEpochMillisecondsV1(issuanceEnd) &&
        issuanceEnd > start)) &&
    (verificationEnd === undefined ||
      (isTransactionGrantEpochMillisecondsV1(verificationEnd) &&
        verificationEnd > start &&
        (issuanceEnd === undefined || verificationEnd >= issuanceEnd)));
}

function currentEpochAdmissionFailure(
  issue: CurrentEpochTransactionGrantAdmissionV1Issue,
): CurrentEpochTransactionGrantAdmissionV1Error {
  return new CurrentEpochTransactionGrantAdmissionV1Error(issue);
}

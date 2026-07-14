import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantIdentityAccessPolicyV1Error,
  TransactionGrantProtocolV1Error,
  TransactionGrantTimestampV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  deriveInertTransactionGrantEvidenceV1,
  type InertTransactionGrantEvidenceV1,
  type TransactionGrantDeploymentIdV1,
  type TransactionGrantKeyIdV1,
  type TransactionGrantPayloadV1,
} from "flarex-protocol/transaction-grant";
import type {
  PointMutationGrantLogicalPinsV1,
  PreparedPointMutationStartEvidenceV1,
} from "flarex-protocol/point-mutation-start";
import type { ScopeId } from "flarex-protocol/storage-authority";

import {
  InvalidExecutorPreparedPointMutationStartV1Error,
  inspectExecutorPreparedPointMutationStartV1,
  type ExecutorPreparedPointMutationStartV1,
} from "./pointMutationStartPreparation";

const MAX_ECMASCRIPT_DATE_EPOCH_MILLISECONDS = 8_640_000_000_000_000;

export type ExpectedTransactionGrantLogicalPinsV1 =
  PointMutationGrantLogicalPinsV1;

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

export type ExpectedTransactionGrantLogicalPinFieldV1 =
  keyof ExpectedTransactionGrantLogicalPinsV1;

export type TransactionGrantVerificationV1Issue =
  | { readonly reason: "malformedEvidence" }
  | { readonly reason: "invalidPreparedStart" }
  | { readonly reason: "unknownKey" }
  | { readonly reason: "disabledKey" }
  | { readonly reason: "unissuableKey" }
  | { readonly reason: "signatureInvalid" }
  | { readonly reason: "cryptographicVerificationFailed" }
  | { readonly reason: "invalidClockReading" }
  | { readonly reason: "issuedInFuture" }
  | { readonly reason: "expired" }
  | { readonly reason: "lifetimeExceeded" }
  | { readonly reason: "keyWindowMismatch" }
  | { readonly reason: "keyRetentionExpired" }
  | { readonly reason: "policyMismatch" }
  | { readonly reason: "policyDigestMismatch" }
  | {
      readonly reason: "pinMismatch";
      readonly field: ExpectedTransactionGrantLogicalPinFieldV1;
    };

export class TransactionGrantVerificationV1Error extends Error {
  readonly name = "TransactionGrantVerificationV1Error";

  constructor(readonly issue: TransactionGrantVerificationV1Issue) {
    super(`Transaction grant verification failed: ${issue.reason}.`);
  }
}

export class InvalidVerifiedTransactionGrantV1Error extends Error {
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

export interface VerifiedTransactionGrantInspectionV1 {
  readonly evidence: InertTransactionGrantEvidenceV1;
  readonly verificationKeyId: TransactionGrantKeyIdV1;
  readonly verifiedAt: TransactionGrantPayloadV1["issuedAt"];
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

export interface CurrentScopeAuthorizationEpochResolverV1 {
  readonly resolveCurrent: (
    deploymentId: TransactionGrantDeploymentIdV1,
  ) => Promise<CurrentScopeAuthorizationEpochV1>;
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

export interface CurrentEpochTransactionGrantAdmissionV1 {
  readonly admit: (
    verifiedGrant: VerifiedTransactionGrantV1,
  ) => Promise<CurrentEpochVerifiedTransactionGrantV1>;
}

/**
 * Adds one located current-epoch check to an already A2b-verified grant. The
 * returned capability is preliminary: O03-B must recheck the epoch inside its
 * short session-activation transaction before creating durable authority.
 */
export function createCurrentEpochTransactionGrantAdmissionV1(
  resolver: CurrentScopeAuthorizationEpochResolverV1,
): CurrentEpochTransactionGrantAdmissionV1 {
  const resolveCurrent = resolver.resolveCurrent;

  return Object.freeze({
    admit: async (
      verifiedGrant: VerifiedTransactionGrantV1,
    ): Promise<CurrentEpochVerifiedTransactionGrantV1> => {
      const verifiedGrantInspection =
        inspectVerifiedTransactionGrantV1(verifiedGrant);
      const payload = verifiedGrantInspection.evidence.payload;
      const unresolvedCurrentAuthority =
        await resolveCurrent(payload.deploymentId);
      const currentAuthority = Object.freeze({
        deploymentId: unresolvedCurrentAuthority.deploymentId,
        scopeId: unresolvedCurrentAuthority.scopeId,
        authorizationRevocationEpoch:
          unresolvedCurrentAuthority.authorizationRevocationEpoch,
      }) satisfies CurrentScopeAuthorizationEpochV1;

      if (currentAuthority.deploymentId !== payload.deploymentId) {
        throw currentEpochAdmissionFailure({
          reason: "locatedDeploymentMismatch",
          expected: payload.deploymentId,
          actual: currentAuthority.deploymentId,
        });
      }
      if (currentAuthority.scopeId !== payload.scopeId) {
        throw currentEpochAdmissionFailure({
          reason: "locatedScopeMismatch",
          expected: payload.scopeId,
          actual: currentAuthority.scopeId,
        });
      }
      if (
        currentAuthority.authorizationRevocationEpoch !==
          payload.authorizationRevocationEpoch
      ) {
        throw currentEpochAdmissionFailure({
          reason: "authorizationRevocationEpochMismatch",
          expected: payload.authorizationRevocationEpoch,
          actual: currentAuthority.authorizationRevocationEpoch,
        });
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
    },
  });
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
  readonly name = "InvalidAdmittedPointMutationStartV1Error";

  constructor() {
    super("Value is not a process-local admitted point-mutation start.");
  }
}

export interface PointMutationStartAdmissionV1 {
  readonly admit: (
    verifiedGrant: VerifiedTransactionGrantV1,
  ) => Promise<AdmittedPointMutationStartV1>;
}

export function createPointMutationStartAdmissionV1(
  resolver: CurrentScopeAuthorizationEpochResolverV1,
): PointMutationStartAdmissionV1 {
  const currentEpochAdmission =
    createCurrentEpochTransactionGrantAdmissionV1(resolver);
  return Object.freeze({
    admit: async (
      verifiedGrant: VerifiedTransactionGrantV1,
    ): Promise<AdmittedPointMutationStartV1> => {
      const expectedStart =
        expectedStartByVerifiedTransactionGrantHandle.get(verifiedGrant);
      if (expectedStart === undefined) {
        throw verificationFailure("invalidPreparedStart");
      }
      const currentEpochGrant = await currentEpochAdmission.admit(
        verifiedGrant,
      );
      const currentEpochInspection =
        inspectCurrentEpochVerifiedTransactionGrantV1(currentEpochGrant);
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
    },
  });
}

export function inspectAdmittedPointMutationStartV1(
  value: unknown,
): AdmittedPointMutationStartInspectionV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidAdmittedPointMutationStartV1Error();
  }
  const inspection = admittedPointMutationStartInspectionByHandle.get(value);
  if (inspection === undefined) {
    throw new InvalidAdmittedPointMutationStartV1Error();
  }
  return inspection;
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
  if (!isPositiveSafeInteger(config.maximumGrantLifetimeMilliseconds)) {
    throw new TransactionGrantAuthorityConfigurationV1Error(
      "invalidMaximumGrantLifetime",
    );
  }
  if (!isNonNegativeSafeInteger(
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

  const maximumGrantLifetimeMilliseconds =
    config.maximumGrantLifetimeMilliseconds;
  const maximumFutureIssuedAtSkewMilliseconds =
    config.maximumFutureIssuedAtSkewMilliseconds;
  const readCurrentTime = config.clock.now;

  return Object.freeze({
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
      if (expectedPins.deploymentId !== keyNamespace.deploymentId) {
        throw pinMismatch("deploymentId");
      }

      let evidence: InertTransactionGrantEvidenceV1;
      try {
        evidence = await deriveInertTransactionGrantEvidenceV1(input.jws);
      } catch (cause) {
        if (cause instanceof TransactionGrantProtocolV1Error) {
          throw verificationFailure("malformedEvidence");
        }
        throw verificationFailure("malformedEvidence");
      }

      const key = keyNamespace.keysById.get(evidence.protectedHeader.kid);
      if (key === undefined) throw verificationFailure("unknownKey");
      if (key.state === "disabled") {
        throw verificationFailure("disabledKey");
      }
      if (key.state === "verifyOnly" && key.phase === "prepublished") {
        throw verificationFailure("unissuableKey");
      }

      let signatureValid: boolean;
      try {
        signatureValid = await key.verify(
          new Uint8Array(evidence.signingInput),
          new Uint8Array(evidence.signatureBytes),
        );
      } catch {
        throw verificationFailure("cryptographicVerificationFailed");
      }
      if (!signatureValid) throw verificationFailure("signatureInvalid");

      let nowEpochMilliseconds: number;
      let verifiedAt: TransactionGrantPayloadV1["issuedAt"];
      try {
        nowEpochMilliseconds = readCurrentTime().getTime();
        if (!isValidEpochMilliseconds(nowEpochMilliseconds)) {
          throw new Error("Invalid clock reading.");
        }
        verifiedAt = TransactionGrantTimestampV1Schema.make(
          new Date(nowEpochMilliseconds).toISOString(),
        );
      } catch {
        throw verificationFailure("invalidClockReading");
      }
      const issuedAtEpochMilliseconds = Date.parse(evidence.payload.issuedAt);
      const expiresAtEpochMilliseconds = Date.parse(evidence.payload.expiresAt);
      if (
        issuedAtEpochMilliseconds >
        nowEpochMilliseconds + maximumFutureIssuedAtSkewMilliseconds
      ) {
        throw verificationFailure("issuedInFuture");
      }
      if (expiresAtEpochMilliseconds <= nowEpochMilliseconds) {
        throw verificationFailure("expired");
      }
      if (
        expiresAtEpochMilliseconds - issuedAtEpochMilliseconds >
        maximumGrantLifetimeMilliseconds
      ) {
        throw verificationFailure("lifetimeExceeded");
      }
      enforceKeyWindow(
        key,
        issuedAtEpochMilliseconds,
        expiresAtEpochMilliseconds,
        nowEpochMilliseconds,
      );
      await enforcePointMutationPolicy(evidence.payload);
      compareExpectedPins(evidence.payload, expectedPins);

      const inspection = Object.freeze({
        evidence,
        verificationKeyId: key.kid,
        verifiedAt,
      } satisfies VerifiedTransactionGrantInspectionV1);
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
}

export function inspectVerifiedTransactionGrantV1(
  value: unknown,
): VerifiedTransactionGrantInspectionV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidVerifiedTransactionGrantV1Error();
  }
  const inspection = verifiedTransactionGrantInspectionByHandle.get(value);
  if (inspection === undefined) {
    throw new InvalidVerifiedTransactionGrantV1Error();
  }
  return inspection;
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
  return isValidEpochMilliseconds(start) &&
    (issuanceEnd === undefined ||
      (isValidEpochMilliseconds(issuanceEnd) && issuanceEnd > start)) &&
    (verificationEnd === undefined ||
      (isValidEpochMilliseconds(verificationEnd) &&
        verificationEnd > start &&
        (issuanceEnd === undefined || verificationEnd >= issuanceEnd)));
}

function enforceKeyWindow(
  key: Exclude<
    StoredTransactionGrantVerificationKeyV1,
    | { readonly state: "disabled" }
    | { readonly state: "verifyOnly"; readonly phase: "prepublished" }
  >,
  issuedAtEpochMilliseconds: number,
  expiresAtEpochMilliseconds: number,
  nowEpochMilliseconds: number,
): void {
  if (
    issuedAtEpochMilliseconds < key.issuedAtInclusiveEpochMilliseconds ||
    (key.issuedAtExclusiveEpochMilliseconds !== undefined &&
      issuedAtEpochMilliseconds >= key.issuedAtExclusiveEpochMilliseconds)
  ) {
    throw verificationFailure("keyWindowMismatch");
  }
  const verificationEnd =
    key.verificationEndsAtExclusiveEpochMilliseconds;
  if (
    verificationEnd !== undefined &&
    (expiresAtEpochMilliseconds > verificationEnd ||
      nowEpochMilliseconds >= verificationEnd)
  ) {
    throw verificationFailure("keyRetentionExpired");
  }
}

async function enforcePointMutationPolicy(
  payload: TransactionGrantPayloadV1,
): Promise<void> {
  if (
    payload.policyVersion !==
      TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1 ||
    !sameCapabilities(
      payload.capabilities,
      TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    ) ||
    payload.auth.kind === "trustedDev" ||
    (payload.auth.kind === "verifiedBearer" &&
      Object.keys(payload.auth.claims).length !== 0)
  ) {
    throw verificationFailure("policyMismatch");
  }

  let policyEvidence: Awaited<
    ReturnType<typeof canonicalizeTransactionGrantIdentityAccessPolicyV1>
  >;
  try {
    policyEvidence =
      await canonicalizeTransactionGrantIdentityAccessPolicyV1({
        policyVersion: payload.policyVersion,
        auth: payload.auth,
        capabilities: payload.capabilities,
      });
  } catch (cause) {
    if (cause instanceof TransactionGrantIdentityAccessPolicyV1Error) {
      throw verificationFailure("policyMismatch");
    }
    throw verificationFailure("policyMismatch");
  }
  if (policyEvidence.sha256Hex !== payload.identityAccessPolicySha256) {
    throw verificationFailure("policyDigestMismatch");
  }
}

function sameCapabilities(
  actual: ReadonlyArray<string>,
  expected: ReadonlyArray<string>,
): boolean {
  return actual.length === expected.length &&
    actual.every((capability, index) => capability === expected[index]);
}

function compareExpectedPins(
  payload: TransactionGrantPayloadV1,
  expected: ExpectedTransactionGrantLogicalPinsV1,
): void {
  const fields = [
    "deploymentId",
    "scopeId",
    "packageId",
    "artifactRuntime",
    "artifactId",
    "sourcePackageHash",
    "executionModule",
    "functionPath",
    "functionKind",
    "schemaVersionId",
    "validatedArgsValueCodecVersion",
    "validatedArgsSha256",
    "requestKey",
    "requestSha256",
    "authorizationRevocationEpoch",
  ] as const satisfies ReadonlyArray<ExpectedTransactionGrantLogicalPinFieldV1>;
  for (const field of fields) {
    if (payload[field] !== expected[field]) throw pinMismatch(field);
  }
}

function currentEpochAdmissionFailure(
  issue: CurrentEpochTransactionGrantAdmissionV1Issue,
): CurrentEpochTransactionGrantAdmissionV1Error {
  return new CurrentEpochTransactionGrantAdmissionV1Error(issue);
}

function verificationFailure(
  reason: Exclude<
    TransactionGrantVerificationV1Issue,
    { readonly reason: "pinMismatch" }
  >["reason"],
): TransactionGrantVerificationV1Error {
  return new TransactionGrantVerificationV1Error({ reason });
}

function pinMismatch(
  field: ExpectedTransactionGrantLogicalPinFieldV1,
): TransactionGrantVerificationV1Error {
  return new TransactionGrantVerificationV1Error({
    reason: "pinMismatch",
    field,
  });
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 &&
    value <= MAX_ECMASCRIPT_DATE_EPOCH_MILLISECONDS;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 &&
    value <= MAX_ECMASCRIPT_DATE_EPOCH_MILLISECONDS;
}

function isValidEpochMilliseconds(value: number): boolean {
  return Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_ECMASCRIPT_DATE_EPOCH_MILLISECONDS;
}

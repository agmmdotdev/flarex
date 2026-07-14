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

const MAX_ECMASCRIPT_DATE_EPOCH_MILLISECONDS = 8_640_000_000_000_000;

export type ExpectedTransactionGrantLogicalPinsV1 = Readonly<
  Pick<
    TransactionGrantPayloadV1,
    | "deploymentId"
    | "scopeId"
    | "packageId"
    | "artifactRuntime"
    | "artifactId"
    | "sourcePackageHash"
    | "executionModule"
    | "functionPath"
    | "functionKind"
    | "schemaVersionId"
    | "validatedArgsValueCodecVersion"
    | "validatedArgsSha256"
    | "requestKey"
    | "requestSha256"
    | "authorizationRevocationEpoch"
  >
>;

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

export interface TransactionGrantVerifierV1Config {
  readonly clock: TransactionGrantVerificationClockV1;
  readonly verificationKeyNamespace:
    TransactionGrantVerificationKeyNamespaceV1;
  readonly maximumGrantLifetimeMilliseconds: number;
  readonly maximumFutureIssuedAtSkewMilliseconds: number;
}

export interface VerifyTransactionGrantV1Input {
  readonly jws: unknown;
  readonly expectedPins: ExpectedTransactionGrantLogicalPinsV1;
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
      const expectedPins = copyExpectedPins(input.expectedPins);
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

function copyExpectedPins(
  pins: ExpectedTransactionGrantLogicalPinsV1,
): ExpectedTransactionGrantLogicalPinsV1 {
  return Object.freeze({
    deploymentId: pins.deploymentId,
    scopeId: pins.scopeId,
    packageId: pins.packageId,
    artifactRuntime: pins.artifactRuntime,
    artifactId: pins.artifactId,
    sourcePackageHash: pins.sourcePackageHash,
    executionModule: pins.executionModule,
    functionPath: pins.functionPath,
    functionKind: pins.functionKind,
    schemaVersionId: pins.schemaVersionId,
    validatedArgsValueCodecVersion: pins.validatedArgsValueCodecVersion,
    validatedArgsSha256: pins.validatedArgsSha256,
    requestKey: pins.requestKey,
    requestSha256: pins.requestSha256,
    authorizationRevocationEpoch: pins.authorizationRevocationEpoch,
  });
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

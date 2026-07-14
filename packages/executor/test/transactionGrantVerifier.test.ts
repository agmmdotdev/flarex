/// <reference types="node" />

import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantRequestSha256HexV1Schema,
  TransactionGrantValidatedArgsSha256HexV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  createTransactionGrantSigningInputV1,
  deriveInertTransactionGrantEvidenceV1,
  encodeTransactionGrantEd25519SignatureV1,
  type InertTransactionGrantEvidenceV1,
  type TransactionGrantInertAuthV1,
  type TransactionGrantJwsV1,
  type TransactionGrantKeyIdV1,
  type TransactionGrantPayloadV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionArtifactIdV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionPackageIdV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import { FlarexValueCodecVersionSchema } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  InvalidVerifiedTransactionGrantV1Error,
  TransactionGrantAuthorityConfigurationV1Error,
  TransactionGrantVerificationV1Error,
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
  inspectVerifiedTransactionGrantV1,
  type ActiveTransactionGrantVerificationKeyV1,
  type ExpectedTransactionGrantLogicalPinsV1,
  type TransactionGrantVerificationKeyV1,
  type TransactionGrantVerifierV1,
} from "../src/transactionGrant";

const TEST_PRIVATE_KEY_PKCS8_BASE64 =
  "MC4CAQAwBQYDK2VwBCIEICpBSuNq0N9DHmrl/kDt7u4bsHa9Um6KjyBQ98WSfc+J";
const TEST_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEAno+3aYSLpdF45q6y9wrLdVOEWJLjvbGTDmfTVRqLEZ8=";
const NOW = new Date("2026-07-14T10:00:30.000Z");
const NOW_MILLISECONDS = NOW.getTime();
const ISSUED_AT_MILLISECONDS = new Date(
  "2026-07-14T10:00:00.000Z",
).getTime();
const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2b",
);
const OTHER_DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_other",
);
const KEY_ID = TransactionGrantKeyIdV1Schema.make("grant-key-a2b-current");
const NEW_KEY_ID = TransactionGrantKeyIdV1Schema.make("grant-key-a2b-new");

describe("transaction-grant verifier", () => {
  it("returns only opaque process-local authority and preserves exact replay", async () => {
    const fixture = await signedFixture();
    const verifier = await verifierFixture();
    const expectedPins = expectedPinsFromPayload(fixture.evidence.payload);

    const first = await verifier.verify({
      jws: fixture.jws,
      expectedPins,
    });
    const second = await verifier.verify({
      jws: fixture.jws,
      expectedPins,
    });
    const inspection = inspectVerifiedTransactionGrantV1(first);

    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).toBe("{}");
    expect(inspection.verificationKeyId).toBe(KEY_ID);
    expect(inspection.verifiedAt).toBe("2026-07-14T10:00:30.000Z");
    expect(inspection.evidence.jws).toEqual(fixture.jws);
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(() => inspectVerifiedTransactionGrantV1(
      JSON.parse(JSON.stringify(first)),
    )).toThrow(InvalidVerifiedTransactionGrantV1Error);
    expect(() => inspectVerifiedTransactionGrantV1({ ...first }))
      .toThrow(InvalidVerifiedTransactionGrantV1Error);
    expect(() => inspectVerifiedTransactionGrantV1(Object.create(first)))
      .toThrow(InvalidVerifiedTransactionGrantV1Error);
    expect(() => inspectVerifiedTransactionGrantV1(fixture.evidence))
      .toThrow(InvalidVerifiedTransactionGrantV1Error);
    expect(() => inspectVerifiedTransactionGrantV1(true))
      .toThrow(InvalidVerifiedTransactionGrantV1Error);
  });

  it("uses one exact key lookup and rejects malformed, unknown, tampered, and wrong-key evidence", async () => {
    const fixture = await signedFixture();
    const expectedPins = expectedPinsFromPayload(fixture.evidence.payload);
    const verifier = await verifierFixture();

    await expect(verifier.verify({ jws: {}, expectedPins }))
      .rejects.toMatchObject({
        issue: { reason: "malformedEvidence" },
      });

    const unknownKeyFixture = await signedFixture({ kid: NEW_KEY_ID });
    await expect(verifier.verify({
      jws: unknownKeyFixture.jws,
      expectedPins: expectedPinsFromPayload(
        unknownKeyFixture.evidence.payload,
      ),
    })).rejects.toMatchObject({ issue: { reason: "unknownKey" } });

    await expect(verifier.verify({
      jws: {
        ...fixture.jws,
        signature: flipBase64UrlCharacter(fixture.jws.signature),
      },
      expectedPins,
    })).rejects.toMatchObject({ issue: { reason: "signatureInvalid" } });

    const wrongMaterialVerifier = await verifierFixture({
      keys: [{
        ...(await activeVerificationKey()),
        verify: async () => false,
      }],
    });
    await expect(wrongMaterialVerifier.verify({
      jws: fixture.jws,
      expectedPins,
    })).rejects.toMatchObject({ issue: { reason: "signatureInvalid" } });
  });

  it("enforces time, fixed policy, digest, empty claims, and explicit limits", async () => {
    const valid = await signedFixture();
    const validPins = expectedPinsFromPayload(valid.evidence.payload);

    const atExpiryVerifier = await verifierFixture({
      now: new Date("2026-07-14T10:01:00.000Z"),
    });
    await expect(atExpiryVerifier.verify({
      jws: valid.jws,
      expectedPins: validPins,
    })).rejects.toMatchObject({ issue: { reason: "expired" } });

    const future = await signedFixture({
      payloadOverrides: {
        issuedAt: "2026-07-14T10:00:30.001Z",
        expiresAt: "2026-07-14T10:01:00.001Z",
      },
    });
    await expect((await verifierFixture()).verify({
      jws: future.jws,
      expectedPins: expectedPinsFromPayload(future.evidence.payload),
    })).rejects.toMatchObject({ issue: { reason: "issuedInFuture" } });
    await expect((await verifierFixture({ futureSkewMilliseconds: 1 })).verify({
      jws: future.jws,
      expectedPins: expectedPinsFromPayload(future.evidence.payload),
    })).resolves.toBeDefined();

    const overlong = await signedFixture({
      payloadOverrides: {
        expiresAt: "2026-07-14T10:02:00.001Z",
      },
    });
    await expect((await verifierFixture()).verify({
      jws: overlong.jws,
      expectedPins: expectedPinsFromPayload(overlong.evidence.payload),
    })).rejects.toMatchObject({ issue: { reason: "lifetimeExceeded" } });

    const policyCases: ReadonlyArray<{
      readonly overrides: Readonly<Record<string, unknown>>;
      readonly reason: "policyMismatch" | "policyDigestMismatch";
    }> = [
      {
        overrides: { capabilities: ["db:get", "db:insert"] },
        reason: "policyMismatch",
      },
      {
        overrides: {
          auth: { kind: "trustedDev", principal: "developer" },
        },
        reason: "policyMismatch",
      },
      {
        overrides: {
          auth: {
            kind: "verifiedBearer",
            issuer: "https://issuer.example.com",
            subject: "user_a2b",
            claims: { role: "admin" },
          },
        },
        reason: "policyMismatch",
      },
      {
        overrides: { identityAccessPolicySha256: "0".repeat(64) },
        reason: "policyDigestMismatch",
      },
    ];
    for (const policyCase of policyCases) {
      const fixture = await signedFixture({
        payloadOverrides: policyCase.overrides,
      });
      await expect((await verifierFixture()).verify({
        jws: fixture.jws,
        expectedPins: expectedPinsFromPayload(fixture.evidence.payload),
      })).rejects.toMatchObject({
        issue: { reason: policyCase.reason },
      });
    }

    const configurationKey = await activeVerificationKey();
    for (const badLifetime of [0, -1, 1.5, NaN]) {
      expect(() => createVerifier({
        namespace: createNamespace([configurationKey]),
        maximumGrantLifetimeMilliseconds: badLifetime,
      })).toThrow(TransactionGrantAuthorityConfigurationV1Error);
    }
    for (const badSkew of [-1, 1.5, NaN]) {
      expect(() => createVerifier({
        namespace: createNamespace([configurationKey]),
        maximumFutureIssuedAtSkewMilliseconds: badSkew,
      })).toThrow(TransactionGrantAuthorityConfigurationV1Error);
    }
  });

  it("compares every independently prepared logical pin including inert epoch binding", async () => {
    const fixture = await signedFixture();
    const pins = expectedPinsFromPayload(fixture.evidence.payload);
    const verifier = await verifierFixture();
    const mismatches: ReadonlyArray<{
      readonly field: keyof ExpectedTransactionGrantLogicalPinsV1;
      readonly pins: ExpectedTransactionGrantLogicalPinsV1;
    }> = [
      { field: "deploymentId", pins: { ...pins, deploymentId: OTHER_DEPLOYMENT_ID } },
      {
        field: "scopeId",
        pins: {
          ...pins,
          scopeId: ReplacementScopeIdV1Schema.make(
            "scope_118f22e2-58cc-7b2a-91d8-f3f3401a0874",
          ),
        },
      },
      { field: "packageId", pins: { ...pins, packageId: TransactionPackageIdV1Schema.make("package_other") } },
      { field: "artifactRuntime", pins: { ...pins, artifactRuntime: "dynamic-worker" } },
      { field: "artifactId", pins: { ...pins, artifactId: TransactionArtifactIdV1Schema.make(`artifact_${"f".repeat(32)}`) } },
      { field: "sourcePackageHash", pins: { ...pins, sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make("f".repeat(64)) } },
      { field: "executionModule", pins: { ...pins, executionModule: TransactionExecutionModuleV1Schema.make("flarex/other.ts") } },
      { field: "functionPath", pins: { ...pins, functionPath: TransactionFunctionPathV1Schema.make("orders:other") } },
      { field: "functionKind", pins: { ...pins, functionKind: "mutation" } },
      { field: "schemaVersionId", pins: { ...pins, schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_other") } },
      { field: "validatedArgsValueCodecVersion", pins: { ...pins, validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema.make(1) } },
      { field: "validatedArgsSha256", pins: { ...pins, validatedArgsSha256: TransactionGrantValidatedArgsSha256HexV1Schema.make("e".repeat(64)) } },
      { field: "requestKey", pins: { ...pins, requestKey: TransactionRequestKeyV1Schema.make("request_other") } },
      { field: "requestSha256", pins: { ...pins, requestSha256: TransactionGrantRequestSha256HexV1Schema.make("d".repeat(64)) } },
      {
        field: "authorizationRevocationEpoch",
        pins: {
          ...pins,
          authorizationRevocationEpoch:
            TransactionAuthorizationRevocationEpochSchema.make(8n),
        },
      },
    ];

    for (const mismatch of mismatches) {
      if (
        mismatch.pins[mismatch.field] === pins[mismatch.field]
      ) {
        continue;
      }
      await expect(verifier.verify({
        jws: fixture.jws,
        expectedPins: mismatch.pins,
      })).rejects.toMatchObject({
        issue: { reason: "pinMismatch", field: mismatch.field },
      });
    }
  });

  it("enforces prepublication, retirement cutover, retention, and disablement", async () => {
    const oldFixture = await signedFixture();
    const oldPublicKey = await importPublicKey();
    const newKeys = await generateEd25519Keys();
    const cutover = ISSUED_AT_MILLISECONDS + 10_000;
    const retentionEnd = ISSUED_AT_MILLISECONDS + 120_000;
    const activeNew = activeKeyFromPair({
      kid: NEW_KEY_ID,
      keyPair: newKeys,
      issuedAtInclusiveEpochMilliseconds: cutover,
    });
    const retiredOld: TransactionGrantVerificationKeyV1 = {
      state: "verifyOnly",
      phase: "retired",
      kid: KEY_ID,
      purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
      issuedAtInclusiveEpochMilliseconds: ISSUED_AT_MILLISECONDS - 60_000,
      issuedAtExclusiveEpochMilliseconds: cutover,
      verificationEndsAtExclusiveEpochMilliseconds: retentionEnd,
      verify: signatureVerifier(oldPublicKey),
    };
    const overlapVerifier = await verifierFixture({
      now: new Date(ISSUED_AT_MILLISECONDS + 30_000),
      keys: [activeNew, retiredOld],
    });
    await expect(overlapVerifier.verify({
      jws: oldFixture.jws,
      expectedPins: expectedPinsFromPayload(oldFixture.evidence.payload),
    })).resolves.toBeDefined();

    const postCutoverOld = await signedFixture({
      payloadOverrides: {
        issuedAt: new Date(cutover).toISOString(),
        expiresAt: new Date(cutover + 60_000).toISOString(),
      },
    });
    await expect(overlapVerifier.verify({
      jws: postCutoverOld.jws,
      expectedPins: expectedPinsFromPayload(
        postCutoverOld.evidence.payload,
      ),
    })).rejects.toMatchObject({ issue: { reason: "keyWindowMismatch" } });

    const disabledVerifier = await verifierFixture({
      keys: [activeNew, {
        state: "disabled",
        kid: KEY_ID,
        purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
      }],
    });
    await expect(disabledVerifier.verify({
      jws: oldFixture.jws,
      expectedPins: expectedPinsFromPayload(oldFixture.evidence.payload),
    })).rejects.toMatchObject({ issue: { reason: "disabledKey" } });

    const prepublishedVerifier = await verifierFixture({
      keys: [activeNew, {
        state: "verifyOnly",
        phase: "prepublished",
        kid: KEY_ID,
        purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
        verify: signatureVerifier(oldPublicKey),
      }],
    });
    await expect(prepublishedVerifier.verify({
      jws: oldFixture.jws,
      expectedPins: expectedPinsFromPayload(oldFixture.evidence.payload),
    })).rejects.toMatchObject({ issue: { reason: "unissuableKey" } });

    const preactivationNew = await signedFixture({
      kid: NEW_KEY_ID,
      privateKey: newKeys.privateKey,
    });
    await expect(overlapVerifier.verify({
      jws: preactivationNew.jws,
      expectedPins: expectedPinsFromPayload(
        preactivationNew.evidence.payload,
      ),
    })).rejects.toMatchObject({ issue: { reason: "keyWindowMismatch" } });

    const shortRetentionVerifier = await verifierFixture({
      keys: [activeNew, {
        ...retiredOld,
        verificationEndsAtExclusiveEpochMilliseconds:
          ISSUED_AT_MILLISECONDS + 45_000,
      }],
    });
    await expect(shortRetentionVerifier.verify({
      jws: oldFixture.jws,
      expectedPins: expectedPinsFromPayload(oldFixture.evidence.payload),
    })).rejects.toMatchObject({ issue: { reason: "keyRetentionExpired" } });
  });

  it("rejects duplicate, wrong-purpose, invalid-window, and ambiguous key namespaces", async () => {
    const active = await activeVerificationKey();
    const cases: ReadonlyArray<ReadonlyArray<TransactionGrantVerificationKeyV1>> = [
      [],
      [active, { ...active, kid: NEW_KEY_ID }],
      [active, { ...active, state: "disabled" }],
      [{ ...active, purpose: "artifact-signing" }],
      [{
        ...active,
        issuedAtExclusiveEpochMilliseconds:
          active.issuedAtInclusiveEpochMilliseconds,
      }],
    ];
    for (const keys of cases) {
      expect(() => createNamespace(keys)).toThrow(
        TransactionGrantAuthorityConfigurationV1Error,
      );
    }
  });
});

async function signedFixture(
  options: {
    readonly kid?: TransactionGrantKeyIdV1;
    readonly privateKey?: CryptoKey;
    readonly payloadOverrides?: Readonly<Record<string, unknown>>;
  } = {},
): Promise<{
  readonly jws: TransactionGrantJwsV1;
  readonly evidence: InertTransactionGrantEvidenceV1;
}> {
  const auth = { kind: "anonymous" } satisfies TransactionGrantInertAuthV1;
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth,
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const payload = await canonicalizeTransactionGrantPayloadV1({
    format: "flarex.transaction-grant",
    version: 1,
    grantId: "grant_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    deploymentId: DEPLOYMENT_ID,
    scopeId: "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    packageId: "package_a2b",
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "a".repeat(64),
    executionModule: "flarex/orders.ts",
    functionPath: "orders:create",
    functionKind: "mutation",
    schemaVersionId: "schema_a2b",
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicySha256: policy.sha256Hex,
    validatedArgsValueCodecVersion: 1,
    validatedArgsSha256: "b".repeat(64),
    requestKey: "request_a2b",
    requestSha256: "c".repeat(64),
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    auth,
    issuedAt: "2026-07-14T10:00:00.000Z",
    expiresAt: "2026-07-14T10:01:00.000Z",
    authorizationRevocationEpoch: "7",
    ...options.payloadOverrides,
  });
  const header = canonicalizeTransactionGrantProtectedHeaderV1({
    alg: "Ed25519",
    kid: options.kid ?? KEY_ID,
    typ: "flarex-transaction-grant+jws",
  });
  const signingInput = createTransactionGrantSigningInputV1({
    protected: header.base64url,
    payload: payload.base64url,
  });
  const signatureBytes = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    options.privateKey ?? await importPrivateKey(),
    copyToArrayBuffer(signingInput),
  ));
  const evidence = await deriveInertTransactionGrantEvidenceV1({
    protected: header.base64url,
    payload: payload.base64url,
    signature: encodeTransactionGrantEd25519SignatureV1(signatureBytes),
  });
  return { jws: evidence.jws, evidence };
}

async function verifierFixture(
  options: {
    readonly now?: Date;
    readonly futureSkewMilliseconds?: number;
    readonly keys?: ReadonlyArray<TransactionGrantVerificationKeyV1>;
  } = {},
): Promise<TransactionGrantVerifierV1> {
  return createVerifier({
    namespace: createNamespace(
      options.keys ?? [await activeVerificationKey()],
    ),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.futureSkewMilliseconds === undefined
      ? {}
      : {
          maximumFutureIssuedAtSkewMilliseconds:
            options.futureSkewMilliseconds,
        }),
  });
}

function createVerifier(input: {
  readonly namespace: ReturnType<
    typeof createTransactionGrantVerificationKeyNamespaceV1
  >;
  readonly now?: Date;
  readonly maximumGrantLifetimeMilliseconds?: number;
  readonly maximumFutureIssuedAtSkewMilliseconds?: number;
}): TransactionGrantVerifierV1 {
  return createTransactionGrantVerifierV1({
    clock: { now: () => input.now ?? NOW },
    verificationKeyNamespace: input.namespace,
    maximumGrantLifetimeMilliseconds:
      input.maximumGrantLifetimeMilliseconds ?? 120_000,
    maximumFutureIssuedAtSkewMilliseconds:
      input.maximumFutureIssuedAtSkewMilliseconds ?? 0,
  });
}

function createNamespace(
  keys: ReadonlyArray<TransactionGrantVerificationKeyV1>,
): ReturnType<typeof createTransactionGrantVerificationKeyNamespaceV1> {
  return createTransactionGrantVerificationKeyNamespaceV1({
    deploymentId: DEPLOYMENT_ID,
    keys,
  });
}

async function activeVerificationKey(): Promise<
  ActiveTransactionGrantVerificationKeyV1
> {
  return {
    state: "active",
    kid: KEY_ID,
    purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
    issuedAtInclusiveEpochMilliseconds: ISSUED_AT_MILLISECONDS - 60_000,
    verify: signatureVerifier(await importPublicKey()),
  };
}

function activeKeyFromPair(input: {
  readonly kid: TransactionGrantKeyIdV1;
  readonly keyPair: CryptoKeyPair;
  readonly issuedAtInclusiveEpochMilliseconds: number;
}): ActiveTransactionGrantVerificationKeyV1 {
  return {
    state: "active",
    kid: input.kid,
    purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
    issuedAtInclusiveEpochMilliseconds:
      input.issuedAtInclusiveEpochMilliseconds,
    verify: signatureVerifier(input.keyPair.publicKey),
  };
}

function signatureVerifier(
  publicKey: CryptoKey,
): ActiveTransactionGrantVerificationKeyV1["verify"] {
  return (signingInput, signature) => crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    copyToArrayBuffer(signature),
    copyToArrayBuffer(signingInput),
  );
}

function expectedPinsFromPayload(
  payload: TransactionGrantPayloadV1,
): ExpectedTransactionGrantLogicalPinsV1 {
  return {
    deploymentId: payload.deploymentId,
    scopeId: payload.scopeId,
    packageId: payload.packageId,
    artifactRuntime: payload.artifactRuntime,
    artifactId: payload.artifactId,
    sourcePackageHash: payload.sourcePackageHash,
    executionModule: payload.executionModule,
    functionPath: payload.functionPath,
    functionKind: payload.functionKind,
    schemaVersionId: payload.schemaVersionId,
    validatedArgsValueCodecVersion: payload.validatedArgsValueCodecVersion,
    validatedArgsSha256: payload.validatedArgsSha256,
    requestKey: payload.requestKey,
    requestSha256: payload.requestSha256,
    authorizationRevocationEpoch: payload.authorizationRevocationEpoch,
  };
}

async function importPrivateKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    copyToArrayBuffer(decodeBase64(TEST_PRIVATE_KEY_PKCS8_BASE64)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

async function importPublicKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    copyToArrayBuffer(decodeBase64(TEST_PUBLIC_KEY_SPKI_BASE64)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

async function generateEd25519Keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function copyToArrayBuffer(bytesValue: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytesValue.byteLength);
  copy.set(bytesValue);
  return copy.buffer;
}

function flipBase64UrlCharacter(value: string): string {
  const first = value[0];
  if (first === undefined) throw new Error("Expected a nonempty signature.");
  return `${first === "A" ? "B" : "A"}${value.slice(1)}`;
}

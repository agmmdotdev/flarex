/// <reference types="node" />

import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import {
  resolveCurrentScopeAuthorizationEpochEffect,
} from "@flarex/persistence-postgres";
import {
  createPGliteLocatedScopeAuthorizationEpochTarget,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
} from "@flarex/persistence-postgres/pglite";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  createPostgresLocatedScopeAuthorizationEpochTarget,
  createPostgresSharedScopeAuthorityProvisioner,
} from "@flarex/persistence-postgres/postgres";
import {
  ReplacementScopeIdV1Schema,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1,
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
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
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import { Effect } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  advanceScopeAuthorizationRevocationEpochInTransaction,
} from "../../persistence-postgres/src/scopeClock";
import {
  CurrentEpochTransactionGrantAdmissionV1Error,
  InvalidAdmittedPointMutationStartV1Error,
  InvalidCurrentEpochVerifiedTransactionGrantV1Error,
  InvalidVerifiedTransactionGrantV1Error,
  TransactionGrantAuthorityConfigurationV1Error,
  TransactionGrantVerificationV1Error,
  createCurrentEpochTransactionGrantAdmissionV1,
  createPointMutationStartAdmissionV1,
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
  inspectAdmittedPointMutationStartV1,
  inspectCurrentEpochVerifiedTransactionGrantV1,
  inspectVerifiedTransactionGrantV1,
  type AdmittedPointMutationStartV1,
  type ActiveTransactionGrantVerificationKeyV1,
  type TransactionGrantVerificationKeyV1,
  type TransactionGrantVerifierV1,
} from "../src/transactionGrant";
import {
  createExecutorPointMutationStartPreparationV1,
  inspectExecutorPreparedPointMutationStartV1,
  type ExecutorPreparedPointMutationStartV1,
} from "../src/pointMutationStartPreparation";
import {
  InvalidActivatedPointMutationSessionV1Error,
  InvalidLoadedPointMutationSessionAttemptV1Error,
  createPointMutationSessionActivationV1,
  createPointMutationSessionAttemptLoadingV1,
  inspectActivatedPointMutationSessionV1,
  inspectLoadedPointMutationSessionAttemptV1,
  pointMutationSessionAttemptSelectorV1FromActivated,
  type PointMutationSessionActivationV1,
} from "../src/pointMutationSessionActivation";
import {
  postgresUrl,
  withTemporaryPostgresExecutorPersistence,
} from "./postgresHelpers";

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
const BASE_SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
);
const OTHER_DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_other",
);
const KEY_ID = TransactionGrantKeyIdV1Schema.make("grant-key-a2b-current");
const NEW_KEY_ID = TransactionGrantKeyIdV1Schema.make("grant-key-a2b-new");
const LOCATED_ADMISSION_SCOPE_UUID =
  "418f22e2-58cc-4b2a-91d8-f3f3401a0874";
const LOCATED_ADMISSION_SCOPE_ID = ReplacementScopeIdV1Schema.make(
  `scope_${LOCATED_ADMISSION_SCOPE_UUID}`,
);
const describePostgres = postgresUrl === null ? describe.skip : describe;

type RootSessionActivationExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionActivationV1"
>;

type RootSessionAttemptLoadingExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionAttemptLoadingV1"
>;

describe("transaction-grant verifier", () => {
  it("returns only opaque process-local authority and preserves exact replay", async () => {
    const fixture = await signedFixture();
    const verifier = await verifierFixture();

    const first = await verifier.verify({
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
    });
    const second = await verifier.verify({
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
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

  it("retains the inspected prepared start while signature verification awaits", async () => {
    const fixture = await signedFixture();
    const replacementStart = await preparedStartFixture({
      scopeId: BASE_SCOPE_ID,
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(7n),
      orderId: "order_replacement",
      requestKey: TransactionRequestKeyV1Schema.make("request_replacement"),
    });
    let releaseSignature: (() => void) | undefined;
    const signatureGate = new Promise<void>((resolve) => {
      releaseSignature = resolve;
    });
    let notifySignatureStarted: (() => void) | undefined;
    const signatureStarted = new Promise<void>((resolve) => {
      notifySignatureStarted = resolve;
    });
    const baseKey = await activeVerificationKey();
    const verifier = await verifierFixture({
      keys: [{
        ...baseKey,
        verify: async (signingInput, signature) => {
          notifySignatureStarted?.();
          await signatureGate;
          return baseKey.verify(signingInput, signature);
        },
      }],
    });
    const input = {
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
    };
    const pending = verifier.verify(input);

    await signatureStarted;
    input.expectedStart = replacementStart;
    releaseSignature?.();
    const verified = await pending;
    const admitted = await runEffect(createPointMutationStartAdmissionV1({
      resolveCurrent: () => Effect.succeed({
        deploymentId: DEPLOYMENT_ID,
        scopeId: fixture.evidence.payload.scopeId,
        authorizationRevocationEpoch:
          fixture.evidence.payload.authorizationRevocationEpoch,
      }),
    }).admit(verified));
    const admittedInspection = inspectAdmittedPointMutationStartV1(admitted);

    expect(admittedInspection.preparedStart.logicalPins).toEqual(
      inspectExecutorPreparedPointMutationStartV1(
        fixture.preparedStart,
      ).logicalPins,
    );
    expect(admittedInspection.preparedStart.logicalPins).not.toEqual(
      inspectExecutorPreparedPointMutationStartV1(replacementStart).logicalPins,
    );
  });

  it("uses one exact key lookup and rejects malformed, unknown, tampered, and wrong-key evidence", async () => {
    const fixture = await signedFixture();
    const verifier = await verifierFixture();

    await expect(verifier.verify({
      jws: {},
      expectedStart: fixture.preparedStart,
    }))
      .rejects.toMatchObject({
        issue: { reason: "malformedEvidence" },
      });

    const unknownKeyFixture = await signedFixture({ kid: NEW_KEY_ID });
    await expect(verifier.verify({
      jws: unknownKeyFixture.jws,
      expectedStart: unknownKeyFixture.preparedStart,
    })).rejects.toMatchObject({ issue: { reason: "unknownKey" } });

    await expect(verifier.verify({
      jws: {
        ...fixture.jws,
        signature: flipBase64UrlCharacter(fixture.jws.signature),
      },
      expectedStart: fixture.preparedStart,
    })).rejects.toMatchObject({ issue: { reason: "signatureInvalid" } });

    const wrongMaterialVerifier = await verifierFixture({
      keys: [{
        ...(await activeVerificationKey()),
        verify: async () => false,
      }],
    });
    await expect(wrongMaterialVerifier.verify({
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
    })).rejects.toMatchObject({ issue: { reason: "signatureInvalid" } });
  });

  it("enforces time, fixed policy, digest, empty claims, and explicit limits", async () => {
    const valid = await signedFixture();

    const atExpiryVerifier = await verifierFixture({
      now: new Date("2026-07-14T10:01:00.000Z"),
    });
    await expect(atExpiryVerifier.verify({
      jws: valid.jws,
      expectedStart: valid.preparedStart,
    })).rejects.toMatchObject({ issue: { reason: "expired" } });

    const future = await signedFixture({
      payloadOverrides: {
        issuedAt: "2026-07-14T10:00:30.001Z",
        expiresAt: "2026-07-14T10:01:00.001Z",
      },
    });
    await expect((await verifierFixture()).verify({
      jws: future.jws,
      expectedStart: future.preparedStart,
    })).rejects.toMatchObject({ issue: { reason: "issuedInFuture" } });
    await expect((await verifierFixture({ futureSkewMilliseconds: 1 })).verify({
      jws: future.jws,
      expectedStart: future.preparedStart,
    })).resolves.toBeDefined();

    const overlong = await signedFixture({
      payloadOverrides: {
        expiresAt: "2026-07-14T10:02:00.001Z",
      },
    });
    await expect((await verifierFixture()).verify({
      jws: overlong.jws,
      expectedStart: overlong.preparedStart,
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
        expectedStart: fixture.preparedStart,
      })).rejects.toMatchObject({
        issue: { reason: policyCase.reason },
      });
    }

    const configurationKey = await activeVerificationKey();
    for (const badLifetime of [
      0,
      -1,
      1.5,
      MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1 + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => createVerifier({
        namespace: createNamespace([configurationKey]),
        maximumGrantLifetimeMilliseconds: badLifetime,
      })).toThrow(TransactionGrantAuthorityConfigurationV1Error);
    }
    for (const badSkew of [
      -1,
      1.5,
      MAX_TRANSACTION_GRANT_EPOCH_MILLISECONDS_V1 + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => createVerifier({
        namespace: createNamespace([configurationKey]),
        maximumFutureIssuedAtSkewMilliseconds: badSkew,
      })).toThrow(TransactionGrantAuthorityConfigurationV1Error);
    }
  });

  it("compares independently prepared logical pins including inert epoch binding", async () => {
    const verifier = await verifierFixture();
    const mismatches: ReadonlyArray<{
      readonly field:
        | "deploymentId"
        | "scopeId"
        | "packageId"
        | "artifactId"
        | "executionModule"
        | "functionPath"
        | "schemaVersionId"
        | "validatedArgsSha256"
        | "requestKey"
        | "requestSha256"
        | "authorizationRevocationEpoch";
      readonly overrides: Readonly<Record<string, unknown>>;
    }> = [
      { field: "deploymentId", overrides: { deploymentId: OTHER_DEPLOYMENT_ID } },
      {
        field: "scopeId",
        overrides: {
          scopeId: ReplacementScopeIdV1Schema.make(
            "scope_118f22e2-58cc-7b2a-91d8-f3f3401a0874",
          ),
        },
      },
      { field: "packageId", overrides: { packageId: "package_other" } },
      {
        field: "artifactId",
        overrides: {
          artifactId: `artifact_${"f".repeat(32)}`,
          sourcePackageHash: "f".repeat(64),
        },
      },
      { field: "executionModule", overrides: { executionModule: "flarex/other.ts" } },
      { field: "functionPath", overrides: { functionPath: "orders:other" } },
      { field: "schemaVersionId", overrides: { schemaVersionId: "schema_other" } },
      { field: "validatedArgsSha256", overrides: { validatedArgsSha256: "e".repeat(64) } },
      { field: "requestKey", overrides: { requestKey: "request_other" } },
      { field: "requestSha256", overrides: { requestSha256: "d".repeat(64) } },
      {
        field: "authorizationRevocationEpoch",
        overrides: { authorizationRevocationEpoch: "8" },
      },
    ];

    for (const mismatch of mismatches) {
      const fixture = await signedFixture({
        payloadOverrides: mismatch.overrides,
      });
      await expect(verifier.verify({
        jws: fixture.jws,
        expectedStart: fixture.preparedStart,
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
      expectedStart: oldFixture.preparedStart,
    })).resolves.toBeDefined();

    const postCutoverOld = await signedFixture({
      payloadOverrides: {
        issuedAt: new Date(cutover).toISOString(),
        expiresAt: new Date(cutover + 60_000).toISOString(),
      },
    });
    await expect(overlapVerifier.verify({
      jws: postCutoverOld.jws,
      expectedStart: postCutoverOld.preparedStart,
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
      expectedStart: oldFixture.preparedStart,
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
      expectedStart: oldFixture.preparedStart,
    })).rejects.toMatchObject({ issue: { reason: "unissuableKey" } });

    const preactivationNew = await signedFixture({
      kid: NEW_KEY_ID,
      privateKey: newKeys.privateKey,
    });
    await expect(overlapVerifier.verify({
      jws: preactivationNew.jws,
      expectedStart: preactivationNew.preparedStart,
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
      expectedStart: oldFixture.preparedStart,
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

describe("current-epoch transaction-grant admission", () => {
  it("produces the final opaque prepared-start capability without handle mixing", async () => {
    const fixture = await signedFixture();
    const verified = await (await verifierFixture()).verify({
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
    });
    const admission = createPointMutationStartAdmissionV1({
      resolveCurrent: () => Effect.succeed({
        deploymentId: DEPLOYMENT_ID,
        scopeId: fixture.evidence.payload.scopeId,
        authorizationRevocationEpoch:
          fixture.evidence.payload.authorizationRevocationEpoch,
      }),
    });
    expectTypeOf<ReturnType<typeof admission.admit>>().toEqualTypeOf<
      Effect.Effect<
        AdmittedPointMutationStartV1,
        | CurrentEpochTransactionGrantAdmissionV1Error
        | TransactionGrantVerificationV1Error
      >
    >();

    const admitted = await runEffect(admission.admit(verified));
    const inspection = inspectAdmittedPointMutationStartV1(admitted);
    expect(JSON.stringify(admitted)).toBe("{}");
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(inspection.preparedStart.logicalPins.requestSha256).toBe(
      fixture.evidence.payload.requestSha256,
    );
    expect(inspection.verifiedGrant).toBe(
      inspectVerifiedTransactionGrantV1(verified),
    );
    for (const forged of [
      fixture.preparedStart,
      verified,
      JSON.parse(JSON.stringify(admitted)),
      { ...admitted },
      Object.create(admitted),
    ]) {
      expect(() => inspectAdmittedPointMutationStartV1(forged))
        .toThrow(InvalidAdmittedPointMutationStartV1Error);
    }
  });

  it("adds a second opaque capability from independently located authority", async () => {
    const fixture = await signedFixture();
    const verifiedGrant = await (await verifierFixture()).verify({
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
    });
    const resolvedDeployments: string[] = [];
    const admission = createCurrentEpochTransactionGrantAdmissionV1({
      resolveCurrent: (deploymentId) => {
        resolvedDeployments.push(deploymentId);
        return Effect.succeed({
          deploymentId,
          scopeId: fixture.evidence.payload.scopeId,
          authorizationRevocationEpoch:
            fixture.evidence.payload.authorizationRevocationEpoch,
        });
      },
    });

    const admittedGrant = await runEffect(admission.admit(verifiedGrant));
    const inspection =
      inspectCurrentEpochVerifiedTransactionGrantV1(admittedGrant);

    expect(resolvedDeployments).toEqual([DEPLOYMENT_ID]);
    expect(admittedGrant).not.toBe(verifiedGrant);
    expect(Object.isFrozen(admittedGrant)).toBe(true);
    expect(JSON.stringify(admittedGrant)).toBe("{}");
    expect(inspection.verifiedGrant)
      .toBe(inspectVerifiedTransactionGrantV1(verifiedGrant));
    expect(inspection.currentAuthority).toEqual({
      deploymentId: DEPLOYMENT_ID,
      scopeId: fixture.evidence.payload.scopeId,
      authorizationRevocationEpoch: 7n,
    });
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(Object.isFrozen(inspection.currentAuthority)).toBe(true);

    for (const forged of [
      verifiedGrant,
      JSON.parse(JSON.stringify(admittedGrant)),
      { ...admittedGrant },
      Object.create(admittedGrant),
      true,
    ]) {
      expect(() => inspectCurrentEpochVerifiedTransactionGrantV1(forged))
        .toThrow(InvalidCurrentEpochVerifiedTransactionGrantV1Error);
    }
  });

  it("propagates a typed current-authority resolver failure unchanged", async () => {
    const fixture = await signedFixture();
    const verifiedGrant = await (await verifierFixture()).verify({
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
    });
    const resolverFailure = new Error("current authority unavailable");
    const admission = createCurrentEpochTransactionGrantAdmissionV1({
      resolveCurrent: () => Effect.fail(resolverFailure),
    });

    const failure = await runEffectFailure(admission.admit(verifiedGrant));
    expect(failure).toBe(resolverFailure);
  });

  it("fails closed on independently located deployment, scope, or epoch drift", async () => {
    const fixture = await signedFixture();
    const payload = fixture.evidence.payload;
    const verifiedGrant = await (await verifierFixture()).verify({
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
    });
    const cases = [
      {
        reason: "locatedDeploymentMismatch",
        authority: {
          deploymentId: OTHER_DEPLOYMENT_ID,
          scopeId: payload.scopeId,
          authorizationRevocationEpoch: payload.authorizationRevocationEpoch,
        },
      },
      {
        reason: "locatedScopeMismatch",
        authority: {
          deploymentId: payload.deploymentId,
          scopeId: ReplacementScopeIdV1Schema.make(
            "scope_118f22e2-58cc-7b2a-91d8-f3f3401a0874",
          ),
          authorizationRevocationEpoch: payload.authorizationRevocationEpoch,
        },
      },
      {
        reason: "authorizationRevocationEpochMismatch",
        authority: {
          deploymentId: payload.deploymentId,
          scopeId: payload.scopeId,
          authorizationRevocationEpoch:
            TransactionAuthorizationRevocationEpochSchema.make(8n),
        },
      },
    ] as const;

    for (const admissionCase of cases) {
      const admission = createCurrentEpochTransactionGrantAdmissionV1({
        resolveCurrent: () => Effect.succeed(admissionCase.authority),
      });
      const rejectedAdmission = runEffect(admission.admit(verifiedGrant));
      await expect(rejectedAdmission).rejects.toMatchObject({
        issue: { reason: admissionCase.reason },
      });
      await expect(rejectedAdmission).rejects.toBeInstanceOf(
        CurrentEpochTransactionGrantAdmissionV1Error,
      );
    }
  });

  it("rejects an old grant after a completed epoch bump and accepts a new one", async () => {
    const oldFixture = await signedFixture();
    const oldGrant = await (await verifierFixture()).verify({
      jws: oldFixture.jws,
      expectedStart: oldFixture.preparedStart,
    });
    let currentEpoch = oldFixture.evidence.payload.authorizationRevocationEpoch;
    const admission = createCurrentEpochTransactionGrantAdmissionV1({
      resolveCurrent: (deploymentId) => Effect.succeed({
        deploymentId,
        scopeId: oldFixture.evidence.payload.scopeId,
        authorizationRevocationEpoch: currentEpoch,
      }),
    });

    await expect(runEffect(admission.admit(oldGrant))).resolves.toBeDefined();
    currentEpoch = TransactionAuthorizationRevocationEpochSchema.make(8n);
    await expect(runEffect(admission.admit(oldGrant))).rejects.toMatchObject({
      issue: { reason: "authorizationRevocationEpochMismatch" },
    });

    const newFixture = await signedFixture({
      payloadOverrides: { authorizationRevocationEpoch: "8" },
      preparedEpoch: TransactionAuthorizationRevocationEpochSchema.make(8n),
    });
    const newGrant = await (await verifierFixture()).verify({
      jws: newFixture.jws,
      expectedStart: newFixture.preparedStart,
    });
    await expect(runEffect(admission.admit(newGrant))).resolves.toBeDefined();
  });

  it("composes signed admission with the located PGlite epoch authority", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const physicalLocator = Object.freeze({
      kind: "shared_database",
      databaseKey: "executor-grant-admission-pglite",
      schemaName: "public",
    } as const);
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator,
        randomUuid: uuidSequence(
          LOCATED_ADMISSION_SCOPE_UUID,
          "60000000-0000-4000-8000-000000000001",
        ),
      },
    ).ensure({
      deploymentId: DEPLOYMENT_ID,
      projectId: "project_grant_admission_pglite",
    });
    const admission = createCurrentEpochTransactionGrantAdmissionV1({
      resolveCurrent: (deploymentId) =>
        resolveCurrentScopeAuthorizationEpochEffect(deploymentId, {
          scopeMetadata: persistence,
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => {
              throw new Error(
                "Shared scope resolution must not read provisioning receipts.",
              );
            },
          },
          scopeEpochTargets: {
            resolve: async (resolvedLocator) =>
              createPGliteLocatedScopeAuthorizationEpochTarget(
                persistence,
                resolvedLocator,
              ),
          },
        }),
    });
    const oldFixture = await signedFixture({
      preparedScopeId: LOCATED_ADMISSION_SCOPE_ID,
      preparedEpoch: TransactionAuthorizationRevocationEpochSchema.make(0n),
      payloadOverrides: {
        scopeId: LOCATED_ADMISSION_SCOPE_ID,
        authorizationRevocationEpoch: "0",
      },
    });
    const oldGrant = await (await verifierFixture()).verify({
      jws: oldFixture.jws,
      expectedStart: oldFixture.preparedStart,
    });

    expect(provisioned.scope.scopeId).toBe(
      oldFixture.evidence.payload.scopeId,
    );
    await expect(runEffect(admission.admit(oldGrant))).resolves.toBeDefined();
    await persistence.drizzle.transaction((tx) =>
      advanceScopeAuthorizationRevocationEpochInTransaction(
        tx,
        provisioned.scope.scopeId,
      ),
    );
    await expect(runEffect(admission.admit(oldGrant))).rejects.toMatchObject({
      issue: { reason: "authorizationRevocationEpochMismatch" },
    });

    const newFixture = await signedFixture({
      preparedScopeId: LOCATED_ADMISSION_SCOPE_ID,
      preparedEpoch: TransactionAuthorizationRevocationEpochSchema.make(1n),
      payloadOverrides: {
        scopeId: LOCATED_ADMISSION_SCOPE_ID,
        authorizationRevocationEpoch: "1",
      },
    });
    const newGrant = await (await verifierFixture()).verify({
      jws: newFixture.jws,
      expectedStart: newFixture.preparedStart,
    });
    await expect(runEffect(admission.admit(newGrant))).resolves.toBeDefined();
  });

  it("activates only the final admitted handle and returns private session authority", async () => {
    expectTypeOf<RootSessionActivationExport>().toEqualTypeOf<never>();
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const physicalLocator = Object.freeze({
      kind: "shared_database",
      databaseKey: "executor-session-activation-pglite",
      schemaName: "public",
    } as const);
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator,
        randomUuid: uuidSequence(
          LOCATED_ADMISSION_SCOPE_UUID,
          "60000000-0000-4000-8000-000000000021",
        ),
      },
    ).ensure({
      deploymentId: DEPLOYMENT_ID,
      projectId: "project_session_activation_pglite",
    });
    await persistence.query(
      `
        update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
        where scope_id = $1
      `,
      [provisioned.scope.scopeId],
    );
    const fixture = await signedFixture({
      preparedScopeId: LOCATED_ADMISSION_SCOPE_ID,
      preparedEpoch: TransactionAuthorizationRevocationEpochSchema.make(0n),
      payloadOverrides: {
        scopeId: LOCATED_ADMISSION_SCOPE_ID,
        authorizationRevocationEpoch: "0",
        issuedAt: "2099-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:01:00.000Z",
      },
    });
    const verifier = await verifierFixture({
      now: new Date("2099-01-01T00:00:30.000Z"),
    });
    const verifiedGrant = await verifier.verify({
      jws: fixture.jws,
      expectedStart: fixture.preparedStart,
    });
    const admission = createPointMutationStartAdmissionV1({
      resolveCurrent: (deploymentId) =>
        resolveCurrentScopeAuthorizationEpochEffect(deploymentId, {
          scopeMetadata: persistence,
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => {
              throw new Error(
                "Shared scope resolution must not read provisioning receipts.",
              );
            },
          },
          scopeEpochTargets: {
            resolve: async (resolvedLocator) =>
              createPGliteLocatedScopeAuthorizationEpochTarget(
                persistence,
                resolvedLocator,
              ),
          },
        }),
    });
    const admitted = await runEffect(admission.admit(verifiedGrant));
    const sessionResolutionPorts = {
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error(
            "Shared scope resolution must not read provisioning receipts.",
          );
        },
      },
      scopeSessionTargets: {
        resolve: async (resolvedLocator: typeof physicalLocator) =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            persistence,
            resolvedLocator,
          ),
      },
    };
    const sessionPersistence =
      createPointMutationSessionActivationPersistenceV1(
        sessionResolutionPorts,
        {
          leaseDurationMilliseconds: 15_000,
          randomUuid: uuidSequence(
            "60000000-0000-4000-8000-000000000022",
            "60000000-0000-4000-8000-000000000023",
          ),
        },
      );
    const attemptLoadPersistence =
      createPointMutationSessionAttemptLoadPersistenceV1(
        sessionResolutionPorts,
      );
    let persistenceCalls = 0;
    const activation = createPointMutationSessionActivationV1({
      activate: async (input) => {
        persistenceCalls += 1;
        return sessionPersistence.activate(input);
      },
    });

    for (const invalid of [
      JSON.parse(JSON.stringify(admitted)),
      { ...admitted },
      Object.create(admitted),
      fixture.preparedStart,
    ]) {
      await expect(activateUnknown(activation, invalid)).rejects.toBeInstanceOf(
        InvalidAdmittedPointMutationStartV1Error,
      );
    }
    expect(persistenceCalls).toBe(0);

    const activated = await activation.activate(admitted);
    const created = inspectActivatedPointMutationSessionV1(activated);
    const replayedHandle = await activation.activate(admitted);
    const replayed = inspectActivatedPointMutationSessionV1(replayedHandle);
    const serializedSelector = JSON.stringify(
      pointMutationSessionAttemptSelectorV1FromActivated(activated),
    );
    const restartedLoading = createPointMutationSessionAttemptLoadingV1(
      attemptLoadPersistence,
    );
    const loaded = await restartedLoading.load(JSON.parse(serializedSelector));
    const loadedInspection = inspectLoadedPointMutationSessionAttemptV1(loaded);

    expectTypeOf<RootSessionAttemptLoadingExport>().toEqualTypeOf<never>();
    expect(persistenceCalls).toBe(2);
    expect(JSON.stringify(activated)).toBe("{}");
    expect(Object.isFrozen(activated)).toBe(true);
    expect(created.status).toBe("created");
    expect(replayed.status).toBe("replayed");
    expect(replayed.anchor).toEqual(created.anchor);
    expect(created.anchor.snapshotToken).toMatchObject({
      scopeId: LOCATED_ADMISSION_SCOPE_ID,
      commitSeq: 0n,
    });
    expect(JSON.stringify(loaded)).toBe("{}");
    expect(loadedInspection).toEqual({
      selector: {
        deploymentId: created.anchor.deploymentId,
        scopeId: created.anchor.scopeId,
        sessionId: created.anchor.sessionId,
        attemptFence: created.anchor.attemptFence,
      },
      storageGeneration: created.anchor.storageGeneration,
      storageGenerationFence: created.anchor.storageGenerationFence,
      snapshotToken: created.anchor.snapshotToken,
      schemaVersionId: "schema_a2b",
    });
    expect(() => inspectLoadedPointMutationSessionAttemptV1({ ...loaded }))
      .toThrow(InvalidLoadedPointMutationSessionAttemptV1Error);
    expect(() => inspectActivatedPointMutationSessionV1({ ...activated }))
      .toThrow(InvalidActivatedPointMutationSessionV1Error);
    expect(() => inspectActivatedPointMutationSessionV1(
      JSON.parse(JSON.stringify(activated)),
    )).toThrow(InvalidActivatedPointMutationSessionV1Error);

    const stored = await persistence.query<{
      package_id: string;
      policy_version: string;
      identity_hash: string;
      args_hash: string;
      grant_id: string;
      request_hash: string;
    }>(
      `
        select package_id, policy_version,
               encode(identity_access_policy_sha256, 'hex') as identity_hash,
               encode(validated_args_sha256, 'hex') as args_hash,
               authorization_grant_id as grant_id,
               encode(request_sha256, 'hex') as request_hash
        from fx_system_tx_session
        where session_id = $1
      `,
      [created.anchor.sessionId],
    );
    expect(stored.rows).toEqual([{
      package_id: fixture.evidence.payload.packageId,
      policy_version: fixture.evidence.payload.policyVersion,
      identity_hash: fixture.evidence.payload.identityAccessPolicySha256,
      args_hash: fixture.evidence.payload.validatedArgsSha256,
      grant_id: fixture.evidence.authorizationGrantId,
      request_hash: fixture.evidence.payload.requestSha256,
    }]);
  });
});

describePostgres(
  "current-epoch transaction-grant admission on real Postgres",
  () => {
    it("rejects a signed old grant after the located S07-A epoch advances", async () => {
      await withTemporaryPostgresExecutorPersistence(
        async (persistence, _executorPersistence, physicalLocator) => {
          const provisioned =
            await createPostgresSharedScopeAuthorityProvisioner(
              persistence,
              {
                physicalLocator,
                randomUuid: uuidSequence(
                  LOCATED_ADMISSION_SCOPE_UUID,
                  "60000000-0000-4000-8000-000000000011",
                ),
              },
            ).ensure({
              deploymentId: DEPLOYMENT_ID,
              projectId: "project_grant_admission_postgres",
            });
          const admission = createCurrentEpochTransactionGrantAdmissionV1({
            resolveCurrent: (deploymentId) =>
              resolveCurrentScopeAuthorizationEpochEffect(deploymentId, {
                scopeMetadata: persistence,
                provisioningReceipts: {
                  getScopeAuthorityProvisioningReceipt: async () => {
                    throw new Error(
                      "Shared scope resolution must not read provisioning receipts.",
                    );
                  },
                },
                scopeEpochTargets: {
                  resolve: async (resolvedLocator) =>
                    createPostgresLocatedScopeAuthorizationEpochTarget(
                      persistence,
                      resolvedLocator,
                    ),
                },
              }),
          });
          const oldFixture = await signedFixture({
            preparedScopeId: LOCATED_ADMISSION_SCOPE_ID,
            preparedEpoch:
              TransactionAuthorizationRevocationEpochSchema.make(0n),
            payloadOverrides: {
              scopeId: LOCATED_ADMISSION_SCOPE_ID,
              authorizationRevocationEpoch: "0",
            },
          });
          const oldGrant = await (await verifierFixture()).verify({
            jws: oldFixture.jws,
            expectedStart: oldFixture.preparedStart,
          });

          expect(provisioned.scope.scopeId).toBe(
            oldFixture.evidence.payload.scopeId,
          );
          await expect(runEffect(admission.admit(oldGrant)))
            .resolves.toBeDefined();
          await persistence.drizzle.transaction((tx) =>
            advanceScopeAuthorizationRevocationEpochInTransaction(
              tx,
              provisioned.scope.scopeId,
            ),
          );
          await expect(runEffect(admission.admit(oldGrant)))
            .rejects.toMatchObject({
            issue: { reason: "authorizationRevocationEpochMismatch" },
          });

          const newFixture = await signedFixture({
            preparedScopeId: LOCATED_ADMISSION_SCOPE_ID,
            preparedEpoch:
              TransactionAuthorizationRevocationEpochSchema.make(1n),
            payloadOverrides: {
              scopeId: LOCATED_ADMISSION_SCOPE_ID,
              authorizationRevocationEpoch: "1",
            },
          });
          const newGrant = await (await verifierFixture()).verify({
            jws: newFixture.jws,
            expectedStart: newFixture.preparedStart,
          });
          await expect(runEffect(admission.admit(newGrant)))
            .resolves.toBeDefined();
        },
      );
    });
  },
);

async function signedFixture(
  options: {
    readonly kid?: TransactionGrantKeyIdV1;
    readonly privateKey?: CryptoKey;
    readonly payloadOverrides?: Readonly<Record<string, unknown>>;
    readonly preparedScopeId?: ReplacementScopeIdV1;
    readonly preparedEpoch?: TransactionAuthorizationRevocationEpoch;
  } = {},
): Promise<{
  readonly jws: TransactionGrantJwsV1;
  readonly evidence: InertTransactionGrantEvidenceV1;
  readonly preparedStart: ExecutorPreparedPointMutationStartV1;
}> {
  const preparedStart = await preparedStartFixture({
    scopeId: options.preparedScopeId ?? BASE_SCOPE_ID,
    authorizationRevocationEpoch:
      options.preparedEpoch ??
      TransactionAuthorizationRevocationEpochSchema.make(7n),
  });
  const pins = inspectExecutorPreparedPointMutationStartV1(
    preparedStart,
  ).logicalPins;
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
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicySha256: policy.sha256Hex,
    validatedArgsValueCodecVersion: pins.validatedArgsValueCodecVersion,
    validatedArgsSha256: pins.validatedArgsSha256,
    requestKey: pins.requestKey,
    requestSha256: pins.requestSha256,
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    auth,
    issuedAt: "2026-07-14T10:00:00.000Z",
    expiresAt: "2026-07-14T10:01:00.000Z",
    authorizationRevocationEpoch:
      pins.authorizationRevocationEpoch.toString(),
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
    copyBytesToArrayBuffer(signingInput),
  ));
  const evidence = await deriveInertTransactionGrantEvidenceV1({
    protected: header.base64url,
    payload: payload.base64url,
    signature: encodeTransactionGrantEd25519SignatureV1(signatureBytes),
  });
  return { jws: evidence.jws, evidence, preparedStart };
}

async function preparedStartFixture(input: {
  readonly scopeId: ReplacementScopeIdV1;
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
  readonly orderId?: string;
  readonly requestKey?: TransactionRequestKeyV1;
}): Promise<ExecutorPreparedPointMutationStartV1> {
  const preparation = createExecutorPointMutationStartPreparationV1({
    loadActiveTargetMetadata: async () => ({
      format: "flarex.point-mutation-target-metadata",
      version: 1,
      deploymentId: DEPLOYMENT_ID,
      scopeId: input.scopeId,
      packageId: "package_a2b",
      artifactRuntime: "dynamic-worker",
      artifactId: `artifact_${"a".repeat(32)}`,
      sourcePackageHash: "a".repeat(64),
      schemaVersionId: "schema_a2b",
      functions: [{
        path: "orders:create",
        executionModule: "flarex/orders.ts",
        kind: "mutation",
        visibility: "public",
        argsValidator: {
          type: "object",
          value: {
            orderId: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        returnsValidator: null,
      }],
      schemaManifest: {
        kind: "appSchema",
        manifestVersion: 1,
        tableDefinitions: {
          kind: "tableDefinitions",
          sectionVersion: 1,
          tables: [],
        },
        indexBindings: {
          kind: "indexBindings",
          sectionVersion: 1,
          indexes: [],
        },
      },
    }),
    loadCurrentScopeAuthority: async () => ({
      deploymentId: DEPLOYMENT_ID,
      scopeId: input.scopeId,
      authorizationRevocationEpoch: input.authorizationRevocationEpoch,
    }),
  });
  return preparation.prepare({
    deploymentId: DEPLOYMENT_ID,
    functionPath: TransactionFunctionPathV1Schema.make("orders:create"),
    args: { orderId: input.orderId ?? "order_a2b" },
    requestKey:
      input.requestKey ?? TransactionRequestKeyV1Schema.make("request_a2b"),
  });
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

async function activateUnknown(
  activation: PointMutationSessionActivationV1,
  value: unknown,
): Promise<unknown> {
  // @ts-expect-error This deliberately exercises the runtime opaque boundary.
  return activation.activate(value);
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
    copyBytesToArrayBuffer(signature),
    copyBytesToArrayBuffer(signingInput),
  );
}

async function importPrivateKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    copyBytesToArrayBuffer(decodeBase64(TEST_PRIVATE_KEY_PKCS8_BASE64)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

async function importPublicKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    copyBytesToArrayBuffer(decodeBase64(TEST_PUBLIC_KEY_SPKI_BASE64)),
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

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

function runEffectFailure<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

function flipBase64UrlCharacter(value: string): string {
  const first = value[0];
  if (first === undefined) throw new Error("Expected a nonempty signature.");
  return `${first === "A" ? "B" : "A"}${value.slice(1)}`;
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("UUID test sequence exhausted.");
    }
    return value;
  };
}

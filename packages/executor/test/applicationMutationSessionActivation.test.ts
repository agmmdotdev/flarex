import { webcrypto } from "node:crypto";

import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import {
  TransactionExecutionClaimFenceV1Schema,
  TransactionExecutionClaimOwnerV1Schema,
} from "@flarex/persistence-postgres/transaction-execution-claim";
import type {
  PreparedApplicationMutationSessionActivationV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { Effect, Result } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  assembleApplicationMutationGrantJwsV1,
  createApplicationMutationGrantVerifierNamespaceV1,
  prepareApplicationMutationGrantV1,
  verifyApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import {
  decodeReplacementScopeIdV1,
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantTimestampV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
} from "flarex-protocol/transaction-grant";
import {
  CanonicalTransactionArgumentsBytesV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionAttemptFenceSchema,
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { canonicalizePointMutationRequestV1 } from
  "flarex-protocol/point-mutation-start";
import {
  canonicalizeFlarexValueJsonV1,
  FLAREX_VALUE_CODEC_VERSION_V1,
} from "flarex-protocol/value";
import {
  CatalogSchemaVersionIdSchema,
} from "flarex-protocol/schema-manifest";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createApplicationMutationSessionActivationV1,
  inspectActivatedPointMutationSessionV1,
} from "../src/pointMutationSessionActivation";
import {
  createPointMutationExecutionClaimVaultV1,
} from "../src/pointMutationExecutionClaim";
import {
  getActivatedPointMutationSessionStateV1,
} from "../src/pointMutationSessionActivationState";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application mutation session activation", () => {
  it("retains owned Application session authority for initial execution", async () => {
    const input = await applicationInput();
    let received: unknown;
    const activation = createApplicationMutationSessionActivationV1({
      activateEffect: candidate => {
        received = candidate;
        return Effect.succeed({
          status: "created" as const,
          anchor: Object.freeze({
            deploymentId: input.deploymentId,
            scopeId: input.scopeId,
            sessionId: TransactionSessionIdV1Schema.make(
              "30000000-0000-4000-8000-000000000001",
            ),
            requestKey: input.evidence.requestKey,
            storageGeneration: FlarexDbV1StorageGenerationSchema.make(
              "flarexdb_v1",
            ),
            storageGenerationFence: StorageGenerationFenceSchema.make(1n),
            attemptFence: TransactionAttemptFenceSchema.make(1n),
            snapshotToken: SnapshotTokenSchema.make({
              scopeId: input.scopeId,
              epoch: ScopeEpochSchema.make("scope_epoch_application"),
              commitSeq: CommitSeqSchema.make(0n),
            }),
            hardExpiresAt: "2026-08-13T01:10:00.000Z",
            leaseExpiresAt: "2026-08-13T01:10:00.000Z",
            createdAt: "2026-08-13T01:00:00.000Z",
            updatedAt: "2026-08-13T01:00:00.000Z",
          }),
          executionClaim: Object.freeze({
            claimOwner: TransactionExecutionClaimOwnerV1Schema.make(
              "30000000-0000-4000-8000-000000000002",
            ),
            claimFence: TransactionExecutionClaimFenceV1Schema.make(1n),
            claimedAt: "2026-08-13T01:00:00.000Z",
            claimExpiresAt: "2026-08-13T01:10:00.000Z",
          }),
        });
      },
    }, createPointMutationExecutionClaimVaultV1().issuer);

    const activated = await Effect.runPromise(activation.activate(input));
    expect(received).not.toBe(input);
    expect(inspectActivatedPointMutationSessionV1(activated).status).toBe(
      "created",
    );
    const state = getActivatedPointMutationSessionStateV1(activated);
    if (state?.executionAuthorityGeneration !== "application_v1") {
      throw new Error("Expected retained Application activation state.");
    }
    expect(state.initialSession).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      schemaVersionId: input.evidence.schemaVersionId,
      requestKey: input.evidence.requestKey,
    });
    expect("packageId" in state.initialSession).toBe(false);
    expect(state.schemaVersionId).toBe(input.evidence.schemaVersionId);
    expect(state.requestKey).toBe(input.evidence.requestKey);
    expect(state.initialSession.applicationExecutionAuthoritySha256)
      .toHaveLength(32);
    expect(state.initialSession.validatedArgsSha256).toEqual(
      input.evidence.validatedArgsSha256,
    );
    expect(state.initialSession.validatedArgsSha256).not.toBe(
      input.evidence.validatedArgsSha256,
    );
  });

  it("rejects noncanonical request evidence before persistence", async () => {
    const input = await applicationInput();
    let persistenceCalls = 0;
    const activation = createApplicationMutationSessionActivationV1({
      activateEffect: () => {
        persistenceCalls += 1;
        return Effect.die(new Error("Persistence must not be called."));
      },
    }, createPointMutationExecutionClaimVaultV1().issuer);
    const invalid = Object.freeze({
      ...input,
      evidence: Object.freeze({
        ...input.evidence,
        requestSha256: TransactionRequestSha256V1Schema.make(
          new Uint8Array(32).fill(0xff),
        ),
      }),
    });

    await expect(Effect.runPromise(activation.activate(invalid))).rejects
      .toMatchObject({ issue: { reason: "invalidPreparedEvidence" } });
    expect(persistenceCalls).toBe(0);
  });
});

async function applicationInput() {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    "deployment_application_activation",
  );
  const scopeId = decodeReplacementScopeIdV1(
    "scope_30000000-0000-4000-8000-000000000001",
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    "schema_application_activation",
  );
  const runtimeTarget = Result.getOrThrow(
    canonicalizeApplicationRuntimeTargetV1({
      format: "flarex.application-runtime-target",
      version: 1,
      scopeId,
      revisionId: "revision-application",
      candidateId: "candidate-application",
      analysisId: "analysis-application",
      sourceArtifactRootSha256: "1".repeat(64),
      manifestSha256: "2".repeat(64),
      schemaSha256: "3".repeat(64),
      functionCatalogSha256: "4".repeat(64),
      publicationSha256: "5".repeat(64),
      executionModulePath: "_flarex/application.js",
      function: {
        path: "recipes:save",
        moduleName: "recipes",
        exportName: "save",
        kind: "mutation",
        visibility: "public",
        args: { type: "any" },
        returns: { type: "any" },
        partition: null,
        entrySha256: "6".repeat(64),
      },
    }),
  );
  const authority = await Effect.runPromise(
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: runtimeTarget.target,
      runtimeTargetSha256: await sha256Hex(runtimeTarget.canonicalBytes),
      activationSequence: "1",
      activeHeadSha256: "7".repeat(64),
      schemaVersionId,
    }),
  );
  const policyVersion = TransactionPolicyVersionV1Schema.make(
    TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  );
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion,
    auth: { kind: "anonymous" },
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const argumentsJson = Object.freeze({ title: "Soup" });
  const canonicalArgs = await canonicalizeFlarexValueJsonV1(argumentsJson);
  const requestKey = TransactionRequestKeyV1Schema.make(
    "request:application:activation",
  );
  const requestSha256 = TransactionRequestSha256V1Schema.make(
    (await canonicalizePointMutationRequestV1({
      deploymentId,
      functionPath: TransactionFunctionPathV1Schema.make("recipes:save"),
      validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
        canonicalArgs.sha256,
      ),
      requestKey,
    })).sha256,
  );
  const now = Date.parse("2026-08-13T01:00:00.000Z");
  const segments = await Effect.runPromise(prepareApplicationMutationGrantV1({
    kid: TransactionGrantKeyIdV1Schema.make("application-key-1"),
    grantId: TransactionAuthorizationGrantIdV1Schema.make(
      "grant_application_activation",
    ),
    deploymentId,
    executionAuthority: authority,
    policyVersion,
    identityAccessPolicy: policy,
    validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    validatedArgsSha256: hex(canonicalArgs.sha256),
    requestKey,
    requestSha256: hex(requestSha256),
    issuedAt: TransactionGrantTimestampV1Schema.make(
      new Date(now - 60_000).toISOString(),
    ),
    expiresAt: TransactionGrantTimestampV1Schema.make(
      new Date(now + 300_000).toISOString(),
    ),
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(0n),
  }));
  const keyPair = await globalThis.crypto.subtle.generateKey(
    "Ed25519",
    false,
    ["sign", "verify"],
  );
  if (!("privateKey" in keyPair) || !("publicKey" in keyPair)) {
    throw new Error("Expected Ed25519 key pair.");
  }
  const wire = assembleApplicationMutationGrantJwsV1(
    segments,
    new Uint8Array(await globalThis.crypto.subtle.sign(
      "Ed25519",
      keyPair.privateKey,
      copyBytesToArrayBuffer(segments.signingInput),
    )),
  );
  const verifiedGrant = await Effect.runPromise(
    verifyApplicationMutationGrantV1(
      wire,
      createApplicationMutationGrantVerifierNamespaceV1({
        deploymentId,
        grantRetentionPolicy: Result.getOrThrow(
          makeGrantRetentionPolicyV1Result({
            maximumGrantLifetimeMilliseconds: 600_000,
            maximumFutureIssuedAtSkewMilliseconds: 30_000,
            maximumLiveSnapshotRetentionMilliseconds: 1_200_000,
          }),
        ),
        trustedNowEpochMilliseconds: Effect.succeed(now),
        keys: [{
          kid: TransactionGrantKeyIdV1Schema.make("application-key-1"),
          purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
          state: "active",
          issuedAtInclusiveEpochMilliseconds: now - 3_600_000,
          publicKey: keyPair.publicKey,
        }],
      }),
    ),
  );
  return Object.freeze({
    deploymentId,
    scopeId,
    activeSelection: Object.freeze({}) as
      PreparedApplicationMutationSessionActivationV1["activeSelection"],
    evidence: Object.freeze({
      executionAuthority: authority.authority,
      verifiedGrant,
      functionPath: TransactionFunctionPathV1Schema.make("recipes:save"),
      functionKind: TransactionFunctionKindV1Schema.make("mutation"),
      schemaVersionId,
      policyVersion,
      identityAccessPolicySha256:
        TransactionIdentityAccessPolicySha256V1Schema.make(
          hexBytes(policy.sha256Hex),
        ),
      validatedArgsJson: argumentsJson,
      validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      validatedArgsCanonicalBytes:
        CanonicalTransactionArgumentsBytesV1Schema.make(
          canonicalArgs.canonicalBytes,
        ),
      validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
        canonicalArgs.sha256,
      ),
      requestKey,
      requestSha256,
    }),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  )));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  );
}

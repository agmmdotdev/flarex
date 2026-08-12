import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  assembleApplicationMutationGrantJwsV1,
  createApplicationMutationGrantVerifierNamespaceV1,
  deriveInertApplicationMutationGrantEvidenceV1,
  prepareApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantTimestampV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
} from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionRequestKeyV1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueJsonV1,
} from "flarex-protocol/value";

import {
  verifyCommitAuthorityEvidenceEffect,
} from "../src/storedAttemptAuthentication/commitAuthorityVerification";
import {
  createTransactionGrantVerificationKernelV1,
} from "../src/transactionGrantVerificationKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment-application-authority",
);
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_00000000-0000-4000-8000-000000000017",
);
const SCHEMA_VERSION_ID = CatalogSchemaVersionIdSchema.make("schema-v17");
const NOW = Date.parse("2026-08-12T10:01:00.000Z");
const RETENTION = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 10 * 60_000,
  maximumFutureIssuedAtSkewMilliseconds: 30_000,
  maximumLiveSnapshotRetentionMilliseconds: 20 * 60_000,
}));

describe("Application commit-authority verification", () => {
  it("verifies the exact Application grant and rejects absent or wrong pins", async () => {
    const fixture = await applicationFixture();
    const verified = await runEffect(verifyCommitAuthorityEvidenceEffect(
      fixture.state,
      fixture.evidence,
      fixture.legacyKernel,
      fixture.namespace,
    ));
    expect(verified.executionAuthorityGeneration).toBe("application_v1");
    if (verified.executionAuthorityGeneration !== "application_v1") {
      throw new Error("Expected Application authority evidence.");
    }
    expect(verified.applicationAuthority.runtimeTarget.function.path).toBe(
      "recipes:update",
    );
    expect(verified.verifiedGrant.payload.executionAuthoritySha256).toBe(
      fixture.authoritySha256Hex,
    );
    expect(Object.isFrozen(verified.verifiedGrant.payload)).toBe(true);
    expect(Object.isFrozen(verified.verifiedGrant.payload.capabilities)).toBe(
      true,
    );
    expect(Object.isFrozen(verified.applicationAuthority.runtimeTarget)).toBe(
      true,
    );
    expect(Object.isFrozen(
      verified.applicationAuthority.runtimeTarget.function,
    )).toBe(true);
    const verifiedGrantSha256 = verified.verifiedGrant.authorizationGrantSha256;
    const expectedGrantSha256 = new Uint8Array(verifiedGrantSha256);
    verifiedGrantSha256.fill(0);
    expect(verified.verifiedGrant.authorizationGrantSha256).toEqual(
      expectedGrantSha256,
    );

    await expect(runEffectFailure(verifyCommitAuthorityEvidenceEffect(
      fixture.state,
      fixture.evidence,
      fixture.legacyKernel,
    ))).resolves.toMatchObject({
      _tag: "StoredCommitAuthorityCorruptionV1Error",
      reason: "authorizationGrantInvalid",
    });

    const wrongRequest = await applicationFixture({
      grantRequestSha256Hex: "8".repeat(64),
    });
    await expect(runEffectFailure(verifyCommitAuthorityEvidenceEffect(
      wrongRequest.state,
      wrongRequest.evidence,
      wrongRequest.legacyKernel,
      wrongRequest.namespace,
    ))).resolves.toMatchObject({
      _tag: "StoredCommitAuthorityCorruptionV1Error",
      reason: "authorizationGrantInvalid",
    });
  });
});

async function applicationFixture(options: Readonly<{
  grantRequestSha256Hex?: string;
}> = {}) {
  const schemaManifest = decodeSchemaManifestAppSchemaV1({
    kind: "appSchema",
    manifestVersion: 1,
    tableDefinitions: {
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [{
        tableId: 1,
        namespace: "app",
        logicalName: "recipes",
        definition: {
          kind: "appDocument",
          definitionVersion: 1,
          documentType: { type: "object", value: {} },
        },
      }],
    },
    indexBindings: { kind: "indexBindings", sectionVersion: 1, indexes: [] },
  });
  const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: SCOPE_ID,
    revisionId: "revision-17",
    candidateId: "candidate-17",
    analysisId: "analysis-17",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: {
      path: "recipes:update",
      moduleName: "recipes",
      exportName: "update",
      kind: "mutation",
      visibility: "public",
      args: { type: "object", value: {} },
      returns: { type: "null" },
      partition: null,
      entrySha256: "6".repeat(64),
    },
  }));
  const runtimeTargetSha256 = await sha256Hex(target.canonicalBytes);
  const authority = await runEffect(
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: target.target,
      runtimeTargetSha256,
      activationSequence: "17",
      activeHeadSha256: "7".repeat(64),
      schemaVersionId: SCHEMA_VERSION_ID,
    }),
  );
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth: { kind: "anonymous" },
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const args = await canonicalizeFlarexValueJsonV1({});
  const requestSha256Hex = "9".repeat(64);
  const grantRequestSha256Hex = options.grantRequestSha256Hex ??
    requestSha256Hex;
  const grant = await runEffect(prepareApplicationMutationGrantV1({
    kid: TransactionGrantKeyIdV1Schema.make("application-key-17"),
    grantId: TransactionAuthorizationGrantIdV1Schema.make(
      "grant-application-17",
    ),
    deploymentId: DEPLOYMENT_ID,
    executionAuthority: authority,
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicy: policy,
    validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    validatedArgsSha256: bytesToHex(args.sha256),
    requestKey: TransactionRequestKeyV1Schema.make("request-application-17"),
    requestSha256: grantRequestSha256Hex,
    issuedAt: TransactionGrantTimestampV1Schema.make(
      "2026-08-12T10:00:00.000Z",
    ),
    expiresAt: TransactionGrantTimestampV1Schema.make(
      "2026-08-12T10:05:00.000Z",
    ),
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(7n),
  }));
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    false,
    ["sign", "verify"],
  );
  if (!("privateKey" in keyPair) || !("publicKey" in keyPair)) {
    throw new Error("Expected Ed25519 key pair.");
  }
  const signature = new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    copyBytesToArrayBuffer(grant.signingInput),
  ));
  const inertGrant = await runEffect(deriveInertApplicationMutationGrantEvidenceV1(
    assembleApplicationMutationGrantJwsV1(grant, signature),
  ));
  const namespace = createApplicationMutationGrantVerifierNamespaceV1({
    deploymentId: DEPLOYMENT_ID,
    grantRetentionPolicy: RETENTION,
    trustedNowEpochMilliseconds: Effect.succeed(NOW),
    keys: [{
      kid: TransactionGrantKeyIdV1Schema.make("application-key-17"),
      purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
      state: "active",
      issuedAtInclusiveEpochMilliseconds: Date.parse(
        "2026-08-12T00:00:00.000Z",
      ),
      publicKey: keyPair.publicKey,
    }],
  });
  const requestSha256 = Uint8Array.from(
    requestSha256Hex.match(/../g) ?? [],
    pair => Number.parseInt(pair, 16),
  );
  const session = Object.freeze({
    executionAuthorityGeneration: "application_v1" as const,
    lifecycle: "running" as const,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: StorageGenerationFenceSchema.make(3n),
    applicationExecutionAuthorityJson: structuredClone(authority.authorityJson),
    applicationExecutionAuthorityCanonicalBytes:
      new Uint8Array(authority.canonicalBytes),
    applicationExecutionAuthoritySha256: new Uint8Array(authority.sha256),
    functionPath: "recipes:update",
    functionKind: "mutation",
    schemaVersionId: SCHEMA_VERSION_ID,
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicySha256:
      transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
        policy.sha256Hex,
      ),
    validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    validatedArgsCanonicalByteLength: args.canonicalBytes.byteLength,
    validatedArgsSha256: new Uint8Array(args.sha256),
    authorizationGrantId: inertGrant.authorizationGrantId,
    authorizationGrantValueCodecVersion:
      inertGrant.authorizationGrantValueCodecVersion,
    authorizationGrantCanonicalByteLength:
      inertGrant.authorizationGrantCanonicalBytes.byteLength,
    authorizationGrantSha256:
      new Uint8Array(inertGrant.authorizationGrantSha256),
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(7n),
    authorizationGrantExpiresAtMilliseconds: Date.parse(
      inertGrant.authorizationGrantExpiresAt,
    ),
    requestKey: TransactionRequestKeyV1Schema.make("request-application-17"),
    requestSha256,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    hardExpiresAtMilliseconds: Date.parse(inertGrant.authorizationGrantExpiresAt),
    createdAtMilliseconds: NOW - 60_000,
    updatedAtMilliseconds: NOW - 30_000,
  });
  const state = Object.freeze({
    authority: Object.freeze({
      deploymentId: DEPLOYMENT_ID,
      scopeId: SCOPE_ID,
      sessionId: TransactionSessionIdV1Schema.make(
        "00000000-0000-4000-8000-000000000017",
      ),
      attemptFence: TransactionAttemptFenceSchema.make(1n),
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(3n),
      snapshotToken: SnapshotTokenSchema.make({
        scopeId: SCOPE_ID,
        epoch: ScopeEpochSchema.make("epoch-17"),
        commitSeq: CommitSeqSchema.make(1n),
      }),
      schemaVersionId: SCHEMA_VERSION_ID,
    }),
    session,
  });
  const evidence = Object.freeze({
    databaseNowMilliseconds: NOW,
    currentAuthorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(7n),
    session: Object.freeze({
      ...structuredClone(session),
      validatedArgsJson: {},
      validatedArgsCanonicalBytes: new Uint8Array(args.canonicalBytes),
      authorizationGrantJson: structuredClone(inertGrant.authorizationGrantJson),
      authorizationGrantCanonicalBytes:
        new Uint8Array(inertGrant.authorizationGrantCanonicalBytes),
    }),
    schema: Object.freeze({
      deploymentId: DEPLOYMENT_ID,
      schemaVersionId: SCHEMA_VERSION_ID,
      manifest: schemaManifest,
      stableBindings: Object.freeze([Object.freeze({
        logicalName: "recipes",
        tableId: schemaManifest.tableDefinitions.tables[0]!.tableId,
      })]),
    }),
  });
  return Object.freeze({
    state,
    evidence,
    namespace,
    authoritySha256Hex: bytesToHex(authority.sha256),
    legacyKernel: createTransactionGrantVerificationKernelV1({
      deploymentId: DEPLOYMENT_ID,
      keysById: new Map(),
      grantRetentionPolicy: RETENTION,
    }),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  )));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

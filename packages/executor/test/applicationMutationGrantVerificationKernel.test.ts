import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import type { GrantRetentionPolicyV1 } from
  "flarex-protocol/grant-retention-policy";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  assembleApplicationMutationGrantJwsV1,
  prepareApplicationMutationGrantV1,
  type ApplicationMutationGrantVerificationKeyV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import {
  ReplacementScopeIdV1Schema,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantTimestampV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
} from "flarex-protocol/transaction-grant";
import {
  CatalogSchemaVersionIdSchema,
} from "flarex-protocol/schema-manifest";
import {
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { FlarexValueCodecVersionSchema } from "flarex-protocol/value";

import {
  createApplicationMutationGrantVerificationKernelV1,
  type ExpectedApplicationMutationGrantLogicalPinsV1,
} from "../src/applicationMutationGrantVerificationKernel";
import { runEffect } from "./effectTestRuntime";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment-cooking",
);
const KEY_ID = TransactionGrantKeyIdV1Schema.make("application-grant-key-1");
const NOW = Date.parse("2026-08-12T10:01:00.000Z");

describe("Application Mutation Grant verification kernel", () => {
  it("uses the supplied database time and returns detached inert evidence", async () => {
    const fixture = await signedFixture();
    const kernel = createKernel(fixture.key);
    const inspection = await runEffect(kernel.verify({
      jws: fixture.jws,
      expectedLogicalPins: fixture.expectedPins,
      trustedNowEpochMilliseconds: NOW,
    }));

    expect(inspection.verifiedAtEpochMilliseconds).toBe(NOW);
    expect(inspection.evidence.payload).toMatchObject(fixture.expectedPins);
    expect(Object.isFrozen(inspection)).toBe(true);
    const firstBytes = inspection.evidence.authorizationGrantCanonicalBytes;
    firstBytes.fill(0);
    expect(inspection.evidence.authorizationGrantCanonicalBytes)
      .not.toEqual(firstBytes);

    await expect(runEffect(kernel.verify({
      jws: fixture.jws,
      expectedLogicalPins: fixture.expectedPins,
      trustedNowEpochMilliseconds: Date.parse(
        "2026-08-12T10:05:00.000Z",
      ),
    }))).rejects.toMatchObject({ issue: { reason: "verificationFailed" } });
  });

  it("snapshots deployment, retention policy, and key configuration", async () => {
    const fixture = await signedFixture();
    const mutablePolicyInput = {
      ...Result.getOrThrow(makeGrantRetentionPolicyV1Result({
        maximumGrantLifetimeMilliseconds: 10 * 60_000,
        maximumFutureIssuedAtSkewMilliseconds: 30_000,
        maximumLiveSnapshotRetentionMilliseconds: 20 * 60_000,
      })),
    };
    const mutablePolicy = mutablePolicyInput as GrantRetentionPolicyV1;
    const mutableKey = { ...fixture.key };
    const mutableConfig = {
      deploymentId: DEPLOYMENT_ID,
      grantRetentionPolicy: mutablePolicy,
      keys: [mutableKey],
    };
    const kernel = createApplicationMutationGrantVerificationKernelV1(
      mutableConfig,
    );
    const replacementPair = await globalThis.crypto.subtle.generateKey(
      "Ed25519",
      false,
      ["sign", "verify"],
    );
    if (!("publicKey" in replacementPair)) {
      throw new Error("Expected an Ed25519 key pair.");
    }
    mutableConfig.deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment-mutated",
    );
    mutablePolicyInput.maximumGrantLifetimeMilliseconds = 1;
    mutableKey.issuedAtInclusiveEpochMilliseconds = NOW + 60_000;
    mutableKey.publicKey = replacementPair.publicKey;

    await expect(runEffect(kernel.verify({
      jws: fixture.jws,
      expectedLogicalPins: fixture.expectedPins,
      trustedNowEpochMilliseconds: NOW,
    }))).resolves.toMatchObject({
      verifiedAtEpochMilliseconds: NOW,
    });
  });

  it("compares every independently supplied logical pin", async () => {
    const fixture = await signedFixture();
    const kernel = createKernel(fixture.key);
    const replacements: {
      readonly [K in keyof ExpectedApplicationMutationGrantLogicalPinsV1]:
        ExpectedApplicationMutationGrantLogicalPinsV1[K];
    } = {
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(
        "deployment-other",
      ),
      scopeId: ReplacementScopeIdV1Schema.make(
        "scope_00000000-0000-0000-0000-000000000099",
      ),
      executionAuthoritySha256: "a".repeat(64),
      activationSequence: "99",
      activeHeadSha256: "b".repeat(64),
      schemaVersionId: CatalogSchemaVersionIdSchema.make("schema-v99"),
      functionPath: "recipes:other",
      functionKind: "mutation",
      policyVersion: TransactionPolicyVersionV1Schema.make(
        "policy_other",
      ),
      identityAccessPolicySha256: "c".repeat(64),
      validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema.make(1),
      validatedArgsSha256: "d".repeat(64),
      requestKey: TransactionRequestKeyV1Schema.make("request-other"),
      requestSha256: "e".repeat(64),
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(99n),
    };
    const fields = Object.keys(replacements) as ReadonlyArray<
      keyof ExpectedApplicationMutationGrantLogicalPinsV1
    >;

    for (const field of fields) {
      if (
        field === "functionKind" ||
        field === "validatedArgsValueCodecVersion"
      ) continue;
      const expected = Object.assign(
        {},
        fixture.expectedPins,
        { [field]: replacements[field] },
      ) as ExpectedApplicationMutationGrantLogicalPinsV1;
      await expect(runEffect(kernel.verify({
        jws: fixture.jws,
        expectedLogicalPins: expected,
        trustedNowEpochMilliseconds: NOW,
      }))).rejects.toMatchObject({
        issue: { reason: "pinMismatch", field },
      });
    }
  });

  it("rejects invalid clocks, malformed evidence, and prepublished keys", async () => {
    const fixture = await signedFixture();
    await expect(runEffect(createKernel(fixture.key).verify({
      jws: fixture.jws,
      expectedLogicalPins: fixture.expectedPins,
      trustedNowEpochMilliseconds: Number.NaN,
    }))).rejects.toMatchObject({ issue: { reason: "invalidClockReading" } });
    await expect(runEffect(createKernel(fixture.key).verify({
      jws: {},
      expectedLogicalPins: fixture.expectedPins,
      trustedNowEpochMilliseconds: NOW,
    }))).rejects.toMatchObject({ issue: { reason: "malformedEvidence" } });
    await expect(runEffect(createKernel({
      kid: KEY_ID,
      purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
      state: "verifyOnly",
      phase: "prepublished",
      publicKey: fixture.key.publicKey,
    }).verify({
      jws: fixture.jws,
      expectedLogicalPins: fixture.expectedPins,
      trustedNowEpochMilliseconds: NOW,
    }))).rejects.toMatchObject({ issue: { reason: "verificationFailed" } });
  });

  it("enforces key windows and grant lifetime at the supplied database time", async () => {
    const fixture = await signedFixture();
    await expect(runEffect(createKernel({
      ...fixture.key,
      verificationEndsAtExclusiveEpochMilliseconds: NOW,
    }).verify({
      jws: fixture.jws,
      expectedLogicalPins: fixture.expectedPins,
      trustedNowEpochMilliseconds: NOW,
    }))).rejects.toMatchObject({ issue: { reason: "verificationFailed" } });
    await expect(runEffect(createKernel({
      ...fixture.key,
      state: "verifyOnly",
      phase: "retired",
      issuedAtExclusiveEpochMilliseconds: NOW - 1,
      verificationEndsAtExclusiveEpochMilliseconds: NOW + 1,
    }).verify({
      jws: fixture.jws,
      expectedLogicalPins: fixture.expectedPins,
      trustedNowEpochMilliseconds: NOW,
    }))).rejects.toMatchObject({ issue: { reason: "verificationFailed" } });
  });
});

function createKernel(key: ApplicationMutationGrantVerificationKeyV1) {
  return createApplicationMutationGrantVerificationKernelV1({
    deploymentId: DEPLOYMENT_ID,
    grantRetentionPolicy: Result.getOrThrow(
      makeGrantRetentionPolicyV1Result({
        maximumGrantLifetimeMilliseconds: 10 * 60_000,
        maximumFutureIssuedAtSkewMilliseconds: 30_000,
        maximumLiveSnapshotRetentionMilliseconds: 20 * 60_000,
      }),
    ),
    keys: [key],
  });
}

async function signedFixture() {
  const authority = await executionAuthority();
  const identityAccessPolicy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion: TransactionPolicyVersionV1Schema.make(
      "policy_point_mutation_v1",
    ),
    auth: { kind: "anonymous" },
    capabilities: [
      "db:get",
      "db:insert",
      "db:patch",
      "db:replace",
      "db:delete",
    ],
  });
  const prepared = await runEffect(prepareApplicationMutationGrantV1({
    kid: KEY_ID,
    grantId: TransactionAuthorizationGrantIdV1Schema.make(
      "grant_application_17",
    ),
    deploymentId: DEPLOYMENT_ID,
    executionAuthority: authority,
    policyVersion: TransactionPolicyVersionV1Schema.make(
      "policy_point_mutation_v1",
    ),
    identityAccessPolicy,
    validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema.make(1),
    validatedArgsSha256: "8".repeat(64),
    requestKey: TransactionRequestKeyV1Schema.make("request-application-17"),
    requestSha256: "9".repeat(64),
    issuedAt: TransactionGrantTimestampV1Schema.make(
      "2026-08-12T10:00:00.000Z",
    ),
    expiresAt: TransactionGrantTimestampV1Schema.make(
      "2026-08-12T10:05:00.000Z",
    ),
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(7n),
  }));
  const keyPair = await globalThis.crypto.subtle.generateKey(
    "Ed25519",
    false,
    ["sign", "verify"],
  );
  if (!("privateKey" in keyPair) || !("publicKey" in keyPair)) {
    throw new Error("Expected an Ed25519 key pair.");
  }
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    copyBytesToArrayBuffer(prepared.signingInput),
  ));
  const key = {
    kid: KEY_ID,
    purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
    state: "active" as const,
    issuedAtInclusiveEpochMilliseconds: Date.parse(
      "2026-08-12T00:00:00.000Z",
    ),
    publicKey: keyPair.publicKey,
  } satisfies ApplicationMutationGrantVerificationKeyV1;
  return {
    key,
    jws: assembleApplicationMutationGrantJwsV1(prepared, signature),
    expectedPins: {
      deploymentId: DEPLOYMENT_ID,
      scopeId: ReplacementScopeIdV1Schema.make(
        authority.authority.runtimeTarget.scopeId,
      ),
      executionAuthoritySha256: hex(authority.sha256),
      activationSequence: authority.authority.activationSequence,
      activeHeadSha256: authority.authority.activeHeadSha256,
      schemaVersionId: CatalogSchemaVersionIdSchema.make(
        authority.authority.schemaVersionId,
      ),
      functionPath: authority.authority.runtimeTarget.function.path,
      functionKind: "mutation",
      policyVersion: prepared.payload.policyVersion,
      identityAccessPolicySha256: identityAccessPolicy.sha256Hex,
      validatedArgsValueCodecVersion: prepared.payload
        .validatedArgsValueCodecVersion,
      validatedArgsSha256: prepared.payload.validatedArgsSha256,
      requestKey: prepared.payload.requestKey,
      requestSha256: prepared.payload.requestSha256,
      authorizationRevocationEpoch:
        prepared.payload.authorizationRevocationEpoch,
    } satisfies ExpectedApplicationMutationGrantLogicalPinsV1,
  };
}

async function executionAuthority() {
  const target = mutationTarget();
  const canonicalTarget = Result.getOrThrow(
    canonicalizeApplicationRuntimeTargetV1(target),
  );
  return runEffect(canonicalizeApplicationMutationExecutionAuthorityV1({
    format: "flarex.application-mutation-execution-authority",
    version: 1,
    runtimeTarget: target,
    runtimeTargetSha256: await sha256Hex(canonicalTarget.canonicalBytes),
    activationSequence: "17",
    activeHeadSha256: "7".repeat(64),
    schemaVersionId: "schema-v17",
  }));
}

function mutationTarget() {
  return {
    format: "flarex.application-runtime-target" as const,
    version: 1 as const,
    scopeId: "scope_00000000-0000-0000-0000-000000000017",
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
      kind: "mutation" as const,
      visibility: "public" as const,
      args: { type: "null" as const },
      returns: { type: "null" as const },
      partition: null,
      entrySha256: "6".repeat(64),
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  ));
  return hex(digest);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

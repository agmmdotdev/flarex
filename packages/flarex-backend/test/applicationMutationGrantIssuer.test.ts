import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  ApplicationMutationGrantVerifierConfigurationV1Error,
  inspectVerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import {
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { FlarexValueCodecVersionSchema } from "flarex-protocol/value";

import {
  ApplicationMutationGrantIssuanceError,
  makeApplicationMutationGrantIssuer,
} from "../src/applicationMutationGrantIssuer";

const NOW = Date.parse("2026-08-13T10:00:00.000Z");
const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment-application-mutation-issuer",
);
const KEY_ID = TransactionGrantKeyIdV1Schema.make(
  "application-mutation-key-1",
);
const RETENTION = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 5 * 60_000,
  maximumFutureIssuedAtSkewMilliseconds: 0,
  maximumLiveSnapshotRetentionMilliseconds: 10 * 60_000,
}));

describe("Application mutation grant issuer", () => {
  it("rejects an invalid verification key before allocating or signing", async () => {
    const keyPair = await crypto.subtle.generateKey(
      "Ed25519",
      false,
      ["sign", "verify"],
    );
    if (!("privateKey" in keyPair)) throw new Error("Expected a private key.");
    let grantIds = 0;
    let signingCalls = 0;

    expect(() => makeApplicationMutationGrantIssuer({
      deploymentId: DEPLOYMENT_ID,
      grantRetentionPolicy: RETENTION,
      signer: {
        kid: KEY_ID,
        publicKey: keyPair.privateKey,
        issuedAtInclusiveEpochMilliseconds: NOW - 60_000,
        sign: () => Effect.sync(() => {
          signingCalls += 1;
          return new Uint8Array(64);
        }),
      },
      runtime: {
        currentTimeMillis: Effect.succeed(NOW),
        nextGrantId: Effect.sync(() => {
          grantIds += 1;
          return TransactionAuthorizationGrantIdV1Schema.make(
            "grant_application_mutation_issuer_invalid",
          );
        }),
      },
    })).toThrow(ApplicationMutationGrantVerifierConfigurationV1Error);
    expect(grantIds).toBe(0);
    expect(signingCalls).toBe(0);
  });

  it("signs and verifies every Application authority pin with owned policy", async () => {
    const keyPair = await crypto.subtle.generateKey(
      "Ed25519",
      false,
      ["sign", "verify"],
    );
    if (!("privateKey" in keyPair) || !("publicKey" in keyPair)) {
      throw new Error("Expected an Ed25519 key pair.");
    }
    let signingCalls = 0;
    const issuer = makeApplicationMutationGrantIssuer({
      deploymentId: DEPLOYMENT_ID,
      grantRetentionPolicy: RETENTION,
      signer: {
        kid: KEY_ID,
        publicKey: keyPair.publicKey,
        issuedAtInclusiveEpochMilliseconds: NOW - 60_000,
        verificationEndsAtExclusiveEpochMilliseconds: NOW + 120_000,
        sign: bytes => Effect.promise(async () => {
          signingCalls += 1;
          return new Uint8Array(await crypto.subtle.sign(
            "Ed25519",
            keyPair.privateKey,
            copyBytesToArrayBuffer(bytes),
          ));
        }),
      },
      runtime: {
        currentTimeMillis: Effect.succeed(NOW),
        nextGrantId: Effect.succeed(
          TransactionAuthorizationGrantIdV1Schema.make(
            "grant_application_mutation_issuer_1",
          ),
        ),
      },
    });
    const executionAuthority = await applicationExecutionAuthority();
    const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });

    const verified = await Effect.runPromise(issuer.issue({
      deploymentId: DEPLOYMENT_ID,
      executionAuthority,
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      identityAccessPolicy: policy,
      validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema.make(1),
      validatedArgsSha256: "8".repeat(64),
      requestKey: TransactionRequestKeyV1Schema.make(
        "request-application-mutation-issuer-1",
      ),
      requestSha256: "9".repeat(64),
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(7n),
    }));
    const evidence = inspectVerifiedApplicationMutationGrantV1(verified);

    expect(signingCalls).toBe(1);
    expect(evidence.protectedHeader.kid).toBe(KEY_ID);
    expect(evidence.payload).toMatchObject({
      deploymentId: DEPLOYMENT_ID,
      scopeId: executionAuthority.authority.runtimeTarget.scopeId,
      executionAuthoritySha256: encodeBytesToLowercaseHex(
        executionAuthority.sha256,
      ),
      activationSequence: "17",
      activeHeadSha256: "7".repeat(64),
      schemaVersionId: "schema-application-17",
      functionPath: "recipes:update",
      functionKind: "mutation",
      issuedAt: "2026-08-13T10:00:00.000Z",
      expiresAt: "2026-08-13T10:02:00.000Z",
    });
  });

  it("fails before signing when the active key has no remaining lifetime", async () => {
    const keyPair = await crypto.subtle.generateKey(
      "Ed25519",
      false,
      ["sign", "verify"],
    );
    if (!("publicKey" in keyPair)) throw new Error("Expected a public key.");
    let signed = false;
    const issuer = makeApplicationMutationGrantIssuer({
      deploymentId: DEPLOYMENT_ID,
      grantRetentionPolicy: RETENTION,
      signer: {
        kid: KEY_ID,
        publicKey: keyPair.publicKey,
        issuedAtInclusiveEpochMilliseconds: NOW - 60_000,
        verificationEndsAtExclusiveEpochMilliseconds: NOW,
        sign: () => Effect.sync(() => {
          signed = true;
          return new Uint8Array(64);
        }),
      },
      runtime: {
        currentTimeMillis: Effect.succeed(NOW),
        nextGrantId: Effect.succeed(
          TransactionAuthorizationGrantIdV1Schema.make(
            "grant_application_mutation_issuer_2",
          ),
        ),
      },
    });
    const executionAuthority = await applicationExecutionAuthority();
    const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });
    const result = await Effect.runPromise(issuer.issue({
      deploymentId: DEPLOYMENT_ID,
      executionAuthority,
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      identityAccessPolicy: policy,
      validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema.make(1),
      validatedArgsSha256: "8".repeat(64),
      requestKey: TransactionRequestKeyV1Schema.make(
        "request-application-mutation-issuer-2",
      ),
      requestSha256: "9".repeat(64),
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(7n),
    }).pipe(Effect.result));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toEqual(new ApplicationMutationGrantIssuanceError({
        reason: "lifetimeExhausted",
      }));
    }
    expect(signed).toBe(false);
  });
});

async function applicationExecutionAuthority() {
  const runtimeTarget = {
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
      args: { type: "any" as const },
      returns: null,
      partition: null,
      entrySha256: "6".repeat(64),
    },
  };
  const canonicalTarget = Result.getOrThrow(
    canonicalizeApplicationRuntimeTargetV1(runtimeTarget),
  );
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(canonicalTarget.canonicalBytes),
  ));
  const runtimeTargetSha256 = Array.from(
    digest,
    byte => byte.toString(16).padStart(2, "0"),
  ).join("");
  return Effect.runPromise(canonicalizeApplicationMutationExecutionAuthorityV1({
    format: "flarex.application-mutation-execution-authority",
    version: 1,
    runtimeTarget,
    runtimeTargetSha256,
    activationSequence: "17",
    activeHeadSha256: "7".repeat(64),
    schemaVersionId: "schema-application-17",
  }));
}

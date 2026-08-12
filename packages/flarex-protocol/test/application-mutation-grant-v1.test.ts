import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { makeGrantRetentionPolicyV1Result } from
  "../src/grant-retention-policy";

import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  assembleApplicationMutationGrantJwsV1,
  createApplicationMutationGrantVerifierNamespaceV1,
  deriveInertApplicationMutationGrantEvidenceV1,
  inspectVerifiedApplicationMutationGrantV1,
  prepareApplicationMutationGrantV1,
  verifyApplicationMutationGrantV1,
} from "../src/application-mutation-grant-v1";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "../src/application-mutation-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from "../src/application-runtime-target-v1";
import {
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  deriveInertTransactionGrantEvidenceV1Effect,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantTimestampV1Schema,
} from "../src/transaction-grant";
import {
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
} from "../src/transaction-session";
import { FlarexValueCodecVersionSchema } from "../src/value";

describe("ApplicationMutationGrantV1", () => {
  it("pins a distinct canonical signing input and rejects legacy decoding", async () => {
    const prepared = await prepareGrant();
    const jws = assembleApplicationMutationGrantJwsV1(
      prepared,
      new Uint8Array(64).fill(0x5a),
    );

    expect(prepared.protectedHeader).toEqual({
      alg: "Ed25519",
      kid: "application-grant-key-1",
      typ: "flarex-application-mutation-grant+jws",
    });
    expect(new TextDecoder().decode(prepared.signingInput))
      .toMatchInlineSnapshot(`"eyJhbGciOiJFZDI1NTE5Iiwia2lkIjoiYXBwbGljYXRpb24tZ3JhbnQta2V5LTEiLCJ0eXAiOiJmbGFyZXgtYXBwbGljYXRpb24tbXV0YXRpb24tZ3JhbnQrandzIn0.eyJmb3JtYXQiOiJmbGFyZXgtdmFsdWUiLCJ2YWx1ZSI6eyJhY3RpdmF0aW9uU2VxdWVuY2UiOiIxNyIsImFjdGl2ZUhlYWRTaGEyNTYiOiI3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3IiwiYXV0aCI6eyJraW5kIjoiYW5vbnltb3VzIn0sImF1dGhvcml6YXRpb25SZXZvY2F0aW9uRXBvY2giOiI3IiwiY2FwYWJpbGl0aWVzIjpbImRiOmdldCIsImRiOmluc2VydCIsImRiOnBhdGNoIiwiZGI6cmVwbGFjZSIsImRiOmRlbGV0ZSJdLCJkZXBsb3ltZW50SWQiOiJkZXBsb3ltZW50LWNvb2tpbmciLCJleGVjdXRpb25BdXRob3JpdHlTaGEyNTYiOiIyYzQzM2E1ZWQ4OWU3NDcxMjI5OGQ0ZWViZTVhZmZkNjY3OThmYTA3MTQyY2FhMGMwOTVkY2ZhNjliYWZlMmVhIiwiZXhwaXJlc0F0IjoiMjAyNi0wOC0xMlQxMDowNTowMC4wMDBaIiwiZm9ybWF0IjoiZmxhcmV4LmFwcGxpY2F0aW9uLW11dGF0aW9uLWdyYW50IiwiZnVuY3Rpb25LaW5kIjoibXV0YXRpb24iLCJmdW5jdGlvblBhdGgiOiJyZWNpcGVzOnVwZGF0ZSIsImdyYW50SWQiOiJncmFudF9hcHBsaWNhdGlvbl8xNyIsImlkZW50aXR5QWNjZXNzUG9saWN5U2hhMjU2IjoiNjEzZWQ1NTRkMDVmOGIwN2I2YjFlODQ4YTM1YmQ5OWNlMTFlZWQxMzA3NDViYWY3YjBmM2QwODJkYmJkZjkxMyIsImlzc3VlZEF0IjoiMjAyNi0wOC0xMlQxMDowMDowMC4wMDBaIiwicG9saWN5VmVyc2lvbiI6InBvbGljeV9wb2ludF9tdXRhdGlvbl92MSIsInJlcXVlc3RLZXkiOiJyZXF1ZXN0LWFwcGxpY2F0aW9uLTE3IiwicmVxdWVzdFNoYTI1NiI6Ijk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTkiLCJzY2hlbWFWZXJzaW9uSWQiOiJzY2hlbWEtdjE3Iiwic2NvcGVJZCI6InNjb3BlXzAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAxNyIsInZhbGlkYXRlZEFyZ3NTaGEyNTYiOiI4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4IiwidmFsaWRhdGVkQXJnc1ZhbHVlQ29kZWNWZXJzaW9uIjoxLCJ2ZXJzaW9uIjoxfSwidmFsdWVDb2RlY1ZlcnNpb24iOjF9"`);
    expect(jws).toMatchInlineSnapshot(`
      {
        "payload": "eyJmb3JtYXQiOiJmbGFyZXgtdmFsdWUiLCJ2YWx1ZSI6eyJhY3RpdmF0aW9uU2VxdWVuY2UiOiIxNyIsImFjdGl2ZUhlYWRTaGEyNTYiOiI3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3IiwiYXV0aCI6eyJraW5kIjoiYW5vbnltb3VzIn0sImF1dGhvcml6YXRpb25SZXZvY2F0aW9uRXBvY2giOiI3IiwiY2FwYWJpbGl0aWVzIjpbImRiOmdldCIsImRiOmluc2VydCIsImRiOnBhdGNoIiwiZGI6cmVwbGFjZSIsImRiOmRlbGV0ZSJdLCJkZXBsb3ltZW50SWQiOiJkZXBsb3ltZW50LWNvb2tpbmciLCJleGVjdXRpb25BdXRob3JpdHlTaGEyNTYiOiIyYzQzM2E1ZWQ4OWU3NDcxMjI5OGQ0ZWViZTVhZmZkNjY3OThmYTA3MTQyY2FhMGMwOTVkY2ZhNjliYWZlMmVhIiwiZXhwaXJlc0F0IjoiMjAyNi0wOC0xMlQxMDowNTowMC4wMDBaIiwiZm9ybWF0IjoiZmxhcmV4LmFwcGxpY2F0aW9uLW11dGF0aW9uLWdyYW50IiwiZnVuY3Rpb25LaW5kIjoibXV0YXRpb24iLCJmdW5jdGlvblBhdGgiOiJyZWNpcGVzOnVwZGF0ZSIsImdyYW50SWQiOiJncmFudF9hcHBsaWNhdGlvbl8xNyIsImlkZW50aXR5QWNjZXNzUG9saWN5U2hhMjU2IjoiNjEzZWQ1NTRkMDVmOGIwN2I2YjFlODQ4YTM1YmQ5OWNlMTFlZWQxMzA3NDViYWY3YjBmM2QwODJkYmJkZjkxMyIsImlzc3VlZEF0IjoiMjAyNi0wOC0xMlQxMDowMDowMC4wMDBaIiwicG9saWN5VmVyc2lvbiI6InBvbGljeV9wb2ludF9tdXRhdGlvbl92MSIsInJlcXVlc3RLZXkiOiJyZXF1ZXN0LWFwcGxpY2F0aW9uLTE3IiwicmVxdWVzdFNoYTI1NiI6Ijk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTkiLCJzY2hlbWFWZXJzaW9uSWQiOiJzY2hlbWEtdjE3Iiwic2NvcGVJZCI6InNjb3BlXzAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAxNyIsInZhbGlkYXRlZEFyZ3NTaGEyNTYiOiI4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4IiwidmFsaWRhdGVkQXJnc1ZhbHVlQ29kZWNWZXJzaW9uIjoxLCJ2ZXJzaW9uIjoxfSwidmFsdWVDb2RlY1ZlcnNpb24iOjF9",
        "protected": "eyJhbGciOiJFZDI1NTE5Iiwia2lkIjoiYXBwbGljYXRpb24tZ3JhbnQta2V5LTEiLCJ0eXAiOiJmbGFyZXgtYXBwbGljYXRpb24tbXV0YXRpb24tZ3JhbnQrandzIn0",
        "signature": "WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWg",
      }
    `);

    const legacy = await Effect.runPromise(
      deriveInertTransactionGrantEvidenceV1Effect(jws).pipe(Effect.result),
    );
    expect(Result.isFailure(legacy)).toBe(true);
    const decoded = await Effect.runPromise(
      deriveInertApplicationMutationGrantEvidenceV1(jws),
    );
    expect(decoded.payload.executionAuthoritySha256).toBe(
      prepared.payload.executionAuthoritySha256,
    );
    const signed = await signedGrant(prepared);
    const verified = await Effect.runPromise(verifyApplicationMutationGrantV1(
      signed.jws,
      signed.namespace,
    ));
    expect(inspectVerifiedApplicationMutationGrantV1(verified).jws)
      .toEqual(signed.jws);
    expect(() => inspectVerifiedApplicationMutationGrantV1({ ...verified }))
      .toThrow();
  });

  it("rejects inverted time and non-Ed25519 signature length", async () => {
    const input = await grantInput();
    const invalidTime = await Effect.runPromise(
      prepareApplicationMutationGrantV1({
        ...input,
        expiresAt: input.issuedAt,
      }).pipe(Effect.result),
    );
    expect(Result.isFailure(invalidTime)).toBe(true);
    if (Result.isFailure(invalidTime)) {
      expect(invalidTime.failure.reason).toBe("invalidTimeRange");
    }

    const prepared = await prepareGrant();
    expect(() => assembleApplicationMutationGrantJwsV1(
      prepared,
      new Uint8Array(63),
    )).toThrow();
    const signed = await signedGrant(prepared);
    const tamperedSignature = new Uint8Array(64);
    const rejectedSignature = await Effect.runPromise(
      verifyApplicationMutationGrantV1(
        assembleApplicationMutationGrantJwsV1(
          prepared,
          tamperedSignature,
        ),
        signed.namespace,
      ).pipe(Effect.result),
    );
    expect(Result.isFailure(rejectedSignature)).toBe(true);
  });

  it.each([
    ["issued in future", "2026-08-12T10:02:00.000Z", "2026-08-12T10:05:00.000Z"],
    ["expired", "2026-08-12T09:50:00.000Z", "2026-08-12T10:00:00.000Z"],
    ["lifetime exceeded", "2026-08-12T10:00:00.000Z", "2026-08-12T10:11:00.000Z"],
  ])("rejects %s grants", async (_case, issuedAt, expiresAt) => {
    const prepared = await Effect.runPromise(prepareApplicationMutationGrantV1({
      ...(await grantInput()),
      issuedAt: TransactionGrantTimestampV1Schema.make(issuedAt),
      expiresAt: TransactionGrantTimestampV1Schema.make(expiresAt),
    }));
    const signed = await signedGrant(prepared);
    const result = await Effect.runPromise(
      verifyApplicationMutationGrantV1(signed.jws, signed.namespace).pipe(
        Effect.result,
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
  });

  it.each(["prepublished", "retired"] as const)(
    "rejects %s key windows",
    async phase => {
      const prepared = await prepareGrant();
      const signed = await signedGrant(prepared, phase);
      const result = await Effect.runPromise(
        verifyApplicationMutationGrantV1(signed.jws, signed.namespace).pipe(
          Effect.result,
        ),
      );
      expect(Result.isFailure(result)).toBe(true);
    },
  );
});

async function prepareGrant() {
  return Effect.runPromise(prepareApplicationMutationGrantV1(
    await grantInput(),
  ));
}

async function signedGrant(
  prepared: Awaited<ReturnType<typeof prepareGrant>>,
  phase?: "prepublished" | "retired",
) {
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
  return {
    jws: assembleApplicationMutationGrantJwsV1(prepared, signature),
    namespace: createApplicationMutationGrantVerifierNamespaceV1({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(
        "deployment-cooking",
      ),
      grantRetentionPolicy: Result.getOrThrow(
        makeGrantRetentionPolicyV1Result({
          maximumGrantLifetimeMilliseconds: 10 * 60_000,
          maximumFutureIssuedAtSkewMilliseconds: 30_000,
          maximumLiveSnapshotRetentionMilliseconds: 20 * 60_000,
        }),
      ),
      trustedNowEpochMilliseconds: Effect.succeed(Date.parse(
        "2026-08-12T10:01:00.000Z",
      )),
      keys: [phase === "prepublished" ? {
        kid: TransactionGrantKeyIdV1Schema.make("application-grant-key-1"),
        purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
        state: "verifyOnly",
        phase,
        publicKey: keyPair.publicKey,
      } : phase === "retired" ? {
        kid: TransactionGrantKeyIdV1Schema.make("application-grant-key-1"),
        purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
        state: "verifyOnly",
        phase,
        issuedAtInclusiveEpochMilliseconds: Date.parse(
          "2026-08-12T00:00:00.000Z",
        ),
        issuedAtExclusiveEpochMilliseconds: Date.parse(
          "2026-08-12T10:00:00.000Z",
        ),
        verificationEndsAtExclusiveEpochMilliseconds: Date.parse(
          "2026-08-12T10:00:30.000Z",
        ),
        publicKey: keyPair.publicKey,
      } : {
        kid: TransactionGrantKeyIdV1Schema.make("application-grant-key-1"),
        purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
        state: "active",
        issuedAtInclusiveEpochMilliseconds: Date.parse(
          "2026-08-12T00:00:00.000Z",
        ),
        publicKey: keyPair.publicKey,
      }],
    }),
  };
}

async function grantInput() {
  const runtimeTarget = mutationTarget();
  const canonicalTarget = Result.getOrThrow(
    canonicalizeApplicationRuntimeTargetV1(runtimeTarget),
  );
  const executionAuthority = await Effect.runPromise(
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget,
      runtimeTargetSha256: await sha256Hex(canonicalTarget.canonicalBytes),
      activationSequence: "17",
      activeHeadSha256: "7".repeat(64),
      schemaVersionId: "schema-v17",
    }),
  );
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
  return {
    kid: TransactionGrantKeyIdV1Schema.make("application-grant-key-1"),
    grantId: TransactionAuthorizationGrantIdV1Schema.make(
      "grant_application_17",
    ),
    deploymentId: TransactionGrantDeploymentIdV1Schema.make(
      "deployment-cooking",
    ),
    executionAuthority,
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
  };
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
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

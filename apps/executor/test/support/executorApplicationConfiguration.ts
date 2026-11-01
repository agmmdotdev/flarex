import { applicationHostPolicy } from "./applicationDOHostPolicy";
import { Encoding } from "effect";

/** Shared configuration witness; production composition requires operator-supplied values. */
export function executorApplicationProfileFixture() {
  return {
    kind: "fresh_core_application" as const,
    deploymentId: "deployment_configured_core_application",
    scopeUuid: "46000000-0000-4000-8000-000000000001",
    epochUuid: "46000000-0000-4000-8000-000000000002",
    canonicalName: "application:configured-core",
    persistenceNamespace: "configured_core",
    instanceName: "configured-core-instance",
    sourceArtifactRootSha256: "01".repeat(32),
    sourcePackageHash: "02".repeat(32),
    compatibilityDate: "2026-06-14",
    generation: 1,
    anchorFunctionPath: "users:read",
    analyzerIdentity: "03".repeat(32),
    analyzerPolicyIdentity: "configured-analysis-policy",
    keyId: "configured-core-key",
    maximumAttempts: 3,
    maximumRegistrationSteps: 64,
    http: { maximumRequestBytes: 2_097_152, maximumResponseBytes: 2_097_152, maximumRegistrationRequestBytes: 16_384 },
    grantRetentionPolicy: { maximumGrantLifetimeMilliseconds: 120_000,
      maximumFutureIssuedAtSkewMilliseconds: 30_000, maximumLiveSnapshotRetentionMilliseconds: 600_000 },
    hostPolicy: applicationHostPolicy(),
    workload: {
      schemaWorker: { documentBytes: 1_048_576, documentCount: 8, maxMetadataEntries: 4096,
        logPageSize: 16, maxLogPagesPerStep: 1, physicalChunkSize: 8, physicalConcurrency: 2 },
      schemaScheduler: { work: { pageSize: 8, maxPages: 4 }, wakeDelayMilliseconds: 25, continuationDelayMilliseconds: 25 },
      indexCache: { maxBytes: 2 * 1024 * 1024, verifyPercent: 100 }, operationCacheMaxBytes: 1024 * 1024,
      admission: { query: { maxActive: 2, maxQueued: 2, waitMilliseconds: 5_000 },
        mutation: { maxActive: 1, maxQueued: 2, waitMilliseconds: 5_000 }, maxPendingCallbacks: 128, maxOpenQueries: 128 },
      maxRequests: 8,
    },
  };
}

export function executorApplicationConfigurationFixture() {
  const profile = executorApplicationProfileFixture();
  return {
    profile,
    FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile] }),
    FLAREX_APPLICATION_KEYS: JSON.stringify({ version: 1, keys: [{ keyId: profile.keyId,
      privateKeyPkcs8: "AQ==", publicKeySpki: "Ag==", queryCursorSecret: "Aw==", issuedAtInclusiveEpochMilliseconds: 0 }] }),
  };
}

export async function createExecutorApplicationSecretFixture(keyId: string) {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  if (!("privateKey" in pair)) throw new Error("Expected an Ed25519 key pair.");
  return JSON.stringify({ version: 1, keys: [{ keyId,
    privateKeyPkcs8: Encoding.encodeBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))),
    publicKeySpki: Encoding.encodeBase64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey))),
    queryCursorSecret: Encoding.encodeBase64(crypto.getRandomValues(new Uint8Array(32))), issuedAtInclusiveEpochMilliseconds: 0,
  }] });
}

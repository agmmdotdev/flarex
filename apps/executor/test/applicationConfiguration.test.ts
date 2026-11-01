import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { readExecutorApplicationKey, readExecutorApplicationProfiles, readExecutorApplicationRegistry, resolveExecutorApplicationProfile,
  resolveExecutorLegacyApplicationProfile } from "../src/applicationConfiguration";
import { executorApplicationConfigurationFixture, executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

describe("configured Core Application routes", () => {
  it("captures an operator profile without making it an installed profile", () => {
    const fixture = executorApplicationConfigurationFixture();
    const profile = Result.getOrThrow(resolveExecutorApplicationProfile(fixture, fixture.profile.deploymentId));
    expect(profile.scopeUuid).toBe(fixture.profile.scopeUuid);
    expect("sourcePackageHash" in profile).toBe(false);
    expect("sourceArtifactRootSha256" in profile).toBe(false);
    expect(profile.workload.indexCache.verifyPercent).toBe(100);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(profile).not.toHaveProperty("privateKeyPkcs8");
  });

  it.each(["deploymentId", "scopeUuid", "canonicalName", "instanceName"] as const)(
    "refuses two profiles sharing %s before routing",
    field => {
      const first = executorApplicationProfileFixture();
      const second = { ...first, deploymentId: "deployment_other_core_application",
        scopeUuid: "46000000-0000-4000-8000-000000000003", canonicalName: "application:other-core",
        instanceName: "other-core-instance", [field]: first[field] };
      const outcome = readExecutorApplicationProfiles({
        FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [first, second] }),
      });
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isSuccess(outcome)) throw new Error("Expected ambiguous route refusal.");
      expect(outcome.failure.reason).toBe("duplicateProfile");
    },
  );

  it("refuses incomplete workload and unsupported policy before a namespace is used", () => {
    const profile = executorApplicationProfileFixture();
    for (const invalid of [
      { ...profile, workload: { ...profile.workload, maxRequests: 0 } },
      { ...profile, hostPolicy: { ...profile.hostPolicy, allowRunAction: true } },
      { ...profile, generation: 0 },
      { ...profile, kind: "legacy" },
      { ...profile, sourceUpload: { ...profile.sourceUpload, blockSizeBytes: profile.sourceUpload.admission.blockBytes + 1 } },
      { ...profile, sourceArtifactRootSha256: "aa".repeat(32) },
      { ...profile, sourcePackageHash: "aa".repeat(32) },
      { ...profile, anchorFunctionPath: "users:get" },
    ]) {
      const outcome = readExecutorApplicationProfiles({
        FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [invalid] }),
      });
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isSuccess(outcome)) throw new Error("Expected invalid operator configuration refusal.");
      expect(outcome.failure.reason).toBe("invalidProfiles");
    }
  });

  it("distinguishes an explicitly absent Core route from invalid configuration", () => {
    const absent = resolveExecutorApplicationProfile({ FLAREX_APPLICATION_PROFILES: '{"version":1,"profiles":[]}' }, "deployment_unknown");
    expect(Result.isFailure(absent)).toBe(true);
    if (Result.isSuccess(absent)) throw new Error("Expected absent route refusal.");
    expect(absent.failure.reason).toBe("unsupportedDeployment");
    const invalid = resolveExecutorApplicationProfile({}, "deployment_unknown");
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isSuccess(invalid)) throw new Error("Expected missing configuration refusal.");
    expect(invalid.failure.reason).toBe("invalidProfiles");
  });

  it("selects stable configured key material and refuses missing or duplicate keys", () => {
    const fixture = executorApplicationConfigurationFixture();
    const first = Result.getOrThrow(readExecutorApplicationKey(fixture, fixture.profile.keyId));
    expect(Result.getOrThrow(readExecutorApplicationKey(fixture, fixture.profile.keyId))).toEqual(first);
    const missing = readExecutorApplicationKey(fixture, "another-key");
    expect(Result.isFailure(missing)).toBe(true);
    if (Result.isSuccess(missing)) throw new Error("Expected missing key refusal.");
    expect(missing.failure.reason).toBe("missingKey");
    const duplicate = readExecutorApplicationKey({ FLAREX_APPLICATION_KEYS: JSON.stringify({ version: 1, keys: [first, first] }) }, first.keyId);
    expect(Result.isFailure(duplicate)).toBe(true);
    if (Result.isSuccess(duplicate)) throw new Error("Expected ambiguous key refusal.");
    expect(duplicate.failure.reason).toBe("invalidKeys");
  });

  it("requires explicit legacy admission and refuses ambiguous mode declarations", () => {
    const profile = executorApplicationProfileFixture();
    const absent = resolveExecutorLegacyApplicationProfile({ FLAREX_APPLICATION_PROFILES: '{"version":1,"profiles":[]}' }, profile.deploymentId);
    expect(Result.isFailure(absent)).toBe(true);
    const env = { FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [],
      maximumLegacyRequestBytes: 4096, legacyProfiles: [{ kind: "legacy_session", deploymentId: profile.deploymentId }] }) };
    expect(Result.getOrThrow(resolveExecutorLegacyApplicationProfile(env, profile.deploymentId)).kind).toBe("legacy_session");
    const ambiguous = readExecutorApplicationProfiles({ FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile],
      maximumLegacyRequestBytes: 4096, legacyProfiles: [{ kind: "legacy_session", deploymentId: profile.deploymentId }] }) });
    expect(Result.isFailure(ambiguous)).toBe(true);
    if (Result.isSuccess(ambiguous)) throw new Error("Expected conflicting mode refusal.");
    expect(ambiguous.failure.reason).toBe("duplicateProfile");
  });

  it("requires and captures an explicit host body budget for named legacy profiles", () => {
    const registry = { version: 1, profiles: [], legacyProfiles: [{ kind: "legacy_session", deploymentId: "legacy_budget" }] };
    for (const maximumLegacyRequestBytes of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const result = readExecutorApplicationRegistry({ FLAREX_APPLICATION_PROFILES: JSON.stringify({ ...registry, maximumLegacyRequestBytes }) });
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isSuccess(result)) throw new Error("Expected an explicit bounded legacy routing policy.");
      expect(result.failure.reason).toBe("invalidProfiles");
    }
    const captured = Result.getOrThrow(readExecutorApplicationRegistry({ FLAREX_APPLICATION_PROFILES:
      JSON.stringify({ ...registry, maximumLegacyRequestBytes: 4096 }) }));
    expect(captured.maximumLegacyRequestBytes).toBe(4096);
    expect(Result.isSuccess(readExecutorApplicationRegistry({ FLAREX_APPLICATION_PROFILES: '{"version":1,"profiles":[]}' }))).toBe(true);
  });
});

import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CatalogTableIdSchema } from "../src/catalog";
import {
  MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1,
  MAX_SCOPE_SYNC_QUERY_TEXT_UTF8_BYTES_V1,
  SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
  SCOPE_SYNC_CURSOR_FORMAT_V1,
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
  ScopeSyncCanonicalQueryIdentityV1Schema,
  ScopeSyncDependencyKeySetV1Schema,
  ScopeSyncQueryGenerationV1Schema,
  captureScopeSyncDependencyKeyV1,
  decodeScopeSyncCanonicalQueryIdentityV1Result,
  decodeScopeSyncDependencyKeySetV1Result,
  decodeScopeSyncQueryGenerationV1Result,
  normalizeScopeSyncDependencyKeySetV1Result,
  type ScopeSyncDependencyKeyV1,
} from "../src/scope-sync-v1";
import {
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "../src/storage-authority";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000001",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000002",
);

describe("scope sync query generation v1 protocol", () => {
  it("strictly decodes and owns every canonical query identity pin", () => {
    const decoded = Result.getOrThrow(
      decodeScopeSyncCanonicalQueryIdentityV1Result(rawIdentity()),
    );

    expect(decoded).toEqual({
      ...rawIdentity(),
      activationSequence: 3n,
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Schema.encodeSync(ScopeSyncCanonicalQueryIdentityV1Schema)(decoded))
      .toEqual(rawIdentity());
  });

  it("strictly decodes owned provisional and active generations", () => {
    const provisional = Result.getOrThrow(
      decodeScopeSyncQueryGenerationV1Result({
        format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        phase: "provisional",
        identity: rawIdentity(),
        generation: "9007199254740993",
        registeredAtCursor: rawCursor("5"),
      }),
    );
    const active = Result.getOrThrow(decodeScopeSyncQueryGenerationV1Result({
      format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      phase: "active",
      identity: rawIdentity(),
      generation: "9007199254740993",
      snapshotCommitSeq: "6",
      refreshedThroughCursor: rawCursor("7"),
      dependencies: [rawTableKey(1), rawTableKey(2)],
      resultSha256Hex: "44".repeat(32),
    }));

    expect(provisional.generation).toBe(9_007_199_254_740_993n);
    expect(active.phase).toBe("active");
    if (active.phase !== "active") throw new Error("Expected active state.");
    expect(active.dependencies).toHaveLength(2);
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active.identity)).toBe(true);
    expect(Object.isFrozen(active.refreshedThroughCursor)).toBe(true);
    expect(Object.isFrozen(active.dependencies)).toBe(true);
    expect(active.dependencies.every(Object.isFrozen)).toBe(true);
    expect(Schema.encodeSync(ScopeSyncQueryGenerationV1Schema)(active))
      .toEqual({
        format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        phase: "active",
        identity: rawIdentity(),
        generation: "9007199254740993",
        snapshotCommitSeq: "6",
        refreshedThroughCursor: rawCursor("7"),
        dependencies: [rawTableKey(1), rawTableKey(2)],
        resultSha256Hex: "44".repeat(32),
      });
  });

  it("normalizes dependency keys into an owned sorted unique set", () => {
    const first = tableKey(1);
    const second = tableKey(2);
    const source = [second, first, second];
    const normalized = Result.getOrThrow(
      normalizeScopeSyncDependencyKeySetV1Result(source),
    );

    source[0] = first;
    expect(normalized).toEqual([first, second]);
    expect(normalized).not.toBe(source);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(normalized.every(Object.isFrozen)).toBe(true);
    expect(Schema.encodeSync(ScopeSyncDependencyKeySetV1Schema)(normalized))
      .toEqual([rawTableKey(1), rawTableKey(2)]);
  });

  it("rejects a dependency set beyond the admitted logical-read budget", () => {
    const keys = Array.from(
      { length: MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1 + 1 },
      (_, index) => tableKey(index + 1),
    );
    const failure = expectFailure(
      normalizeScopeSyncDependencyKeySetV1Result(keys),
    );

    expect(failure).toMatchObject({
      _tag: "ScopeSyncDependencyKeySetV1Error",
      maximumKeys: MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1,
      observedKeys: MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1 + 1,
    });
  });

  it.each([
    ["identity unknown field", () => Result.isFailure(
      decodeScopeSyncCanonicalQueryIdentityV1Result({
      ...rawIdentity(),
      unexpected: true,
      }),
    )],
    ["identity malformed hash", () => Result.isFailure(
      decodeScopeSyncCanonicalQueryIdentityV1Result({
      ...rawIdentity(),
      argumentsSha256Hex: "not-a-hash",
      }),
    )],
    ["identity blank function", () => Result.isFailure(
      decodeScopeSyncCanonicalQueryIdentityV1Result({
      ...rawIdentity(),
      functionPath: " ",
      }),
    )],
    ["identity NUL function", () => Result.isFailure(
      decodeScopeSyncCanonicalQueryIdentityV1Result({
        ...rawIdentity(),
        functionPath: "users:\0list",
      }),
    )],
    ["identity malformed Unicode policy", () => Result.isFailure(
      decodeScopeSyncCanonicalQueryIdentityV1Result({
        ...rawIdentity(),
        policyVersion: "policy_\ud800",
      }),
    )],
    ["identity oversized multibyte schema version", () => Result.isFailure(
      decodeScopeSyncCanonicalQueryIdentityV1Result({
        ...rawIdentity(),
        schemaVersionId: "\u00e9".repeat(
          Math.floor(MAX_SCOPE_SYNC_QUERY_TEXT_UTF8_BYTES_V1 / 2) + 1,
        ),
      }),
    )],
    ["generation zero", () => Result.isFailure(
      decodeScopeSyncQueryGenerationV1Result({
      format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      phase: "provisional",
      identity: rawIdentity(),
      generation: "0",
      registeredAtCursor: rawCursor("5"),
      }),
    )],
    ["generation unknown field", () => Result.isFailure(
      decodeScopeSyncQueryGenerationV1Result({
      format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      phase: "provisional",
      identity: rawIdentity(),
      generation: "1",
      registeredAtCursor: rawCursor("5"),
      unexpected: true,
      }),
    )],
    ["generation cursor authority mismatch", () => Result.isFailure(
      decodeScopeSyncQueryGenerationV1Result({
        format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        phase: "provisional",
        identity: rawIdentity(),
        generation: "1",
        registeredAtCursor: {
          ...rawCursor("5"),
          scopeUuid: "00000000-0000-4000-8000-000000000099",
        },
      }),
    )],
    ["active refresh behind snapshot", () => Result.isFailure(
      decodeScopeSyncQueryGenerationV1Result({
        format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        phase: "active",
        identity: rawIdentity(),
        generation: "1",
        snapshotCommitSeq: "6",
        refreshedThroughCursor: rawCursor("5"),
        dependencies: [rawTableKey(1)],
        resultSha256Hex: "44".repeat(32),
      }),
    )],
    ["dependency duplicate", () => Result.isFailure(
      decodeScopeSyncDependencyKeySetV1Result([
        rawTableKey(1),
        rawTableKey(1),
      ]),
    )],
    ["dependency reverse order", () => Result.isFailure(
      decodeScopeSyncDependencyKeySetV1Result([
        rawTableKey(2),
        rawTableKey(1),
      ]),
    )],
  ] as const)("rejects %s", (_name, isFailure) => {
    expect(isFailure()).toBe(true);
  });
});

function rawIdentity() {
  return {
    format: SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    activationSequence: "3",
    activeHeadSha256Hex: "11".repeat(32),
    sourcePackageSha256Hex: "22".repeat(32),
    schemaVersionId: "schema_users_v1",
    policyVersion: "policy_query_v1",
    componentPath: null,
    functionPath: "users:list",
    argumentsSha256Hex: "33".repeat(32),
    identityAccessPolicySha256Hex: "55".repeat(32),
  } as const;
}

function rawCursor(sequence: string) {
  return {
    format: SCOPE_SYNC_CURSOR_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    appliedThroughCommitSeq: sequence,
  } as const;
}

function rawTableKey(tableId: number) {
  return {
    format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    kind: "appTable",
    tableId,
  } as const;
}

function tableKey(tableId: number): ScopeSyncDependencyKeyV1 {
  return captureScopeSyncDependencyKeyV1({
    ...rawTableKey(tableId),
    tableId: CatalogTableIdSchema.make(tableId),
  });
}

function expectFailure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: failure => failure,
    onSuccess: () => {
      throw new Error("Expected Result failure.");
    },
  });
}

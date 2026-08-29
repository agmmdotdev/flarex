import {
  bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  canonicalizeScopeSyncDependencyKeyV1Result,
  canonicalizeScopeSyncQueryAuthorityV1,
  canonicalizeScopeSyncQueryKeyV1,
  compareScopeSyncQueryKeyEvidenceV1,
  decodeScopeSyncDependencyKeyEvidenceV1Result,
  decodeScopeSyncQueryAuthorityEvidenceV1,
  decodeScopeSyncQueryKeyEvidenceV1,
  MAX_SCOPE_SYNC_DEPENDENCY_KEY_CANONICAL_BYTES_V1,
  MAX_SCOPE_SYNC_QUERY_AUTHORITY_CANONICAL_BYTES_V1,
  MAX_SCOPE_SYNC_QUERY_KEY_CANONICAL_BYTES_V1,
  ScopeSyncQueryKeyComparisonV1Error,
  ScopeSyncQueryModelSha256,
  ScopeSyncQueryModelSha256Error,
  ScopeSyncQueryModelV1Error,
  SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
  SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1,
  SCOPE_SYNC_QUERY_MODEL_SHA256_BYTES_V1,
  type ScopeSyncQueryAuthorityEvidenceV1,
  type ScopeSyncQueryKeyEvidenceV1,
  type ScopeSyncQueryModelSha256Api,
} from "../src/scope-sync-query-model-v1";
import {
  SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
} from "../src/scope-sync-v1";

const SCOPE_UUID = "00000000-0000-4000-8000-000000000001";
const OTHER_SCOPE_UUID = "00000000-0000-4000-8000-000000000011";
const EPOCH_UUID = "00000000-0000-4000-8000-000000000002";
const OTHER_EPOCH_UUID = "00000000-0000-4000-8000-000000000012";

describe("scope sync query model V1", () => {
  it("canonicalizes stable query, dependency, and authority frames", async () => {
    const query = await runQueryKey(rawIdentity());
    const table = success(canonicalizeScopeSyncDependencyKeyV1Result(
      rawTableDependency(),
    ));
    const point = success(canonicalizeScopeSyncDependencyKeyV1Result(
      rawPointDependency(),
    ));
    const relation = success(canonicalizeScopeSyncDependencyKeyV1Result(
      rawIncomingRelationDependency(),
    ));
    const authority = await runAuthority(rawAuthority());

    expect(query.canonicalText).toBe(
      '{"format":"flarex.scope-sync-canonical-query-key","identity":{"activationSequence":"3","activeHeadSha256Hex":"1111111111111111111111111111111111111111111111111111111111111111","argumentsSha256Hex":"3333333333333333333333333333333333333333333333333333333333333333","componentPath":null,"epochUuid":"00000000-0000-4000-8000-000000000002","format":"flarex.scope-sync-canonical-query","functionPath":"users:list","identityAccessPolicySha256Hex":"5555555555555555555555555555555555555555555555555555555555555555","policyVersion":"policy_query_v1","schemaVersionId":"schema_users_v1","scopeUuid":"00000000-0000-4000-8000-000000000001","sourcePackageSha256Hex":"2222222222222222222222222222222222222222222222222222222222222222","version":1},"version":1}',
    );
    expect(table.canonicalText).toBe(
      '{"format":"flarex.scope-sync-dependency-key","kind":"appTable","tableId":7,"version":1}',
    );
    expect(point.canonicalText).toBe(
      '{"documentId":"7:00000000-0000-4000-8000-000000000003","format":"flarex.scope-sync-dependency-key","kind":"appRowPoint","version":1}',
    );
    expect(relation.canonicalText).toBe(
      '{"edgeDefinitionId":8,"format":"flarex.scope-sync-dependency-key","kind":"appRelationIncoming","targetRowId":"00000000000040008000000000000004","version":1}',
    );
    expect(authority.canonicalText).toBe(
      '{"activationSequence":"3","activeHeadSha256Hex":"1111111111111111111111111111111111111111111111111111111111111111","epochUuid":"00000000-0000-4000-8000-000000000002","format":"flarex.scope-sync-query-authority","scopeUuid":"00000000-0000-4000-8000-000000000001","storageGeneration":"flarexdb_v1","storageGenerationFence":"9","syncModelId":"flarexdb.application-query.v1","version":1}',
    );
    expect(encodeBytesToLowercaseHex(query.sha256)).toBe(
      "bf40c56e684e383f0fffe27edc7f43ddb8e0189cf80eda94f8e6c78d80c3ee8a",
    );
    expect(encodeBytesToLowercaseHex(authority.sha256)).toBe(
      "b9795675f3994d631348da4007287e3c976484a3e799ef5e7b4eab6c07cd4422",
    );
    expect(query.sha256).toHaveLength(
      SCOPE_SYNC_QUERY_MODEL_SHA256_BYTES_V1,
    );
    expect(new TextDecoder().decode(query.canonicalBytes)).toBe(
      query.canonicalText,
    );
    expect(new TextDecoder().decode(table.canonicalBytes)).toBe(
      table.canonicalText,
    );
    expect(new TextDecoder().decode(authority.canonicalBytes)).toBe(
      authority.canonicalText,
    );
    expect(bytesEqual(query.canonicalBytes, authority.canonicalBytes)).toBe(
      false,
    );
    expect(bytesEqual(query.sha256, authority.sha256)).toBe(false);
  });

  it("decodes exact canonical evidence and rejects malformed encodings", async () => {
    const query = await runQueryKey(rawIdentity());
    const dependency = success(canonicalizeScopeSyncDependencyKeyV1Result(
      rawTableDependency(),
    ));
    const authority = await runAuthority(rawAuthority());

    expect((await runQueryKeyDecode(
      query.canonicalBytes,
      query.sha256,
    )).canonicalText).toBe(query.canonicalText);
    expect(success(decodeScopeSyncDependencyKeyEvidenceV1Result(
      dependency.canonicalBytes,
    )).canonicalText).toBe(dependency.canonicalText);
    expect((await runAuthorityDecode(
      authority.canonicalBytes,
      authority.sha256,
    )).canonicalText).toBe(authority.canonicalText);

    expectIssue(
      await runEffectResult(
        decodeScopeSyncQueryKeyEvidenceV1(
          new Uint8Array([0xff]),
          query.sha256,
        ),
        webCryptoSha256,
      ),
      "invalidUtf8",
    );
    expectIssue(
      decodeScopeSyncDependencyKeyEvidenceV1Result(
        new TextEncoder().encode("{"),
      ),
      "invalidJson",
    );

    const nonCanonicalDependency = new TextEncoder().encode(
      ` ${dependency.canonicalText}`,
    );
    expectIssue(
      decodeScopeSyncDependencyKeyEvidenceV1Result(nonCanonicalDependency),
      "nonCanonical",
    );
    const nonCanonicalAuthority = new TextEncoder().encode(
      `${authority.canonicalText}\n`,
    );
    expectIssue(
      await runEffectResult(
        decodeScopeSyncQueryAuthorityEvidenceV1(
          nonCanonicalAuthority,
          authority.sha256,
        ),
        webCryptoSha256,
      ),
      "nonCanonical",
    );
    const queryWithFutureField = new TextEncoder().encode(
      query.canonicalText.replace(',"version":1}', ',"unexpected":true,"version":1}'),
    );
    expectIssue(
      await runEffectResult(
        decodeScopeSyncQueryKeyEvidenceV1(
          queryWithFutureField,
          query.sha256,
        ),
        webCryptoSha256,
      ),
      "invalidInput",
    );
  });

  it("rejects wrong, malformed, and source-failed SHA-256 evidence", async () => {
    const query = await runQueryKey(rawIdentity());
    const authority = await runAuthority(rawAuthority());

    expectIssue(
      await runEffectResult(
        decodeScopeSyncQueryKeyEvidenceV1(
          query.canonicalBytes,
          new Uint8Array(31),
        ),
        webCryptoSha256,
      ),
      "invalidSha256Length",
      "decodeQueryKey",
    );
    expectIssue(
      await runEffectResult(
        decodeScopeSyncQueryAuthorityEvidenceV1(
          authority.canonicalBytes,
          new Uint8Array(32),
        ),
        webCryptoSha256,
      ),
      "digestMismatch",
      "decodeQueryAuthority",
    );

    const invalidDigest = ScopeSyncQueryModelSha256.of({
      digest: () => Effect.succeed(new Uint8Array(33)),
    });
    expectIssue(
      await runEffectResult(
        canonicalizeScopeSyncQueryKeyV1(rawIdentity()),
        invalidDigest,
      ),
      "invalidSha256Length",
      "canonicalizeQueryKey",
    );
    expectIssue(
      await runEffectResult(
        decodeScopeSyncQueryAuthorityEvidenceV1(
          authority.canonicalBytes,
          authority.sha256,
        ),
        invalidDigest,
      ),
      "invalidSha256Length",
      "decodeQueryAuthority",
    );

    const sourceFailure = new ScopeSyncQueryModelSha256Error({
      operation: "digest",
      cause: new Error("unavailable"),
    });
    const failed = await runEffectResult(
      canonicalizeScopeSyncQueryAuthorityV1(rawAuthority()),
      ScopeSyncQueryModelSha256.of({
        digest: () => Effect.fail(sourceFailure),
      }),
    );
    expect(failure(failed)).toBe(sourceFailure);
  });

  it("fails closed on query-key collisions and inconsistent digests", async () => {
    const forced = ScopeSyncQueryModelSha256.of({
      digest: () => Effect.succeed(new Uint8Array(32).fill(0xa5)),
    });
    const left = await runQueryKey(rawIdentity(), forced);
    const right = await runQueryKey(
      rawIdentity({ functionPath: "users:get" }),
      forced,
    );
    const collision = compareScopeSyncQueryKeyEvidenceV1(left, right);

    expect(failure(collision)).toBeInstanceOf(
      ScopeSyncQueryKeyComparisonV1Error,
    );
    expect(failure(collision)).toMatchObject({
      issue: { reason: "sha256Collision" },
    });

    const first = await runQueryKey(
      rawIdentity(),
      ScopeSyncQueryModelSha256.of({
        digest: () => Effect.succeed(new Uint8Array(32).fill(0x11)),
      }),
    );
    const second = await runQueryKey(
      rawIdentity(),
      ScopeSyncQueryModelSha256.of({
        digest: () => Effect.succeed(new Uint8Array(32).fill(0x22)),
      }),
    );
    expect(failure(compareScopeSyncQueryKeyEvidenceV1(first, second)))
      .toMatchObject({ issue: { reason: "inconsistentDigest" } });
    expect(success(compareScopeSyncQueryKeyEvidenceV1(left, left))).toEqual({
      kind: "equal",
    });
  });

  it("makes every semantic identity and authority field digest-sensitive", async () => {
    const query = await runQueryKey(rawIdentity());
    const queryDigest = encodeBytesToLowercaseHex(query.sha256);
    for (const [field, value] of [
      ["scopeUuid", OTHER_SCOPE_UUID],
      ["epochUuid", OTHER_EPOCH_UUID],
      ["activationSequence", 4n],
      ["activeHeadSha256Hex", "12".repeat(32)],
      ["sourcePackageSha256Hex", "23".repeat(32)],
      ["schemaVersionId", "schema_users_v2"],
      ["policyVersion", "policy_query_v2"],
      ["componentPath", "accounts"],
      ["functionPath", "users:get"],
      ["argumentsSha256Hex", "34".repeat(32)],
      ["identityAccessPolicySha256Hex", "56".repeat(32)],
    ] as const) {
      const changed = await runQueryKey(rawIdentity({ [field]: value }));
      expect(encodeBytesToLowercaseHex(changed.sha256), field).not.toBe(
        queryDigest,
      );
    }

    const authority = await runAuthority(rawAuthority());
    const authorityDigest = encodeBytesToLowercaseHex(authority.sha256);
    for (const [field, value] of [
      ["scopeUuid", OTHER_SCOPE_UUID],
      ["epochUuid", OTHER_EPOCH_UUID],
      ["storageGenerationFence", 10n],
      ["activationSequence", 4n],
      ["activeHeadSha256Hex", "12".repeat(32)],
    ] as const) {
      const changed = await runAuthority(rawAuthority({ [field]: value }));
      expect(encodeBytesToLowercaseHex(changed.sha256), field).not.toBe(
        authorityDigest,
      );
    }

    for (const invalid of [
      rawIdentity({ format: "flarex.scope-sync-canonical-query-v2" }),
      rawIdentity({ version: 2 }),
    ]) {
      expectIssue(await runEffectResult(
        canonicalizeScopeSyncQueryKeyV1(invalid),
        webCryptoSha256,
      ), "invalidInput");
    }
    for (const invalid of [
      rawAuthority({ format: "flarex.scope-sync-query-authority-v2" }),
      rawAuthority({ version: 2 }),
      rawAuthority({ syncModelId: "flarexdb.application-query.v2" }),
      rawAuthority({ storageGeneration: "legacy_v1" }),
    ]) {
      expectIssue(await runEffectResult(
        canonicalizeScopeSyncQueryAuthorityV1(invalid),
        webCryptoSha256,
      ), "invalidInput");
    }
  });

  it("owns and freezes receipts without exposing mutable byte aliases", async () => {
    const mutatingSha256 = ScopeSyncQueryModelSha256.of({
      digest: (bytes) => Effect.sync(() => {
        bytes.fill(0);
        return new Uint8Array(32).fill(7);
      }),
    });
    const query = await runQueryKey(rawIdentity(), mutatingSha256);
    const dependency = success(canonicalizeScopeSyncDependencyKeyV1Result(
      rawIncomingRelationDependency(),
    ));
    const authority = await runAuthority(rawAuthority(), mutatingSha256);

    const queryBytes = query.canonicalBytes;
    const queryDigest = query.sha256;
    const dependencyBytes = dependency.canonicalBytes;
    const authorityBytes = authority.canonicalBytes;
    queryBytes.fill(0);
    queryDigest.fill(0);
    dependencyBytes.fill(0);
    authorityBytes.fill(0);

    expect(new TextDecoder().decode(query.canonicalBytes)).toBe(
      query.canonicalText,
    );
    expect(query.sha256).toEqual(new Uint8Array(32).fill(7));
    expect(new TextDecoder().decode(dependency.canonicalBytes)).toBe(
      dependency.canonicalText,
    );
    expect(new TextDecoder().decode(authority.canonicalBytes)).toBe(
      authority.canonicalText,
    );
    expect(Object.isFrozen(query)).toBe(true);
    expect(Object.isFrozen(query.frame)).toBe(true);
    expect(Object.isFrozen(query.frame.identity)).toBe(true);
    expect(Object.isFrozen(dependency)).toBe(true);
    expect(Object.isFrozen(dependency.dependencyKey)).toBe(true);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.authority)).toBe(true);
  });

  it("recanonicalizes decoded domain values without encoded-side coercion", async () => {
    const query = await runQueryKey(rawIdentity());
    const authority = await runAuthority(rawAuthority());

    const recanonicalizedQuery = await runQueryKey(query.frame.identity);
    const recanonicalizedAuthority = await runAuthority(authority.authority);

    expect(recanonicalizedQuery.canonicalText).toBe(query.canonicalText);
    expect(recanonicalizedQuery.sha256).toEqual(query.sha256);
    expect(recanonicalizedAuthority.canonicalText).toBe(
      authority.canonicalText,
    );
    expect(recanonicalizedAuthority.sha256).toEqual(authority.sha256);
  });

  it("rejects accessors, symbols, and reflection traps without invoking getters", async () => {
    let getterCalls = 0;
    const hostileIdentity = { ...rawIdentity() };
    Object.defineProperty(hostileIdentity, "functionPath", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("must not run");
      },
    });
    expectIssue(await runEffectResult(
      canonicalizeScopeSyncQueryKeyV1(hostileIdentity),
      webCryptoSha256,
    ), "invalidOwnData", "canonicalizeQueryKey");
    expect(getterCalls).toBe(0);

    const hostileDependency = { ...rawTableDependency() };
    Object.defineProperty(hostileDependency, "kind", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "appTable";
      },
    });
    expectIssue(
      canonicalizeScopeSyncDependencyKeyV1Result(hostileDependency),
      "invalidOwnData",
      "canonicalizeDependencyKey",
    );
    expect(getterCalls).toBe(0);

    const symbolAuthority = {
      ...rawAuthority(),
      [Symbol("unexpected")]: true,
    };
    expectIssue(await runEffectResult(
      canonicalizeScopeSyncQueryAuthorityV1(symbolAuthority),
      webCryptoSha256,
    ), "invalidOwnData", "canonicalizeQueryAuthority");

    const trappedAuthority = new Proxy(rawAuthority(), {
      ownKeys: () => {
        throw new Error("reflection denied");
      },
    });
    expectIssue(await runEffectResult(
      canonicalizeScopeSyncQueryAuthorityV1(trappedAuthority),
      webCryptoSha256,
    ), "invalidOwnData", "canonicalizeQueryAuthority");
  });

  it("checks decoded byte ceilings before parsing or hashing", async () => {
    const query = await runEffectResult(
      decodeScopeSyncQueryKeyEvidenceV1(
        new Uint8Array(MAX_SCOPE_SYNC_QUERY_KEY_CANONICAL_BYTES_V1 + 1),
        new Uint8Array(32),
      ),
      webCryptoSha256,
    );
    expect(failure(query)).toMatchObject({ issue: {
      reason: "canonicalBytesExceeded",
      observedBytes: MAX_SCOPE_SYNC_QUERY_KEY_CANONICAL_BYTES_V1 + 1,
      maximumBytes: MAX_SCOPE_SYNC_QUERY_KEY_CANONICAL_BYTES_V1,
    } });
    const authority = await runEffectResult(
      decodeScopeSyncQueryAuthorityEvidenceV1(
        new Uint8Array(
          MAX_SCOPE_SYNC_QUERY_AUTHORITY_CANONICAL_BYTES_V1 + 1,
        ),
        new Uint8Array(32),
      ),
      webCryptoSha256,
    );
    expect(failure(authority)).toMatchObject({ issue: {
      reason: "canonicalBytesExceeded",
      observedBytes: MAX_SCOPE_SYNC_QUERY_AUTHORITY_CANONICAL_BYTES_V1 + 1,
      maximumBytes: MAX_SCOPE_SYNC_QUERY_AUTHORITY_CANONICAL_BYTES_V1,
    } });
    const dependency = decodeScopeSyncDependencyKeyEvidenceV1Result(
      new Uint8Array(MAX_SCOPE_SYNC_DEPENDENCY_KEY_CANONICAL_BYTES_V1 + 1),
    );
    expect(failure(dependency)).toMatchObject({
      issue: {
        reason: "canonicalBytesExceeded",
        observedBytes: MAX_SCOPE_SYNC_DEPENDENCY_KEY_CANONICAL_BYTES_V1 + 1,
        maximumBytes: MAX_SCOPE_SYNC_DEPENDENCY_KEY_CANONICAL_BYTES_V1,
      },
    });
  });
});

const webCryptoSha256 = ScopeSyncQueryModelSha256.of({
  digest: (bytes) => Effect.tryPromise({
    try: async () => {
      const stable = new Uint8Array(bytes);
      return new Uint8Array(await crypto.subtle.digest("SHA-256", stable));
    },
    catch: (cause) => new ScopeSyncQueryModelSha256Error({
      operation: "digest",
      cause,
    }),
  }),
});

function rawIdentity(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    format: SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: SCOPE_UUID,
    epochUuid: EPOCH_UUID,
    activationSequence: 3n,
    activeHeadSha256Hex: "11".repeat(32),
    sourcePackageSha256Hex: "22".repeat(32),
    schemaVersionId: "schema_users_v1",
    policyVersion: "policy_query_v1",
    componentPath: null,
    functionPath: "users:list",
    argumentsSha256Hex: "33".repeat(32),
    identityAccessPolicySha256Hex: "55".repeat(32),
    ...overrides,
  };
}

function rawAuthority(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    format: SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: SCOPE_UUID,
    syncModelId: SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
    epochUuid: EPOCH_UUID,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 9n,
    activationSequence: 3n,
    activeHeadSha256Hex: "11".repeat(32),
    ...overrides,
  };
}

function rawTableDependency(): Readonly<Record<string, unknown>> {
  return {
    format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    kind: "appTable",
    tableId: 7,
  };
}

function rawPointDependency(): Readonly<Record<string, unknown>> {
  return {
    format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    kind: "appRowPoint",
    documentId: "7:00000000-0000-4000-8000-000000000003",
  };
}

function rawIncomingRelationDependency(): Readonly<Record<string, unknown>> {
  return {
    format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    kind: "appRelationIncoming",
    edgeDefinitionId: 8,
    targetRowId: "00000000000040008000000000000004",
  };
}

function runQueryKey(
  input: unknown,
  sha256: ScopeSyncQueryModelSha256Api = webCryptoSha256,
): Promise<ScopeSyncQueryKeyEvidenceV1> {
  return Effect.runPromise(
    canonicalizeScopeSyncQueryKeyV1(input).pipe(
      Effect.provideService(ScopeSyncQueryModelSha256, sha256),
    ),
  );
}

function runAuthority(
  input: unknown,
  sha256: ScopeSyncQueryModelSha256Api = webCryptoSha256,
): Promise<ScopeSyncQueryAuthorityEvidenceV1> {
  return Effect.runPromise(
    canonicalizeScopeSyncQueryAuthorityV1(input).pipe(
      Effect.provideService(ScopeSyncQueryModelSha256, sha256),
    ),
  );
}

function runQueryKeyDecode(
  bytes: unknown,
  digest: unknown,
): Promise<ScopeSyncQueryKeyEvidenceV1> {
  return Effect.runPromise(
    decodeScopeSyncQueryKeyEvidenceV1(bytes, digest).pipe(
      Effect.provideService(ScopeSyncQueryModelSha256, webCryptoSha256),
    ),
  );
}

function runAuthorityDecode(
  bytes: unknown,
  digest: unknown,
): Promise<ScopeSyncQueryAuthorityEvidenceV1> {
  return Effect.runPromise(
    decodeScopeSyncQueryAuthorityEvidenceV1(bytes, digest).pipe(
      Effect.provideService(ScopeSyncQueryModelSha256, webCryptoSha256),
    ),
  );
}

function runEffectResult<A, E>(
  effect: Effect.Effect<A, E, ScopeSyncQueryModelSha256>,
  sha256: ScopeSyncQueryModelSha256Api,
): Promise<Result.Result<A, E>> {
  return Effect.runPromise(effect.pipe(
    Effect.result,
    Effect.provideService(ScopeSyncQueryModelSha256, sha256),
  ));
}

function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: (error) => {
      throw error;
    },
    onSuccess: value => value,
  });
}

function failure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: error => error,
    onSuccess: () => {
      throw new Error("Expected Result failure.");
    },
  });
}

function expectIssue<A, E>(
  result: Result.Result<A, E>,
  reason: ScopeSyncQueryModelV1Error["issue"]["reason"],
  operation?: ScopeSyncQueryModelV1Error["operation"],
): void {
  const error = failure(result);
  expect(error).toBeInstanceOf(ScopeSyncQueryModelV1Error);
  if (!(error instanceof ScopeSyncQueryModelV1Error)) return;
  expect(error.issue.reason).toBe(reason);
  if (operation !== undefined) expect(error.operation).toBe(operation);
}

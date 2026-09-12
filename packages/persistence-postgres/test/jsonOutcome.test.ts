import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { ScopeEpochUuidV1Schema, CommitSeqSchema } from "flarex-protocol/storage-authority";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { canonicalizeJsonOutcome, verifyJsonOutcome } from "../src/jsonOutcome";
import { commerceIdentityEvidence } from "../src/commerceTransaction/request";
import { createCommittedJsonOutcomeResolver, createCommittedPointOutcomeResolverV1, validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1, type CommittedPointOutcomeStoredScalarEvidenceV1 } from "../src/committedPointOutcome";
import { fxSystemIdempotency } from "../src/schema";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createPGlitePersistence } from "../src/pglite";
import { createPostgresPersistence } from "../src/postgres";
import { createFileScopedPostgresFixture, withTemporaryPostgresSchema } from "./postgresHelpers";
import { makeDrizzleCopyFixture, writeJournalThrough } from "./migrationFixtureSupport";
import { insertCanonicalAvailableOutcome, insertCanonicalExpiredOutcome, insertOutcomeHeader, insertOutcomeScope, outcomeLookup, OUTCOME_EPOCH_A } from "./committedPointOutcomeTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const native = process.env.FLAREX_TEST_DRIVER === "postgres";
const cleanup: Array<() => Promise<void>> = [];
let persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>> | Awaited<ReturnType<typeof createPostgresPersistence>>;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
const canonical = (value: unknown, maximum?: number) => runEffect(Effect.fromResult(canonicalizeJsonOutcome(value, maximum)));

it("rejects malformed scalar evidence even when database constraints were bypassed", async () => {
  const lookup = outcomeLookup("scalar-evidence");
  const row: CommittedPointOutcomeStoredScalarEvidenceV1 = {
    outcomeScopeUuid: lookup.scopeUuid, outcomeRequestKey: lookup.requestKey,
    identityHashByteLength: 32, identityMatches: true, functionPathValid: true, functionPathMatches: true,
    requestHashByteLength: 32, requestMatches: true, epochUuid: OUTCOME_EPOCH_A, commitSeq: 1n,
    resultState: "available", resultEncoding: "json", resultValueCodecVersion: null,
    resultSemanticBytes: 4, resultByteLength: 4, resultSha256ByteLength: 32, resultExpiredAt: null,
    createdAt: new Date(1000), retainedHeaderScopeUuid: lookup.scopeUuid,
    retainedHeaderEpochUuid: OUTCOME_EPOCH_A, retainedHeaderCommitSeq: 1n,
  };
  const decode = (value: CommittedPointOutcomeStoredScalarEvidenceV1) => Effect.fromResult(
    validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1(lookup, value, { lastCommitSeq: 1n, oldestAvailableCommitSeq: 0n }, "json"),
  );
  expect(await runEffect(decode(row))).toMatchObject({ state: "available" });
  for (const invalid of [{ resultEncoding: "unknown" }, { resultEncoding: undefined }, { resultValueCodecVersion: 1 },
    { resultSemanticBytes: 5 }, { resultSemanticBytes: "4" }, { resultByteLength: -1 }, { resultSha256ByteLength: null },
    { resultEncoding: "application-value" }, { resultExpiredAt: new Date(2000) },
  ]) expect(await runEffectFailure(decode({ ...row, ...invalid }))).toMatchObject({ reason: "availableResultEvidenceInvalid" });
  const expired = { ...row, resultState: "expired", resultSemanticBytes: null, resultByteLength: null,
    resultSha256ByteLength: null, resultExpiredAt: new Date(2000) };
  expect(await runEffect(decode(expired))).toMatchObject({ state: "expired" });
  for (const invalid of [{ resultValueCodecVersion: 1 }, { resultSemanticBytes: 0 }, { resultByteLength: 0 },
    { resultSha256ByteLength: 32 }, { resultExpiredAt: new Date(NaN) }, { resultExpiredAt: new Date(999) },
  ]) expect(await runEffectFailure(decode({ ...expired, ...invalid }))).toMatchObject({ reason: "expiredResultEvidenceInvalid" });
});

beforeAll(async () => {
  if (native) {
    const fixture = await createFileScopedPostgresFixture(); cleanup.push(fixture.dispose); persistence = fixture.persistence;
  } else persistence = await createMigratedPGlitePersistence(close => cleanup.push(close));
  await insertOutcomeScope(persistence);
  await insertOutcomeHeader(persistence);
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

it("owns canonical ordinary JSON, normalizes numbers, and preserves Application rejection", async () => {
  const input = { z: [-0, 1e30, 0.001], "$ne": { "မြန်မာ": true }, "$integer": "not-a-marker" };
  const result = await canonical(input);
  expect(result.canonicalText).toBe('{"$integer":"not-a-marker","$ne":{"မြန်မာ":true},"z":[0,1e+30,0.001]}');
  expect(result.semanticSizeBytes).toBe(Buffer.byteLength(result.canonicalText));
  expect(result.valueJson).toEqual(JSON.parse(result.canonicalText));
  const retained = await runEffect(verifyJsonOutcome(result.canonicalBytes, digest(result.canonicalBytes)));
  expect(retained.valueJson).toEqual(result.valueJson);
  input.z[0] = 42;
  result.canonicalBytes.fill(0); retained.sha256.fill(0); retained.canonicalBytes.fill(0);
  expect(retained.canonicalText).toBe(result.canonicalText);
  expect(retained.canonicalBytes).toEqual(result.canonicalBytes);
  expect(retained.sha256).toEqual(new Uint8Array(digest(result.canonicalBytes)));
  expect(Object.isFrozen(retained.valueJson)).toBe(true);
  expect(await runEffectFailure(canonicalizeSuccessfulResultV1Effect({ "$ne": "x" }))).toMatchObject({ _tag: "CommitProtocolV1Error" });
});

it("refuses non-JSON data, malformed Unicode, getters, oversized and deep data without broadening the budget", async () => {
  const getter = vi.fn(() => "x");
  const accessor = Object.defineProperty({}, "x", { enumerable: true, get: getter });
  for (const value of [undefined, 1n, Infinity, NaN, new Date(), new Map(), accessor, [undefined], new Array(2), "\ud800", { "\udfff": true }, { nested: "\ud800" }]) {
    expect(await runEffectFailure(Effect.fromResult(canonicalizeJsonOutcome(value)))).toMatchObject({ reason: "invalidInput" });
  }
  expect(getter).not.toHaveBeenCalled();
  expect((await canonical("é", 4)).semanticSizeBytes).toBe(4);
  expect(await runEffectFailure(Effect.fromResult(canonicalizeJsonOutcome("é", 3)))).toMatchObject({ reason: "limitExceeded" });
  let deep: unknown = null;
  for (let i = 0; i < 66; i++) deep = [deep];
  expect(await runEffectFailure(Effect.fromResult(canonicalizeJsonOutcome(deep)))).toMatchObject({ reason: "limitExceeded" });
});

it("rejects noncanonical bytes, invalid UTF-8, JSON syntax, Unicode and digest corruption", async () => {
  for (const bytes of [new Uint8Array([0xff]), Buffer.from(' {"x":1}'), Buffer.from('{"z":1,"a":2}'), Buffer.from('{"a":1,"a":1}'), Buffer.from('"\\ud800"'), Buffer.from('1e999'), Buffer.from('-0'), Buffer.from('{'), new Uint8Array()]) {
    expect(await runEffectFailure(verifyJsonOutcome(bytes, digest(bytes)))).toMatchObject({ _tag: "JsonOutcomeError" });
  }
  const result = await canonical({ good: true });
  expect(await runEffectFailure(verifyJsonOutcome(result.canonicalBytes, new Uint8Array(32)))).toMatchObject({ reason: "invalidEvidence" });
});

it("domain-separates identities and keeps key order stable but arrays, values and domains distinct", async () => {
  const evidence = async (domain: Parameters<typeof commerceIdentityEvidence>[0], value: unknown) =>
    (await runEffect(commerceIdentityEvidence(domain, value, 4096))).canonicalBytes;
  expect(await evidence("policy", { b: 2, a: 1 })).toEqual(await evidence("policy", { a: 1, b: 2 }));
  expect(await evidence("command", [-0])).toEqual(await evidence("command", [0]));
  expect(await evidence("command", [1, 2])).not.toEqual(await evidence("command", [2, 1]));
  const domains = ["policy", "atomic-policy", "command", "atomic-command"] as const;
  const hashes = await Promise.all(domains.map(async domain => digest(await evidence(domain, { "$ne": true })).toString("hex")));
  expect(new Set(hashes).size).toBe(domains.length);
  for (const domain of domains) {
    const bytes = await evidence(domain, { a: 1 });
    expect(() => JSON.parse(new TextDecoder().decode(bytes))).toThrow();
    const old = await runEffect(canonicalizeSuccessfulResultV1Effect({ resultEncoding: "json", value: { a: 1 } }));
    expect(digest(bytes)).not.toEqual(digest(old.canonicalBytes));
  }
});

it("verifies JSON replay, preserves expiration, and refuses wrong-family evidence before verification", async () => {
  const lookup = outcomeLookup("json-result");
  const result = await canonical({ "$ne": "x", "မြန်မာ": [0, false] });
  await persistence.drizzle.insert(fxSystemIdempotency).values({
    scopeUuid: lookup.scopeUuid, requestKey: lookup.requestKey,
    identityAccessPolicySha256: lookup.expectedIdentityAccessPolicySha256,
    functionPath: lookup.expectedFunctionPath, requestSha256: lookup.expectedRequestSha256,
    epochUuid: ScopeEpochUuidV1Schema.make(OUTCOME_EPOCH_A), commitSeq: CommitSeqSchema.make(1n),
    resultState: "available", resultEncoding: "json", resultValueCodecVersion: null,
    resultSemanticBytes: result.semanticSizeBytes, resultBytes: result.canonicalBytes, resultSha256: digest(result.canonicalBytes),
  });
  const before = vi.fn();
  const json = createCommittedJsonOutcomeResolver(persistence.drizzle);
  expect(await runEffect(json.resolve(lookup))).toMatchObject({ kind: "available", successfulResult: { valueJson: result.valueJson } });
  const app = createCommittedPointOutcomeResolverV1(persistence.drizzle, { beforeResultVerification: before,
    observeQuery: query => expect(query.params).toContain("application-value"),
  });
  expect(await runEffectFailure(app.resolve(lookup))).toMatchObject({ mismatches: ["resultEncoding"] });
  expect(before).not.toHaveBeenCalled();
  await persistence.drizzle.update(fxSystemIdempotency).set({ resultState: "expired", resultValueCodecVersion: null,
    resultSemanticBytes: null, resultBytes: null, resultSha256: null, resultExpiredAt: new Date(),
  }).where(eq(fxSystemIdempotency.requestKey, lookup.requestKey));
  expect(await runEffect(json.resolve(lookup))).toMatchObject({ kind: "expired" });
  expect(await runEffectFailure(app.resolve(lookup))).toMatchObject({ mismatches: ["resultEncoding"] });
  await insertCanonicalAvailableOutcome(persistence, { requestKey: "app-result" });
  await insertCanonicalExpiredOutcome(persistence, { requestKey: "app-expired" });
  const wrongJson = createCommittedJsonOutcomeResolver(persistence.drizzle, { beforeResultVerification: before });
  for (const key of ["app-result", "app-expired"]) expect(await runEffectFailure(wrongJson.resolve(outcomeLookup(key)))).toMatchObject({ mismatches: ["resultEncoding"] });
  expect(before).not.toHaveBeenCalled();
});

it("rejects contradictory encoding and stored canonical corruption rather than returning missing", async () => {
  for (const update of ["result_encoding = 'unknown'", "result_encoding = 'json'", "result_value_codec_version = null", "result_encoding = null"]) {
    await expect(persistence.query(`update fx_system_idempotency set ${update} where request_key = 'app-result'`)).rejects.toThrow();
  }
  await persistence.query("update fx_system_idempotency set result_encoding = 'json', result_value_codec_version = null, result_bytes = $1, result_semantic_bytes = 4, result_sha256 = $2 where request_key = 'app-result'", [Buffer.from("true"), new Uint8Array(32)]);
  expect(await runEffectFailure(createCommittedJsonOutcomeResolver(persistence.drizzle).resolve(outcomeLookup("app-result")))).toMatchObject({ reason: "resultCanonicalEvidenceInvalid" });
  await expect(persistence.query("update fx_system_idempotency set result_semantic_bytes = 5 where request_key = 'app-result'")).rejects.toThrow();
});

it("backfills both retained and expired Application rows without changing evidence or identities", async () => {
  const fixture = await makeDrizzleCopyFixture("outcome-json", native ? "postgres" : "pglite", "0099_outcome_json_encoding.sql");
  try {
    await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 98);
    const prove = async (db: typeof persistence) => {
      await db.migrate();
      await insertOutcomeScope(db); await insertOutcomeHeader(db);
      await insertCanonicalAvailableOutcome(db, { requestKey: "old-available" });
      await insertCanonicalExpiredOutcome(db, { requestKey: "old-expired" });
      const before = await db.query("select * from fx_system_idempotency order by request_key");
      await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 99);
      await db.migrate(); await db.migrate();
      const after = await db.query("select * from fx_system_idempotency order by request_key");
      expect(after.rows).toEqual(before.rows.map(row => ({ ...row, result_encoding: "application-value" })));
      const resolver = createCommittedPointOutcomeResolverV1(db.drizzle);
      expect(await runEffect(resolver.resolve(outcomeLookup("old-available")))).toMatchObject({ kind: "available" });
      expect(await runEffect(resolver.resolve(outcomeLookup("old-expired")))).toMatchObject({ kind: "expired" });
    };
    if (native) await withTemporaryPostgresSchema(async options => {
      const db = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
      try { await prove(db); } finally { await db.close(); }
    });
    else {
      const client = new PGlite();
      try { await prove(await createPGlitePersistence({ db: client, migrationsFolder: fixture.migrationsFolder })); } finally { await client.close(); }
    }
  } finally { await fixture.cleanup(); }
}, 120000);

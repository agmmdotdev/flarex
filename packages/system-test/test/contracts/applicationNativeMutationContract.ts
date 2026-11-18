import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Cause, Clock, Effect, Encoding, Exit, Result, Schema } from "effect";
import { jsonToFlarexValueV1 } from "flarex-protocol/value";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
} from "flarex-protocol/internal/application-revision-syscall-validation-v1";
import { compileCoreApplicationIndexes, compileCoreApplicationSchema } from "@flarex/persistence-postgres/internal/core-application-schema";
import { CorePersistenceError } from "@flarex/persistence-postgres/internal/core";
import { CoreApplicationMutationError } from "@flarex/persistence-postgres/internal/core-application-mutation";
import type { ApplicationCoreFixture } from
  "@flarex/persistence-postgres/internal/system-test/core-application-fixture";
import { proveApplicationNestedMutation, proveApplicationNestedMutationFailure, proveCoreApplicationAuthority, proveCoreApplicationColdClaim, proveCoreApplicationBusyClaim, proveCoreApplicationIndexOrder, proveCoreApplicationClock, proveCoreApplicationAdmissionExpiry, proveCoreApplicationDocumentValidation, proveCoreApplicationSchemaMappings, proveCoreApplicationArgumentProfile, proveCoreApplicationArgumentRefusal, proveCoreApplicationLiterals } from
  "../../support/applicationNativeMutationHarness";

const storageTables = ["documents", "indexes", "leases", "persistence_globals", "read_only"];
const idOracle = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
  sourcePin: Schema.Literal("db914cf06e2b06ee985646611b9e12ed7a770318"),
  sequences: Schema.Array(Schema.Struct({ name: Schema.String, ids: Schema.Array(Schema.String) })),
})))(readFileSync(new URL("../../../persistence-postgres/test/core/fixtures/transactionIdOracle/vectors.json", import.meta.url), "utf8"));

/** Rust's independent first draw plus the live fixture's observed UTC day bounds. */
function firstDrawForFixtureDays(name: "ascending" | "zero", days: readonly number[]): readonly Uint8Array[] {
  const vector = idOracle.sequences.find(sequence => sequence.name === name)?.ids[0];
  if (vector === undefined) throw new Error("Missing independent transaction ID vector: " + name);
  const first = Result.getOrThrow(Encoding.decodeHex(vector));
  return days.map(day => {
    const expected = first.slice();
    new DataView(expected.buffer, expected.byteOffset, expected.byteLength).setUint16(14, day, false);
    return expected;
  });
}

export function defineApplicationNestedMutationContract(adapter: Readonly<{
  runScenario: <A>(scenario: (fixture: ApplicationCoreFixture) => Promise<A>) => Promise<A>;
  runLiteralScenario: <A>(scenario: (fixture: ApplicationCoreFixture) => Promise<A>) => Promise<A>;
}>): void {
  it("preserves Int64 and signed-zero literals through cold analysis, authenticated execution and reconstruction", async () => {
    const proof = await adapter.runLiteralScenario(proveCoreApplicationLiterals);
    const minimum = -9223372036854775808n, maximum = 9223372036854775807n;
    expect(proof.coldAnalysisLoads).toBe(2);
    expect(proof.low).toMatchObject({ disposition: "published", value: {
      integer: { $integer: "AAAAAAAAAIA=" }, zero: { $float: "AAAAAAAAAIA=" }, refused: true,
    } });
    expect(jsonToFlarexValueV1(proof.low.value)).toMatchObject({ integer: minimum, zero: -0, refused: true });
    expect(proof.high).toMatchObject({ disposition: "published", value: {
      integer: { $integer: "/////////38=" }, zero: { $float: "AAAAAAAAAIA=" }, refused: false,
    } });
    expect(jsonToFlarexValueV1(proof.high.value)).toMatchObject({ integer: maximum, zero: -0, refused: false });
    for (const refusal of [proof.invalidNumber, proof.invalidZero]) {
      expect(Exit.isFailure(refusal)).toBe(true);
      if (Exit.isSuccess(refusal)) throw new Error("A mismatched literal argument was admitted.");
      expect(refusal.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error instanceof CoreApplicationMutationError && reason.error.reason === "argumentsInvalid")).toBe(true);
    }
    expect(Exit.isFailure(proof.invalidReturn)).toBe(true);
    expect(proof.stagedForInvalidReturn).toBe(1);
    expect(proof.beforeInvalidReturn).toHaveLength(2);
    expect(proof.afterInvalidReturn).toEqual(proof.beforeInvalidReturn);
    expect(proof.cold).toEqual(proof.afterInvalidReturn);
    for (const row of proof.cold) expect(Object.is(row.zero, -0)).toBe(true);
    expect(proof.cold.map(row => row.integer)).toEqual(expect.arrayContaining([minimum, maximum]));
    expect(proof.freshAfterReopen.disposition).toBe("published");
    expect(jsonToFlarexValueV1(proof.freshAfterReopen.value)).toMatchObject({ integer: minimum, zero: -0 });
    expect(proof.replayAfterReopen).toMatchObject({ disposition: "replayed", commitSeq: proof.high.commitSeq, value: proof.high.value });
    expect(proof.final).toHaveLength(3);
    expect(proof.workerLoads).toBeGreaterThan(0);
    expect(proof.storageTables).toEqual(storageTables);
  }, 120_000);

  it("shares staged deletes across nested calls and reconstructs exact history and replay", async () => {
    const proof = await adapter.runScenario(proveApplicationNestedMutation);
    expect(proof.published).toMatchObject({ disposition: "published", value: { before: "Ada", child: null, after: null } });
    for (const replay of [proof.replayed, proof.coldReplay]) expect(replay).toMatchObject({
      disposition: "replayed", commitSeq: proof.published.commitSeq, value: proof.published.value,
    });
    expect(proof.workerLoads).toBe(1);
    expect(proof.before.history).toHaveLength(1);
    expect(proof.after.history).toHaveLength(2);
    expect(proof.after.history.at(-1)).toEqual({ timestamp: proof.published.commitSeq, deleted: true, value: null });
    expect(proof.after.document).toBeNull();
    expect(proof.after.indexed).toEqual([]);
    expect(proof.coldCurrent).toEqual(proof.after);
    expect(Exit.isFailure(proof.historicalAdmission)).toBe(true);
    if (Exit.isFailure(proof.historicalAdmission)) expect(Result.getOrThrow(Cause.findError(proof.historicalAdmission.cause))).toMatchObject({
      _tag: "CorePersistenceError", reason: "outOfRetention",
    });
    expect(proof.historical.document).toMatchObject({ name: "Ada" });
    expect(proof.historical.indexed).toEqual([proof.historical.document]);
    expect(proof.storageTables).toEqual(storageTables);
  }, 120_000);

  it("rejects the Standard root after a caught child patch failure without publishing either write", async () => {
    const proof = await adapter.runScenario(proveApplicationNestedMutationFailure);
    expect(proof.before.document).toMatchObject({ _id: proof.documentId, name: "Ada" });
    expect(proof.before.history).toHaveLength(1);
    expect(proof.before.indexed).toEqual([proof.before.document]);
    expect(proof.failure.outcome).toEqual({ disposition: "rejected", errorTag: "PointMutationOccApplicationErrorV1",
      code: "NESTED_PATCH_FAILED", message: "Fixture nested patch failed.",
      data: { id: proof.documentId, childName: "child-patched" },
    });
    // Claim/abort records are legitimate logical writes. User data and exact
    // index/document history remain unchanged after the caught child failure.
    expect(proof.failure.state).toEqual(proof.before);
    expect(proof.failure.workerLoads).toBe(1);
    const markers = ["parent-before-child", "child-patched", "parent-after-catch"];
    expect(proof.failure.calls.filter(call => call.method === "patchPointDocument")).toEqual(markers.map(name => ({
      method: "patchPointDocument", arguments: [proof.documentId, { name }],
    })));
    expect(proof.failure.results.filter(result => result.method === "patchPointDocument")).toEqual(markers.map(name => ({
      method: "patchPointDocument", arguments: [proof.documentId, { name }], result: undefined,
    })));
    expect(proof.failure.results.filter(result => result.method === "readPointDocument")).toMatchObject(
      ["child-patched", "parent-after-catch"].map(name => ({ method: "readPointDocument", arguments: [proof.documentId],
        result: { kind: "present", document: { _id: proof.documentId, _creationTime: expect.any(Number), name } },
      })),
    );
    expect(proof.success.outcome).toMatchObject({ disposition: "published", value: {
      child: { _id: proof.documentId, name: "child-patched" }, caught: false,
      after: { _id: proof.documentId, name: "parent-after-success" },
    } });
    expect(proof.success.workerLoads).toBe(1);
    expect(proof.success.state.history).toHaveLength(2);
    expect(proof.success.state.history.at(-1)?.timestamp).toBe(proof.success.outcome.commitSeq);
    expect(proof.success.state.document).toMatchObject({ _id: proof.documentId, name: "parent-after-success" });
    expect(proof.success.state.indexed).toEqual([proof.success.state.document]);
    expect(proof.subsequent.outcome).toMatchObject({ disposition: "published" });
    expect(proof.subsequent.outcome.commitSeq).toBeGreaterThan(proof.success.outcome.commitSeq);
    expect(proof.subsequent.outcome.value).not.toBe(proof.documentId);
    expect(proof.subsequent.workerLoads).toBe(1);
    expect(proof.subsequent.state.history).toEqual(proof.success.state.history);
    expect(proof.subsequent.state.document).toEqual(proof.success.state.document);
    expect(proof.subsequent.state.indexed).toHaveLength(2);
    expect(proof.storageTables).toEqual(storageTables);
  }, 120_000);
  it("orders equal Application index fields by creation time before developer ID across reopen", async () => {
    const beforeDay = Math.floor((await Effect.runPromise(Clock.currentTimeMillis)) / 86_400_000);
    const proof = await adapter.runScenario(proveCoreApplicationIndexOrder);
    const afterDay = Math.floor((await Effect.runPromise(Clock.currentTimeMillis)) / 86_400_000);
    expect(Math.abs(afterDay - beforeDay)).toBeLessThanOrEqual(1);
    const fixtureDays = [...new Set([beforeDay, afterDay])];
    expect(proof.workerLoads).toBe(2);
    expect(proof.inserts).toBe(2);
    expect(proof.ids).toHaveLength(2);
    const [earlierId, laterId] = proof.ids;
    if (earlierId === undefined || laterId === undefined) throw new Error("Ordering proof is missing its allocated IDs.");
    expect(earlierId > laterId).toBe(true);
    expect(firstDrawForFixtureDays("ascending", fixtureDays)).toContainEqual(Result.getOrThrow(decodeDocumentId(earlierId)).internalId);
    expect(firstDrawForFixtureDays("zero", fixtureDays)).toContainEqual(Result.getOrThrow(decodeDocumentId(laterId)).internalId);
    for (const state of [proof.warm, proof.cold]) {
      expect(state.asc.map(row => row._id)).toEqual(proof.ids);
      expect(state.desc.map(row => row._id)).toEqual([...proof.ids].reverse());
      const earlierTime = Schema.decodeUnknownSync(Schema.Number)(state.asc[0]?._creationTime);
      const laterTime = Schema.decodeUnknownSync(Schema.Number)(state.asc[1]?._creationTime);
      expect(earlierTime).toBeLessThan(laterTime);
    }
    expect(proof.cold).toEqual(proof.warm);
  }, 120_000);

  it("rejects declared system, repeated and excessive index fields before schema installation", async () => {
    await adapter.runScenario(async fixture => {
      let installations = 0;
      const observed = { ...fixture.database, prepareSchema: (input: Parameters<typeof fixture.database.prepareSchema>[0]) => {
        installations += 1;
        return fixture.database.prepareSchema(input);
      } };
      const before = await Effect.runPromise(fixture.database.publishedTimestamp);
      for (const fields of [["_creationTime"], ["_id"], ["address._secret"], ["name", "name"],
        Array.from({ length: 16 }, (_, ordinal) => "field" + ordinal)]) {
        const outcome = await Effect.runPromise(Effect.exit(Effect.fromResult(compileCoreApplicationSchema({ ...fixture.manifest,
          schema: { ...fixture.manifest.schema, indexes: fixture.manifest.schema.indexes.map(index => ({ ...index, fields })) },
        })).pipe(Effect.flatMap(schema => observed.prepareSchema({ schema })))));
        expect(Exit.isFailure(outcome)).toBe(true);
      }
      expect(installations).toBe(0);
      expect(await Effect.runPromise(fixture.database.publishedTimestamp)).toBe(before);
      const maximum = Array.from({ length: 15 }, (_, ordinal) => "field" + ordinal);
      const installed = Result.getOrThrow(compileCoreApplicationIndexes([{ name: "by_maximum",
        fields: maximum }]));
      expect(installed[0]?.fields).toEqual([...maximum, "_creationTime"]);
    });
  }, 120_000);

  it("refuses native schema profiles and exact-value indexes before prepare without changing active code or data", async () => {
    await adapter.runScenario(async fixture => {
      let preparations = 0;
      const prepare = (schema: unknown) => { preparations++; return fixture.database.prepareSchema({ schema }); };
      const before = await Effect.runPromise(fixture.database.publishedTimestamp);
      const active = await Effect.runPromise(fixture.database.selectProgram("users:create"));
      const manifest = fixture.manifest;
      const relationalTables = manifest.schema.tables.map(table => {
        if (table.name !== "users") return table;
        if (table.validator.type !== "object") throw new Error("Expected object users validator");
        return { ...table, validator: { ...table.validator, value: { ...table.validator.value,
          manager: { fieldType: { type: "id", tableName: "users" }, optional: true } } } };
      });
      for (const unsupported of [
        { ...manifest, version: 2, schema: { ...manifest.schema, version: 2, tables: relationalTables, relations: [{
          relationOrdinal: 1, sourceTableOrdinal: 1, targetTableOrdinal: 1,
          declaration: { format: "flarex.relation-declaration", version: 1,
            source: { table: "users", path: [{ kind: "field", name: "manager" }], forwardName: "manager" },
            target: { table: "users" }, value: { cardinality: "one", required: false },
            inverse: { cardinality: "many", name: "reports" }, localized: false, onTargetDelete: "restrict" },
        }] } },
        { ...manifest, schema: { ...manifest.schema,
          indexes: manifest.schema.indexes.map(index => ({ ...index, decimalFields: index.fields })) } },
      ]) {
        const result = await Effect.runPromise(Effect.result(Effect.fromResult(compileCoreApplicationSchema(unsupported)).pipe(
          Effect.flatMap(prepare))));
        expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreSchemaError", reason: "unsupportedCapability" } });
      }
      expect(preparations).toBe(0);
      expect(await Effect.runPromise(fixture.database.publishedTimestamp)).toBe(before);
      expect(await Effect.runPromise(fixture.database.selectProgram("users:create"))).toEqual(active);
    });
  }, 120_000);
  it("uses source schema omission and shares implicit table mappings with typed nested functions", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationSchemaMappings);
    expect(proof.outcome).toMatchObject({ disposition: "published", value: {
      before: null, old: { _id: proof.documentId, name: "Ada" },
      unlisted: { _id: proof.unlistedId, value: "kept outside manifest" }, normalizedUnlisted: proof.unlistedId,
      missing: [], missingIndex: true, unreadyIndex: true,
      parent: { value: "parent" }, child: { parent: expect.any(String) },
    } });
    if (proof.outcome.disposition !== "published") throw new Error("Expected published mapping witness");
    const value = Schema.decodeUnknownSync(Schema.Struct({ parentId: Schema.String, childId: Schema.String,
      normalizedParent: Schema.String, normalizedChild: Schema.String }))(proof.outcome.value);
    expect(value.normalizedParent).toBe(value.parentId);
    expect(value.normalizedChild).toBe(value.childId);
    expect(proof.tables.map(table => table.logicalName).toSorted()).toEqual(["implicit_child", "implicit_parent", "staging", "unlisted", "users"]);
    expect(proof.unlisted._tag).toBe("Some");
    expect(proof.calls).not.toContain("tableMappings");
    expect(proof.calls).not.toContain("tableNumber");
    expect(proof.workerLoads).toBe(1);
  }, 120_000);
  it("lets actual Worker code catch pre-stage schema refusals and commit subsequent valid writes", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationDocumentValidation);
    expect(proof.outcome).toMatchObject({ disposition: "published", value: {
      failures: Array.from({ length: 2 }, () => ({
        name: APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
        message: APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
      })),
      afterRefusal: { _id: proof.documentId, name: "Ada" },
      after: { _id: proof.documentId, name: "valid after refusal" },
    } });
    expect(proof.calls.filter(call => call.method === "insertPointDocument")).toEqual([
      { method: "insertPointDocument", arguments: ["users", { name: 123 }] },
      { method: "insertPointDocument", arguments: ["users", { name: "independent valid" }] },
    ]);
    expect(proof.calls.filter(call => call.method === "patchPointDocument")).toEqual([
      { method: "patchPointDocument", arguments: [proof.documentId, { name: 123 }] },
      { method: "patchPointDocument", arguments: [proof.documentId, { name: "valid after refusal" }] },
    ]);
    expect(proof.after.document).toMatchObject({ name: "valid after refusal" });
    expect(proof.after.history).toHaveLength(2);
    expect(proof.after.indexed.map(row => row.name)).toEqual(["independent valid", "valid after refusal"]);
    expect(proof.workerLoads).toBe(1);
  }, 120_000);

  it("admits general argument values beyond stored-document size and nesting for actual Worker mutations", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationArgumentProfile);
    expect(proof.outcomes).toHaveLength(2);
    for (const outcome of proof.outcomes) expect(outcome.disposition).toBe("published");
    expect(proof.documents.map(document => document.name)).toEqual(["large unused arguments", "deep unused arguments"]);
    for (const document of proof.documents) expect(Object.keys(document).sort()).toEqual(["_creationTime", "_id", "name"]);
    expect(proof.workerLoads).toBe(2);
  }, 120_000);

  it("refuses excessive argument size, nesting and nonobject roots before claim or Worker body", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationArgumentRefusal);
    expect(proof.outcomes).toHaveLength(4);
    for (const outcome of proof.outcomes) {
      expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isSuccess(outcome)) throw new Error("Invalid argument profile was admitted.");
      expect(outcome.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error instanceof CoreApplicationMutationError && reason.error.reason === "argumentsInvalid")).toBe(true);
    }
    expect(proof.claims).toBe(0);
    expect(proof.workerLoads).toBe(0);
    expect(proof.after).toEqual(proof.before);
    expect(proof.afterTimestamp).toBe(proof.beforeTimestamp);
  }, 120_000);

  it("retains the invoking grant Clock across actual Worker RPC callbacks", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationClock);
    expect(proof.outcome).toMatchObject({ disposition: "published", value: { caught: false } });
    expect(proof.after.document).toMatchObject({ name: "parent-after-success" });
    expect(proof.after.history).toHaveLength(2);
    expect(proof.workerLoads).toBe(1);
    expect(proof.clockReads).toBeGreaterThan(0);
    expect(proof.pointReads).toBeGreaterThan(0);
    expect(proof.epochReadTimes.length).toBeGreaterThan(0);
    expect(proof.epochReadTimes.every(time => time === 1234)).toBe(true);
  }, 120_000);

  it("refuses expired grant admission after the body without publishing or rerunning it", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationAdmissionExpiry);
    expect(Exit.isFailure(proof.outcome)).toBe(true);
    if (Exit.isSuccess(proof.outcome)) throw new Error("Expired grant admitted a user-data commit.");
    expect(proof.outcome.cause.reasons.some(reason => Cause.isFailReason(reason) &&
      reason.error instanceof CoreApplicationMutationError && reason.error.reason === "expired")).toBe(true);
    expect(proof.after).toEqual(proof.before);
    expect(proof.deadline).toBe(proof.admissionTime);
    expect(Exit.isFailure(proof.replay)).toBe(true);
    if (Exit.isSuccess(proof.replay)) throw new Error("Expired body's terminal request was admitted again.");
    expect(proof.replay.cause.reasons.some(reason => Cause.isFailReason(reason) &&
      reason.error instanceof CoreApplicationMutationError && reason.error.reason === "terminalRequest")).toBe(true);
    expect(proof.workerLoads).toBe(1);
  }, 120_000);

  for (const mode of ["beforeBody", "duringBody"] as const) it('refuses actual grant revocation ' + mode, async () => {
    const proof = await adapter.runScenario(fixture => proveCoreApplicationAuthority(fixture, mode));
    expect(Exit.isFailure(proof.outcome)).toBe(true);
    if (Exit.isSuccess(proof.outcome)) throw new Error("Revoked mutation unexpectedly succeeded.");
    expect(proof.outcome.cause.reasons.some(reason => Cause.isFailReason(reason) &&
      reason.error instanceof CoreApplicationMutationError && reason.error.reason === "revoked")).toBe(true);
    expect(proof.after).toEqual(proof.before);
    expect(proof.pointReads).toBe(0);
    expect(proof.workerLoads).toBe(mode === "beforeBody" ? 0 : 1);
  }, 120_000);

  it("keeps the admitted program when an immutable head moves without revoking its grant", async () => {
    const proof = await adapter.runScenario(fixture => proveCoreApplicationAuthority(fixture, "benignHead"));
    expect(proof.currentProgramHash).not.toBe(proof.originalProgramHash);
    expect(Exit.isSuccess(proof.outcome)).toBe(true);
    if (Exit.isFailure(proof.outcome)) throw new Error("Benign head movement rejected the admitted program.", { cause: proof.outcome.cause });
    expect(proof.outcome.value).toMatchObject({ disposition: "published", value: { caught: false } });
    expect(proof.after.document).toMatchObject({ name: "parent-after-success" });
    expect(proof.after.history).toHaveLength(2);
    expect(proof.workerLoads).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("reconciles a fenced predecessor claim after response loss without another body", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationColdClaim);
    expect(Exit.isFailure(proof.lost)).toBe(true);
    if (Exit.isSuccess(proof.lost)) throw new Error("Lost claim acknowledgement unexpectedly succeeded.");
    expect(proof.lost.cause.reasons.some(reason => Cause.isFailReason(reason) &&
      reason.error instanceof CorePersistenceError && reason.error.reason === "uncertainWrite")).toBe(true);
    for (const refusal of [proof.recovered, proof.replayed]) {
      expect(Exit.isFailure(refusal)).toBe(true);
      if (Exit.isSuccess(refusal)) throw new Error("Recovered failed claim granted another body.");
      expect(refusal.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error instanceof CoreApplicationMutationError && reason.error.reason === "terminalRequest")).toBe(true);
    }
    expect(proof.workerLoads).toBe(0);
    expect(proof.after).toEqual(proof.before);
  }, 120_000);

  it("keeps an active same-owner claim busy and replays its single committed body", async () => {
    const proof = await adapter.runScenario(proveCoreApplicationBusyClaim);
    expect(Exit.isFailure(proof.contender)).toBe(true);
    if (Exit.isSuccess(proof.contender)) throw new Error("Active duplicate received body permission.");
    expect(proof.contender.cause.reasons.some(reason => Cause.isFailReason(reason) &&
      reason.error instanceof CoreApplicationMutationError && reason.error.reason === "inProgress")).toBe(true);
    expect(Exit.isSuccess(proof.first)).toBe(true);
    if (Exit.isFailure(proof.first)) throw new Error("Original claimed body did not commit.", { cause: proof.first.cause });
    expect(proof.replay).toMatchObject({ disposition: "replayed", commitSeq: proof.first.value.commitSeq, value: proof.first.value.value });
    expect(proof.workerLoads).toBe(1);
    expect(proof.after.history).toHaveLength(2);
    expect(proof.after.document).toMatchObject({ name: "parent-after-success" });
  }, 120_000);

}

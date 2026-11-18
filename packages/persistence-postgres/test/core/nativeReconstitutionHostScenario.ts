import { randomBytes } from "node:crypto";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { CoreDatabase } from "../../src/core/api";
import { CorePersistenceError } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { makePreparedHostRuntime } from "../../src/execution/preparation/preparedHostRuntime";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceNativeHostProfile, makeAtomicCommerceNativeHost } from "../../src/frameworks/atomicCommerce/nativeHost";
import type { AtomicCommerceNativeParticipantInput } from "../../src/frameworks/atomicCommerce/nativeConfiguration";
import { defineAtomicCommerceNativeSource } from "../../src/frameworks/atomicCommerce/nativeSelection";
import { defineCommerceCommand } from "../../src/frameworks/commerceTransaction/commands";
import { commerceNativeRegistrations, makeCommerceNativeHost } from "../../src/frameworks/commerceTransaction/nativeHost";
import { commerceError, type CommerceTransactionError } from "../../src/frameworks/commerceTransaction/model";
import { capturePrivateCanonicalValue } from "../../src/installation/frameworkSchema/privateCanonicalValue";
import type { LogicalReconstitutionPolicy } from "../../src/storage/documents/logicalDocuments/model";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeFixtureData, readCoreNativeFixtureInventory } from "./nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "23a00000-0000-4000-8000-000000000001", epochUuid: "23a00000-0000-4000-8000-000000000002" };
const origin = { kind: "synthetic", sourceId: "neutral-native-reconstitution-host" } as const;
const lifecycleOrigin = { kind: "implicit", sourceId: `${origin.sourceId}.lifecycle` } as const;
const initialTime = 1_793_577_600_000_000_000n;
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
const decodeRestoration = Schema.decodeUnknownEffect(Schema.Struct({ rows: Schema.Array(Schema.JsonObject), time: Schema.String }));

const setup = Effect.fn("NativeReconstitutionHostTest.setup")(function* (fixture: CorePersistenceFixture) {
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: [{ tableId: "entry", origin, columns: [
      ...["id", "value"].map(columnId => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false,
        default: { kind: "currentTimestamp" }, origin: lifecycleOrigin })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
    ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
      { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
    ], constraints: [], relationships: [] }], capabilities: [
      { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
        updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
      { capabilityId: "entry.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: lifecycleOrigin },
    ] }));
  const sourceContract = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-reconstitution-host", owner: "medusa",
    writeProfile: "medusa.neutral-native-reconstitution-host", evidence: { provenance: origin }, definition: { kind: "relational", schema },
    bindings: [{ kind: "definition", localName: "entry", table: { namespace: "medusa", logicalName: `${origin.sourceId}/entry` } }] });
  const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source: sourceContract, provenance: origin, commands: [] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const clock = { now: initialTime };
  const options = { schemaBundles: [bundle], now: Effect.sync(() => clock.now),
    randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)), schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 };
  const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), value => value.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let active = false;
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); active = true; break;
    }
    if (status.state === "failed" || status.state === "overwritten")
      return yield* Effect.die(new Error("Neutral reconstitution host schema " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  if (!active) return yield* Effect.die(new Error("Neutral reconstitution host schema did not activate"));
  const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 8, maximumPreparedBytes: 16_777_216 });
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const initialization = { stepId: "neutral-reconstitution-host-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 };
  const seed = defineCommerceCommand("reconstitutionHostSeed", "write", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [{ id: "entry", value: "original" }])];
  }));
  const binding = yield* database.bindNative({ definition, commands: yield* Effect.fromResult(commerceNativeRegistrations([seed])) });
  const initial = yield* Effect.acquireUseRelease(makeCommerceNativeHost({ database, binding, hostRuntime, commands: [seed], initialization,
    identityAndAccessPolicy: { profile: "neutral-reconstitution-seed" } }), host => Effect.gen(function* () {
    yield* host.initialize([]); return yield* decodeRows(yield* host.run(host.newRequestKey(), seed, null));
  }), host => host.close);
  clock.now += 20_000_000_000n;
  const participant = defineAtomicCommerceParticipant("neutralReconstitution");
  const source = yield* Effect.fromResult(defineAtomicCommerceNativeSource("neutralReconstitution", definition));
  const entered = yield* Deferred.make<void>();
  const executions = { restore: 0, probe: 0 };
  const caught: Cause.Cause<CommerceTransactionError>[] = [];
  const probe = defineCommerceCommand("reconstitutionHostProbe", "read", ctx => Effect.gen(function* () {
    const store = yield* ctx.table("entry");
    return { reconstitute: store.reconstitute !== undefined, replay: store.replay !== undefined };
  }));
  const restore = defineCommerceCommand("reconstitutionHostRestore", "write", (ctx, mode) => Effect.gen(function* () {
    const store = yield* ctx.table("entry");
    if (store.reconstitute === undefined) return yield* commerceError("invalidAuthority");
    const original = yield* store.find(ctx.manager, { predicate: { kind: "in", column: "id", values: ["entry"] }, order: { column: "id", direction: "asc" } });
    yield* store.delete(ctx.manager, [{ id: "entry" }]);
    if (mode === "caught") {
      yield* store.reconstitute(ctx.manager, original.map(row => ({ ...row, value: "forged" })))
        .pipe(Effect.catchCause(cause => Effect.sync(() => { caught.push(cause); })));
      yield* store.write(ctx.manager, "insert", [{ id: "after-refusal", value: "must-roll-back" }]);
      return null;
    }
    const restored = yield* store.reconstitute(ctx.manager, original);
    if (mode === "late") return yield* commerceError("adapterFailure");
    if (mode === "cancel") { yield* Deferred.succeed(entered, undefined); yield* Effect.never; }
    if (ctx.transactionTime === undefined) return yield* commerceError("invalidAuthority");
    return { rows: [...restored], time: yield* ctx.transactionTime };
  }));
  const probeRoot = defineAtomicCommerceCommand("reconstitutionHostProbeRoot", (ctx, args) => {
    executions.probe++; return ctx.call(participant, probe, args);
  });
  const restoreRoot = defineAtomicCommerceCommand("reconstitutionHostRestoreRoot", (ctx, args) => {
    executions.restore++; return ctx.call(participant, restore, args);
  });
  const input = (policy?: LogicalReconstitutionPolicy, validated = true, selected: CoreDatabase = database) => {
    const member: AtomicCommerceNativeParticipantInput = { participant, nativeStorage: source, commands: [probe, restore],
      ...(policy === undefined ? {} : { reconstitution: policy }),
      ...(validated ? { validateLogicalCall: () => Effect.void } : {}) };
    return { member, input: { database: selected, bundle, hostRuntime, sources: [{ source, definition, initialization }],
      participants: [member], commands: [probeRoot, restoreRoot], executionIsolation: "scopeExclusive" as const,
      identityAndAccessPolicy: { profile: "neutral-native-reconstitution-host" } } };
  };
  const makeHost = (policy?: LogicalReconstitutionPolicy, selected: CoreDatabase = database) => makeAtomicCommerceNativeHost(input(policy, true, selected).input);
  return { database, hostRuntime, options, clock, input, makeHost, commands: { probeRoot, restoreRoot }, executions, caught, entered, initial };
});

function expectRefusal<Value>(result: Exit.Exit<Value, CommerceTransactionError>, reason: CommerceTransactionError["reason"],
  additionalReasons: readonly CommerceTransactionError["reason"][] = []) {
  expect(result).toMatchObject({ _tag: "Failure" });
  if (Exit.isSuccess(result)) throw new Error("Expected native reconstitution refusal");
  expect(result.cause.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ error: expect.objectContaining({ reason }) })]));
  expect(result.cause.reasons.filter(entry => !Cause.isFailReason(entry)
    || entry.error.reason !== reason && entry.error.reason !== "rollbackOnly" && !additionalReasons.includes(entry.error.reason))).toEqual([]);
}

export function registerNativeReconstitutionHostScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };
    it("exposes only the selected capability, rejects malformed or unvalidated policies, and freezes policy before preparation", run(fixture => Effect.gen(function* () {
      const tested = yield* setup(fixture);
      yield* Effect.acquireUseRelease(tested.makeHost(), host => Effect.gen(function* () {
        expect(yield* host.run(host.newRequestKey(), tested.commands.probeRoot, null)).toEqual({ reconstitute: false, replay: false });
        expectRefusal(yield* Effect.exit(host.run(host.newRequestKey(), tested.commands.restoreRoot, null)), "invalidAuthority");
      }), host => host.close);
      for (const invalid of ["malformed", "unvalidated"] as const) {
        const selected = tested.input("advanceUpdatedAt", invalid !== "unvalidated");
        if (invalid === "malformed") Object.defineProperty(selected.member, "reconstitution", { value: "unknownPolicy" });
        const attempted = yield* Effect.exit(Effect.acquireUseRelease(makeAtomicCommerceNativeHost(selected.input), host => Effect.gen(function* () {
          const token = yield* host.captureRequest(host.newRequestKey(), tested.commands.probeRoot, null);
          yield* host.prepareRequest(token);
        }), host => host.close));
        expectRefusal(attempted, "unsupportedProfile");
      }
      const selected = tested.input("advanceUpdatedAt"), profile = captureAtomicCommerceNativeHostProfile(selected.input);
      Object.defineProperty(selected.member, "reconstitution", { value: "preserveTimestamps" });
      yield* Effect.acquireUseRelease(profile.make({ database: tested.database, hostRuntime: tested.hostRuntime }), host => Effect.gen(function* () {
        expect(yield* host.run(host.newRequestKey(), tested.commands.probeRoot, null)).toEqual({ reconstitute: true, replay: false });
        const restored = yield* decodeRestoration(yield* host.run(host.newRequestKey(), tested.commands.restoreRoot, null));
        expect(restored.rows).toEqual(tested.initial.map(row => ({ ...row, updated_at: restored.time })));
        expect(restored.time > String(tested.initial[0]?.updated_at)).toBe(true);
      }), host => host.close);
    })), 120_000);

    it("binds both timestamp policies and omission to distinct identities and recovers a cold committed outcome without a callback", run(fixture => Effect.gen(function* () {
      const tested = yield* setup(fixture), command = tested.commands.restoreRoot;
      const preserving = yield* tested.makeHost("preserveTimestamps"), advancing = yield* tested.makeHost("advanceUpdatedAt"), omitted = yield* tested.makeHost();
      yield* Effect.addFinalizer(() => preserving.close.pipe(Effect.andThen(advancing.close), Effect.andThen(omitted.close)));
      const key = preserving.newRequestKey(), token = yield* preserving.captureRequest(key, command, null), correlation = yield* preserving.prepareRequest(token);
      const restored = yield* preserving.runCaptured(token);
      expect((yield* decodeRestoration(restored)).rows).toEqual(tested.initial);
      expect(tested.executions.restore).toBe(1);
      for (const changed of [advancing, omitted]) {
        const changedToken = yield* changed.captureRequest(key, command, null), changedCorrelation = yield* changed.prepareRequest(changedToken);
        expect(changedCorrelation.root.definitionHash).not.toBe(correlation.root.definitionHash);
        expectRefusal(yield* Effect.exit(changed.runCaptured(changedToken)), "requestConflict");
      }
      expect(tested.executions.restore).toBe(1);
      yield* preserving.close; yield* advancing.close; yield* omitted.close; yield* tested.database.close();
      const persistence = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
      const cold = yield* Effect.acquireRelease(openCoreDatabase(persistence, tested.options), value => value.close());
      const before = yield* readCoreNativeFixtureInventory(cold, persistence);
      yield* Effect.acquireUseRelease(tested.makeHost("preserveTimestamps", cold), host => Effect.gen(function* () {
        const coldToken = yield* host.captureRequest(key, command, null);
        expect(yield* host.prepareRequest(coldToken)).toEqual(correlation);
        expect(Option.getOrThrow(yield* host.recoverCaptured(coldToken))).toEqual(restored);
        expect(yield* host.runCaptured(coldToken)).toEqual(restored);
      }), host => host.close);
      expect(tested.executions.restore).toBe(1);
      expect(yield* readCoreNativeFixtureInventory(cold, persistence)).toEqual(before);
    })), 120_000);

    it("keeps caught proof refusal, later native failure and cancelled restoration rollback-only without publication", run(fixture => Effect.gen(function* () {
      const tested = yield* setup(fixture);
      yield* Effect.acquireUseRelease(tested.makeHost("advanceUpdatedAt"), host => Effect.gen(function* () {
        for (const mode of ["caught", "late", "cancel"] as const) {
          const token = yield* host.captureRequest(host.newRequestKey(), tested.commands.restoreRoot, mode);
          yield* host.prepareRequest(token);
          const before = yield* readCoreNativeFixtureInventory(tested.database, fixture.persistence);
          if (mode === "cancel") {
            const running = yield* Effect.forkChild(host.runCaptured(token));
            yield* Deferred.await(tested.entered);
            yield* Fiber.interrupt(running);
            expect(Exit.isFailure(yield* Fiber.await(running))).toBe(true);
          } else expectRefusal(yield* Effect.exit(host.runCaptured(token)), mode === "caught" ? "rollbackOnly" : "adapterFailure", mode === "caught" ? ["invalidInput"] : []);
          const after = yield* readCoreNativeFixtureInventory(tested.database, fixture.persistence);
          expect(coreNativeFixtureData(after)).toEqual(coreNativeFixtureData(before));
          expect(after.outcomes.filter(outcome => outcome.value.state === "committed"))
            .toEqual(before.outcomes.filter(outcome => outcome.value.state === "committed"));
          expect(Option.isNone(yield* host.recoverCaptured(token))).toBe(true);
        }
        expect(tested.caught).toHaveLength(1);
        expect(tested.caught[0]?.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ error: expect.objectContaining({ reason: "invalidInput" }) })]));
      }), host => host.close);
    })), 120_000);
  });
}

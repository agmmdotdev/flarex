import { randomBytes } from "node:crypto";
import { Cause, Effect, Exit, Option, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import type { CoreDatabase, CoreNativeRootBindingInput, CoreNativeRootIdentity, CoreNativeRootRecoveryInput } from "../../src/core/api";
import { CorePersistenceError } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { compileCoreNativeEventStorageDefinition } from "../../src/commit/events/coreDefinition";
import { makePreparedHostRuntime } from "../../src/execution/preparation/preparedHostRuntime";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceNativeHost } from "../../src/frameworks/atomicCommerce/nativeHost";
import { defineAtomicCommerceNativeSource } from "../../src/frameworks/atomicCommerce/nativeSelection";
import { defineCommerceCommand } from "../../src/frameworks/commerceTransaction/commands";
import { commerceNativeRegistrations, makeCommerceNativeHost } from "../../src/frameworks/commerceTransaction/nativeHost";
import { commerceError, type CommerceTransactionError } from "../../src/frameworks/commerceTransaction/model";
import { defaultCommerceResources, logicalCommerceBatchResources } from "../../src/frameworks/commerceTransaction/resources";
import { capturePrivateCanonicalValue } from "../../src/installation/frameworkSchema/privateCanonicalValue";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeFixtureData, readCoreNativeFixtureInventory } from "./nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "22a00000-0000-4000-8000-000000000001", epochUuid: "22a00000-0000-4000-8000-000000000002" };
const origin = { kind: "synthetic", sourceId: "neutral-native-atomic-admission" } as const;
const revision = "a".repeat(64);
const cohorts = [128, 129, 256] as const;
const rowId = (index: number) => `entry-${String(index).padStart(3, "0")}`;
const query = (size: typeof cohorts[number], take?: number): JsonObject => ({ fields: ["id"],
  predicate: { kind: "in", column: `cohort${size}`, values: ["selected"] }, order: { column: "id", direction: "asc" },
  ...(take === undefined ? {} : { take }) });

const setup = Effect.fn("NativeAtomicAdmissionTest.setup")(function* (fixture: CorePersistenceFixture) {
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: [{ tableId: "entry", origin, columns: ["id", "value", ...cohorts.map(size => `cohort${size}`)].map(columnId =>
      ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
    keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }],
    indexes: cohorts.map(size => ({ indexId: `entry.cohort${size}`, kind: "btree", columns: [`cohort${size}`], predicate: null, origin })),
    constraints: [], relationships: [] }], capabilities: [] }));
  const sourceContract = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-atomic-admission", owner: "medusa",
    writeProfile: "medusa.neutral-native-atomic-admission", evidence: { provenance: origin }, definition: { kind: "relational", schema },
    bindings: [{ kind: "definition", localName: "entry", table: { namespace: "medusa", logicalName: `${origin.sourceId}/entry` } }] });
  const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source: sourceContract, provenance: origin, commands: [] });
  const storage = yield* compileCoreNativeEventStorageDefinition(target);
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }, { kind: "native", definition: storage }] });
  const options = { schemaBundles: [bundle], now: Effect.succeed(1_793_577_600_000_000_000n),
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
      return yield* Effect.die(new Error("Neutral atomic admission schema " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  if (!active) return yield* Effect.die(new Error("Neutral atomic admission schema did not activate"));
  const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 8, maximumPreparedBytes: 16_777_216 });
  const emptyDataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const initialization = { stepId: "neutral-atomic-admission-empty", datasetSha256: emptyDataset.sha256Hex, expectedRowCount: 0 };
  const seed = defineCommerceCommand("atomicAdmissionBulkSeed", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", Array.from({ length: 257 }, (_, index) => ({
      id: rowId(index), value: "original", cohort128: index < 128 ? "selected" : "other",
      cohort129: index < 129 ? "selected" : "other", cohort256: index < 256 ? "selected" : "other",
    })));
    return null;
  }));
  const binding = yield* database.bindNative({ definition, commands: yield* Effect.fromResult(commerceNativeRegistrations([seed])) });
  // A separate trusted bulk owner seeds the data. Ordinary atomic participants
  // never inherit its 2,048-identity allowance.
  yield* Effect.acquireUseRelease(makeCommerceNativeHost({ database, binding, hostRuntime, commands: [seed], initialization,
    identityAndAccessPolicy: { profile: "neutral-atomic-admission-bulk" }, resources: logicalCommerceBatchResources,
    nativeLimits: { maxIdentities: logicalCommerceBatchResources.catalogRows, maxDocumentBytes: 65_536 } }), host => Effect.gen(function* () {
    yield* host.initialize([]); yield* host.run(host.newRequestKey(), seed, null);
  }), host => host.close);
  const participant = defineAtomicCommerceParticipant("neutralAdmission");
  const source = yield* Effect.fromResult(defineAtomicCommerceNativeSource("neutralAdmission", definition));
  const find = defineCommerceCommand("atomicAdmissionFind", "read", (ctx, input) => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).find(ctx.manager, input)];
  }));
  const count = defineCommerceCommand("atomicAdmissionCount", "read", (ctx, input) => Effect.gen(function* () {
    return yield* (yield* ctx.table("entry")).count(ctx.manager, input);
  }));
  const update = defineCommerceCommand("atomicAdmissionUpdate", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("entry")).write(ctx.manager, "update", [{ id: rowId(0), value: "must-roll-back" }]);
    return null;
  }));
  const executions = { find: 0, count: 0, repeated: 0, overflow: 0, staged: 0 };
  const findRoot = defineAtomicCommerceCommand("atomicAdmissionFindRoot", (ctx, input) => {
    executions.find++; return ctx.call(participant, find, input);
  });
  const countRoot = defineAtomicCommerceCommand("atomicAdmissionCountRoot", (ctx, input) => {
    executions.count++; return ctx.call(participant, count, input);
  });
  const repeatedRoot = defineAtomicCommerceCommand("atomicAdmissionRepeatedRoot", (ctx, input) => Effect.gen(function* () {
    executions.repeated++;
    const first = yield* ctx.call(participant, count, input);
    const second = yield* ctx.call(participant, count, input);
    return { first, second };
  }));
  const overflowRoot = defineAtomicCommerceCommand("atomicAdmissionOverflowRoot", ctx => Effect.gen(function* () {
    executions.overflow++;
    yield* ctx.call(participant, count, query(256));
    return yield* ctx.call(participant, find, { fields: ["id"], predicate: { kind: "in", column: "id", values: [rowId(256)] },
      order: { column: "id", direction: "asc" } });
  }));
  const event = defineCommerceEventContract({ name: "neutral.admission", revision, internal: false, decode: () => Effect.succeed({ id: rowId(0) }) });
  const caught: Cause.Cause<CommerceTransactionError>[] = [];
  const stagedRoot = defineAtomicCommerceCommand("atomicAdmissionStagedRoot", ctx => Effect.gen(function* () {
    executions.staged++;
    yield* ctx.call(participant, update, null);
    yield* ctx.emit(event, { id: rowId(0) });
    yield* ctx.call(participant, count, query(129)).pipe(Effect.catchCause(cause => Effect.sync(() => { caught.push(cause); })));
    return { caught: true };
  }));
  const commands = [findRoot, countRoot, repeatedRoot, overflowRoot, stagedRoot];
  const recoveries: Array<Readonly<{ input: CoreNativeRootRecoveryInput; identity: CoreNativeRootIdentity }>> = [];
  const live: Array<Readonly<{ input: CoreNativeRootBindingInput; identity: CoreNativeRootIdentity }>> = [];
  const observe = (selected: CoreDatabase): CoreDatabase => ({ ...selected,
    bindNativeRootRecovery: Effect.fn("NativeAtomicAdmissionTest.observeRecovery")(function* (input: CoreNativeRootRecoveryInput) {
      const recovery = yield* selected.bindNativeRootRecovery(input); recoveries.push({ input, identity: recovery.identity }); return recovery;
    }),
    bindNativeRoot: Effect.fn("NativeAtomicAdmissionTest.observeLive")(function* (input: CoreNativeRootBindingInput) {
      const root = yield* selected.bindNativeRoot(input); live.push({ input, identity: (yield* selected.readNativeRootBinding(root)).identity }); return root;
    }),
  });
  const makeHost = (explicit: boolean, selected = database) => makeAtomicCommerceNativeHost({ database: observe(selected), bundle, hostRuntime,
    sources: [{ source, definition, initialization }], commands, identityAndAccessPolicy: { profile: "neutral-native-atomic-admission" },
    eventStorage: { definition: storage }, events: { producerRevision: revision, contracts: [event],
      subscribers: [{ id: "neutral-admission", revision }], validate: () => Effect.void },
    participants: [{ participant, nativeStorage: source, commands: [find, count, update],
      ...(explicit ? { logicalResources: defaultCommerceResources } : {}) }],
  });
  return { database, options, makeHost, commands: { findRoot, countRoot, repeatedRoot, overflowRoot, stagedRoot },
    executions, recoveries, live, caught };
});

function expectRefusal<Value>(result: Exit.Exit<Value, CommerceTransactionError>, reason: CommerceTransactionError["reason"],
  additionalReasons: readonly CommerceTransactionError["reason"][] = []) {
  expect(result).toMatchObject({ _tag: "Failure" });
  if (Exit.isSuccess(result)) throw new Error("Expected a complete native admission refusal");
  expect(result.cause.reasons).toEqual(expect.arrayContaining([
    expect.objectContaining({ error: expect.objectContaining({ reason }) }),
  ]));
  const unexpectedReasons = result.cause.reasons.filter(entry => !Cause.isFailReason(entry)
    || entry.error.reason !== reason && entry.error.reason !== "rollbackOnly" && !additionalReasons.includes(entry.error.reason));
  expect(unexpectedReasons).toEqual([]);
  return result.cause;
}

export function registerNativeAtomicAdmissionScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };
    it("keeps implicit admission at 128 before pagination or count and deduplicates repeated originals", run(fixture => Effect.gen(function* () {
      const tested = yield* setup(fixture);
      yield* Effect.acquireUseRelease(tested.makeHost(false), host => Effect.gen(function* () {
        const { findRoot, countRoot, repeatedRoot } = tested.commands;
        expect(yield* host.run(host.newRequestKey(), countRoot, query(128))).toBe(128);
        expect(yield* host.run(host.newRequestKey(), findRoot, query(128, 1))).toEqual([{ id: rowId(0) }]);
        expect(yield* host.run(host.newRequestKey(), repeatedRoot, query(128))).toEqual({ first: 128, second: 128 });
        for (const command of [findRoot, countRoot])
          expectRefusal(yield* Effect.exit(host.run(host.newRequestKey(), command, query(129, 1))), "limitExceeded");
        const recovery = tested.recoveries[0], live = tested.live[0];
        expect(recovery?.identity).toEqual(live?.identity);
        expect(recovery?.input.participants[0]?.limits).toEqual({ maxIdentities: 128, maxDocumentBytes: 65_536 });
        expect(Object.isFrozen(recovery?.input.participants[0]?.limits)).toBe(true);
        expect(live?.input.participants[0]?.limits).toBe(recovery?.input.participants[0]?.limits);
      }), host => host.close);
    })), 120_000);

    it("honors the explicit default 256 grant while retaining its distinct 257th identity boundary", run(fixture => Effect.gen(function* () {
      const tested = yield* setup(fixture);
      yield* Effect.acquireUseRelease(tested.makeHost(true), host => Effect.gen(function* () {
        const { countRoot, repeatedRoot, overflowRoot } = tested.commands;
        expect(yield* host.run(host.newRequestKey(), countRoot, query(129))).toBe(129);
        expect(yield* host.run(host.newRequestKey(), repeatedRoot, query(256))).toEqual({ first: 256, second: 256 });
        expectRefusal(yield* Effect.exit(host.run(host.newRequestKey(), overflowRoot, null)), "limitExceeded");
        expect(tested.recoveries[0]?.input.participants[0]?.limits.maxIdentities).toBe(256);
        expect(tested.live[0]?.input.participants[0]?.limits).toBe(tested.recoveries[0]?.input.participants[0]?.limits);
      }), host => host.close);
    })), 120_000);

    it("rolls back a staged update, indexes, history, event intents and outcome when user code catches overflow", run(fixture => Effect.gen(function* () {
      const tested = yield* setup(fixture);
      yield* Effect.acquireUseRelease(tested.makeHost(false), host => Effect.gen(function* () {
        // Prepare the lazy profile before taking the durable baseline.
        const key = host.newRequestKey(), token = yield* host.captureRequest(key, tested.commands.stagedRoot, null);
        yield* host.prepareRequest(token);
        const before = yield* readCoreNativeFixtureInventory(tested.database, fixture.persistence);
        const result = yield* Effect.exit(host.runCaptured(token));
        const cause = expectRefusal(result, "rollbackOnly", ["limitExceeded"]);
        expect(tested.caught).toHaveLength(1);
        const original = tested.caught[0];
        if (original === undefined) return yield* Effect.die(new Error("Missing caught native identity refusal"));
        expect(original.reasons.every(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded")).toBe(true);
        const retainedAsCause = cause.reasons.some(reason => Cause.isFailReason(reason)
          && reason.error.reason === "rollbackOnly" && reason.error.cause === original);
        const retainedAsReasons = original.reasons.every(originalReason => Cause.isFailReason(originalReason)
          && cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === originalReason.error));
        expect(retainedAsCause || retainedAsReasons).toBe(true);
        const after = yield* readCoreNativeFixtureInventory(tested.database, fixture.persistence);
        expect(coreNativeFixtureData(after)).toEqual(coreNativeFixtureData(before));
        expect(after.outcomes.filter(outcome => outcome.value.state === "committed"))
          .toEqual(before.outcomes.filter(outcome => outcome.value.state === "committed"));
        expect(Option.isNone(yield* host.recoverCaptured(token))).toBe(true);
        expect(tested.executions.staged).toBe(1);
      }), host => host.close);
    })), 120_000);

    it("binds limits into immutable root identity, refuses profile changes and cold replays exact historical frames without a callback", run(fixture => Effect.gen(function* () {
      const tested = yield* setup(fixture), command = tested.commands.countRoot, args = query(129);
      const explicit = yield* tested.makeHost(true), implicit = yield* tested.makeHost(false);
      yield* Effect.addFinalizer(() => explicit.close.pipe(Effect.andThen(implicit.close)));
      const key = explicit.newRequestKey(), token = yield* explicit.captureRequest(key, command, args);
      const correlation = yield* explicit.prepareRequest(token);
      expect(yield* explicit.runCaptured(token)).toBe(129);
      expect(tested.executions.count).toBe(1);
      const changed = yield* implicit.captureRequest(key, command, args), changedCorrelation = yield* implicit.prepareRequest(changed);
      expect(changedCorrelation.root.definitionHash).not.toBe(correlation.root.definitionHash);
      expectRefusal(yield* Effect.exit(implicit.runCaptured(changed)), "requestConflict");
      expect(tested.executions.count).toBe(1);
      const explicitInput = tested.recoveries[0]?.input, implicitInput = tested.recoveries[1]?.input;
      if (explicitInput === undefined || implicitInput === undefined) return yield* Effect.die(new Error("Missing actual prepared atomic profiles"));
      expect(implicitInput.contract).toEqual(explicitInput.contract);
      // Before this correction an omitted profile encoded 256 in this existing
      // field. Its immutable frame is exactly the current explicit-default frame.
      const historicalInput: CoreNativeRootRecoveryInput = { ...implicitInput, participants: implicitInput.participants.map(member => ({ ...member,
        limits: member.definition.identity.sourceKey === "medusa.neutral-native-atomic-admission"
          ? { ...member.limits, maxIdentities: 256 } : member.limits })) };
      expect((yield* tested.database.bindNativeRootRecovery(historicalInput)).identity).toEqual(correlation.root);
      yield* explicit.close; yield* implicit.close; yield* tested.database.close();
      const persistence = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
      const cold = yield* Effect.acquireRelease(openCoreDatabase(persistence, tested.options), database => database.close());
      const historical = yield* cold.bindNativeRootRecovery(historicalInput);
      expect(yield* historical.resolve(correlation)).toMatchObject({ kind: "committed", result: 129 });
      yield* Effect.acquireUseRelease(tested.makeHost(true, cold), host => Effect.gen(function* () {
        const coldToken = yield* host.captureRequest(key, command, args), coldCorrelation = yield* host.prepareRequest(coldToken);
        expect(coldCorrelation).toEqual(correlation);
        expect(Option.getOrThrow(yield* host.recoverCaptured(coldToken))).toBe(129);
        expect(yield* host.runCaptured(coldToken)).toBe(129);
        expect(yield* host.run(key, command, args)).toBe(129);
        expect(tested.executions.count).toBe(1);
      }), host => host.close);
    })), 120_000);
  });
}

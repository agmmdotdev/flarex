import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost } from "@flarex/persistence-postgres/internal/commerce";
import { defineCommerceCommand, defineAtomicCommerceCommand, defineAtomicCommerceParticipant,
  type LogicalCommerceCallValidation, type LogicalCommerceEventValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const origin = { kind: "synthetic", sourceId: "atomic-logical-validation" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "atomic-logical-validation",
  tables: [{ tableId: "validation_probe", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "value", type: "integer", nullable: false, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "validation_probe.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }],
  capabilities: [],
}));
const evidence = { kind: "synthetic", sourceId: "atomic-logical-validation" };
const decodeInput = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String, value: Schema.Int }), { onExcessProperty: "error" });
const participant = defineAtomicCommerceParticipant("validation_probe");
const write = defineCommerceCommand("validationProbeWrite", "write", Effect.fn(function* (ctx, input) {
  const data = yield* decodeInput(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  yield* (yield* ctx.table("validation_probe")).write(ctx.manager, "insert", [data]);
  return data;
}));
const read = defineCommerceCommand("validationProbeRead", "read", Effect.fn(function* (ctx) {
  return [...yield* (yield* ctx.table("validation_probe")).find(ctx.manager,
    { fields: ["id", "value"], take: 100, order: { column: "id", direction: "asc" } })];
}));
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let storage: Awaited<ReturnType<typeof makeStorage>>;
let reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;

async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid validation-probe seed"), hashFailure: cause => new Error("Validation-probe seed hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage,
    source: { sourceKey: "medusa.validation-probe", writeProfile: "medusa.validation-probe", schema, evidence },
    initialization: { stepId: "validation-probe-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 },
  };
}

async function open(mode: "accept" | "aggregate-refusal" | "call-refusal", trace: string[],
  shape: "both" | "call" | "aggregate" | "call-own-undefined" | "aggregate-own-undefined" = "both") {
  const callFailure = commerceError("invalidInput"), aggregateFailure = commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.gen(function* () {
    expect(command).toBe(write); expect(call.commandName).toBe("validationProbeWrite"); expect(call.mode).toBe("write");
    expect(call.events).toEqual([]); expect(activity.mutations).toHaveLength(1);
    expect(activity.mutations[0]).toMatchObject({ ordinal: 0, operation: "insert", table: "validation_probe", after: call.input });
    expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
    trace.push("call:" + call.toAttempt);
    if (mode === "call-refusal") return yield* Effect.fail(callFailure);
  });
  const validateLogical: LogicalCommerceEventValidation = (calls, mutations, lifecycle, observedRows, setNull, replacements) => Effect.gen(function* () {
    trace.push("aggregate");
    expect(calls).toHaveLength(2); expect(calls.map(call => [call.fromAttempt, call.toAttempt])).toEqual([[0, 1], [1, 2]]);
    expect(mutations).toHaveLength(2); expect(mutations.map(change => change.ordinal)).toEqual([0, 1]);
    expect(mutations.map(change => ({ id: change.after?.id, value: change.after?.value }))).toEqual(calls.map(call => call.input));
    for (const change of mutations) {
      expect(change.after).toMatchObject({ _id: expect.any(String), _creationTime: expect.any(Number) });
      expect(change.after?._creationTime).toBeGreaterThan(0);
    }
    expect(new Set(mutations.map(change => change.after?._id)).size).toBe(2);
    expect(lifecycle).toEqual([]); expect(setNull).toEqual([]); expect(replacements).toEqual([]);
    expect(observedRows).toHaveLength(2);
    if (mode === "aggregate-refusal") return yield* Effect.fail(aggregateFailure);
  });
  const root = defineAtomicCommerceCommand("validationProbeRoot", Effect.fn(function* (ctx, input) {
    const prefix = typeof input === "string" ? input : mode;
    yield* ctx.call(participant, write, { id: prefix + "-first", value: 1 });
    return yield* ctx.call(participant, write, { id: prefix + "-second", value: 2 });
  }));
  const member = { participant, logicalStorage: storage, commands: [write],
    ...(shape === "both" || shape === "aggregate" || shape === "aggregate-own-undefined" ? { validateLogical } : {}),
    ...(shape === "both" || shape === "call" || shape === "call-own-undefined" ? { validateLogicalCall } : {}),
  };
  if (shape === "call-own-undefined") Object.defineProperty(member, "validateLogical", { value: undefined, enumerable: true });
  if (shape === "aggregate-own-undefined") Object.defineProperty(member, "validateLogicalCall", { value: undefined, enumerable: true });
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    identityAndAccessPolicy: { profile: "neutral-logical-validation", mode },
    participants: [member], commands: [root],
  }));
  return { host, root, callFailure, aggregateFailure };
}

describe("conjunctive per-call and aggregate logical participant validation", () => {
  beforeAll(async () => {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.validation-probe", owner: "medusa", writeProfile: "medusa.validation-probe",
      evidence, definition: { kind: "relational", schema },
      bindings: [{ kind: "definition", localName: "validation_probe", table: { namespace: "medusa", logicalName: "atomic-logical-validation/validation_probe" } }],
    }));
    // Existing authenticated catalog/database bootstrap only; the admitted source,
    // commands and validators above are neutral authored records.
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    storage = await makeStorage();
    reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [read] }));
    cleanup.push(() => Effect.runPromise(reader.close));
    await Effect.runPromise(reader.initialize([]));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("validates each call before the complete participant and publishes only after both policies accept", async () => {
    const trace: string[] = [], { host, root } = await open("accept", trace);
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), root, null))).toEqual({ id: "accept-second", value: 2 });
      expect(trace).toEqual(["call:1", "call:1", "aggregate"]);
      expect(await Effect.runPromise(reader.read(read, null))).toEqual([{ id: "accept-first", value: 1 }, { id: "accept-second", value: 2 }]);
    } finally { await Effect.runPromise(host.close); }
  });

  it("rolls back accepted calls, history, facts and outcomes when aggregate validation refuses", async () => {
    const trace: string[] = [], { host, root, aggregateFailure } = await open("aggregate-refusal", trace);
    try {
      const before = await logicalCurrencyInventory(fixture), exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), root, null));
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === aggregateFailure)).toBe(true);
      expect(trace).toEqual(["call:1", "call:1", "aggregate"]);
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    } finally { await Effect.runPromise(host.close); }
  });

  it("retains the first per-call failure and skips subsequent calls and aggregate validation", async () => {
    const trace: string[] = [], { host, root, callFailure } = await open("call-refusal", trace);
    try {
      const before = await logicalCurrencyInventory(fixture), exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), root, null));
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === callFailure)).toBe(true);
      expect(trace).toEqual(["call:1"]); expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    } finally { await Effect.runPromise(host.close); }
  });

  it("binds the added aggregate guard into replay identity while omitted and own undefined retain single-validator identities", async () => {
    const dualTrace: string[] = [], dual = await open("accept", dualTrace);
    const call = await open("accept", [], "call"), callUndefined = await open("accept", [], "call-own-undefined");
    const aggregate = await open("accept", [], "aggregate"), aggregateUndefined = await open("accept", [], "aggregate-own-undefined");
    try {
      for (const [plain, ownUndefined, input] of [[call, callUndefined, "identity-call"],
        [aggregate, aggregateUndefined, "identity-aggregate"]] as const) {
        const key = plain.host.newRequestKey(), result = await Effect.runPromise(plain.host.run(key, plain.root, input));
        expect(result).toEqual({ id: input + "-second", value: 2 });
        const before = await logicalCurrencyInventory(fixture);
        expect(await Effect.runPromise(ownUndefined.host.run(key, ownUndefined.root, input))).toEqual(result);
        expect(await Effect.runPromise(Effect.result(dual.host.run(key, dual.root, input))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
        expect(dualTrace).toEqual([]); expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      }
    } finally {
      for (const member of [dual, call, callUndefined, aggregate, aggregateUndefined]) await Effect.runPromise(member.host.close);
    }
  });
});

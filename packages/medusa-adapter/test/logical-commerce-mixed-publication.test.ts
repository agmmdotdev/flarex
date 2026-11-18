import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { appRowIdHexV1FromBytes } from "flarex-protocol/app-document-id";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defaultCommerceResources, logicalCommerceBatchResources, type CommerceResources } from "../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { captureAtomicCommerceParticipants } from "../../persistence-postgres/src/frameworks/atomicCommerce/participants";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const origin = { kind: "synthetic", sourceId: "mixed-publication-proof" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "mixed-publication-proof",
  tables: [{ tableId: "mixed_probe", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "code", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "value", type: "integer", nullable: false, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "mixed.primary", kind: "primary", columns: ["id"], origin },
    { keyId: "mixed.code", kind: "unique", columns: ["code"], origin }], indexes: [], constraints: [], relationships: [] }], capabilities: [],
}));
const evidence = { kind: "synthetic", sourceId: "mixed-publication-proof" };
const Row = Schema.Struct({ id: Schema.String, code: Schema.String, value: Schema.Int });
const decodeSteps = Schema.decodeUnknownResult(Schema.Array(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("insert"), rows: Schema.Array(Row) }),
  Schema.Struct({ kind: Schema.Literal("update"), rows: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.Int,
    code: Schema.optionalKey(Schema.String) })) }),
  Schema.Struct({ kind: Schema.Literal("delete"), ids: Schema.Array(Schema.String) }),
])), { onExcessProperty: "error" });
type Steps = Result.Result.Success<ReturnType<typeof decodeSteps>>;
const participant = defineAtomicCommerceParticipant("mixed_probe");
const resources: CommerceResources = { ...defaultCommerceResources, catalogRows: 256, queryRows: 256, writeBatchRows: 256, facts: 256 };
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let storage: Awaited<ReturnType<typeof makeStorage>>;
let reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;

const apply = defineCommerceCommand("mixedProbeApply", "write", Effect.fn(function* (ctx, input) {
  const steps = yield* Effect.fromResult(decodeSteps(input)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const table = yield* ctx.table("mixed_probe");
  for (const step of steps) {
    if (step.kind === "delete") yield* table.delete(ctx.manager, step.ids);
    else yield* table.write(ctx.manager, step.kind, step.rows);
  }
  return null;
}));
const read = defineCommerceCommand("mixedProbeRead", "read", Effect.fn(function* (ctx, input) {
  const ids = yield* Effect.fromResult(Schema.decodeUnknownResult(Schema.Array(Schema.String))(input))
    .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  return [...yield* (yield* ctx.table("mixed_probe")).find(ctx.manager, { fields: ["id", "code", "value"],
    predicate: { kind: "in", column: "id", values: ids }, take: 128, order: { column: "id", direction: "asc" } })];
}));

async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid neutral dataset"), hashFailure: cause => new Error("Neutral dataset hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage,
    source: { sourceKey: "medusa.mixed-probe", writeProfile: "medusa.mixed-probe", schema, evidence },
    initialization: { stepId: "mixed-probe-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 },
  };
}
async function open(selectedResources: CommerceResources | null = resources, refuse = false, publication: "mixed" | null | "undefined" = "mixed") {
  const root = defineAtomicCommerceCommand("mixedNeutralRoot", Effect.fn(function* (ctx, input) {
    yield* ctx.call(participant, apply, input);
    if (refuse) return yield* ctx.refuse(commerceError("invalidInput"));
    return null;
  }));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    identityAndAccessPolicy: { profile: "neutral-mixed-publication-proof" }, requestCommandMs: 30_000, requestCallLimit: 1024,
    participants: [{ participant, logicalStorage: storage, commands: [apply],
      ...(publication === null ? {} : { logicalPublication: publication === "undefined" ? undefined : publication }),
      ...(selectedResources === null ? {} : { logicalResources: selectedResources }) }], commands: [root],
  }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { host, root };
}
const row = (id: string) => ({ id, code: id, value: 0 });
function scenario(prefix: string) {
  const oldA = `${prefix}-old-a`, oldB = `${prefix}-old-b`;
  const retained = Array.from({ length: 30 }, (_, index) => row(`${prefix}-retained-${index}`));
  const removed = Array.from({ length: 20 }, (_, index) => row(`${prefix}-removed-${index}`));
  const fresh = Array.from({ length: 80 }, (_, index) => row(`${prefix}-fresh-${index}`));
  const newA = { id: `${prefix}-new-a`, code: oldA, value: 1 }, newB = { id: `${prefix}-new-b`, code: oldB, value: 2 };
  const seed: Steps = [{ kind: "insert", rows: [row(oldA), row(oldB), ...retained, ...removed] }];
  // Author the release before each claim. The separate physical-identity case
  // below proves transfers within and across canonical source packet bounds.
  const steps: Steps = [{ kind: "delete", ids: [oldA] }, { kind: "insert", rows: [newA] },
    { kind: "delete", ids: [oldB] }, { kind: "insert", rows: fresh },
    { kind: "update", rows: retained.map(value => ({ id: value.id, value: 7 })) },
    { kind: "insert", rows: [newB] }, { kind: "delete", ids: removed.map(value => value.id) }];
  const ids = [oldA, newA.id, oldB, ...fresh.map(value => value.id), ...retained.map(value => value.id), newB.id, ...removed.map(value => value.id)];
  const expected = [newA, newB, ...fresh, ...retained.map(value => ({ ...value, value: 7 }))].sort((left, right) => left.id.localeCompare(right.id));
  return { seed, steps, ids, expected };
}
async function readRows(ids: readonly string[]) {
  const result: Array<typeof Row.Type> = [];
  for (let offset = 0; offset < ids.length; offset += 64) {
    const rows = Schema.decodeUnknownSync(Schema.Array(Row))(await Effect.runPromise(reader.read(read, ids.slice(offset, offset + 64))));
    result.push(...rows);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

describe("bounded generic mixed logical publication", () => {
  beforeAll(async () => {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.mixed-probe", owner: "medusa", writeProfile: "medusa.mixed-probe",
      evidence, definition: { kind: "relational", schema },
      bindings: [{ kind: "definition", localName: "mixed_probe", table: { namespace: "medusa", logicalName: "mixed-publication-proof/mixed_probe" } }],
    }));
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    storage = await makeStorage();
    reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [read] }));
    cleanup.push(() => Effect.runPromise(reader.close));
    await Effect.runPromise(reader.initialize([]));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("captures publication policy before source reflection, rejects invalid and physical selections, and binds only explicit selection to replay identity", async () => {
    let selected: "mixed" | undefined = "mixed";
    const member = { participant, logicalStorage: storage, commands: [apply], get logicalPublication() { return selected; } };
    let storageSelections = 0;
    const switching = new Proxy(member, { get(target, key, receiver) {
      if (key === "logicalStorage") return ++storageSelections === 1 ? storage : undefined;
      return Reflect.get(target, key, receiver);
    } });
    const captured = Result.getOrThrow(captureAtomicCommerceParticipants([switching]));
    expect(storageSelections).toBe(1);
    selected = undefined;
    const first = captured[0];
    if (first?.kind !== "logical") throw new Error("Missing captured logical member");
    expect(first.logicalPublication).toBe("mixed");
    let sourceReads = 0;
    for (const invalid of [null, false, 128, "paged", {}]) {
      const malformed = new Proxy(member, { get(target, key, receiver) {
        if (key === "logicalPublication") return invalid;
        if (key === "logicalStorage") { sourceReads++; throw new Error("Source reflected before publication refusal"); }
        return Reflect.get(target, key, receiver);
      } });
      expect(captureAtomicCommerceParticipants([malformed])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
    const physical = new Proxy(member, { get(target, key, receiver) {
      if (key === "logicalPublication") return "mixed";
      if (key === "logicalStorage") return undefined;
      if (key === "profile" || key === "installation") throw new Error("Physical preparation preceded publication refusal");
      return Reflect.get(target, key, receiver);
    } });
    expect(captureAtomicCommerceParticipants([physical])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(sourceReads).toBe(0);
    const omitted = await open(resources, false, null), ownUndefined = await open(resources, false, "undefined"), explicit = await open();
    const input: Steps = [{ kind: "insert", rows: [row("identity-default")] }], key = omitted.host.newRequestKey();
    await Effect.runPromise(omitted.host.run(key, omitted.root, input));
    const before = await logicalCurrencyInventory(fixture);
    expect(await Effect.runPromise(ownUndefined.host.run(key, ownUndefined.root, input))).toBeNull();
    const conflict = await Effect.runPromise(Effect.exit(explicit.host.run(key, explicit.root, input)));
    expect(Exit.isFailure(conflict)).toBe(true);
    if (Exit.isFailure(conflict)) expect(conflict.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "requestConflict")).toBe(true);
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
  }, 120_000);

  it("admits explicit mixed publication inside unchanged 128-identity resources while default publication still refuses", async () => {
    const small: CommerceResources = { ...resources, catalogRows: 128, queryRows: 128, writeBatchRows: 128, facts: 128 };
    const tested = await open(small), unselected = await open(small, false, null), ordinary = await open(null, false, null);
    const rows = Array.from({ length: 68 }, (_, index) => row(`small-${index}`)), removed = rows[0], target = rows.at(-1);
    if (removed === undefined || target === undefined) throw new Error("Missing small-source endpoints");
    await Effect.runPromise(tested.host.run(tested.host.newRequestKey(), tested.root, [{ kind: "insert", rows }]));
    const fresh = row("small-new"), steps: Steps = [{ kind: "delete", ids: [removed.id] },
      { kind: "update", rows: rows.slice(1).map(value => ({ id: value.id, value: 7, ...(value === target ? { code: removed.code } : {}) })) },
      { kind: "insert", rows: [fresh] }];
    const before = await logicalCurrencyInventory(fixture);
    for (const denied of [unselected, ordinary]) {
      const exit = await Effect.runPromise(Effect.exit(denied.host.run(denied.host.newRequestKey(), denied.root, steps)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded" &&
        typeof reason.error.cause === "object" && reason.error.cause !== null && "maximumIdentities" in reason.error.cause && reason.error.cause.maximumIdentities === 128)).toBe(true);
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    }
    await Effect.runPromise(tested.host.run(tested.host.newRequestKey(), tested.root, steps));
    const after = await logicalCurrencyInventory(fixture);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 69);
    expect(await readRows([...rows.map(value => value.id), fresh.id])).toEqual([...rows.slice(1).map(value => ({ ...value, value: 7,
      ...(value === target ? { code: removed.code } : {}) })), fresh].sort((left, right) => left.id.localeCompare(right.id)));
  }, 120_000);

  it("refuses an oversized connected unique-key component after a valid native staged cyclic swap and rolls back every family", async () => {
    const small: CommerceResources = { ...resources, catalogRows: 128, queryRows: 128, writeBatchRows: 128, facts: 128 }, tested = await open(small);
    const rows = Array.from({ length: 65 }, (_, index) => row(`cycle-${index}`)), first = rows[0], last = rows.at(-1);
    if (first === undefined || last === undefined) throw new Error("Missing cyclic swap endpoints");
    await Effect.runPromise(tested.host.run(tested.host.newRequestKey(), tested.root, [{ kind: "insert", rows }]));
    const steps: Array<Steps[number]> = [{ kind: "update", rows: [{ id: first.id, code: "cycle-temporary-slot", value: 7 }] }];
    for (let index = 1; index < rows.length; index++) {
      const current = rows[index], previous = rows[index - 1];
      if (current === undefined || previous === undefined) throw new Error("Missing cyclic swap member");
      steps.push({ kind: "update", rows: [{ id: current.id, code: previous.code, value: 7 }] });
    }
    steps.push({ kind: "update", rows: [{ id: first.id, code: last.code, value: 7 }] });
    const before = await logicalCurrencyInventory(fixture);
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.root, steps)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toContainEqual(expect.objectContaining({ reason: "limitExceeded", cause: { maximumIdentities: 128, changes: 65, pages: 2, componentRows: 65 } }));
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    expect(await readRows(rows.map(value => value.id))).toEqual(rows.toSorted((left, right) => left.id.localeCompare(right.id)));
  }, 120_000);

  it("publishes 134 mixed changes and transfers unique keys, preserving canonical source fact order and replay", async () => {
    const data = scenario("success"), tested = await open();
    await Effect.runPromise(tested.host.run(tested.host.newRequestKey(), tested.root, data.seed));
    const before = await logicalCurrencyInventory(fixture), key = tested.host.newRequestKey();
    expect(await Effect.runPromise(tested.host.run(key, tested.root, data.steps))).toBeNull();
    const after = await logicalCurrencyInventory(fixture);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.revisions).toHaveLength(before.revisions.length + 134);
    const facts = after.rowChanges.slice(before.rowChanges.length);
    expect(facts).toHaveLength(134);
    expect(facts.map(fact => fact.changeOrdinal)).toEqual(Array.from({ length: 134 }, (_, index) => index));
    expect(new Set(facts.map(fact => fact.commitSeq)).size).toBe(1);
    const identities = await Promise.all(after.revisions.filter(revision => !revision.isTombstone && facts.some(fact =>
      fact.tableId === revision.tableId && bytesEqualFullScan(fact.rowId, revision.rowId))).map(async revision => {
      const value = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      return { rowId: revision.rowId, id: Schema.decodeUnknownSync(Row)(value.valueJson).id };
    }));
    const factIds = facts.map(fact => identities.find(identity => bytesEqualFullScan(identity.rowId, fact.rowId))?.id);
    expect(factIds.toSorted()).toEqual(data.ids.toSorted());
    expect(facts.map(fact => appRowIdHexV1FromBytes(fact.rowId))).toEqual(facts.toSorted((left, right) => left.tableId - right.tableId ||
      appRowIdHexV1FromBytes(left.rowId).localeCompare(appRowIdHexV1FromBytes(right.rowId))).map(fact => appRowIdHexV1FromBytes(fact.rowId)));
    expect(await readRows(data.ids)).toEqual(data.expected);
    expect(await Effect.runPromise(tested.host.run(key, tested.root, data.steps))).toBeNull();
    expect(await logicalCurrencyInventory(fixture)).toEqual(after);
  }, 120_000);

  it("keeps transfers in one packet when authentic canonical row identities place their endpoints within and across naive pages", async () => {
    const tested = await open(), rows = Array.from({ length: 134 }, (_, index) => row(`physical-${index}`));
    await Effect.runPromise(tested.host.run(tested.host.newRequestKey(), tested.root, [{ kind: "insert", rows }]));
    const seeded = await logicalCurrencyInventory(fixture), seedCommit = seeded.commits.at(-1);
    if (seedCommit === undefined) throw new Error("Missing authentic seed commit");
    const physical = (await Promise.all(seeded.revisions.filter(revision => revision.commitSeq === seedCommit.commitSeq).map(async revision => ({
      rowId: appRowIdHexV1FromBytes(revision.rowId),
      row: Schema.decodeUnknownSync(Row)((await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes,
        sha256: revision.valueSha256, profile: "appDocument" })).valueJson),
    })))).sort((left, right) => left.rowId.localeCompare(right.rowId));
    expect(physical).toHaveLength(134);
    const removed = physical[0], distant = physical.at(-1), adjacentLeft = physical[10], adjacentRight = physical[11];
    if (removed === undefined || distant === undefined || adjacentLeft === undefined || adjacentRight === undefined)
      throw new Error("Missing authentic transfer endpoints");
    const selected = new Set([removed.row.id, distant.row.id, adjacentLeft.row.id, adjacentRight.row.id]);
    const fresh = row("physical-new");
    const steps: Steps = [{ kind: "delete", ids: [removed.row.id] },
      { kind: "update", rows: [{ id: distant.row.id, code: removed.row.code, value: 7 }] },
      { kind: "update", rows: [{ id: adjacentLeft.row.id, code: "physical-temporary-slot", value: 7 }] },
      { kind: "update", rows: [{ id: adjacentRight.row.id, code: adjacentLeft.row.code, value: 7 }] },
      { kind: "update", rows: [{ id: adjacentLeft.row.id, code: adjacentRight.row.code, value: 7 }] },
      { kind: "update", rows: physical.filter(value => !selected.has(value.row.id)).map(value => ({ id: value.row.id, value: 7 })) },
      { kind: "insert", rows: [fresh] }];
    await Effect.runPromise(tested.host.run(tested.host.newRequestKey(), tested.root, steps));
    const after = await logicalCurrencyInventory(fixture), facts = after.rowChanges.slice(seeded.rowChanges.length);
    expect(facts).toHaveLength(135);
    const naivePage = (rowId: string) => Math.floor(facts.findIndex(fact => appRowIdHexV1FromBytes(fact.rowId) === rowId) / 64);
    expect(naivePage(removed.rowId)).toBe(0);
    expect(naivePage(distant.rowId)).toBe(2);
    expect(naivePage(adjacentLeft.rowId)).toBe(0);
    expect(naivePage(adjacentRight.rowId)).toBe(0);
    expect(facts.map(fact => appRowIdHexV1FromBytes(fact.rowId))).toEqual(facts.toSorted((left, right) => left.tableId - right.tableId ||
      appRowIdHexV1FromBytes(left.rowId).localeCompare(appRowIdHexV1FromBytes(right.rowId))).map(fact => appRowIdHexV1FromBytes(fact.rowId)));
    const expected = [...physical.filter(value => value !== removed).map(value => ({ ...value.row, value: 7,
      code: value === distant ? removed.row.code : value === adjacentLeft ? adjacentRight.row.code : value === adjacentRight ? adjacentLeft.row.code : value.row.code })), fresh]
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(await readRows([...rows.map(value => value.id), fresh.id])).toEqual(expected);
  }, 120_000);

  it("rolls back the complete mixed graph when the root refuses before publication", async () => {
    const data = scenario("refused"), seed = await open(), tested = await open(resources, true);
    await Effect.runPromise(seed.host.run(seed.host.newRequestKey(), seed.root, data.seed));
    const before = await logicalCurrencyInventory(fixture);
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.root, data.steps)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidInput")).toBe(true);
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
  }, 120_000);

  it("rolls back rows, history, indexes, unique claims, facts and outcomes after a late fact-page failure, then retries", async () => {
    const data = scenario("late"), tested = await open();
    await Effect.runPromise(tested.host.run(tested.host.newRequestKey(), tested.root, data.seed));
    const before = await logicalCurrencyInventory(fixture), key = tested.host.newRequestKey();
    let factPages = 0;
    if (fixture.observeSql !== undefined) fixture.observeSql(text => {
      if (/\bfx_write_scope_publication_rows\b/i.test(text) && ++factPages === 2) throw new Error("neutral late second fact page");
    });
    else {
      await fixture.testOwner.query(`create function flarex_test_fail_mixed_fact_page() returns trigger language plpgsql as $$
        declare seen integer;
        begin
          seen := coalesce(nullif(current_setting('flarex.test_mixed_fact_pages', true), '')::integer, 0) + 1;
          if seen = 2 then raise exception 'neutral late second fact page'; end if;
          perform set_config('flarex.test_mixed_fact_pages', seen::text, true);
          return null;
        end $$`);
      await fixture.testOwner.query(`create trigger flarex_test_fail_mixed_fact_page after insert on fx_system_commit_app_row_change
        for each statement execute function flarex_test_fail_mixed_fact_page()`);
    }
    try {
      const exit = await Effect.runPromise(Effect.exit(tested.host.run(key, tested.root, data.steps)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("neutral late second fact page");
      if (fixture.observeSql !== undefined) expect(factPages).toBe(2);
    } finally {
      if (fixture.observeSql !== undefined) fixture.observeSql(undefined);
      else {
        await fixture.testOwner.query("drop trigger flarex_test_fail_mixed_fact_page on fx_system_commit_app_row_change");
        await fixture.testOwner.query("drop function flarex_test_fail_mixed_fact_page()");
      }
    }
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    expect(await Effect.runPromise(tested.host.run(key, tested.root, data.steps))).toBeNull();
    expect(await readRows(data.ids)).toEqual(data.expected);
  }, 120_000);

  it("retains ordinary identity refusal and explicit batch mixed refusal while pure batch create/delete remain supported", async () => {
    const data = scenario("batch"), batch = await open(logicalCommerceBatchResources, false, null),
      explicitBatch = await open(logicalCommerceBatchResources), ordinary = await open(null, false, null);
    await Effect.runPromise(batch.host.run(batch.host.newRequestKey(), batch.root, data.seed));
    const before = await logicalCurrencyInventory(fixture);
    for (const tested of [batch, explicitBatch, ordinary]) {
      const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.root, data.steps)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded")).toBe(true);
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    }
    const rows = Array.from({ length: 130 }, (_, index) => row(`pure-${index}`));
    await Effect.runPromise(batch.host.run(batch.host.newRequestKey(), batch.root, [{ kind: "insert", rows }]));
    expect(await readRows(rows.map(value => value.id))).toHaveLength(130);
    await Effect.runPromise(batch.host.run(batch.host.newRequestKey(), batch.root, [{ kind: "delete", ids: rows.map(value => value.id) }]));
    expect(await readRows(rows.map(value => value.id))).toEqual([]);
    expect((await logicalCurrencyInventory(fixture)).rowChanges).toHaveLength(before.rowChanges.length + 260);
  }, 120_000);
});

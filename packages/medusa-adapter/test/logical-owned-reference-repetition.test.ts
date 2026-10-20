import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { replaceGraphRows } from "../src/write/replace";
import type { ReplacementProfile } from "../src/write/graph-model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { volume, decodeKey, profile, sourceKey, evidence, schema } from "./support/logical-volume-graph";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const selected = defineCommerceCommand("neutralOwnedReferenceSelected", "write", Effect.fn(function* (ctx, input) {
  return (yield* replaceGraphRows(ctx, profile, volume, input, { relations: ["editions"] })).entities;
}));
const { repeatedOwnedReferences: _selected, ...ordinary } = profile;
const refused = defineCommerceCommand("neutralOwnedReferenceDefault", "write", Effect.fn(function* (ctx, input) {
  return (yield* replaceGraphRows(ctx, ordinary, volume, input, { relations: ["editions"] })).entities;
}));
const late = defineCommerceCommand("neutralOwnedReferenceLateFailure", "write", Effect.fn(function* (ctx, input) {
  yield* replaceGraphRows(ctx, profile, volume, input, { relations: ["editions"] });
  return yield* ctx.refuse(commerceError("invalidInput"));
}));
const managedProfile: ReplacementProfile = { ...profile, ownedChildUpdatedAt: "managed" };
const managed = defineCommerceCommand("neutralOwnedChildManagedClock", "write", Effect.fn(function* (ctx, input) {
  return (yield* replaceGraphRows(ctx, managedProfile, volume, input, { relations: ["editions"] })).entities;
}));
const managedLate = defineCommerceCommand("neutralOwnedChildManagedClockLateFailure", "write", Effect.fn(function* (ctx, input) {
  yield* replaceGraphRows(ctx, managedProfile, volume, input, { relations: ["editions"] });
  return yield* ctx.refuse(commerceError("invalidInput"));
}));
const touchedProfile: ReplacementProfile = { ...profile, touchExistingRoot: true };
const touched = defineCommerceCommand("neutralExistingRootManagedTouch", "write", Effect.fn(function* (ctx, input) {
  return (yield* replaceGraphRows(ctx, touchedProfile, volume, input, { relations: ["editions"] })).entities;
}));
const touchedLate = defineCommerceCommand("neutralExistingRootManagedTouchLateFailure", "write", Effect.fn(function* (ctx, input) {
  yield* replaceGraphRows(ctx, touchedProfile, volume, input, { relations: ["editions"] });
  return yield* ctx.refuse(commerceError("invalidInput"));
}));
const seed = defineCommerceCommand("neutralOwnedReferenceSeed", "write", Effect.fn(function* (ctx, input) {
  const prefix = yield* Effect.fromResult(decodeKey(input)), roots = yield* ctx.table("volumes"), children = yield* ctx.table("editions");
  yield* roots.write(ctx.manager, "insert", [{ isbn: prefix + "-own", title: "Own" }, { isbn: prefix + "-other", title: "Other" }]);
  yield* children.write(ctx.manager, "insert", [
    { serial: prefix + "-kept", volume_isbn: prefix + "-own", label: "Kept" },
    { serial: prefix + "-removed", volume_isbn: prefix + "-own", label: "Removed" },
    { serial: prefix + "-past", volume_isbn: prefix + "-own", label: "Historical" },
    { serial: prefix + "-foreign", volume_isbn: prefix + "-other", label: "Foreign" },
  ]);
  yield* children.lifecycle(ctx.manager, "softDelete", [{ serial: prefix + "-past" }]);
  return null;
}));
const read = defineCommerceCommand("neutralOwnedReferenceRead", "read", Effect.fn(function* (ctx) {
  const output: JsonObject[] = [];
  for (const [name, key] of [["volumes", "isbn"], ["editions", "serial"]]) {
    if (name === undefined || key === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    output.push(...yield* (yield* ctx.table(name)).find(ctx.manager, { take: 64, order: { column: key, direction: "asc" } }));
  }
  return output;
}));
const commands = [seed, selected, refused, late, managed, managedLate, touched, touchedLate, read];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>, host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
const run = (command: typeof selected, input: Json) => Effect.runPromise(host.run(host.newRequestKey(), command, input));
const decodeReadRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const rows = async () => decodeReadRows(await Effect.runPromise(host.read(read, null)));
const snapshot = async () => {
  const inventory = await logicalCurrencyInventory(fixture);
  return { rows: inventory.rows, revisions: inventory.revisions, indexEntries: inventory.indexEntries, indexRevisions: inventory.indexRevisions,
    uniqueKeys: inventory.uniqueKeys, rowChanges: inventory.rowChanges, physicalFacts: inventory.physicalFacts, events: inventory.events };
};
const input = (prefix: string) => [{ isbn: prefix + "-own", editions: [{ serial: prefix + "-kept" }, { serial: prefix + "-kept" }] }];

describe(`neutral owned reference repetition - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey,
      evidence, definition: { kind: "relational", schema }, bindings: ["volumes", "editions"].map(localName => ({ kind: "definition" as const,
        localName, table: { namespace: "medusa" as const, logicalName: "neutral-owned-reference-repetition/" + localName } })) }));
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => new Error("Invalid neutral graph dataset"), hashFailure: cause => new Error("Neutral graph dataset hash", { cause }) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "neutral-owned-reference-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } };
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands }));
    cleanup.push(() => Effect.runPromise(host.close)); await Effect.runPromise(host.initialize([]));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("stores and returns one retained existing member, deletes only its omitted sibling and replays once", async () => {
    const prefix = "selected147"; await run(seed, prefix);
    const before = await rows(), key = host.newRequestKey(), result = await Effect.runPromise(host.run(key, selected, input(prefix)));
    expect(result).toEqual([expect.objectContaining({ isbn: prefix + "-own", editions: [expect.objectContaining({ serial: prefix + "-kept", label: "Kept" })] })]);
    const after = await rows();
    expect(after.find(row => row.serial === prefix + "-kept")).toEqual(before.find(row => row.serial === prefix + "-kept"));
    expect(after.find(row => row.serial === prefix + "-removed")).toBeUndefined();
    expect(after.filter(row => row.serial !== prefix + "-removed")).toEqual(before.filter(row => row.serial !== prefix + "-removed"));
    const durable = await snapshot(); expect(await Effect.runPromise(host.run(key, selected, input(prefix)))).toEqual(result);
    expect(await snapshot()).toEqual(durable);
  }, 180_000);

  it("keeps default duplicate refusal without publishing pending changes", async () => {
    const prefix = "default147"; await run(seed, prefix); const before = await snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), refused, input(prefix)))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it.each(["conflict", "first-write", "new", "historical", "foreign", "root"] as const)("refuses %s repeats in the selected profile before publication", async kind => {
    const prefix = "refused147-" + kind; await run(seed, prefix);
    const root = prefix + "-own", member = prefix + (kind === "new" ? "-new" : kind === "historical" ? "-past" : kind === "foreign" ? "-foreign" : "-kept");
    const request = kind === "root" ? [{ isbn: root }, { isbn: root }] : [{ isbn: root, editions: [
      { serial: member, ...(kind === "first-write" ? { label: "Changed" } : {}) }, { serial: member, ...(kind === "conflict" ? { label: "Changed" } : {}) },
    ] }];
    const before = await snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), selected, request))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("rolls back the actual completed shared graph writes when its outer owner refuses", async () => {
    const prefix = "late147"; await run(seed, prefix); const before = await snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), late, input(prefix)))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("keeps an opted-in owned child's clock authoritative, replays once and touches repeated explicit clock changes", async () => {
    const prefix = "managed-clock147"; await run(seed, prefix);
    const before = await rows(), previous = before.find(row => row.serial === prefix + "-kept");
    if (previous === undefined) throw new Error("Missing neutral owned clock member");
    const suppliedStamp = "2099-01-02T03:04:05.678Z";
    const request = [{ isbn: prefix + "-own", editions: [{ ...previous, label: "Changed", updated_at: suppliedStamp }, { serial: prefix + "-removed" }] }];
    const key = host.newRequestKey(), result = await Effect.runPromise(host.run(key, managed, request));
    const after = await rows(), written = after.find(row => row.serial === previous.serial);
    expect(written).toMatchObject({ ...previous, label: "Changed", updated_at: expect.any(String) });
    expect(written?.updated_at).not.toBe(suppliedStamp);
    expect(after.filter(row => row.serial !== previous.serial)).toEqual(before.filter(row => row.serial !== previous.serial));
    const settled = await snapshot();
    expect(await Effect.runPromise(host.run(key, managed, request))).toEqual(result); expect(await snapshot()).toEqual(settled);
    // Reusing the same supplied stamp after business content already
    // matches must still perform an ordinary managed write, never store it.
    await run(managed, request);
    const repeated = await snapshot(), current = (await rows()).find(row => row.serial === previous.serial);
    expect(current).toMatchObject({ ...previous, label: "Changed", updated_at: expect.any(String) });
    expect(current?.updated_at).not.toBe(suppliedStamp);
    expect(repeated.revisions.length).toBeGreaterThan(settled.revisions.length);
    expect(repeated.rowChanges.length).toBeGreaterThan(settled.rowChanges.length);
  }, 180_000);

  it.each(["default", "root", "created_at", "deleted_at", "invalid-clock", "new-child"] as const)(
    "keeps %s outside the owned-child managed clock policy without publication", async kind => {
      const prefix = "managed-clock-refused147-" + kind; await run(seed, prefix);
      const previous = (await rows()).find(row => row.serial === prefix + "-kept");
      if (previous === undefined) throw new Error("Missing neutral managed clock refusal member");
      const other = "2099-01-02T03:04:05.678Z";
      const member = { ...previous, updated_at: other, ...(kind === "created_at" ? { created_at: other } : {}),
        ...(kind === "deleted_at" ? { deleted_at: other } : {}), ...(kind === "invalid-clock" ? { updated_at: "invalid-date" } : {}) };
      const request = kind === "root" ? [{ isbn: prefix + "-own", updated_at: other }]
        : [{ isbn: prefix + "-own", editions: kind === "new-child" ? [{ serial: prefix + "-new", label: "New", updated_at: other }]
          : [member, { serial: prefix + "-removed" }] }];
      const before = await snapshot();
      expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), kind === "default" ? selected : managed, request))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(await snapshot()).toEqual(before);
    }, 180_000);

  it("rolls back an actual owned-child managed clock write on late outer refusal", async () => {
    const prefix = "managed-clock-late147"; await run(seed, prefix);
    const previous = (await rows()).find(row => row.serial === prefix + "-kept");
    if (previous === undefined) throw new Error("Missing neutral managed clock rollback member");
    const request = [{ isbn: prefix + "-own", editions: [{ ...previous, label: "Pending", updated_at: "2099-01-02T03:04:05.678Z" },
      { serial: prefix + "-removed" }] }], before = await snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), managedLate, request))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("touches only the existing root under an explicit profile and replays its managed write once", async () => {
    const prefix = "root-touch147"; await run(seed, prefix);
    const request = [{ isbn: prefix + "-own" }], before = await rows();
    await run(selected, request); expect(await rows()).toEqual(before);
    const baseline = await snapshot(), key = host.newRequestKey(), result = await Effect.runPromise(host.run(key, touched, request));
    const after = await rows(), previous = before.find(row => row.isbn === prefix + "-own"), current = after.find(row => row.isbn === prefix + "-own");
    if (previous === undefined || current === undefined) throw new Error("Missing neutral touched root");
    expect(current).toEqual({ ...previous, updated_at: expect.any(String) }); expect(current.updated_at).not.toBe(previous.updated_at);
    expect(after.filter(row => row.isbn !== previous.isbn)).toEqual(before.filter(row => row.isbn !== previous.isbn));
    const settled = await snapshot();
    expect(settled.revisions.length - baseline.revisions.length).toBe(1); expect(settled.rowChanges.length - baseline.rowChanges.length).toBe(1);
    expect(await Effect.runPromise(host.run(key, touched, request))).toEqual(result); expect(await snapshot()).toEqual(settled);
  }, 180_000);

  it.each(["created_at", "updated_at", "deleted_at", "child-clock"] as const)("keeps %s strict under the root-touch policy", async kind => {
    const prefix = "root-touch-refused147-" + kind; await run(seed, prefix);
    const clock = "2099-01-02T03:04:05.678Z", request = [{ isbn: prefix + "-own", ...(kind === "child-clock"
      ? { editions: [{ serial: prefix + "-kept", updated_at: clock }, { serial: prefix + "-removed" }] } : { [kind]: clock }) }];
    const before = await snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), touched, request))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("rolls back the explicit existing-root touch when its outer owner refuses", async () => {
    const prefix = "root-touch-late147"; await run(seed, prefix); const before = await snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), touchedLate, [{ isbn: prefix + "-own" }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

});

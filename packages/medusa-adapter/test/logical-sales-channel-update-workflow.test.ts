import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareCoreSalesChannelUpdate } from "./support/core-sales-channel-update-fixture";
import { expectWorkflowDefect, expectWorkflowRefusal } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreSalesChannelUpdate>>;
const rows = async () => (await connected.fixture.snapshot()).rows;
const facts = async () => (await connected.fixture.snapshot()).revisions;
const commits = async () => (await connected.fixture.snapshot()).outcomes;
const events = async () => (await connected.fixture.snapshot()).events;
const snapshot = () => connected.fixture.snapshot();
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}

describe("native Sales Channel selector update on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareCoreSalesChannelUpdate(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("retains native zero-match undefined through the genuine composer failure", async () => {
    const original = SalesChannelModuleService.prototype.updateSalesChannels;
    let returnedUndefined = false;
    const native = vi.spyOn(SalesChannelModuleService.prototype, "updateSalesChannels")
      .mockImplementation(async function (this: SalesChannelModuleService, ...args) {
        const result = await Reflect.apply(original, this, args);
        returnedUndefined = result === undefined;
        return result;
      });
    const host = await connected.prepareUpdate();
    try {
      const before = await snapshot();
      const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), {
        selector: { id: "missing-native-sales-channel" }, update: { name: "Unused" },
      }));
      if (Exit.isSuccess(result)) throw new Error("Native zero-match workflow unexpectedly succeeded");
      expect(returnedUndefined).toBe(true); expect(native).toHaveBeenCalledTimes(1);
      const defects = result.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect);
      expect(defects).toHaveLength(1);
      const [originalFailure] = defects;
      if (!(originalFailure instanceof TypeError)) throw new Error("Native composer lost its original TypeError");
      expect(originalFailure.message).toBe("Cannot read properties of undefined (reading 'id')");
      expectWorkflowDefect(result, originalFailure);
      expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("updates all four matches but returns one row and one workflow event, with replay and conflicts", async () => {
    const ids = await connected.seed("sales-update-four", 4);
    const native = vi.spyOn(SalesChannelModuleService.prototype, "updateSalesChannels");
    const host = await connected.prepareUpdate(), changed = await connected.prepareUpdate("e".repeat(64));
    const input = { selector: {}, update: { name: "Updated all four", description: "Native selector update", is_disabled: true } };
    try {
      const before = await snapshot(), key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input));
      expect(Array.isArray(result)).toBe(false);
      expect(result).toMatchObject({ id: ids[0], ...input.update });
      expect(await Effect.runPromise(connected.list(ids))).toMatchObject(ids.map(id => ({ id, ...input.update })));
      const table = connected.sales.schema.tables.find(value => value.identity.tableId === "sales_channel");
      if (table === undefined) throw new Error("Missing genuine Sales Channel schema");
      expect(Object.keys(result).sort()).toEqual(table.columns.map(column => column.identity.columnId).sort());
      const emitted = (await events()).slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([
        ...ids.map(() => "sales_channel.sales-channel.updated"), "sales-channel.updated",
      ]);
      expect(emitted.filter(event => event.envelope.internal).map(event => event.envelope.message))
        .toEqual(ids.map(id => expect.objectContaining({ data: { id } })));
      expect(emitted.filter(event => !event.envelope.internal).map(event => event.envelope.message))
        .toEqual([expect.objectContaining({ data: { id: ids[0] } })]);
      expect((await commits()).length - before.outcomes.length).toBe(1);
      expect(new Set(emitted.map(event => event.timestamp)).size).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { ...input, update: { name: "Conflict" } })))
        .rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(committed);
    } finally { native.mockRestore(); await Effect.runPromise(connected.remove(ids)); }
  }, 120_000);

  it("uses native metadata merge and a genuine empty update without DAL changes or internal events", async () => {
    const ids = await connected.seed("sales-update-metadata", 2), first = ids[0];
    if (first === undefined) throw new Error("Missing seeded Sales Channel");
    const host = await connected.prepareUpdate();
    try {
      await Effect.runPromise(host.run(host.newRequestKey(), { selector: { name: ["sales-update-metadata"], is_disabled: false },
        update: { metadata: { drop: "", nested: { after: true }, added: "new" } } }));
      expect(await Effect.runPromise(connected.list(ids))).toMatchObject(ids.map((id, index) => ({ id,
        metadata: { keep: "row-" + index, nested: { after: true }, added: "new" } })));
      const before = await snapshot();
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: first }, update: {} }));
      expect(result).toMatchObject({ id: first });
      expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.revisions);
      expect((await events()).slice(before.events.length).map(event => ({ contract: event.envelope.contract, internal: event.envelope.internal })))
        .toEqual([{ contract: "sales-channel.updated", internal: false }]);
      expect((await commits()).length - before.outcomes.length).toBe(1);
      await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: first }, update: { metadata: null } }));
      expect(await Effect.runPromise(connected.list([first]))).toMatchObject([{ id: first, metadata: null }]);
      await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: first }, update: { metadata: {} } }));
      expect(await Effect.runPromise(connected.list([first]))).toMatchObject([{ id: first, metadata: {} }]);
    } finally { await Effect.runPromise(connected.remove(ids)); }
  }, 120_000);

  it("rejects malformed selectors/data and a fifth actual match before native update writes", async () => {
    const ids = await connected.seed("sales-update-overflow", 5), first = ids[0];
    if (first === undefined) throw new Error("Missing overflow seed");
    const native = vi.spyOn(SalesChannelModuleService.prototype, "updateSalesChannels");
    const host = await connected.prepareUpdate();
    try {
      const before = await snapshot();
      const rejected = [
        { selector: { id: ids }, update: { name: "Too many IDs" } },
        { selector: { id: first, q: "search" }, update: { name: "Unsupported search" } },
        { selector: { id: first, foreign_field: true }, update: { name: "Unknown selector" } },
        { selector: { id: first }, update: { name: "Rejected", id: "replacement" } },
        { selector: { id: first }, update: { name: "Rejected", created_at: "2020-01-01T00:00:00Z" } },
        { selector: { id: first }, update: { name: "Rejected", deleted_at: null } },
        { selector: { id: first }, update: { name: "Rejected", foreign_field: true } },
      ];
      for (const input of rejected) {
        const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)));
        expect(Result.isFailure(result)).toBe(true);
      }
      const overflow = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: {}, update: { name: "No truncated update" } })));
      if (Result.isSuccess(overflow)) throw new Error("Fifth actual Sales Channel match was admitted");
      expect(failurePath(overflow.failure)).toContain("unsupportedProfile");
      expect(native).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); await Effect.runPromise(connected.remove(ids)); }
  }, 120_000);

  it("rolls back real native writes/events after a late throw or malformed complete return", async () => {
    const ids = await connected.seed("sales-update-late"), first = ids[0];
    if (first === undefined) throw new Error("Missing seeded Sales Channel");
    const host = await connected.prepareUpdate();
    try {
      for (const mode of ["throw", "malformed"] as const) {
        const original = SalesChannelModuleService.prototype.updateSalesChannels;
        const failure = new Error("Late native Sales Channel update failure");
        let nativeCompleted = false;
        const native = vi.spyOn(SalesChannelModuleService.prototype, "updateSalesChannels")
          .mockImplementation(async function (this: SalesChannelModuleService, ...args) {
            const result = await Reflect.apply(original, this, args);
            nativeCompleted = true;
            if (mode === "throw") throw failure;
            if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error("Missing genuine scalar native update result");
            Object.defineProperty(result, "is_disabled", { value: "invalid", enumerable: true, writable: true, configurable: true });
            return result;
          });
        try {
          const before = await snapshot();
          const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { selector: { id: first }, update: { name: "Must roll back" } }));
          expect(nativeCompleted).toBe(true); expect(native).toHaveBeenCalledTimes(1);
          // The logical-call receipt validates native results before the method
          // decoder; a forged return therefore fails at that earlier owner.
          if (mode === "throw") expectWorkflowDefect(result, failure);
          else expectWorkflowRefusal(result, "receiptMismatch");
          expect(await snapshot()).toEqual(before);
        } finally { native.mockRestore(); }
      }
    } finally { await Effect.runPromise(connected.remove(ids)); }
  }, 120_000);

  it("isolates selectors and identical update request keys in two genuine scopes", async () => {
    const other = await prepareCoreSalesChannelUpdate(driver, close => cleanup.push(close), {
      physical: connected.fixture.physical,
    });
    const ids = await connected.seed("sales-update-shared"), otherIds = await other.seed("sales-update-shared");
    const first = await connected.prepareUpdate(), second = await other.prepareUpdate(), key = first.newRequestKey();
    const left = { selector: { id: ids }, update: { name: "First shop update" } };
    const right = { selector: { id: otherIds }, update: { name: "Second shop update", is_disabled: true } };
    try {
      const leftResult = await Effect.runPromise(first.run(key, left));
      const rightResult = await Effect.runPromise(second.run(key, right));
      expect(await Effect.runPromise(connected.list(ids))).toMatchObject([{ id: ids[0], name: "First shop update", is_disabled: false }]);
      expect(await Effect.runPromise(other.list(otherIds))).toMatchObject([{ id: otherIds[0], name: "Second shop update", is_disabled: true }]);
      const before = await Promise.all([snapshot(), other.fixture.snapshot()]);
      expect(await Effect.runPromise(first.run(key, left))).toEqual(leftResult);
      expect(await Effect.runPromise(second.run(key, right))).toEqual(rightResult);
      expect(await Promise.all([snapshot(), other.fixture.snapshot()])).toEqual(before);
    } finally { await Effect.runPromise(connected.remove(ids)); await Effect.runPromise(other.remove(otherIds)); }
  }, 180_000);
});

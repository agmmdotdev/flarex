import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Fiber, Option, Result } from "effect";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { isNonArrayRecord } from "@flarex/utils/records";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { readCoreFixtureRegistry } from "../../persistence-postgres/test/core/fixture";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { currencyAnnouncementWrite, currencyCommands, withCurrencyService } from "../src/modules/currency/service";
import { createCoreCurrencyFixture, type CoreCurrencyFixture, type CoreCurrencyInventory } from "./support/core-currency-fixture";
import { expectNative12Failure, native12Arguments } from "./support/native12-current-observations";

const data = (inventory: CoreCurrencyInventory) => ({ rows: inventory.rows, revisions: inventory.revisions });
const currencyRow = async (fixture: CoreCurrencyFixture, code: string) => {
  const row = (await fixture.inventory()).rows.find(row => row.value.code === code);
  if (row === undefined) throw new Error(`Missing native Currency ${code}`);
  return row;
};
const softDeleteCurrency = defineCommerceCommand("nativeCurrencySoftDeleteWitness", "write", ctx =>
  withCurrencyService(ctx, async ({ repository, context }) => { await repository.softDelete({ code: "zzx" }, context); return null; }));
const hardDeleteCurrency = defineCommerceCommand("nativeCurrencyHardDeleteWitness", "write", ctx =>
  withCurrencyService(ctx, async ({ repository, context }) => { await repository.delete({ code: "zzx" }, context); return null; }));
const duplicateCurrency = defineCommerceCommand("nativeCurrencyDuplicateWitness", "write", ctx =>
  withCurrencyService(ctx, async ({ repository, context }) => {
    await repository.create([{ code: "zzx", name: "Duplicate", symbol: "D", symbol_native: "D" }], context);
    return null;
  }));

for (const driver of ["pglite", "postgres"] as const) {
  describe.skipIf(driver === "postgres" && postgresUrl === null)(`Currency and native Payload on translated Core ${driver}`, () => {
    it("rejects stored exact/raw corruption before a code-only Currency projection", async () => {
      const fixture = await createCoreCurrencyFixture(driver);
      try {
        const row = await currencyRow(fixture, "usd");
        expect(await fixture.service.retrieveCurrency("usd", { select: ["code"] })).toEqual({ code: "usd" });
        const original = await fixture.run(Effect.gen(function* () {
          const id = yield* Effect.fromResult(decodeDocumentId(row.value._id));
          const metadata = yield* fixture.database.readNativeBinding(fixture.currencyBinding);
          const registry = yield* readCoreFixtureRegistry(fixture, yield* fixture.database.publishedTimestamp);
          const table = registry.tableByNumber(id.tableNumber, metadata.namespace)?.definition;
          if (table === undefined || table.name !== row.table) return yield* Effect.die(new Error("Missing fixture Currency table"));
          const snapshot = yield* fixture.persistence.readSnapshot(row.timestamp);
          const stored = yield* snapshot.get(table.tabletId, id.internalId);
          if (Option.isNone(stored)) return yield* Effect.die(new Error("Missing fixture Currency revision"));
          expect(stored.value.ts).toBe(row.timestamp);
          return stored.value;
        }));
        const raw = row.value.raw_rounding;
        if (!isNonArrayRecord(raw) || typeof raw.value !== "string") throw new Error("Missing fixture exact-number companion");
        const corrupted = Result.getOrThrow(encodeDocumentValue({ ...row.value,
          raw_rounding: { ...raw, value: raw.value === "1" ? "2" : "1" } }));
        const updateRevision = (jsonValue: Uint8Array) => fixture.physical.query(
          `UPDATE "${fixture.physical.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5 RETURNING ts`,
          [jsonValue, fixture.physical.instanceName, original.tableId, original.id, original.ts.toString()]);
        try {
          expect(await updateRevision(corrupted)).toHaveLength(1);
          await fixture.reopen();
          expectNative12Failure(await fixture.run(Effect.exit(fixture.host.read(currencyCommands.retrieve,
            { code: "usd", config: { select: ["code"] } }))), "storedCorruption");
        } finally {
          expect(await updateRevision(original.jsonValue)).toHaveLength(1);
        }
        await fixture.reopen();
        expect(await fixture.service.retrieveCurrency("usd", { select: ["code"] })).toEqual({ code: "usd" });
      } finally { await fixture.close(); }
    }, 180_000);

    it("refuses a nonempty source beyond its cap and retries the same failed initialization", async () => {
      const fixture = await createCoreCurrencyFixture(driver, { initialize: false });
      try {
        expectNative12Failure(await fixture.run(Effect.exit(fixture.host.read(currencyCommands.retrieve, { code: "usd" }))), "seedRequired");
        const existing = Array.from({ length: 130 }, (_, index) => ({ code: `fixture-${index.toString().padStart(3, "0")}`,
          name: "Existing fixture Currency", symbol: "F", symbol_native: "F" }));
        expect(await fixture.maintainCurrencyForInitialization({ insert: existing.slice(0, 128) })).toBe(128);
        expect(await fixture.maintainCurrencyForInitialization({ insert: existing.slice(128) })).toBe(2);
        const before = await fixture.inventory();
        expect(before.rows).toHaveLength(130);
        expectNative12Failure(await fixture.run(Effect.exit(fixture.host.initialize(fixture.initialization.rows))), "seedMismatch");
        const refused = await fixture.inventory();
        expect(data(refused)).toEqual(data(before));
        expect(refused.outcomes).toHaveLength(1);
        const failed = refused.outcomes[0];
        expect(failed?.value.state).toBe("failed");
        expectNative12Failure(await fixture.run(Effect.exit(fixture.host.read(currencyCommands.retrieve, { code: "fixture-000" }))), "seedRequired");
        expect(await fixture.maintainCurrencyForInitialization({ delete: existing.slice(0, 128).map(row => row.code) })).toBe(128);
        expect(await fixture.maintainCurrencyForInitialization({ delete: existing.slice(128).map(row => row.code) })).toBe(2);
        expect((await fixture.inventory()).rows).toHaveLength(0);
        expect(await fixture.run(fixture.host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        const seeded = await fixture.inventory();
        expect(seeded.rows).toHaveLength(123);
        expect(seeded.outcomes).toHaveLength(1);
        expect(seeded.outcomes[0]?.value).toMatchObject({ _id: failed?.value._id, key: failed?.value.key,
          state: "committed", result: JSON.stringify({ rowCount: 123 }) });
        expect(await fixture.run(fixture.host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        expect(await fixture.inventory()).toEqual(seeded);
        await fixture.reopen();
        const cold = await fixture.inventory();
        expect(await fixture.run(fixture.host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        expect(await fixture.service.retrieveCurrency("usd")).toMatchObject({ code: "usd" });
        expect(await fixture.inventory()).toEqual(cold);
      } finally { await fixture.close(); }
    }, 180_000);

    it("initializes once and preserves genuine Currency exact/default/lifecycle behavior", async () => {
      const fixture = await createCoreCurrencyFixture(driver, { initialize: false,
        commands: [softDeleteCurrency, hardDeleteCurrency, duplicateCurrency] });
      try {
        expectNative12Failure(await fixture.run(Effect.exit(fixture.host.read(currencyCommands.retrieve, { code: "usd" }))), "seedRequired");
        const wrong = fixture.initialization.rows.map((row, index) => index === 0 ? { ...row, name: "Changed dataset" } : row);
        expectNative12Failure(await fixture.run(Effect.exit(fixture.host.initialize(wrong))), "seedMismatch");
        expect((await fixture.inventory()).rows).toHaveLength(0);
        expect(await fixture.run(fixture.host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        const seeded = await fixture.inventory();
        expect(seeded.rows).toHaveLength(123);
        expect(await fixture.run(fixture.host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        expect(await fixture.inventory()).toEqual(seeded);
        expect(await fixture.service.retrieveCurrency("usd")).toMatchObject({ code: "usd", decimal_digits: 2 });
        const [page, total] = await fixture.service.listAndCountCurrencies({ code: ["usd", "eur"] }, { take: 1 });
        expect(page).toHaveLength(1); expect(total).toBe(2);
        const [first, all] = await fixture.service.listAndCountCurrencies({}, { take: 1 });
        expect(first).toHaveLength(1); expect(all).toBe(123);
        const value = { code: "zzx", name: "Exact", symbol: "N", symbol_native: "N", decimal_digits: 2.5,
          rounding: "0.00000000000000000001" };
        await fixture.run(fixture.host.run(fixture.host.newRequestKey(), currencyAnnouncementWrite, value));
        const original = await currencyRow(fixture, "zzx");
        const expectedRaw = new BigNumber(value.rounding).raw;
        expect(original.value).toMatchObject({ code: "zzx", decimal_digits: 2.5,
          rounding: expectedRaw?.value, raw_rounding: expectedRaw, deleted_at: null });
        await fixture.run(Effect.sleep(20));
        await fixture.run(fixture.host.run(fixture.host.newRequestKey(), currencyAnnouncementWrite, { ...value, name: "Upserted" }));
        const updated = await currencyRow(fixture, "zzx");
        expect(updated.value._id).toBe(original.value._id);
        expect(updated.value.created_at).toBe(original.value.created_at);
        expect(updated.value.updated_at).toBe(original.value.updated_at);
        await fixture.run(fixture.host.run(fixture.host.newRequestKey(), softDeleteCurrency, null));
        const deleted = await currencyRow(fixture, "zzx");
        expect(deleted.value.deleted_at).not.toBeNull();
        expectNative12Failure(await fixture.run(Effect.exit(fixture.host.run(fixture.host.newRequestKey(), duplicateCurrency, null))), "invalidInput");
        await expect(fixture.service.retrieveCurrency("zzx")).rejects.toMatchObject({ type: "not_found" });
        await fixture.run(fixture.host.run(fixture.host.newRequestKey(), currencyAnnouncementWrite, { ...value, name: "Restored" }));
        const restored = await currencyRow(fixture, "zzx");
        expect(restored.value._id).toBe(original.value._id);
        expect(restored.value.deleted_at).toBeNull();
        expect(restored.value.updated_at).toBe(deleted.value.updated_at);
        await fixture.run(fixture.host.run(fixture.host.newRequestKey(), hardDeleteCurrency, null));
        await fixture.run(fixture.host.run(fixture.host.newRequestKey(), currencyAnnouncementWrite, value));
        expect((await currencyRow(fixture, "zzx")).value._id).not.toBe(original.value._id);
        await fixture.reopen();
        const beforeReplay = await fixture.inventory();
        expect(await fixture.run(fixture.host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        expect(await fixture.inventory()).toEqual(beforeReplay);
      } finally { await fixture.close(); }
    }, 180_000);

    it("runs the real Local API/hooks with atomic App writes, replay, refusal and cancellation", async () => {
      const fixture = await createCoreCurrencyFixture(driver, { includeUserNameIndex: true });
      try {
        await fixture.run(Effect.scoped(Effect.gen(function* () {
          const host = yield* fixture.announcement();
          const observer = yield* fixture.database.begin();
          yield* observer.scan("users", "by_name");
          const before = yield* Effect.promise(() => fixture.inventory());
          const key = host.newRequestKey(), args = native12Arguments("nnn", "native-payload");
          const result = yield* host.run(key, args);
          expect(result).toMatchObject({ currency: { code: "nnn" }, cms: { title: "native-payload" }, applicationId: expect.any(String) });
          const after = yield* Effect.promise(() => fixture.inventory());
          expect(after.rows).toHaveLength(before.rows.length + 3);
          const changes = after.revisions.slice(before.revisions.length);
          expect(changes).toHaveLength(3);
          expect(new Set(changes.map(change => change.timestamp)).size).toBe(1);
          const outcome = after.outcomes.find(row => row.value.key === key);
          expect(outcome?.value.state).toBe("committed");
          expect(outcome?.timestamp).toBe(changes[0]?.timestamp);
          expect(fixture.payload.observations.executions()).toBe(1);
          expect(fixture.payload.observations.touched()).toContain("posts");
          yield* observer.insert("users", { name: "stale observer" });
          expectNative12Failure(yield* Effect.exit(fixture.database.commit(yield* observer.finalize())), "conflict");
          expect(yield* host.run(key, args)).toEqual(result);
          expect(fixture.payload.observations.executions()).toBe(1);
          expect(yield* Effect.promise(() => fixture.inventory())).toEqual(after);
          expectNative12Failure(yield* Effect.exit(host.run(key, native12Arguments("nnn", "changed-key-arguments"))), "requestConflict");
          const invalid = { ...native12Arguments("aaa", "invalid-application"), application: { name: 42 } };
          expectNative12Failure(yield* Effect.exit(host.run(host.newRequestKey(), invalid)), "documentInvalid");
          for (const [title, code] of [["nested-caught", "bbb"], ["id-foreign", "ccc"], ["id-removed", "ddd"]] as const) {
            expect(Exit.isFailure(yield* Effect.exit(host.run(host.newRequestKey(), native12Arguments(code, title))))).toBe(true);
            expect(data(yield* Effect.promise(() => fixture.inventory()))).toEqual(data(after));
          }
          expect(yield* host.run(host.newRequestKey(), native12Arguments("eee", "nested-ok"))).toMatchObject({ cms: { title: "nested-ok" } });
          const nested = yield* Effect.promise(() => fixture.inventory());
          expect(nested.rows).toHaveLength(after.rows.length + 4);
          expect(nested.revisions).toHaveLength(after.revisions.length + 4);
          const pendingBefore = fixture.payload.observations.pendingReads();
          yield* Effect.scoped(Effect.gen(function* () {
            const fiber = yield* host.run(host.newRequestKey(), native12Arguments("fff", "id-unresolved")).pipe(Effect.forkScoped);
            yield* Effect.gen(function* () {
              while (fixture.payload.observations.pendingReads() === pendingBefore) yield* Effect.sleep(10);
            }).pipe(Effect.timeout("5 seconds"));
            yield* Fiber.interrupt(fiber);
            const interrupted = yield* Fiber.await(fiber);
            expect(Exit.isFailure(interrupted)).toBe(true);
            if (Exit.isFailure(interrupted)) expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
          }));
          expect(data(yield* Effect.promise(() => fixture.inventory()))).toEqual(data(nested));
        })));
      } finally { await fixture.close(); }
    }, 180_000);

    it("recovers a lost final acknowledgement and replays cold without callbacks", async () => {
      const fixture = await createCoreCurrencyFixture(driver);
      try {
        let executions = 0, key = "";
        const args = native12Arguments("ack", "uncertain-payload");
        await fixture.run(Effect.scoped(Effect.gen(function* () {
          const host = yield* fixture.announcement({ hooks: { afterSteps: () => Effect.sync(() => {
            executions++; fixture.loseNextWriteAcknowledgement();
          }) } });
          key = host.newRequestKey();
          expectNative12Failure(yield* Effect.exit(host.run(key, args)), "decisionUncertain");
          expect(executions).toBe(1);
          expect(fixture.payload.observations.executions()).toBe(1);
        })));
        await fixture.reopen();
        await fixture.run(Effect.scoped(Effect.gen(function* () {
          const host = yield* fixture.announcement({ hooks: { afterSteps: () => Effect.sync(() => { executions++; }) } });
          const before = yield* Effect.promise(() => fixture.inventory());
          expect(yield* host.run(key, args)).toMatchObject({ currency: { code: "ack" }, cms: { title: "uncertain-payload" }, applicationId: expect.any(String) });
          expect(executions).toBe(1);
          expect(fixture.payload.observations.executions()).toBe(0);
          expect(yield* Effect.promise(() => fixture.inventory())).toEqual(before);
        })));
      } finally { await fixture.close(); }
    }, 180_000);
  });
}

import { createHash } from "node:crypto";
import { Deferred, Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { ApplicationWritePolicyDigest, makeApplicationWritePolicyDigest } from "@flarex/analysis/internal/application-write-policy";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { isJsonObject } from "flarex-protocol/json";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { coreNativeRelationalFailure, coreNativeRelationalRows, makeCoreNativeDefinition,
  makeCoreRelationalNativeDefinition, requireCoreNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle, requireCoreSchemaBundle } from "../../src/core/schemaBundle";

const target = { scopeUuid: "81b313bf-4a9e-4b82-8049-04f69c4ee1e4", epochUuid: "1e66db52-8644-445b-81a9-3fa7f5fb015f" };
const timestamp = "2026-11-01T00:00:00.000Z";
function digestGate() {
  const state = Deferred.makeUnsafe<void>();
  return { promise: Effect.runPromise(Deferred.await(state)),
    resolve: () => Effect.runSync(Deferred.succeed(state, undefined)) };
}
const fixture = Effect.fn("NativeSchemaBundleFixture.sources")(function* () {
  const application = yield* prepareApplicationSchemaSource(defineSchema({
    users: defineTable({ name: v.string() }).index("by_name", ["name"]),
  }));
  const payloadSource = yield* compilePayloadCollections([{ slug: "posts", fields: [{ name: "title", type: "text", required: true }] }]);
  const payload = yield* makeCoreNativeDefinition({ ...target, source: payloadSource.sourceContract });
  const currency = yield* compileCurrencyCoreDefinition(target);
  return { application, payload, currency };
});

describe("authentic Core schema bundles", () => {
  it("combines real producers with stable names and unchanged individual Payload identity", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const { application, payload, currency } = yield* fixture();
      const before = { identity: { ...payload.identity }, metadata: payload.metadata };
      const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: currency },
        { kind: "application", definition: application }, { kind: "native", definition: payload }] });
      const reordered = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: payload },
        { kind: "native", definition: currency }, { kind: "application", definition: application }] });
      expect(bundle.metadata).toBe(reordered.metadata);
      expect(requireCoreSchemaBundle(bundle)).toMatchObject({ _tag: "Success" });
      expect(Result.isFailure(requireCoreSchemaBundle({ ...bundle }))).toBe(true);
      expect(payload.identity).toEqual(before.identity);
      expect(payload.metadata).toBe(before.metadata);
      expect(currency.commands).toEqual([]);
      const table = currency.tables[0];
      expect(table?.localName).toBe("currency");
      expect(table?.name).toMatch(/^n_[0-9a-hjkmnp-tv-z]{52}$/);
      expect(bundle.bindings).toEqual(expect.arrayContaining([
        { sourceKey: "application", localName: "users", table: { namespace: "app", logicalName: "users" }, coreTableName: "users" },
        { sourceKey: "payload", localName: "posts", table: { namespace: "app", logicalName: "posts" }, coreTableName: "posts" },
        { sourceKey: "medusa.currency", localName: "currency", table: { namespace: "medusa", logicalName: "commerce.currency/currency" },
          coreTableName: table?.name },
      ]));
      expect(bundle.schema.tables.find(table => table.tableName === "users")?.indexes)
        .toEqual([{ indexDescriptor: "by_name", fields: ["name", "_creationTime"] }]);
      expect(table?.indexes?.find(index => index.nativeId === "currency.active"))
        .toMatchObject({ kind: "index", fields: ["deleted_at"], requiredPrefix: { field: "deleted_at", value: null } });
      expect(table?.uniqueConstraints[0]).toMatchObject({ descriptor: "currency.primary", fields: ["code"], nullsDistinct: false });
    }));
  });

  it("refuses forged source capabilities, mapped-name collisions and mixed native targets", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const { application, payload, currency } = yield* fixture();
      expect(Result.isFailure(requireCoreNativeDefinition({ ...currency }))).toBe(true);
      expect(Result.isFailure(yield* Effect.result(makeCoreSchemaBundle({ sources: [
        { kind: "application", definition: { ...application } }, { kind: "native", definition: currency },
      ] })))).toBe(true);
      const name = currency.tables[0]?.name;
      if (name === undefined) return yield* Effect.die(new Error("Missing Currency table"));
      const conflicting = yield* prepareApplicationSchemaSource(defineSchema({ [name]: defineTable({ name: v.string() }) }));
      expect(Result.isFailure(yield* Effect.result(makeCoreSchemaBundle({ sources: [
        { kind: "application", definition: conflicting }, { kind: "native", definition: currency },
      ] })))).toBe(true);
      const other = yield* compileCurrencyCoreDefinition({ ...target, epochUuid: "e3318339-9128-4892-bb0c-2369f6e5905f" });
      expect(Result.isFailure(yield* Effect.result(makeCoreSchemaBundle({ sources: [
        { kind: "native", definition: payload }, { kind: "native", definition: other },
      ] })))).toBe(true);
    }));
  });

  it("captures exact source capabilities before a native table-name digest awaits", async () => {
    const currency = await Effect.runPromise(compileCurrencyCoreDefinition(target));
    const envelope = { kind: "native" as const, definition: currency };
    const entered = digestGate(), release = digestGate();
    const delayed = makeApplicationWritePolicyDigest(async input => {
      entered.resolve();
      await release.promise;
      return Uint8Array.from(createHash("sha256").update(new Uint8Array(input)).digest()).buffer;
    });
    const pending = Effect.runPromise(makeCoreSchemaBundle({ sources: [envelope] })
      .pipe(Effect.provideService(ApplicationWritePolicyDigest, delayed)));
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error("Bundle did not reach the digest barrier"); })]);
      envelope.definition = Object.freeze({ ...currency, metadata: "unissued source replacement" });
      release.resolve();
      const bundle = await pending;
      expect(bundle.sources[0]?.definition).toBe(currency);
      expect(bundle.nativeDefinitions[0]).toBe(currency);
      expect(bundle.metadata).not.toContain("unissued source replacement");
    } finally { entered.resolve(); release.resolve(); await pending; }
  });

  it("refuses source envelope getters without invoking them", async () => {
    const currency = await Effect.runPromise(compileCurrencyCoreDefinition(target));
    let reads = 0;
    const envelope = { get kind(): "native" { reads++; return "native"; }, definition: currency };
    const result = await Effect.runPromise(Effect.result(makeCoreSchemaBundle({ sources: [envelope] })));
    expect(Result.isFailure(result)).toBe(true);
    expect(reads).toBe(0);
  });

  it("captures the entire relational constructor input before source hashing awaits", async () => {
    const currency = await Effect.runPromise(compileCurrencyCoreDefinition(target));
    if (!isJsonObject(currency.source.evidence)) throw new Error("Missing Currency evidence");
    const provenance = currency.source.evidence.provenance;
    if (provenance === undefined || !isJsonObject(provenance)) throw new Error("Missing Currency provenance");
    const command = { name: "captured-command", mode: "write" as const };
    const input = { ...target, source: currency.source, provenance: { ...provenance }, commands: [command] };
    const entered = digestGate(), release = digestGate();
    const original = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (algorithm, data) => {
      entered.resolve();
      await release.promise;
      return original(algorithm, data);
    });
    const pending = Effect.runPromise(makeCoreRelationalNativeDefinition(input));
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error("Definition did not reach the digest barrier"); })]);
      command.name = "mutated-command";
      input.provenance.revision = "mutated-revision";
      release.resolve();
      const definition = await pending;
      expect(definition.commands.map(selected => selected.name)).toEqual(["captured-command"]);
      expect(definition.identity.provenanceSha256).toBe(currency.identity.provenanceSha256);
    } finally { entered.resolve(); release.resolve(); digest.mockRestore(); await pending; }
  });

  it("retains the genuine compiler target selected before source hashing awaits", async () => {
    const input = { ...target };
    const entered = digestGate(), release = digestGate();
    const original = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (algorithm, data) => {
      entered.resolve();
      await release.promise;
      return original(algorithm, data);
    });
    const pending = Effect.runPromise(compileCurrencyCoreDefinition(input));
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error("Compiler did not reach the digest barrier"); })]);
      input.epochUuid = "90c9f948-8253-442d-bf5c-72e56dd2353d";
      release.resolve();
      expect((await pending).identity.epochUuid).toBe(target.epochUuid);
    } finally { entered.resolve(); release.resolve(); digest.mockRestore(); await pending; }
  });

  it("derives native exact/default rules from real Currency DML without tightening binary64 or raw precision", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const definition = yield* compileCurrencyCoreDefinition(target);
      const policy = coreNativeRelationalRows(definition, definition.tables[0]?.name ?? "missing");
      if (policy === undefined) return yield* Effect.die(new Error("Missing native row policy"));
      const row = yield* Effect.fromResult(policy.rows.normalize({ code: "xzz", name: "Example", symbol: "E", symbol_native: "E",
        decimal_digits: 1.25 }, null, timestamp));
      expect(row).toMatchObject({ decimal_digits: 1.25, rounding: "0", raw_rounding: { value: "0", precision: 20 },
        created_at: timestamp, updated_at: timestamp, deleted_at: null });
      expect(Result.isSuccess(policy.rows.validate({ ...row, raw_rounding: { value: "0", precision: 10 } }, "storedCorruption"))).toBe(true);
      const corrupt = policy.rows.validate({ ...row, raw_rounding: { value: "1", precision: 20 } }, "storedCorruption");
      expect(Result.isFailure(corrupt) && corrupt.failure).toMatchObject({ reason: "corruptData" });
      const missing = policy.rows.normalize({ code: "missing" }, null, timestamp);
      expect(Result.isFailure(missing)).toBe(true);
      if (Result.isFailure(missing)) expect(coreNativeRelationalFailure(missing.failure))
        .toMatchObject({ table: { identity: { tableId: "currency" } }, diagnostic: { kind: "missing" } });
    }));
  });

  it("uses the same scalar row owner for a neutral relational producer", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const origin = { kind: "synthetic", sourceId: "neutral.scalar" };
      const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral.scalar", capabilities: [],
        tables: [{ tableId: "measurement", origin, columns: [
          { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
          { columnId: "amount", type: "doublePrecision", nullable: false, default: { kind: "doublePrecisionLiteral", value: 1.25 }, origin },
        ], keys: [{ keyId: "measurement.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }] }));
      const provenance = { kind: "synthetic", fixtureId: "neutral.scalar" };
      const source = yield* captureLogicalSchemaSource({ key: "neutral.scalar", owner: "medusa", writeProfile: "neutral.scalar",
        evidence: { provenance }, definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "measurement",
          table: { namespace: "medusa", logicalName: "neutral.scalar/measurement" } }] });
      const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance, commands: [] });
      const policy = coreNativeRelationalRows(definition, definition.tables[0]?.name ?? "missing");
      if (policy === undefined) return yield* Effect.die(new Error("Missing neutral row policy"));
      expect(yield* Effect.fromResult(policy.rows.normalize({ id: "sample" }, null, timestamp))).toEqual({ id: "sample", amount: 1.25 });
      expect(Result.isFailure(policy.rows.normalize({ id: "sample", amount: Infinity }, null, timestamp))).toBe(true);
    }));
  });
});

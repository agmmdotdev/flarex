import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import type { JsonObject } from "flarex-protocol/json";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceNativeRegistrations } from "../../persistence-postgres/src/frameworks/commerceTransaction/nativeHost";
import { getCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { CoreNativeQueryError } from "../../persistence-postgres/src/core/api";
import { coreNativeIndexName } from "../../persistence-postgres/src/core/schemaTableName";
import { coreNativeTestBudget } from "../../persistence-postgres/test/core/nativeTestBudget";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";
import { openCoreProductReadHost, seedCorePricingLists } from "./support/core-product-creation-fixture";
import { prepareCoreProductUpdate } from "./support/core-product-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreProductUpdate>>;
let readerRuntime: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
let reader: Awaited<ReturnType<typeof openCoreProductReadHost>>;

function activeIndex() {
  const source = connected.pricing.definition.source.definition;
  if (source.kind !== "relational") throw new Error("Missing authentic relational Pricing source");
  const sourceTable = source.schema.tables.find(table => table.identity.tableId === "price_list");
  const active = sourceTable?.indexes.filter(index => index.predicate?.kind === "isNullAndTextEquals");
  const sourceIndex = active?.[0];
  if (active?.length !== 1 || sourceIndex === undefined) throw new Error("Missing sole native PriceList text predicate");
  const table = connected.pricing.definition.tables.find(table => table.localName === "price_list");
  const index = table?.indexes?.find(index => index.nativeId === sourceIndex.identity.indexId);
  if (table === undefined || index === undefined || table.table === undefined) throw new Error("Missing authentic native active PriceList index");
  return { sourceIndex, table, index, qualifiedTable: table.table };
}

async function softDeleteList(id: string) {
  const runtime = await Effect.runPromise(makeLocalPricingCommands("price-list-deletions"));
  const policy = workflowModuleDefinition(runtime.workflow)?.logical;
  const method = runtime.workflow.methods.softDeletePriceLists;
  const definition = method === undefined ? undefined : workflowMethodDefinition(method);
  if (policy === undefined || definition === undefined || !policy.commands.includes(runtime.listSoftDelete))
    throw new Error("Missing admitted native PriceList deletion profile");
  const participant = defineAtomicCommerceParticipant("pricing");
  const contracts = definition.moduleEvents.map(name => ({ name,
    token: defineCommerceEventContract({ name, revision: "a".repeat(64), internal: true, decode: policy.capture }) }));
  const command = defineAtomicCommerceCommand("pricingIndexSoftDelete", (context, value) =>
    context.call(participant, runtime.listSoftDelete, value));
  const host = await Effect.runPromise(connected.execution.prepare({ identityAndAccessPolicy: { proof: "native-price-list-index-lifecycle" },
    participants: [{ participant, nativeStorage: connected.pricing.source, commands: [runtime.listSoftDelete],
      validateLogicalCall: policy.validateLogicalCall, events: { contracts: contracts.map(contract => contract.token), select: value => {
        const selected = isJsonObject(value) ? contracts.find(contract => contract.name === value.name) : undefined;
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected.token);
      } } }], commands: [command], events: { producerRevision: "a".repeat(64), contracts: contracts.map(contract => contract.token),
      subscribers: [{ id: "native-price-list-index", revision: "b".repeat(64) }],
      validate: events => events.every(event => event.internal) ? Effect.void : Effect.fail(commerceError("unadmittedEvent")) } }));
  try { return await Effect.runPromise(host.run(host.newRequestKey(), command, [id])); }
  finally { await Effect.runPromise(host.close); }
}

/** Trusted Core observation uses the existing admitted native reader registration.
 * It is separate from the native Medusa list method and grants no new method. */
const observeCore = Effect.fn("NativePriceListIndex.observeCore")((where: JsonObject, page: boolean) => connected.fixture.useGeneration(generation => Effect.gen(function* () {
  const selected = getCommerceCommand(readerRuntime.listUpdateRead);
  if (selected === undefined || selected.mode !== "read" || !readerRuntime.commands.includes(readerRuntime.listUpdateRead))
    return yield* Effect.die(new Error("Missing admitted PriceList read command"));
  const binding = yield* generation.database.bindNative({ definition: connected.pricing.definition,
    commands: yield* Effect.fromResult(commerceNativeRegistrations([readerRuntime.listUpdateRead], { readOnly: true })) });
  const { table, index } = activeIndex();
  return yield* Effect.acquireUseRelease(generation.database.beginNative(binding, { commandName: selected.name,
    ...coreNativeTestBudget(), limits: { maxIdentities: 4, maxDocumentBytes: 65_536 } }), operation => Effect.gen(function* () {
    const documents = page ? (yield* operation.operations.findPage(table.name, where,
      { indexName: index.indexName, offset: 0, limit: 4 })).documents : yield* operation.operations.find(table.name, where);
    yield* operation.finishRead();
    return documents;
  }), operation => operation.abort());
})));

describe("authentic native PriceList predicate over ordinary Core indexes", () => {
  beforeAll(async () => {
    connected = await prepareCoreProductUpdate(driver, close => cleanup.push(close));
    readerRuntime = await Effect.runPromise(makeLocalPricingCommands("price-list-updates"));
    reader = await openCoreProductReadHost(connected.fixture, "pricing", [readerRuntime.listUpdateRead]);
    cleanup.push(() => Effect.runPromise(reader.close));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("authenticates the pinned active predicate and preserves the complete eight-source bundle", async () => {
    expect(connected.fixture.sources).toHaveLength(8);
    expect(connected.fixture.sources.reduce((total, source) => total + source.definition.tables.length, 0)).toBe(30);
    const { sourceIndex, table, index, qualifiedTable } = activeIndex();
    expect(sourceIndex.identity.indexId).toBe("PriceList_id_status_starts_at_ends_at_0");
    expect(sourceIndex.kind).toBe("btree");
    expect(sourceIndex.columns.map(column => column.columnId)).toEqual(["id", "status", "starts_at", "ends_at"]);
    expect(sourceIndex.predicate).toMatchObject({ kind: "isNullAndTextEquals", nullColumn: { columnId: "deleted_at" },
      textColumn: { columnId: "status" }, value: "active" });
    expect(index).toMatchObject({ kind: "index", fields: ["deleted_at", "status", "id", "starts_at", "ends_at"],
      requiredPrefix: { all: [{ field: "deleted_at", value: null }, { field: "status", value: "active" }] } });
    expect(table.uniqueConstraints.some(constraint => constraint.indexName === index.indexName)).toBe(false);
    expect(index.indexName).toBe(await Effect.runPromise(coreNativeIndexName(qualifiedTable, "index", sourceIndex.identity.indexId)));
    expect(connected.pricing.definition.schema.tables.find(candidate => candidate.tableName === table.name)?.indexes)
      .toContainEqual({ indexDescriptor: index.indexName, fields: ["deleted_at", "status", "id", "starts_at", "ends_at"] });
    await connected.fixture.run(connected.fixture.useGeneration(generation => Effect.gen(function* () {
      const binding = yield* generation.database.bindNative({ definition: connected.pricing.definition,
        commands: yield* Effect.fromResult(commerceNativeRegistrations([readerRuntime.listUpdateRead], { readOnly: true })) });
      const installed = yield* generation.database.readNativeBinding(binding);
      expect(installed.definition.identity).toEqual(connected.pricing.definition.identity);
      expect(installed.tables.find(candidate => candidate.name === table.name)?.indexes.find(candidate => candidate.name === index.indexName))
        .toMatchObject({ name: index.indexName, fields: ["deleted_at", "status", "id", "starts_at", "ends_at"] });
    })));
  });

  it("retains draft and deleted backing entries while native broad reads and qualified Core pages keep distinct membership", async () => {
    const ids = ["index-active-list", "index-draft-list", "index-deleted-list"];
    await seedCorePricingLists(connected.fixture, connected.pricing, ids.map((id, index) => ({ id, title: id,
      description: "Native ordinary-index membership", status: index === 1 ? "draft" : "active", type: "sale", prices: [] })));
    const nativeList = () => Effect.runPromise(reader.read(readerRuntime.listUpdateRead,
      { filters: { id: ids }, config: { select: ["id", "status"] } }));
    expect(await nativeList()).toEqual([
      { id: ids[0], status: "active" }, { id: ids[2], status: "active" }, { id: ids[1], status: "draft" },
    ]);
    expect((await connected.fixture.run(observeCore({ deleted_at: null, status: "active" }, true))).map(row => row.id).toSorted())
      .toEqual([ids[0], ids[2]].toSorted());
    await softDeleteList(ids[2]!);
    expect(await nativeList()).toEqual([{ id: ids[0], status: "active" }, { id: ids[1], status: "draft" }]);
    const all = await connected.fixture.run(observeCore({}, false));
    expect(all.map(row => row.id).toSorted()).toEqual(ids.toSorted());
    expect(all.find(row => row.id === ids[2])?.deleted_at).toEqual(expect.any(String));
    expect((await connected.fixture.run(observeCore({ deleted_at: null, status: "active" }, true))).map(row => row.id))
      .toEqual([ids[0]]);
    const { table, index } = activeIndex(), inventory = await connected.fixture.inventory();
    const rows = inventory.rows.filter(row => row.table === table.name);
    expect(rows).toHaveLength(3);
    const expectedIds = new Set(rows.map(row => encodeBytesToLowercaseHex(Result.getOrThrow(decodeDocumentId(row.value._id)).internalId)));
    const entries = inventory.indexes.filter(entry => entry.table === table.name && entry.name === index.indexName);
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map(entry => entry.id))).toEqual(expectedIds);
  }, 120_000);

  it("refuses explicit native access without both authentic predicate equalities", async () => {
    const before = await connected.fixture.snapshot();
    for (const where of [{}, { deleted_at: null }, { status: "active" }, { deleted_at: null, status: "draft" },
      { deleted_at: "2026-11-01T00:00:00.000Z", status: "active" }]) {
      const exit = await connected.fixture.run(Effect.exit(observeCore(where, true)));
      expect(exit).toMatchObject({ _tag: "Failure" });
      if (exit._tag === "Failure") {
        expect(exit.cause.reasons).toHaveLength(1);
        const [causeReason] = exit.cause.reasons;
        expect(causeReason !== undefined && Cause.isFailReason(causeReason)).toBe(true);
        if (causeReason !== undefined && Cause.isFailReason(causeReason)) {
          expect(causeReason.error).toBeInstanceOf(CoreNativeQueryError);
          expect(causeReason.error).toMatchObject({ reason: "invalidInput" });
        }
      }
    }
    expect(await connected.fixture.snapshot()).toEqual(before);
  });
});

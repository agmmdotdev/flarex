import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { LogicalCommerceCallObservation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { isJsonObject } from "flarex-protocol/json";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureFulfillmentCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionCreationRepository } from "../src/modules/fulfillment/shipping-option-create-repository";
import { shippingOptionCreationPolicy } from "../src/modules/fulfillment/shipping-option-create-receipt";
import { correlatePhysicalGraphReceipt } from "../src/repository/physical-graph-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import type { SchemaTable } from "../src/schema/model";

type Input = Parameters<typeof correlatePhysicalGraphReceipt>[0];
type Activity = Input["activity"];
let prepared: Result.Result.Success<ReturnType<typeof prepareShippingOptionCreationRepository>>;
let configuration: Pick<Input, "tables" | "entities" | "root" | "referenceDetachments">;
let option: JsonObject, rule: JsonObject, source: JsonObject;
const stamp = "2026-10-18T00:00:00.000Z";
function row(table: SchemaTable, id: string, supplied: JsonObject): JsonObject {
  const defaults = table.columns.reduce<JsonObject>((defaults, column) => {
    const value: Json = ["created_at", "updated_at"].includes(column.name) ? stamp
      : column.defaultValue !== undefined ? column.defaultValue
      : column.nullable ? null : column.type === "boolean" ? false : column.type === "number" ? 0
      : column.options?.choices?.[0] ?? column.name;
    return { ...defaults, [column.name]: value };
  }, {});
  return { ...defaults, id, ...supplied };
}
const keyRead = (table: string, column: string, value: string) => ({ table,
  query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values: [value] }), total: 1, returned: 1 });
const activity = (): Activity => ({ lifecycle: [], setNull: [], referenceReplacements: [],
  observedRows: [{ table: "shipping_option", row: option }, { table: "shipping_option_rule", row: rule },
    { table: "fulfillment", row: { ...source, shipping_option_id: null } }],
  relationalReads: [keyRead("shipping_option", "id", "option142"), keyRead("shipping_option_rule", "shipping_option_id", "option142"),
    { table: "fulfillment", query: { predicate: { kind: "in", column: "shipping_option_id", values: ["option142"] },
      order: { column: "id", direction: "asc" } }, total: 1, returned: 1 }],
  mutations: [{ ordinal: 0, table: "shipping_option_rule", operation: "delete", before: rule, after: null },
    { ordinal: 1, table: "shipping_option", operation: "delete", before: option, after: null },
    { ordinal: 2, table: "fulfillment", operation: "patch", before: source, after: { ...source, shipping_option_id: null },
      deletedReference: { sourceColumn: "shipping_option_id", targetTable: "shipping_option", targetColumn: "id", targetKey: "option142", targetDeleteOrdinal: 1 } }],
});
const verify = (value = activity()) => correlatePhysicalGraphReceipt({ ...configuration, requestedIds: ["option142"], activity: value });
const refused = (value: Activity) => expect(verify(value)).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureFulfillmentCreationMetadata());
  prepared = Result.getOrThrow(prepareShippingOptionCreationRepository(metadata.frame, "reference-detachment"));
  const contracts = prepared.contracts, sourceTable = contracts.physicalEntities.find(entity => entity.table.name === "fulfillment")?.table;
  if (sourceTable === undefined) throw new Error("Missing explicit detach-only source contract");
  option = row(contracts.option, "option142", { price_type: "flat" });
  rule = row(contracts.rule, "rule142", { shipping_option_id: "option142", attribute: "enabled", operator: "eq", value: "true" });
  source = row(sourceTable, "ful142", { shipping_option_id: "option142", deleted_at: stamp });
  configuration = { tables: contracts.tables, entities: contracts.physicalEntities, root: contracts.option, referenceDetachments: contracts.referenceDetachments };
});

describe("eager physical reference detachment receipt", () => {
  it("correlates the complete historical source read and exact FK-only patch to its actual prior Option deletion", () => {
    expect(Result.getOrThrow(verify())).toEqual(["option142"]);
    const empty = activity();
    expect(Result.getOrThrow(verify({ ...empty, observedRows: empty.observedRows.slice(0, 2), mutations: empty.mutations.slice(0, 2),
      relationalReads: empty.relationalReads.map((read, index) => index === 2 ? { ...read, total: 0, returned: 0 } : read) }))).toEqual(["option142"]);
  });

  it("refuses missing, redirected, truncated, filtered or extra source reads", () => {
    const value = activity(), sourceRead = value.relationalReads[2];
    if (sourceRead === undefined || !isJsonObject(sourceRead.query)) throw new Error("Missing complete source read fixture");
    const sourceQuery = sourceRead.query;
    refused({ ...value, relationalReads: value.relationalReads.slice(0, 2) });
    refused({ ...value, relationalReads: [...value.relationalReads, sourceRead] });
    for (const query of [{ predicate: { kind: "isNull", column: "deleted_at" } }, { take: 1 }, { fields: ["id"] }])
      refused({ ...value, relationalReads: value.relationalReads.map((read, index) => index === 2 ? { ...read, query: { ...sourceQuery, ...query } } : read) });
    refused({ ...value, relationalReads: value.relationalReads.map((read, index) => index === 2 ? { ...read, total: 2 } : read) });
  });

  it("requires exact causal ownership and refuses timestamp, history, data or source identity changes", () => {
    const value = activity(), patch = value.mutations[2]!;
    const { deletedReference: _proof, ...withoutProof } = patch;
    refused({ ...value, mutations: [...value.mutations.slice(0, 2), withoutProof] });
    for (const deletedReference of [{ ...patch.deletedReference!, targetDeleteOrdinal: 0 },
      { ...patch.deletedReference!, targetKey: "other" }, { ...patch.deletedReference!, sourceColumn: "provider_id" }])
      refused({ ...value, mutations: [...value.mutations.slice(0, 2), { ...patch, deletedReference }] });
    for (const changed of [{ updated_at: "2026-10-19T00:00:00.000Z" }, { deleted_at: null }, { data: { invented: true } }, { id: "other" }])
      refused({ ...value, mutations: [...value.mutations.slice(0, 2), { ...patch, after: { ...source, shipping_option_id: null, ...changed } }] });
    refused({ ...value, mutations: value.mutations.slice(0, 2) });
    refused({ ...value, observedRows: value.observedRows.filter(row => row.table !== "fulfillment") });
    refused({ ...value, observedRows: value.observedRows.map(row => row.table === "fulfillment" ? { ...row, row: source } : row) });
    refused({ ...value, observedRows: [...value.observedRows, { table: "fulfillment", row: source }] });
    for (const changed of [{ updated_at: "2026-10-19T00:00:00.000Z" }, { deleted_at: null }, { data: { forged: true } }])
      refused({ ...value, observedRows: value.observedRows.map(row => row.table === "fulfillment" ? { ...row, row: { ...row.row, ...changed } } : row) });
    refused({ ...value, observedRows: [...value.observedRows, { table: "fulfillment", row: { ...source, id: "outside", shipping_option_id: "other" } }] });
    expect(correlatePhysicalGraphReceipt({ ...configuration, referenceDetachments: [], requestedIds: ["option142"], activity: value })).toMatchObject({ _tag: "Failure" });
  });

  it("retains root-only native event validation and rejects added Fulfillment update messages", async () => {
    const policy = shippingOptionCreationPolicy(prepared), event = {
      name: buildModuleResourceEventName({ prefix: "fulfillment", objectName: "shipping_option", action: "deleted" }),
      metadata: { source: "fulfillment", object: "shipping_option", action: "deleted" }, data: { id: "option142" },
    };
    const current = activity();
    const call: LogicalCommerceCallObservation = { commandName: "shippingOptionPhysicalDeleteForWorkflow", mode: "write", input: ["option142"], result: null, events: [event],
      fromAttempt: 0, toAttempt: current.mutations.length, fromLifecycle: 0, toLifecycle: current.lifecycle.length };
    await Effect.runPromise(policy.validateLogicalCall(call, current));
    expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call, events: [...call.events,
      { ...event, name: "fulfillment.fulfillment.updated", metadata: { source: "fulfillment", object: "fulfillment", action: "updated" } }] }, activity()))))).toBe(true);
  });
});

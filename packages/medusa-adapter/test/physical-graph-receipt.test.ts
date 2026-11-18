import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentGraphContracts } from "../src/modules/fulfillment/fulfillment-graph-contracts";
import { commerceRelationReadQuery } from "../src/query/relations";
import { correlatePhysicalGraphReceipt } from "../src/repository/physical-graph-receipt";

type Input = Parameters<typeof correlatePhysicalGraphReceipt>[0];
type Activity = Input["activity"];
let configuration: Pick<Input, "tables" | "entities" | "root">;
let graph: Result.Result.Success<ReturnType<typeof compileFulfillmentGraphContracts>>;
const stamp = "2026-10-18T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const set: JsonObject = { id: "set-a", name: "Set", type: "shipping", metadata: { retained: true }, ...managed };
const zone: JsonObject = { id: "zone-a", name: "Zone", fulfillment_set_id: "set-a", metadata: null, ...managed };
const geo: JsonObject = { id: "geo-a", type: "country", country_code: "Raw", province_code: null, city: null,
  postal_expression: null, metadata: null, service_zone_id: "zone-a", ...managed };
const option: JsonObject = { id: "option-a", name: "Option", price_type: "flat", data: null, metadata: null,
  service_zone_id: "zone-a", shipping_profile_id: "profile", provider_id: "provider", shipping_option_type_id: "type", ...managed };
const rule: JsonObject = { id: "rule-a", attribute: "raw", operator: "eq", value: null, shipping_option_id: "option-a", ...managed };
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const read = (table: string, column: string, values: readonly string[], total: number) => ({
  table, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values: [...values] }), total, returned: total,
});
const remove = (ordinal: number, table: string, before: JsonObject): Activity["mutations"][number] =>
  ({ ordinal, table, operation: "delete", before, after: null });
const deletionReads = () => [
  read("fulfillment_set", "id", ["set-a"], 1), read("service_zone", "fulfillment_set_id", ["set-a"], 1),
  read("shipping_option", "service_zone_id", ["zone-a"], 1), read("shipping_option_rule", "shipping_option_id", ["option-a"], 1),
  read("geo_zone", "service_zone_id", ["zone-a"], 1),
];

// Fixed executed-evidence transcripts, not another lifecycle planner. Native
// connected consumers separately establish that these reads/writes are issued.
const deletion = (): Activity => ({ ...empty(), observedRows: [
  { table: "fulfillment_set", row: set }, { table: "service_zone", row: zone }, { table: "geo_zone", row: geo },
  { table: "shipping_option", row: option }, { table: "shipping_option_rule", row: rule },
], relationalReads: deletionReads(), mutations: [remove(0, "shipping_option_rule", rule), remove(1, "geo_zone", geo), remove(2, "shipping_option", option),
  remove(3, "service_zone", zone), remove(4, "fulfillment_set", set)] });
const input = (activity = deletion(), requestedIds: readonly string[] = ["set-a"]): Input => ({ ...configuration, activity, requestedIds });
const refused = (value: Input) => expect(correlatePhysicalGraphReceipt(value))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
const changeRows = (activity: Activity, table: string, change: (row: JsonObject) => JsonObject): Activity => ({ ...activity,
  observedRows: activity.observedRows.map(value => value.table === table ? { ...value, row: change(value.row) } : value),
  mutations: activity.mutations.map(value => value.table === table && value.before !== null ? { ...value, before: change(value.before) } : value),
});

beforeAll(async () => {
  const metadata = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
  graph = Result.getOrThrow(compileFulfillmentGraphContracts(metadata));
  configuration = { tables: metadata.tables, entities: graph.entities, root: graph.set };
});

describe("complete physical graph receipt correlation", () => {
  it("correlates complete Set and Zone inverse graphs through their actual checked metadata", () => {
    const activity = deletion();
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input(activity)))).toEqual(["set-a"]);
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt({ tables: configuration.tables, entities: graph.zoneEntities,
      root: graph.zone, requestedIds: ["zone-a"], activity: { ...activity,
        observedRows: activity.observedRows.filter(value => value.table !== "fulfillment_set"),
        relationalReads: [read("service_zone", "id", ["zone-a"], 1), ...activity.relationalReads.slice(2)],
        mutations: activity.mutations.filter(value => value.table !== "fulfillment_set"),
      } }))).toEqual(["zone-a"]);
    // Delete preimages independently carry complete rows; equal observations
    // can repeat, and a separate observation is not required for each preimage.
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input({ ...activity, observedRows: [] })))).toEqual(["set-a"]);
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input({ ...activity,
      observedRows: [...activity.observedRows, ...activity.observedRows] })))).toEqual(["set-a"]);
  });

  it("requires every actual read, including empty child queries, with complete matching counts", () => {
    const activity = deletion();
    for (let omitted = 0; omitted < activity.relationalReads.length; omitted++)
      refused(input({ ...activity, relationalReads: activity.relationalReads.filter((_value, index) => index !== omitted) }));
    refused(input({ ...activity, relationalReads: [...activity.relationalReads, read("geo_zone", "service_zone_id", ["zone-a"], 1)] }));
    for (const count of [{ total: 2, returned: 1 }, { total: 1, returned: 0 }, { total: 0, returned: 0 }])
      refused(input({ ...activity, relationalReads: activity.relationalReads.map(value => ({ ...value, ...count })) }));
    const leaf: Activity = { ...empty(), mutations: [remove(0, "fulfillment_set", set)], relationalReads: [
      read("fulfillment_set", "id", ["set-a"], 1), read("service_zone", "fulfillment_set_id", ["set-a"], 0),
    ] };
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input(leaf)))).toEqual(["set-a"]);
    refused(input({ ...leaf, relationalReads: leaf.relationalReads.slice(0, 1) }));
  });

  it("refuses redirected, reordered, filtered and truncated read evidence", () => {
    const activity = deletion();
    for (let selected = 0; selected < activity.relationalReads.length; selected++) {
      refused(input({ ...activity, relationalReads: activity.relationalReads.map((value, index) => index === selected
        ? { ...value, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ["outside"] }) } : value) }));
      refused(input({ ...activity, relationalReads: deletionReads().map((value, index) => index === selected
        ? { ...value, query: { ...value.query, take: 1 } } : value) }));
    }
    refused(input({ ...activity, relationalReads: [...activity.relationalReads].reverse() }));
    refused(input({ ...activity, relationalReads: deletionReads().map(value => ({ ...value,
      query: { ...value.query, predicate: { kind: "and", children: [value.query.predicate ?? null, { kind: "isNull", column: "deleted_at" }] } },
    })) }));
  });

  it("requires complete consistent row preimages and rejects unselected or unowned observations", () => {
    const activity = deletion();
    refused(input({ ...activity, mutations: activity.mutations.map(value => ({ ...value, before: null })) }));
    const { metadata: _metadata, ...incomplete } = set;
    refused(input(changeRows(activity, "fulfillment_set", () => incomplete)));
    refused(input({ ...activity, observedRows: [...activity.observedRows, { table: "fulfillment_set", row: { ...set, name: "forged" } }] }));
    refused(input({ ...activity, mutations: activity.mutations.map(value => value.table === "fulfillment_set"
      ? { ...value, before: { ...set, name: "forged" } } : value) }));
    refused(input({ ...activity, observedRows: [...activity.observedRows, { table: "shipping_profile", row: set }] }));
    refused(input({ ...activity, observedRows: [...activity.observedRows, { table: "fulfillment_set", row: { ...set, id: "unrequested" } }] }));
    refused(input({ ...activity, observedRows: [...activity.observedRows, { table: "shipping_option_rule", row: { ...rule, operator: 42 } }] }));
  });

  it("requires one physical delete for each selected row and authentic consecutive ordinals", () => {
    const activity = deletion();
    for (let omitted = 0; omitted < activity.mutations.length; omitted++)
      refused(input({ ...activity, mutations: activity.mutations.filter((_value, index) => index !== omitted)
        .map((value, ordinal) => ({ ...value, ordinal })) }));
    refused(input({ ...activity, mutations: [...activity.mutations, remove(5, "fulfillment_set", set)] }));
    refused(input({ ...activity, mutations: activity.mutations.map(value => ({ ...value, ordinal: value.ordinal + 1 })) }));
    refused(input({ ...activity, mutations: activity.mutations.map(value => ({ ...value, operation: "patch" as const })) }));
    refused(input({ ...activity, mutations: activity.mutations.map(value => ({ ...value, after: value.before })) }));
  });

  it("refuses orphan descendants even when their observations and delete preimages agree", () => {
    const activity = deletion();
    for (const [table, column] of [["service_zone", "fulfillment_set_id"], ["geo_zone", "service_zone_id"],
      ["shipping_option", "service_zone_id"], ["shipping_option_rule", "shipping_option_id"]] as const)
      refused(input(changeRows(activity, table, row => ({ ...row, [column]: "outside" }))));
  });

  it("requires child-before-parent deletion without imposing sibling mutation order", () => {
    const activity = deletion();
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input({ ...activity, mutations: [
      remove(0, "geo_zone", geo), remove(1, "shipping_option_rule", rule), remove(2, "shipping_option", option),
      remove(3, "service_zone", zone), remove(4, "fulfillment_set", set),
    ] })))).toEqual(["set-a"]);
    refused(input({ ...activity, mutations: [remove(0, "fulfillment_set", set), remove(1, "shipping_option_rule", rule),
      remove(2, "geo_zone", geo), remove(3, "shipping_option", option), remove(4, "service_zone", zone)] }));
    refused(input({ ...activity, mutations: [remove(0, "shipping_option", option), remove(1, "shipping_option_rule", rule),
      remove(2, "geo_zone", geo), remove(3, "service_zone", zone), remove(4, "fulfillment_set", set)] }));
    refused(input({ ...activity, mutations: [remove(0, "shipping_option_rule", rule), remove(1, "shipping_option", option),
      remove(2, "service_zone", zone), remove(3, "geo_zone", geo), remove(4, "fulfillment_set", set)] }));
  });

  it("retains historical physical roots and descendants instead of filtering them out", () => {
    let activity = deletion();
    for (const table of ["fulfillment_set", "service_zone", "geo_zone", "shipping_option", "shipping_option_rule"])
      activity = changeRows(activity, table, row => ({ ...row, deleted_at: stamp }));
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input(activity)))).toEqual(["set-a"]);
  });

  it("distinguishes empty-ID skip from authenticated absence and preserves duplicate raw selectors", () => {
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input(empty(), [])))).toEqual([]);
    const missing = { ...empty(), relationalReads: [read("fulfillment_set", "id", ["missing", "missing"], 0)] };
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input(missing, ["missing", "missing"])))).toEqual([]);
    refused(input(empty(), ["missing"]));
    refused(input({ ...missing, relationalReads: [read("fulfillment_set", "id", ["missing"], 0)] }, ["missing", "missing"]));
    const activity = deletion(), raw = ["set-a", "missing", "set-a"];
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input({ ...activity,
      relationalReads: [read("fulfillment_set", "id", raw, 1), ...activity.relationalReads.slice(1)] }, raw)))).toEqual(["set-a"]);
  });

  it("uses native UTF-8 root query order while returning authentic root mutation order", () => {
    const bmp = "set-\uE000", supplementary = "set-\u{10000}", raw = [supplementary, bmp];
    const bmpRow = { ...set, id: bmp }, supplementaryRow = { ...set, id: supplementary };
    const activity: Activity = { ...empty(), observedRows: [
      { table: "fulfillment_set", row: supplementaryRow }, { table: "fulfillment_set", row: bmpRow },
    ], relationalReads: [read("fulfillment_set", "id", raw, 2), read("service_zone", "fulfillment_set_id", [bmp], 0),
      read("service_zone", "fulfillment_set_id", [supplementary], 0)],
    mutations: [remove(0, "fulfillment_set", supplementaryRow), remove(1, "fulfillment_set", bmpRow)] };
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input(activity, raw)))).toEqual(raw);
    refused(input({ ...activity, relationalReads: [read("fulfillment_set", "id", raw, 2),
      read("service_zone", "fulfillment_set_id", [supplementary], 0), read("service_zone", "fulfillment_set_id", [bmp], 0)] }, raw));
  });

  it("authenticates an explicitly selected storage insertion root order without changing the default", () => {
    const first = { ...set, id: "set-z" }, second = { ...set, id: "set-a", deleted_at: stamp };
    const raw = ["set-a", "missing", "set-z", "set-a"];
    const rootRead = { table: "fulfillment_set", query: commerceRelationReadQuery(defaultCommerceResources,
      { kind: "in", column: "id", values: raw }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }),
      total: 2, returned: 2, orderedIdentities: [{ id: "set-z" }, { id: "set-a" }] };
    const activity: Activity = { ...empty(), mutations: [remove(0, "fulfillment_set", first), remove(1, "fulfillment_set", second)],
      relationalReads: [rootRead, read("service_zone", "fulfillment_set_id", ["set-z"], 0), read("service_zone", "fulfillment_set_id", ["set-a"], 0)] };
    const selected: Input = { ...input(activity, raw), rootOrder: "storageInsertion" };
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(selected))).toEqual(["set-z", "set-a"]);
    refused(input(activity, raw));
    for (const identities of [[], [{ id: "set-z" }], [{ id: "set-z" }, { id: "set-z" }],
      [{ id: "outside" }, { id: "set-a" }], [{ id: "set-z", extra: true }, { id: "set-a" }],
      [{ id: "set-a" }, { id: "set-z" }]]) refused({ ...selected, activity: { ...activity,
        relationalReads: [{ ...rootRead, orderedIdentities: identities }, ...activity.relationalReads.slice(1)] } });
    refused({ ...selected, activity: { ...activity, relationalReads: [
      { ...rootRead, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: raw }) },
      ...activity.relationalReads.slice(1)] } });
    refused({ ...selected, activity: { ...activity, relationalReads: [{ ...rootRead, total: 3 }, ...activity.relationalReads.slice(1)] } });
    refused({ ...selected, activity: { ...activity, relationalReads: [{ ...rootRead, returned: 1 }, ...activity.relationalReads.slice(1)] } });
    refused({ ...selected, activity: { ...activity,
      mutations: [remove(0, "fulfillment_set", second), remove(1, "fulfillment_set", first)] } });
  });

  it("distinguishes storage insertion empty-ID skip from a complete empty identity read", () => {
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt({ ...input(empty(), []), rootOrder: "storageInsertion" }))).toEqual([]);
    const activity: Activity = { ...empty(), relationalReads: [{ table: "fulfillment_set",
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ["missing"] },
        { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }), total: 0, returned: 0, orderedIdentities: [] }] };
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt({ ...input(activity, ["missing"]), rootOrder: "storageInsertion" }))).toEqual([]);
    refused({ ...input({ ...activity, relationalReads: [] }, ["missing"]), rootOrder: "storageInsertion" });
  });

  it("enforces every entity allowance and the real sixteen-Geo complete cohort boundary", () => {
    const activity = deletion();
    for (const entity of configuration.entities)
      refused({ ...input(activity), entities: configuration.entities.map(value => value === entity ? { ...value, maximum: 0 } : value) });
    const geos = Array.from({ length: 16 }, (_unused, index) => ({ ...geo, id: "geo-" + index }));
    const complete: Activity = { ...activity,
      observedRows: [...activity.observedRows.filter(value => value.table !== "geo_zone"), ...geos.map(row => ({ table: "geo_zone", row }))],
      relationalReads: activity.relationalReads.map(value => value.table === "geo_zone"
        ? read("geo_zone", "service_zone_id", ["zone-a"], 16) : value),
      mutations: [remove(0, "shipping_option_rule", rule), ...geos.map((row, index) => remove(index + 1, "geo_zone", row)),
        remove(17, "shipping_option", option), remove(18, "service_zone", zone), remove(19, "fulfillment_set", set)],
    };
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt(input(complete)))).toEqual(["set-a"]);
    const overflow = { ...geo, id: "geo-overflow" };
    refused(input({ ...complete, observedRows: [...complete.observedRows, { table: "geo_zone", row: overflow }] }));
    refused(input({ ...complete, observedRows: complete.observedRows.filter(value => value.table !== "geo_zone"),
      mutations: [remove(0, "shipping_option_rule", rule), ...[...geos, overflow].map((row, index) => remove(index + 1, "geo_zone", row)),
        remove(18, "shipping_option", option), remove(19, "service_zone", zone), remove(20, "fulfillment_set", set)],
      relationalReads: complete.relationalReads.map(value => value.table === "geo_zone"
        ? read("geo_zone", "service_zone_id", ["zone-a"], 17) : value),
    }));
  });
});

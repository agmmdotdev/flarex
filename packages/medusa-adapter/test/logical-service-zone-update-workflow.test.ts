import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { serviceZoneUpdateResources } from "../src/workflow/policy";
import { prepareServiceZoneUpdateWorkflow } from "../src/workflows/fulfillment/update-service-zones";
import { ServiceZoneUpdateUpserts } from "../src/modules/fulfillment/service-zone-update-input";
import { prepareLogicalServiceZoneUpdate } from "./support/logical-service-zone-update-fixture";
import { serviceZoneDeletionGraph, serviceZoneParents, serviceZoneSeedTime } from "./support/logical-service-zone-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalServiceZoneUpdate>>, sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), row = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
const graph = {
  maximumNew: serviceZoneDeletionGraph("zone-update-max-new", { roots: 4 }),
  maximumCurrent: serviceZoneDeletionGraph("zone-update-max-current", { roots: 4, geos: 16 }),
  maximumReplacement: serviceZoneDeletionGraph("zone-update-max-replacement", { roots: 4, geos: 16 }),
  scalar: serviceZoneDeletionGraph("zone-update-scalar", { geos: 2, options: 1, rules: 1 }),
  membership: serviceZoneDeletionGraph("zone-update-membership", { roots: 2, geos: 4 }),
  retained: serviceZoneDeletionGraph("zone-update-retained", { geos: 1 }),
  historicalEmpty: serviceZoneDeletionGraph("zone-update-historical-empty", { geos: 2 }),
  historicalNew: serviceZoneDeletionGraph("zone-update-historical-new", { geos: 2 }),
  postalObject: serviceZoneDeletionGraph("zone-update-postal-object", { geos: 1 }),
  postalArray: serviceZoneDeletionGraph("zone-update-postal-array", { geos: 1 }),
  postalPrimitive: serviceZoneDeletionGraph("zone-update-postal-primitive", { geos: 1 }),
  failure: serviceZoneDeletionGraph("zone-update-failure", { geos: 1 }), cancel: serviceZoneDeletionGraph("zone-update-cancel", { geos: 1 }),
  protected: serviceZoneDeletionGraph("zone-update-protected", { geos: 1, options: 1, rules: 1 }),
  predicateRace: serviceZoneDeletionGraph("zone-update-predicate-race"), fkRace: serviceZoneDeletionGraph("zone-update-fk-race", { geos: 1 }),
  nameRace: serviceZoneDeletionGraph("zone-update-name-race", { roots: 2 }),
  unicode: serviceZoneDeletionGraph("zone-update-unicode", { roots: 2, geos: 2 }),
  ordering: serviceZoneDeletionGraph("zone-update-ordering", { geos: 2 }),
};
const unicodeIds = new Map([["zone-update-unicode-zone-0", "zone-update-é"], ["zone-update-unicode-zone-1", "zone-update-😀"]]);
graph.unicode.ids = graph.unicode.ids.map(id => unicodeIds.get(id) ?? id); graph.unicode.allIds = graph.unicode.allIds.map(id => unicodeIds.get(id) ?? id);
graph.unicode.rows = graph.unicode.rows.map(value => ({ ...value, row: Object.fromEntries(Object.entries(value.row).map(([key, field]) =>
  [key, ["id", "service_zone_id"].includes(key) && typeof field === "string" ? unicodeIds.get(field) ?? field : field])) }));
const orderedChildIds = new Map([["zone-update-ordering-geo-0", "zone-update-child-Z"], ["zone-update-ordering-geo-1", "zone-update-child-A"]]);
graph.ordering.geoIds = graph.ordering.geoIds.map(id => orderedChildIds.get(id) ?? id); graph.ordering.allIds = graph.ordering.allIds.map(id => orderedChildIds.get(id) ?? id);
graph.ordering.rows = graph.ordering.rows.map(value => {
  const id = typeof value.row.id === "string" ? orderedChildIds.get(value.row.id) : undefined;
  return { ...value, row: { ...value.row, ...(id === undefined ? {} : { id }) } };
});
for (const value of [graph.membership, graph.historicalEmpty, graph.historicalNew]) value.rows = value.rows.map(entry => entry.row.id === value.geoIds[0]
  ? { ...entry, row: { ...entry.row, deleted_at: serviceZoneSeedTime } } : entry);
const postalValues = { postalObject: { eq: "SW1", in: ["SW1", "SW2"], opaque: { nested: true } }, postalArray: ["SW1", { eq: "SW2" }, 7], postalPrimitive: "SW1" };
for (const key of ["postalObject", "postalArray", "postalPrimitive"] as const) graph[key].rows = graph[key].rows.map(entry => entry.table === "geo_zone"
  ? { ...entry, row: { ...entry.row, type: "zip", country_code: "GB", province_code: "LND", city: "London", postal_expression: postalValues[key] } } : entry);
const parentIds = [...Object.values(serviceZoneParents), "zone-create-protected-profile", "zone-create-type", "zone-create-provider"];
const newGeography = () => [
  { type: "country", country_code: " Raw MM " }, { type: "province", country_code: "US", province_code: "CA" },
  { type: "city", country_code: "TH", province_code: "BK", city: " Bangkok " },
  { type: "zip", country_code: "GB", province_code: "LND", city: "London", postal_expression: { eq: "SW1" } },
];
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function nativePreimageTap() {
  const original = FulfillmentModuleService.prototype.listServiceZones; let captured: unknown;
  const spy = vi.spyOn(FulfillmentModuleService.prototype, "listServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
    const result = await Reflect.apply(original, this, args); captured = structuredClone(result); return result;
  });
  return { get: () => { if (captured === undefined) throw new Error("Missing actual native root preimage result"); return captured; },
    peek: () => captured, restore: () => spy.mockRestore(), spy };
}
const nestedIds = (value: unknown) => rows(value).flatMap(root => root.geo_zones === undefined ? [] : rows(root.geo_zones).map(child => text(child.id)));

describe("genuine Service Zone selector update, geography replacement and retained inverse", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalServiceZoneUpdate(driver, close => cleanup.push(close), Object.values(graph)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("accepts the complete four-empty-root to sixteen-new-child genuine root plus retained inverse", async () => {
    const tap = nativePreimageTap(), inverse = vi.spyOn(FulfillmentModuleService.prototype, "upsertServiceZones");
    try {
      const host = await connected.prepareRootRoundtrip(tap.get), before = await connected.snapshot(), rootBefore = await connected.read(graph.maximumNew.ids),
        parents = await connected.read(parentIds), key = host.newRequestKey(), ids = [...graph.maximumNew.ids].reverse(); let calls = 0;
      const result = row(await Effect.runPromise(host.run(key, { selector: { id: ids }, update: { geo_zones: newGeography() } }).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) }),
        Effect.ensuring(Effect.sync(() => console.info("ServiceZone update accepting maximum new root plus inverse BoundedRequest.enter", calls))),
      )));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(serviceZoneUpdateResources.calls);
      const output = rows(result.output); expect(output.map(root => root.id)).toEqual(ids); expect(nestedIds(output)).toHaveLength(16);
      for (const root of output) {
        expect(root).not.toHaveProperty("shipping_options"); expect(root).not.toHaveProperty("fulfillment_set");
        expect(root.updated_at).toBe(serviceZoneSeedTime); expect(rows(root.geo_zones).map(child => child.type)).toEqual(["country", "province", "city", "zip"]);
        for (const child of rows(root.geo_zones)) expect(child).toMatchObject({ id: expect.stringMatching(/^fgz_/), service_zone_id: root.id, deleted_at: null });
      }
      expect(result.preimages).toEqual(ids.map(id => ({ id, geo_zones: [] }))); expect(inverse.mock.calls.map(call => call[0])).toEqual([result.preimages]);
      expect(await connected.read(graph.maximumNew.ids)).toEqual(rootBefore); expect(await connected.read(nestedIds(output))).toEqual([]); expect(await connected.read(parentIds)).toEqual(parents);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(emitted.map(event => event.envelope.contract)).toEqual([
        ...Array(16).fill("fulfillment.geo-zone.created"), ...Array(16).fill("fulfillment.geo-zone.deleted"),
      ]);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(await Effect.runPromise(host.run(key, { selector: { id: ids }, update: { geo_zones: newGeography() } }))).toEqual(result);
      expect(inverse).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
    } finally { tap.restore(); inverse.mockRestore(); }
  }, 240_000);

  it("accepts the complete sixteen-current-child native empty-patch root and ID-only retained inverse without writes", async () => {
    const tap = nativePreimageTap();
    try {
      const host = await connected.prepareRootRoundtrip(tap.get), before = await connected.snapshot(), ids = [...graph.maximumCurrent.ids].reverse(); let calls = 0;
      const result = row(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: ids }, update: {} }).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) }),
        Effect.ensuring(Effect.sync(() => console.info("ServiceZone update accepting maximum current graph empty root plus inverse BoundedRequest.enter", calls))),
      )));
      expect(calls).toBeLessThanOrEqual(serviceZoneUpdateResources.calls); expect(result.preimages).toEqual(ids.map(id => ({ id })));
      for (const root of rows(result.output)) expect(root).not.toHaveProperty("geo_zones");
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
    } finally { tap.restore(); }
  }, 240_000);

  it("commits the full sixteen-old to sixteen-new replacement and preserves the genuine inverse membership refusal", async () => {
    const tap = nativePreimageTap();
    try {
      const host = await connected.prepare(), before = await connected.snapshot(), parentBefore = await connected.read(parentIds), ids = [...graph.maximumReplacement.ids].reverse();
      const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: ids }, update: { geo_zones: newGeography() } })));
      expect(output.map(root => root.id)).toEqual(ids); expect(nestedIds(output)).toHaveLength(16); expect(await connected.read(graph.maximumReplacement.geoIds)).toEqual([]);
      expect(await connected.read(nestedIds(output))).toHaveLength(16); expect(await connected.read(parentIds)).toEqual(parentBefore);
      const after = await connected.snapshot(); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 32);
      expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([
        ...Array(16).fill("fulfillment.geo-zone.deleted"), ...Array(16).fill("fulfillment.geo-zone.created"),
      ]);
      const retained = Schema.decodeUnknownSync(ServiceZoneUpdateUpserts)(tap.get()), first = retained[0]; if (first === undefined) throw new Error("Missing actual retained original Zone");
      const message = "The following geo zones does not exists: " + rows(first.geo_zones).map(child => child.id).join(", ");
      const inverse = await connected.prepareInverse(), result = await Effect.runPromise(Effect.result(inverse.run(inverse.newRequestKey(), retained)));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain(message);
      expect(await connected.snapshot()).toEqual(after);
    } finally { tap.restore(); }
  }, 240_000);

  it("rolls back the complete same-attempt maximum replacement when the authentic retained inverse refuses removed IDs", async () => {
    const tap = nativePreimageTap();
    try {
      const host = await connected.prepareRootRoundtrip(tap.get), before = await connected.snapshot();
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: graph.maximumCurrent.ids }, update: { geo_zones: newGeography() } })));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure).some(reason => reason.startsWith("The following geo zones does not exists: "))).toBe(true);
      expect(await connected.snapshot()).toEqual(before); expect(await connected.read(graph.maximumCurrent.geoIds)).toHaveLength(16);
    } finally { tap.restore(); }
  }, 240_000);

  it("keeps scalar output and projected preimages distinct from creation results, including same/empty name writes", async () => {
    const forward = await connected.prepareForward(), id = graph.scalar.ids[0]!, originalChildren = await connected.read(graph.scalar.geoIds);
    const emptyBefore = await connected.snapshot(), empty = row(await Effect.runPromise(forward.run(forward.newRequestKey(), { input: { selector: { id }, update: {} } })));
    expect(empty.preimages).toEqual([{ id }]); expect(rows(empty.output)[0]).not.toHaveProperty("geo_zones");
    expect((await connected.snapshot()).events).toEqual(emptyBefore.events);
    for (const name of [id, "", " Native renamed Zone "]) {
      const before = await connected.snapshot(), prior = await connected.read([id]);
      const result = row(await Effect.runPromise(forward.run(forward.newRequestKey(), { input: { selector: { id }, update: { name } } })));
      expect(result.preimages).toEqual([{ id, name: prior[0]?.name }]); expect(rows(result.output)[0]).toMatchObject({ id, name, updated_at: expect.any(String) });
      expect(rows(result.output)[0]).not.toHaveProperty("shipping_options"); expect(rows(result.output)[0]).not.toHaveProperty("geo_zones");
      expect((await connected.snapshot()).events.slice(before.events.length).map(event => event.envelope.contract)).toEqual(["fulfillment.service-zone.updated"]);
    }
    expect(await connected.read(graph.scalar.geoIds)).toEqual(originalChildren);
  }, 240_000);

  it("preserves empty/missing/historical selector resolution and actual first-occurrence selector order", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "updateServiceZones");
    try {
      for (const id of [[], ["missing"], ["zone-create-historical-name"]]) expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: {} }))).toEqual([]);
      expect(native).toHaveBeenCalledTimes(3);
      const [a, b] = graph.nameRace.ids; if (a === undefined || b === undefined) throw new Error("Missing selector ordering roots");
      expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [a, b, a] }, update: {} }))).map(root => root.id)).toEqual([a, b]);
      expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [b, a] }, update: {} }))).map(root => root.id)).toEqual([b, a]);
      const [accent, emoji] = graph.unicode.ids; if (accent === undefined || emoji === undefined) throw new Error("Missing actual Unicode selector cohort");
      expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [emoji, "missing", accent, emoji] }, update: {} }))).map(root => root.id)).toEqual([emoji, accent]);
      const inverse = await connected.prepareAbsentInverse(), upsert = vi.spyOn(FulfillmentModuleService.prototype, "upsertServiceZones");
      try { expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), null))).toBeNull(); expect(upsert).not.toHaveBeenCalled(); } finally { upsert.mockRestore(); }
    } finally { native.mockRestore(); }
  }, 180_000);

  it("keeps existing-child IDs per parent and refuses historical/missing/foreign membership atomically", async () => {
    const host = await connected.prepare(), id = graph.membership.ids[0]!;
    for (const child of [graph.membership.geoIds[0]!, graph.membership.geoIds[1]!, "missing-geo"]) {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id }, update: { geo_zones: [{ id: child }] } })));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("The following geo zones does not exists: " + child);
      expect(await connected.snapshot()).toEqual(before);
    }
    const before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: graph.membership.ids }, update: { geo_zones: [{ id: graph.membership.geoIds[2]! }] } }))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("retains one existing child plus three new children and successfully executes the genuine projected inverse", async () => {
    const tap = nativePreimageTap();
    try {
      const host = await connected.prepareRootRoundtrip(tap.get), previous = await connected.read(graph.retained.allIds), before = await connected.snapshot();
      const result = row(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: graph.retained.ids[0]! },
        update: { geo_zones: [{ id: graph.retained.geoIds[0]! }, ...newGeography().slice(0, 3)] } })));
      expect(rows(rows(result.output)[0]?.geo_zones)).toHaveLength(4); expect(await connected.read(graph.retained.allIds)).toEqual(previous);
      expect((await connected.snapshot()).events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([
        ...Array(3).fill("fulfillment.geo-zone.created"), ...Array(3).fill("fulfillment.geo-zone.deleted"),
      ]);
    } finally { tap.restore(); }
  }, 180_000);

  it("preserves native insertion order for nonlexical Z,A existing Geo IDs followed by a new child", async () => {
    const tap = nativePreimageTap();
    try {
      const host = await connected.prepare(), output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: graph.ordering.ids[0]! },
        update: { geo_zones: [...[...graph.ordering.geoIds].reverse().map(id => ({ id })), { type: "country", country_code: "TH" }] } })));
      const children = rows(output[0]?.geo_zones); expect(children).toHaveLength(3); expect(children.slice(0, 2).map(child => child.id)).toEqual(["zone-update-child-Z", "zone-update-child-A"]);
      expect(children[2]).toMatchObject({ id: expect.stringMatching(/^fgz_/), country_code: "TH" });
      expect(rows(rows(tap.get())[0]?.geo_zones).map(child => child.id)).toEqual(["zone-update-child-Z", "zone-update-child-A"]);
    } finally {
      const original = tap.peek(), isRows = Schema.is(Schema.Array(Schema.JsonObject));
      if (isRows(original)) console.info("ServiceZone nonlexical actual projected Geo IDs", original.flatMap(root =>
        isRows(root.geo_zones) ? root.geo_zones.map(child => child.id) : []));
      tap.restore();
    }
  }, 180_000);

  it.each(["postalObject", "postalArray", "postalPrimitive"] as const)("preserves complete %s preimages and native JSON-reference change detection", async selected => {
    const tap = nativePreimageTap(), selectedGraph = graph[selected], oldGeo = selectedGraph.geoIds[0]!;
    try {
      const host = await connected.prepareRootRoundtrip(tap.get), before = await connected.snapshot();
      const result = row(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: selectedGraph.ids[0]! }, update: { geo_zones: [
        { id: oldGeo }, { type: "zip", country_code: "US", province_code: "NY", city: "New York", postal_expression: { eq: "10001" } },
      ] } })));
      expect(rows(rows(result.preimages)[0]?.geo_zones)[0]).toMatchObject({ id: oldGeo, postal_expression: postalValues[selected] });
      const actual = (await connected.read([oldGeo]))[0]; expect(actual?.postal_expression).toEqual(postalValues[selected]);
      const changed = selected !== "postalPrimitive"; expect(actual?.updated_at === serviceZoneSeedTime).toBe(!changed);
      expect((await connected.snapshot()).events.slice(before.events.length).map(event => event.envelope.contract)).toEqual(changed
        ? ["fulfillment.geo-zone.created", "fulfillment.geo-zone.updated", "fulfillment.geo-zone.deleted", "fulfillment.geo-zone.updated"]
        : ["fulfillment.geo-zone.created", "fulfillment.geo-zone.deleted"]);
    } finally { tap.restore(); }
  }, 240_000);

  it.each(["historicalEmpty", "historicalNew"] as const)("preserves native historical omission behavior for %s", async selected => {
    const value = graph[selected], host = await connected.prepare(), before = await connected.snapshot();
    const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: value.ids[0]! },
      update: { geo_zones: selected === "historicalEmpty" ? [] : [{ type: "country", country_code: "TH" }] } })));
    expect(await connected.read([value.geoIds[1]!])).toEqual([]);
    const historical = await connected.read([value.geoIds[0]!]); expect(historical).toHaveLength(selected === "historicalEmpty" ? 1 : 0);
    expect(rows(output[0]?.geo_zones)).toHaveLength(selected === "historicalEmpty" ? 0 : 1);
    expect((await connected.snapshot()).events.slice(before.events.length).map(event => event.envelope.contract)).toEqual(selected === "historicalEmpty"
      ? ["fulfillment.geo-zone.deleted"] : ["fulfillment.geo-zone.deleted", "fulfillment.geo-zone.created", "fulfillment.geo-zone.deleted"]);
  }, 240_000);

  it("preserves native geography validation order while refusing nullable names and global-name collisions atomically", async () => {
    const host = await connected.prepare(), id = graph.failure.ids[0]!;
    for (const [geo, message] of [[{ country_code: "MM" }, "Invalid geo zone type: undefined"],
      [{ type: "unknown" }, "Invalid geo zone type: unknown"], [{ type: "country", country_code: "" }, "Missing required property country_code for geo zone type country"],
      [{ type: "province", country_code: "MM" }, "Missing required property province_code for geo zone type province"]] as const) {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id }, update: { geo_zones: [geo] } })));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain(message); expect(await connected.snapshot()).toEqual(before);
    }
    for (const input of [{ selector: { id }, update: { name: null } }, { selector: { id }, update: { name: graph.protected.ids[0]! } },
      { selector: { id: graph.nameRace.ids }, update: { name: "zone-update-duplicate-name" } }]) {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("invalidInput"); expect(await connected.snapshot()).toEqual(before);
    }
  }, 240_000);

  it("refuses wider module fields, managed identities, malformed children and over-budget input before native work", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "updateServiceZones"), before = await connected.snapshot();
    try {
      for (const invalid of [{ selector: { id: Array(5).fill("id") }, update: {} }, { selector: {}, update: {} },
        ...["id", "fulfillment_set_id", "metadata", "shipping_options", "created_at", "deleted_at", "unknown"].map(field => ({ selector: { id: graph.failure.ids[0]! }, update: { [field]: null } })),
        { selector: { id: graph.failure.ids[0]! }, update: { geo_zones: Array(5).fill({ type: "country", country_code: "MM" }) } },
        { selector: { id: graph.failure.ids[0]! }, update: { geo_zones: [{ id: graph.failure.geoIds[0]!, city: "wider-module-patch" }] } }])
        // @ts-expect-error Deliberately invalid input crosses the checked host boundary.
        await expect(Effect.runPromise(host.run(host.newRequestKey(), invalid))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(native).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
      expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareServiceZoneUpdateWorkflow({ ...connected.options,
        modules: { fulfillment: { ...connected.installed, module: { ...connected.fulfillment.workflow } } } }))))).toBe(true);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["late", "caught", "forged"] as const)("rolls back %s native failure and revokes escaped update handles", async mode => {
    const original = FulfillmentModuleService.prototype.updateServiceZones; let escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late native ServiceZone update failure");
      if (mode === "caught") { try { await this.deleteServiceZones([...graph.failure.ids]); } catch { /* refusal remains root-fatal */ } return output; }
      if (!Array.isArray(output) || typeof output[0] !== "object" || output[0] === null) throw new Error("Missing genuine Zone update result");
      Reflect.set(output[0], "shipping_options", [{ id: "forged" }]); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: graph.failure.ids[0]! }, update: { name: "zone-update-failed" } }))))).toBe(true);
      expect(await connected.snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing genuine escaped update method");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("cancels a pending native update and revokes the escaped method without partial publication", async () => {
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.updateServiceZones;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined; const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait; await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), { selector: { id: graph.cancel.ids[0]! }, update: { name: "zone-update-cancelled" } }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("Interrupt"); expect(await connected.snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing cancelled native method"); await expect(escaped()).rejects.toBeDefined();
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("refuses oversized current-history cohorts in a fresh bounded scenario without partial settlement", async () => {
    const overflow = serviceZoneDeletionGraph("zone-update-overflow", { roots: 4, geos: 17 });
    const other = await prepareLogicalServiceZoneUpdate(driver, close => cleanup.push(close), [overflow], { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "service_zone_update_overflow", projectId: "service_zone_update_overflow", uuidOffset: 910_000 } });
    const host = await other.prepare(), before = await other.snapshot();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: overflow.ids }, update: { geo_zones: [{ type: "country", country_code: "TH" }] } })));
    expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("limitExceeded"); expect(await other.snapshot()).toEqual(before);
  }, 240_000);

  it("isolates equal selectors and request keys across scopes, rejects changed replay identity and revokes successful handles", async () => {
    const other = await prepareLogicalServiceZoneUpdate(driver, close => cleanup.push(close), [graph.protected], { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "service_zone_update_b", projectId: "service_zone_update_b", uuidOffset: 920_000 } });
    const left = await connected.prepare(), right = await other.prepare(), changed = await connected.prepare("f".repeat(64)), key = left.newRequestKey(), id = graph.protected.ids[0]!;
    const first = { selector: { id }, update: { name: "Updated first scope" } }, second = { selector: { id }, update: { name: "Updated second scope" } };
    const original = FulfillmentModuleService.prototype.updateServiceZones; let escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args); return result;
    });
    try {
      const beforeOther = await other.read(graph.protected.allIds), firstOutput = await Effect.runPromise(left.run(key, first));
      expect(await other.read(graph.protected.allIds)).toEqual(beforeOther);
      const secondOutput = await Effect.runPromise(right.run(key, second)); expect((await connected.read([id]))[0]?.name).toBe(first.update.name);
      expect((await other.read([id]))[0]?.name).toBe(second.update.name); const after = await connected.snapshot();
      expect(await Effect.runPromise(left.run(key, first))).toEqual(firstOutput); expect(await Effect.runPromise(right.run(key, second))).toEqual(secondOutput);
      await expect(Effect.runPromise(changed.run(key, first))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(left.run(key, second))).rejects.toMatchObject({ reason: "requestConflict" });
      if (escaped === undefined) throw new Error("Missing successful genuine update handle"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); }
  }, 240_000);

  it.skipIf(driver !== "postgres")("invalidates a complete Geo predicate after a canonical child insertion commits", async () => {
    const host = await connected.prepare(), insertion = await connected.prepareGeoInsertion(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.updateServiceZones, id = graph.predicateRace.ids[0]!;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), { selector: { id }, update: { name: "Pending predicate update" } }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(insertion.newRequestKey(), { id: "zone-update-concurrent-geo", type: "country", country_code: "MM", province_code: null, city: null,
          postal_expression: null, metadata: null, service_zone_id: id, created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null })
          .pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("writeConflict");
      expect((await connected.read([id]))[0]?.name).toBe(id); expect(await connected.read(["zone-update-concurrent-geo"])).toHaveLength(1);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.events).toEqual(before.events);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it.skipIf(driver !== "postgres")("refuses stale updates when the genuine physical inverse removes their root and FK children", async () => {
    const host = await connected.prepare(), deletion = await connected.preparePhysicalDelete(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.updateServiceZones, id = graph.fkRace.ids[0]!;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), { selector: { id }, update: { name: "Pending deleted-root update" } }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* deletion.run(deletion.newRequestKey(), [id]).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("writeConflict"); expect(await connected.read(graph.fkRace.allIds)).toEqual([]);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual(["fulfillment.service-zone.deleted"]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it.skipIf(driver !== "postgres")("settles one concurrent native scalar update for a shared global name", async () => {
    const left = await connected.prepare(), right = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(); let arrivals = 0;
    const original = FulfillmentModuleService.prototype.updateServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); arrivals++; if (arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { selector: { id: graph.nameRace.ids[0]! }, update: { name: "Shared concurrent Zone name" } }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { selector: { id: graph.nameRace.ids[1]! }, update: { name: "Shared concurrent Zone name" } }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      expect((await connected.read(graph.nameRace.ids)).filter(root => root.name === "Shared concurrent Zone name")).toHaveLength(1);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.events).toHaveLength(before.events.length + 1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});

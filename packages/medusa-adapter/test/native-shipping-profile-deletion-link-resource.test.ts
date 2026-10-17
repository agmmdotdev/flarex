import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareShippingProfileDeletionLinks, prepareShippingProfileDeletionLinkResource } from "../src/links/shipping-profile-deletion";
import { prepareLocalProductLinks } from "../src/links/product-service";
import { captureProductShippingProfileLinkMetadata } from "../src/links/product-shipping-profile-schema";
import { prepareLinkService } from "../src/links/service";
import { prepareLinkRepository } from "../src/links/repository";
import { captureCommerceInput } from "../src/value/input";
import { prepareLinkWorkflowService } from "../src/links/workflow-service";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices, type InvokeWorkflowMethod } from "../src/workflow/composed-resource";
import { workflowMethodDefinition, workflowModuleDefinition, type WorkflowMethod } from "../src/workflow/module";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

let links: Effect.Success<ReturnType<typeof prepareShippingProfileDeletionLinks>>;
let readPlan: Result.Result.Success<ReturnType<typeof prepareLinkRepository>>["readPlan"];
let lifecycleReadPlan: Result.Result.Success<ReturnType<typeof prepareLinkRepository>>["lifecycleReadPlan"];
type Service = ComposedWorkflowServices<{ readonly link: typeof links.resource }>["link"];
type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const endpoint = (ids: string[]) => ({ fulfillment: { shipping_profile_id: [...ids] } });
const time = "2026-10-17T00:00:00.000Z", table = "product_shipping_profile";
const row = (product_id: string, shipping_profile_id = "sp", deleted_at: string | null = null) => ({
  id: "link-" + product_id, product_id, shipping_profile_id, created_at: time, updated_at: time, deleted_at,
} satisfies JsonObject);
const input = (ids: string[]) => ({ filters: { shipping_profile_id: [...ids] }, config: {
  select: ["product_id", "shipping_profile_id"], relations: [], order: { product_id: "ASC" as const }, skip: 0, take: 256,
} });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const receipt = (ids: string[], rows: readonly JsonObject[]): Call => ({
  commandName: "shippingProfileProductLinkCount", mode: "read", input: input(ids), result: [rows, rows.length],
  events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const pair = (product_id: string, shipping_profile_id = "sp") => ({ product_id, shipping_profile_id });

/** Router-only observation port checks real issuer argument/result contracts.
 * It makes no persistence/settlement claim; connected tests own those proofs. */
function bind(respond: (name: string, args: readonly unknown[]) => Json | Promise<Json>) {
  const definition = composedWorkflowResourceDefinition(links.resource);
  if (definition === undefined) throw new Error("Missing ShippingProfile deletion Link resource");
  const calls: Array<{ name: string; args: readonly unknown[] }> = [];
  const invoke: InvokeWorkflowMethod = async <Output>(method: WorkflowMethod<readonly unknown[], Output>, ...args: readonly unknown[]) => {
    const selected = workflowMethodDefinition(method);
    const identity = selected === undefined ? undefined : commerceCommandIdentity(selected.command);
    if (selected === undefined || identity === undefined) throw new Error("Missing native Link method");
    Result.getOrThrow(selected.input(args));
    calls.push({ name: identity.name, args: structuredClone(args) });
    // SAFETY: this observation port preserves the authentic method's checked
    // output association, matching the production issuer boundary.
    return Result.getOrThrow(selected.output(await respond(identity.name, args))) as Output;
  };
  // SAFETY: the authentic factory retains this exact associated service ABI.
  return { service: definition.bind(invoke) as Service, calls, definition };
}

beforeAll(async () => {
  links = await Effect.runPromise(prepareShippingProfileDeletionLinks());
  const metadata = await Effect.runPromise(captureProductShippingProfileLinkMetadata());
  const prefix = metadata.joiner.databaseConfig?.idPrefix;
  if (prefix === undefined) throw new Error("Missing native Link prefix");
  const prepared = Result.getOrThrow(prepareLinkRepository(metadata.frame, prefix, 8, true));
  readPlan = prepared.readPlan;
  lifecycleReadPlan = prepared.lifecycleReadPlan;
});

describe("native ShippingProfile deletion stored Link resource", () => {
  it.each(["delete", "restore"] as const)("routes %s through the sole genuine stored family", async operation => {
    const family = links.nativeServices.shipping;
    const map = { product_id: ["product1", "product2"], shipping_profile_id: ["sp1", "sp2"] };
    const { service, calls, definition } = bind(() => map);
    const args = endpoint(["sp2", "missing", "sp1", "sp2"]);
    const result = await service[operation](args);
    expect(result).toEqual([null, { [family.routing.__joinerConfig.serviceName!]: map }]);
    expect(calls).toEqual([{ name: operation === "delete" ? family.softDeleteName : family.restoreName,
      args: [{ shipping_profile_id: ["sp2", "missing", "sp1", "sp2"] }, { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys }] }]);
    expect(definition.dependencies).toEqual([family.softDeleteMethod, family.restoreMethod]);
    expect(Object.keys(definition.methods)).toEqual(["delete", "restore"]);
    expect(args).toEqual(endpoint(["sp2", "missing", "sp1", "sp2"]));
    expect(Result.isSuccess(definition.methods[operation]!.output(result))).toBe(true);
    expect(family.routing.__joinerConfig.relationships?.every(relation => relation.deleteCascade !== true)).toBe(true);
  });

  it.each(["delete", "restore"] as const)("retains grouped empty %s with native router no-dispatch", async operation => {
    const { service, calls, definition } = bind(() => { throw new Error("Unexpected empty family callback"); });
    const result = await service[operation](endpoint([]));
    expect(result).toEqual([null, {}]); expect(calls).toEqual([]);
    expect(Result.isSuccess(definition.methods[operation]!.output(result))).toBe(true);
  });

  it.each(["delete", "restore"] as const)("refuses native router errors-as-data from %s", async operation => {
    const { service, calls, definition } = bind(async () => { throw new Error("native stored Link failure"); });
    const result = await service[operation](endpoint(["sp"]));
    expect(result[0]).toMatchObject([{ serviceName: links.nativeServices.shipping.routing.__joinerConfig.serviceName,
      method: operation === "delete" ? "softDelete" : "restore", args: { shipping_profile_id: ["sp"] },
      error: { message: "native stored Link failure" } }]);
    expect(calls).toHaveLength(1);
    expect(definition.methods[operation]!.output(result)).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure" } });
  });

  it("uses its complete-history owner and genuine Query aliases without other Link/Product authority", () => {
    const definition = workflowModuleDefinition(links.shipping.workflow);
    expect(definition?.source).toEqual({ name: "flarex-product-links", profile: "shipping-profile-deletions" });
    expect(definition?.graph.aliases.map(alias => alias.name)).toContain("product_shipping_profile");
    expect(definition?.graph.reads).toHaveLength(1);
    expect(Object.keys(links.nativeServices)).toEqual(["shipping"]);
    expect(Object.keys(links.shipping.workflow.methods)).toEqual(["create", "list", "softDelete", "restore"]);
    expect(links.shipping.commands).toHaveLength(5);
    expect(composedWorkflowResourceDefinition(links.resource)?.identity).toMatchObject({ lifecycle: { maximumRows: 8, completeHistory: true } });
  });

  it("refuses copied tokens, another admission, unbounded and active-only owners", async () => {
    expect(prepareShippingProfileDeletionLinkResource({ shipping: { ...links.nativeServices.shipping } }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const old = await Effect.runPromise(prepareLocalProductLinks("product-deletions"));
    for (const shipping of [old.nativeServices.shipping, old.nativeServices.sales])
      expect(prepareShippingProfileDeletionLinkResource({ shipping }))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    const metadata = await Effect.runPromise(captureProductShippingProfileLinkMetadata());
    for (const prepared of [await Effect.runPromise(prepareLinkService(metadata)), await Effect.runPromise(prepareLinkService(metadata, 8))])
      expect(prepareLinkWorkflowService(prepared, "looseShippingProfileDeletion", "shipping-profile-deletions"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("bounds raw grouped endpoints and paired result maps", () => {
    const { definition } = bind(() => ({})), family = links.nativeServices.shipping;
    const config = { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys };
    for (const operation of ["delete", "restore"] as const) {
      const method = definition.methods[operation]!;
      expect(Result.isSuccess(method.arguments([endpoint(["sp", "sp", "missing", "other"])]))).toBe(true);
      for (const value of [endpoint(["1", "2", "3", "4", "5"]), endpoint([""]), {}, { fulfillment: {} },
        { fulfillment: { shipping_profile_id: "sp" } }, { product: { product_id: ["p"] } },
        { fulfillment: { shipping_profile_id: ["sp"] }, product: { product_id: ["p"] } }])
        expect(Result.isFailure(method.arguments([value]))).toBe(true);
      const native = workflowMethodDefinition(operation === "delete" ? family.softDeleteMethod! : family.restoreMethod!);
      expect(Result.isSuccess(native!.input([{ shipping_profile_id: ["1", "2", "3", "4"] }, config]))).toBe(true);
      expect(Result.isFailure(native!.input([{ product_id: ["p"] }, config]))).toBe(true);
      for (const value of [[null, { foreign: {} }], [null, { [family.routing.__joinerConfig.serviceName!]: { product_id: ["p"] } }],
        [null, { [family.routing.__joinerConfig.serviceName!]: { product_id: ["p"], shipping_profile_id: [] } }]] satisfies Json[])
        expect(Result.isFailure(method.output(value))).toBe(true);
    }
  });
});

describe("ShippingProfile deletion Link lifecycle selection receipt", () => {
  const evidence = (ids: string[], total: number, restore = true, maximum = 256): Activity["relationalReads"] => {
    const query = Result.getOrThrow(lifecycleReadPlan(restore ? "restore" : "softDelete", { shipping_profile_id: ids }, maximum)).query;
    return [0, 1].map(() => ({ table, query, total, returned: total }));
  };
  const lifecycleCall = (ids: string[], restore = true): Call => ({
    commandName: restore ? links.nativeServices.shipping.restoreName! : links.nativeServices.shipping.softDeleteName!,
    mode: "write", input: { selector: { shipping_profile_id: ids },
      config: { returnLinkableKeys: links.nativeServices.shipping.routing.__joinerConfig.primaryKeys! } },
    result: {}, events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
  });
  const validate = (call: Call, activity: Activity) => links.shipping.logicalEventPolicy().validateLogicalCall(call, activity);
  const refuse = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(validate(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

  it("shares native wrapped selection planning while preserving false and multi-branch predicates", () => {
    for (const ids of [[], ["old", "missing", "old"]]) for (const operation of ["softDelete", "restore"] as const) {
      const flat = Result.getOrThrow(lifecycleReadPlan(operation, { shipping_profile_id: ids }, 8));
      const native = Result.getOrThrow(lifecycleReadPlan(operation, { $or: [{ shipping_profile_id: { $in: ids } }] }, 8));
      expect(native.query).toEqual(flat.query);
      expect(native.query.take).toBe(8);
      expect(native.withDeleted).toBe(true);
    }
    const none = Result.getOrThrow(lifecycleReadPlan("restore", { $or: [] }, 8));
    const all = Result.getOrThrow(lifecycleReadPlan("restore", {}, 8));
    expect(none.query.predicate).toEqual({ kind: "and", children: [{ kind: "or", children: [] }] });
    expect(none.query).not.toEqual(all.query);
    const multiple = Result.getOrThrow(lifecycleReadPlan("restore", {
      $or: [{ product_id: { $in: ["a"] }, shipping_profile_id: { $in: ["old"] } },
        { product_id: { $in: ["b"] }, shipping_profile_id: { $in: ["other"] } }],
    }, 8));
    expect(multiple.query.predicate).toEqual({ kind: "and", children: [{ kind: "or", children: [
      { kind: "and", children: [{ kind: "in", column: "product_id", values: ["a"] }, { kind: "in", column: "shipping_profile_id", values: ["old"] }] },
      { kind: "and", children: [{ kind: "in", column: "product_id", values: ["b"] }, { kind: "in", column: "shipping_profile_id", values: ["other"] }] },
    ] }] });
  });

  it.each([false, true])("requires exact complete executed selection for empty lifecycle restore=%s", async restore => {
    for (const ids of [[], ["old", "missing", "old"]]) {
      const call = lifecycleCall(ids, restore), activity = { ...empty(), relationalReads: evidence(ids, 0, restore) };
      const query = Result.getOrThrow(lifecycleReadPlan(restore ? "restore" : "softDelete", { shipping_profile_id: ids }, 256)).query;
      await Effect.runPromise(validate(call, activity));
      await Effect.runPromise(validate(call, { ...activity, relationalReads: evidence(ids, 0, restore, 4) }));
      await refuse(call, empty());
      await refuse(call, { ...activity, relationalReads: evidence(["redirected"], 0, restore) });
      await refuse(call, { ...activity, relationalReads: activity.relationalReads.slice(0, 1) });
      await refuse(call, { ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, total: 1, returned: 1 })) });
      await refuse(call, { ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, query: { ...query, take: 0 }, total: 1, returned: 0 })) });
      await refuse(call, { ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, query: { ...query, fields: ["id"] } })) });
    }
  });

  it("preserves all eight historical Link restores and native result/event order", async () => {
    const before = Array.from({ length: 8 }, (_, index) => row("product-" + index, "old", time));
    const after = before.map(value => ({ ...value, deleted_at: null }));
    const family = links.nativeServices.shipping, entityName = family.routing.__definition.label;
    const call: Call = { ...lifecycleCall(["old", "missing", "old"]),
      result: { product_id: before.map(value => value.product_id!), shipping_profile_id: before.map(value => value.shipping_profile_id!) },
      events: [{ name: entityName + ".attached", metadata: { source: family.routing.__joinerConfig.serviceName!,
        object: entityName, action: "attached" }, data: { id: before.map(value => value.id!) } }],
    };
    const activity: Activity = { ...empty(), relationalReads: evidence(["old", "missing", "old"], 8, true, 8),
      observedRows: after.map(value => ({ table, row: value })),
      mutations: after.map((value, ordinal) => ({ ordinal, table, operation: "patch", before: before[ordinal]!, after: value })),
      lifecycle: before.map((value, attemptOrdinal) => ({ table, operation: "restore", key: {
        product_id: value.product_id!, shipping_profile_id: value.shipping_profile_id!,
      }, beforeDeletedAt: time, afterDeletedAt: null, attemptOrdinal, rowAtOperation: null })),
    };
    await Effect.runPromise(validate(call, activity));
    await refuse(call, { ...activity, relationalReads: evidence(["old", "missing", "old"], 9, true, 8) });
    await refuse(call, { ...activity, relationalReads: evidence(["elsewhere"], 8, true, 8) });
    await refuse(call, { ...activity, lifecycle: activity.lifecycle.slice(0, -1) });
  });
});

describe("ShippingProfile deletion complete active Link Query receipt", () => {
  const evidence = (ids: string[], total: number): Activity["relationalReads"] => {
    const args = input(ids);
    const query = Result.getOrThrow(readPlan(Result.getOrThrow(captureCommerceInput(buildQuery(args.filters, args.config))), args.config.take)).query;
    return [0, 1].map(() => ({ table, query, total, returned: total }));
  };
  const validate = (call: Call, activity: Activity) => links.shipping.logicalEventPolicy().validateLogicalCall(call, activity);
  const refuse = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(validate(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

  it("authenticates exact active cohort and native Product-key order from permuted candidate observations", async () => {
    const activity: Activity = { ...empty(), relationalReads: evidence(["sp", "missing", "sp"], 2),
      observedRows: [row("z"), row("old", "sp", time), row("a"), row("outside", "else")].map(row => ({ table, row })) };
    const call = receipt(["sp", "missing", "sp"], [pair("a"), pair("z")]);
    await Effect.runPromise(validate(call, activity));
    for (const result of [[[pair("z"), pair("a")], 2], [[pair("a")], 1], [[pair("a"), pair("z"), pair("old")], 3],
      [[pair("a"), pair("z")], 1], [[pair("a"), { ...pair("z"), id: "extra" }], 2]] satisfies Json[])
      await refuse({ ...call, result }, activity);
  });

  it("authenticates full candidate DML rows before exact two-field presentation", async () => {
    const call = receipt(["sp"], [pair("a")]);
    for (const modify of [
      (value: Record<string, Json>) => { delete value.created_at; },
      (value: Record<string, Json>) => { value.product_id = 1; },
      (value: Record<string, Json>) => { value.shipping_profile_id = ""; },
      (value: Record<string, Json>) => { value.extra = true; },
    ]) {
      const candidate = { ...row("a") }; modify(candidate);
      await refuse(call, { ...empty(), relationalReads: evidence(["sp"], 1), observedRows: [{ table, row: candidate }] });
    }
    await refuse(call, { ...empty(), relationalReads: evidence(["sp"], 1), observedRows: [{ table: "product", row: row("a") }] });
  });

  it("retains empty/deleted matching selection and refuses a ninth active row", async () => {
    const activity = { ...empty(), relationalReads: evidence(["sp"], 0), observedRows: [{ table, row: row("old", "sp", time) }] };
    await Effect.runPromise(validate(receipt(["sp"], []), activity));
    await Effect.runPromise(validate(receipt([], []), { ...empty(), relationalReads: evidence([], 0), observedRows: [{ table, row: row("outside") }] }));
    const rows = Array.from({ length: 9 }, (_, index) => row("p" + index));
    await refuse(receipt(["sp"], rows.map(value => pair(String(value.product_id)))), { ...empty(), relationalReads: evidence(["sp"], 9), observedRows: rows.map(row => ({ table, row })) });
  });

  it("refuses wider fields, selectors, pagination, event or mutation evidence", async () => {
    const call = receipt(["sp"], [pair("a")]), activity = { ...empty(), relationalReads: evidence(["sp"], 1), observedRows: [{ table, row: row("a") }] };
    for (const replacement of [
      { ...input(["sp"]), filters: { product_id: ["a"] } },
      { ...input(["sp"]), config: { ...input(["sp"]).config, select: ["product_id", "shipping_profile_id", "id"] } },
      { ...input(["sp"]), config: { ...input(["sp"]).config, skip: 1 } },
      { ...input(["sp"]), config: { ...input(["sp"]).config, order: { product_id: "DESC" } } },
    ]) await refuse({ ...call, input: replacement }, activity);
    await refuse({ ...call, mode: "write" }, activity);
    await refuse({ ...call, events: [{ name: "foreign" }] }, activity);
    await refuse(call, { ...activity, mutations: [{ ordinal: 0, table, operation: "insert", before: null, after: row("b") }] });
  });

  it("requires authentic exact read intent even for empty results", async () => {
    const call = receipt(["blocked"], []), matching = { ...empty(), relationalReads: evidence(["blocked"], 0) };
    await Effect.runPromise(validate(call, matching));
    await refuse(call, empty());
    await refuse(call, { ...matching, relationalReads: evidence(["elsewhere"], 0) });
    await refuse(call, { ...matching, relationalReads: matching.relationalReads.slice(0, 1) });
    await refuse(call, { ...matching, relationalReads: matching.relationalReads.map(read => ({ ...read, table: "product" })) });
    await refuse(call, { ...matching, relationalReads: matching.relationalReads.map(read => ({ ...read, total: 1, returned: 0 })) });
  });
});

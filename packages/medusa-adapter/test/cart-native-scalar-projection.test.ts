import { Effect, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureCartCreationMetadata } from "../src/modules/cart/creation-schema";
import { decodeCartPaymentRead, prepareCartPaymentRead } from "../src/modules/cart/payment-read";
import { compileProjection, projectRows, type ProjectionPolicy } from "../src/query/projection";
import { captureCommerceInput } from "../src/value/input";

let prepared: Result.Result.Success<ReturnType<typeof prepareCartPaymentRead>>;
beforeAll(async () => {
  const metadata = await Effect.runPromise(captureCartCreationMetadata());
  prepared = Result.getOrThrow(prepareCartPaymentRead(metadata.frame, "creation", "nativeOrm"));
});

const query = (table: string, select: string[], relations: string[] = []) => captureCommerceInput(buildQuery({ id: "native-json" },
  { select, relations, take: 1 })).pipe(Result.flatMap(value => prepared.queryTable(table, value)));

it("retains only the native required whole Cart metadata beside discarded JSON descendant selectors", () => {
  const config = getSelectsAndRelationsFromObjectArray([{ id: "native-json", metadata: { edited: true, nested: { value: 1 } } }],
    { requiredFields: ["id", "metadata"] });
  expect(config).toEqual({ selects: ["id", "metadata.edited", "metadata.nested.value", "metadata"], relations: [] });
  const plan = Result.getOrThrow(query("cart", config.selects, config.relations));
  expect(plan.projection.storageFields).toEqual(["id", "metadata"]);
  const row = { id: "native-json", metadata: { retained: true, nested: { previous: 2 } }, email: "unselected@example.com" };
  expect(Result.getOrThrow(projectRows([row], plan.projection.node))).toEqual([{ id: row.id, metadata: row.metadata }]);
});

it("keeps a native Line metadata-only preimage at id without synthesizing the JSON parent", () => {
  const config = getSelectsAndRelationsFromObjectArray([{ metadata: { group: "changed" } }]);
  expect(config).toEqual({ selects: ["metadata.group"], relations: [] });
  const plan = Result.getOrThrow(query("cart_line_item", config.selects, config.relations));
  expect(plan.projection.storageFields).toEqual(["id"]);
  expect(Result.getOrThrow(projectRows([{ id: "native-json", metadata: { group: "before" } }], plan.projection.node)))
    .toEqual([{ id: "native-json" }]);
  const emptyKey = getSelectsAndRelationsFromObjectArray([{ metadata: { "": "changed" } }]);
  expect(emptyKey).toEqual({ selects: ["metadata."], relations: [] });
  expect(Result.getOrThrow(query("cart_line_item", emptyKey.selects)).projection.storageFields).toEqual(["id"]);
});

it("preserves real relation projection and refuses unknown or non-JSON scalar descendants", () => {
  const plan = Result.getOrThrow(query("cart", ["items.title", "items.metadata.group"], ["items"]));
  expect(plan.projection.node.children[0]?.node.fields).toEqual(new Set(["title", "id", "cart_id"]));
  for (const fields of [["email.member"], ["unregistered.member"], ["items.title.member"]])
    expect(Result.isFailure(query("cart", fields, fields[0]?.startsWith("items.") ? ["items"] : []))).toBe(true);
  const policy: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "retain", selectableRelations: [], nested: new Map() };
  expect(Result.isFailure(compileProjection(prepared.catalog, "cart", ["metadata.group"], [], policy))).toBe(true);
  expect(Result.isFailure(compileProjection(prepared.catalog, "cart", ["metadata.group"], [], { ...policy, jsonScalarFields: ["unregistered"] }))).toBe(true);
});

it("populates the native bare Address selector from a primitive update reference without inventing a scalar", () => {
  const config = getSelectsAndRelationsFromObjectArray([{ id: "native-json", shipping_address: "addr-native" }],
    { requiredFields: ["id", "metadata"] });
  expect(config).toEqual({ selects: ["id", "shipping_address", "metadata"], relations: [] });
  const plan = Result.getOrThrow(query("cart", config.selects, config.relations));
  expect(plan.paths).toEqual(["shipping_address"]);
  expect(plan.projection.storageFields).toEqual(["id", "metadata", "shipping_address_id"]);
  expect(Result.getOrThrow(projectRows([{ id: "native-json", metadata: null, shipping_address_id: "addr-native",
    shipping_address: { id: "addr-native", city: "Yangon" } }], plan.projection.node)))
    .toEqual([{ id: "native-json", metadata: null, shipping_address_id: "addr-native", shipping_address: { id: "addr-native", city: "Yangon" } }]);
  const combined = Result.getOrThrow(query("cart", ["items.tax_lines.code"], ["shipping_address"]));
  expect(combined.paths).toEqual(["shipping_address", "items", "items.tax_lines"]);
  expect(combined.projection.storageFields).not.toContain("shipping_address");
  expect(Result.isFailure(query("cart", ["creation_claims"], []))).toBe(true);
});

it("admits native take1 only for an empty or singleton ID cohort at command and normalized DAL boundaries", () => {
  const nativeQuery = (where: Record<string, unknown>, take: 1 | 4 | 15 | 256) =>
    captureCommerceInput(buildQuery(where, { select: ["id"], relations: [], take })).pipe(Result.flatMap(prepared.query));
  for (const id of ["native-json", ["native-json"], ["native-json", "native-json"], []]) {
    expect(Result.isSuccess(decodeCartPaymentRead({ filters: { id }, config: { take: 1 } }))).toBe(true);
    const plan = Result.getOrThrow(nativeQuery({ id }, 1));
    expect(plan.projection.storageFields).toEqual(["id"]);
    expect(plan.query.predicate).toEqual({ kind: "and", children: [{ kind: "and", children: [
      { kind: "in", column: "id", values: typeof id === "string" ? [id] : [...new Set(id)] },
    ] }, { kind: "isNull", column: "deleted_at" }] });
  }
  const multiple = ["native-json", "other-native-json"];
  expect(Result.isFailure(decodeCartPaymentRead({ filters: { id: multiple }, config: { take: 1 } }))).toBe(true);
  expect(Result.isFailure(nativeQuery({ id: multiple }, 1))).toBe(true);
  expect(Result.isFailure(nativeQuery({ $or: multiple.map(id => ({ id })) }, 1))).toBe(true);
  expect(Result.isFailure(nativeQuery({}, 1))).toBe(true);
  expect(Result.isFailure(nativeQuery({ id: { $in: ["native-json"] } }, 1))).toBe(true);
  expect(Result.isSuccess(nativeQuery({ $or: [{ id: "native-json" }, { id: "native-json" }] }, 1))).toBe(true);
  expect(Result.isSuccess(nativeQuery({ $or: [] }, 1))).toBe(true);
  // The real scalarIdWhere grammar intersects direct membership with its
  // normalized selector membership; that intersection can also prove one ID.
  expect(Result.isSuccess(nativeQuery({ id: multiple, $or: [{ id: "native-json" }] }, 1))).toBe(true);
  for (const take of [4, 15, 256] as const) {
    expect(Result.isSuccess(decodeCartPaymentRead({ filters: { id: multiple }, config: { take } }))).toBe(true);
    const plan = Result.getOrThrow(nativeQuery({ id: multiple }, take));
    if (plan.window.kind !== "catalog") throw new Error("Missing actual Cart complete-cohort query owner");
    expect(plan.window.select(multiple.map(id => ({ id })))).toEqual({ rows: multiple.map(id => ({ id })), count: 2 });
  }
});

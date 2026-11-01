import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import type { DocumentObject } from "flarex-protocol/document-value";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { JsonObject } from "flarex-protocol/json";
import { compileProductCoreDefinition } from "../../../medusa-adapter/src/modules/product/schema";
import { compileProductLinksCoreDefinition } from "../../../medusa-adapter/src/links/product-definition";
import type { CoreNativeDefinition, CoreNativeRelationalRowPolicy } from "../../src/core/nativePolicy";
import { coreNativePolicyForTable, coreNativeRelationalRows } from "../../src/core/nativePolicy";
import type { CoreTableDefinition } from "../../src/core/api";
import { executeCoreNativeRelationalPage, executeCoreNativeRelationalRead, prepareCoreNativeRelationalRead } from "../../src/core/nativeRelationalQuery";
import { captureCoreNativeWhere, coreNativeUniqueValues, planCoreNativeQuery } from "../../src/core/nativeQuery";

let definition: CoreNativeDefinition;
beforeAll(async () => {
  definition = await Effect.runPromise(compileProductCoreDefinition({ scopeUuid: "b0bb299f-9937-4e56-94c6-a184575674ca",
    epochUuid: "1e02d9b6-fb17-477d-83ea-a1fd77a4d81d" }));
});

function select(localName: string): Readonly<{ table: CoreTableDefinition; policy: CoreNativeRelationalRowPolicy }> {
  const declaration = definition.tables.find(table => table.localName === localName);
  const schema = definition.schema.tables.find(table => table.tableName === declaration?.name);
  const policy = declaration === undefined ? undefined : coreNativeRelationalRows(definition, declaration.name);
  if (declaration === undefined || schema === undefined || policy === undefined) throw new Error("Missing genuine Product table");
  return { policy, table: { name: declaration.name, number: 10001, tabletId: new Uint8Array(16), namespace: null, state: "active",
    nativePolicy: coreNativePolicyForTable(definition, declaration, "active", Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16)))),
    indexes: schema.indexes.map((index, position) => ({ name: index.indexDescriptor, fields: index.fields, ref: { id: Uint8Array.of(position + 1) } })) } };
}
function document(policy: CoreNativeRelationalRowPolicy, row: JsonObject, creationTime: number): DocumentObject {
  const normalized = Result.getOrThrow(policy.rows.normalize(row, null, "2026-11-01T00:00:00.000Z"));
  return { ...normalized, _id: `storage-${row.id}`, _creationTime: creationTime };
}

describe("native relational plans over Core observations", () => {
  it("captures Product and Link target identities before asynchronous compilation", async () => {
    const check = async <Failure>(compile: (target: { scopeUuid: string; epochUuid: string; applicationRead?: boolean }) => Effect.Effect<CoreNativeDefinition, Failure>) => {
      const target = { scopeUuid: "b0bb299f-9937-4e56-94c6-a184575674ca", epochUuid: "1e02d9b6-fb17-477d-83ea-a1fd77a4d81d", applicationRead: false };
      const expected = { scopeUuid: target.scopeUuid, epochUuid: target.epochUuid };
      const running = Effect.runPromise(compile(target));
      target.scopeUuid = "0617fdc6-e30e-4d59-83aa-b8881384f264";
      target.epochUuid = "10ceab98-9b60-4da7-9558-747539f6c67c";
      target.applicationRead = true;
      const selected = await running;
      expect(selected.identity).toMatchObject(expected);
      expect(selected.applicationRead).toBe(false);
    };
    await check(compileProductCoreDefinition);
    await check(target => compileProductLinksCoreDefinition(target, { salesChannel: true, shippingProfile: true }));
  });

  it("uses the active indexed cohort for native search and counts before its projected window", async () => {
    const { table, policy } = select("product");
    const rows = [document(policy, { id: "later", title: "MATCH two", handle: "later" }, 2),
      document(policy, { id: "first", title: "match one", handle: "first" }, 1),
      document(policy, { id: "other", title: "Other", handle: "other" }, 3)];
    const captured: JsonObject[] = [];
    const query = Result.getOrThrow(prepareCoreNativeRelationalRead(policy, { fields: ["id"], skip: 1, take: 1,
      order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
        { kind: "isNull", column: "deleted_at" }, { kind: "textLikeAscii", column: "title", pattern: "%MATCH%" },
      ] } }, 2048));
    const result = await Effect.runPromise(executeCoreNativeRelationalRead({ find: (_table, where) => {
      captured.push(where); return Effect.succeed(rows);
    } }, table, policy, query));
    expect(captured).toEqual([{ deleted_at: null }]);
    expect(result).toEqual({ rows: [{ id: "later" }], count: 2, returned: 1 });
  });

  it("keeps native JSON containment and stable insertion order in the shared query owner", async () => {
    const { table, policy } = select("product");
    const rows = [document(policy, { id: "a", title: "A", handle: "a", metadata: { channel: ["retail", "web"] } }, 2),
      document(policy, { id: "z", title: "Z", handle: "z", metadata: { channel: ["web"] } }, 1)];
    const json = Result.getOrThrow(prepareCoreNativeRelationalRead(policy, { fields: ["id"], order: { column: "id", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" },
        { kind: "jsonContains", column: "metadata", value: { channel: ["retail"] } }] } }, 2048));
    expect(await Effect.runPromise(executeCoreNativeRelationalRead({ find: () => Effect.succeed(rows) }, table, policy, json)))
      .toEqual({ rows: [{ id: "a" }], count: 1, returned: 1 });
    const insertion = Result.getOrThrow(prepareCoreNativeRelationalRead(policy, { fields: ["id"], order: { kind: "storageInsertion", direction: "asc" },
      predicate: { kind: "in", column: "id", values: ["a", "z"] } }, 2048));
    expect(await Effect.runPromise(executeCoreNativeRelationalRead({ find: () => Effect.succeed(rows) }, table, policy, insertion)))
      .toEqual({ rows: [{ id: "z" }, { id: "a" }], count: 2, returned: 2, orderedIdentities: [{ id: "z" }, { id: "a" }] });
  });

  it("claims active non-null SKU tuples and needs explicit partial eligibility for unique reads", () => {
    const { table, policy } = select("product_variant");
    const sku = table.nativePolicy?.uniqueConstraints.find(constraint => "fields" in constraint && constraint.fields.length === 1 && constraint.fields[0] === "sku");
    if (sku === undefined) throw new Error("Missing SKU constraint");
    const active = document(policy, { id: "variant", title: "Variant", sku: "shared" }, 1);
    expect(Result.getOrThrow(coreNativeUniqueValues(sku, active))).toEqual(["shared"]);
    expect(Result.getOrThrow(coreNativeUniqueValues(sku, { ...active, sku: null }))).toBeNull();
    expect(Result.getOrThrow(coreNativeUniqueValues(sku, { ...active, deleted_at: "2026-11-01T00:00:00.000Z" }))).toBeNull();
    const plan = (where: JsonObject) => Result.getOrThrow(planCoreNativeQuery(table, Result.getOrThrow(captureCoreNativeWhere(where))));
    expect(plan({ sku: "shared", deleted_at: null })).toMatchObject({ kind: "unique", values: ["shared"] });
    expect(plan({ sku: "shared" }).kind).not.toBe("unique");
  });

  it("keeps examined pages on the native window and refuses unadmitted PostgreSQL predicates before reads", async () => {
    const { table, policy } = select("product");
    const declaration = definition.tables.find(candidate => candidate.name === table.name);
    if (declaration === undefined) throw new Error("Missing Product declaration");
    const row = document(policy, { id: "page", title: "Page", handle: "page" }, 1);
    const query = Result.getOrThrow(prepareCoreNativeRelationalRead(policy, { fields: ["id"], skip: 2, take: 1,
      order: { column: "id", direction: "asc" }, predicate: { kind: "isNull", column: "deleted_at" } }, 2048));
    const windows: unknown[] = [];
    expect(await Effect.runPromise(executeCoreNativeRelationalPage({ findPage: (name, where, options) => {
      windows.push({ name, where, options }); return Effect.succeed({ documents: [row], hasMore: true });
    } }, table, declaration, policy, query))).toEqual({ rows: [{ id: "page" }], hasMore: true });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ name: table.name, where: { deleted_at: null }, options: { offset: 2, limit: 1, order: "asc" } });
    const postgres = Result.getOrThrow(prepareCoreNativeRelationalRead(policy, { fields: ["id"], order: { column: "id", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "in", column: "id", values: ["page"] },
        { kind: "postgresText", column: "title", operator: "regex", value: "P.*" }] } }, 2048));
    let reads = 0;
    await expect(Effect.runPromise(executeCoreNativeRelationalRead({ find: () => {
      reads++; return Effect.succeed([row]);
    } }, table, policy, postgres))).rejects.toMatchObject({ _tag: "CoreQueryInputError", reason: "invalidQuery" });
    expect(reads).toBe(0);
  });
});

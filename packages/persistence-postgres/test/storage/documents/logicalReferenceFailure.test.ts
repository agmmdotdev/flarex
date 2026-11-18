import { expect, it } from "vitest";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { inspectLogicalReferenceFailure, retainLogicalReferenceFailure } from "../../../src/storage/documents/logicalDocuments/referenceFailure";
import { logicalCommerceError } from "../../../src/frameworks/commerceTransaction/model";
import { projectCommerceRequestFailure } from "../../../src/frameworks/commerceTransaction/request";

it("retains exact reference-failure identity through the Commerce projection", () => {
  const failure = logicalCommerceError("documentInvalid");
  const child = { tableId: CatalogTableIdSchema.make(1), tableName: "child", documentId: "document" };
  const target = { tableId: CatalogTableIdSchema.make(2), tableName: "parent", column: "id", key: "missing" };
  retainLogicalReferenceFailure(failure, { origin: "checkpoint", child, sourceColumn: "parent_id", target });
  child.documentId = "changed"; target.key = "changed";
  expect(projectCommerceRequestFailure(failure)).toBe(failure);
  expect(inspectLogicalReferenceFailure(failure)).toMatchObject({ origin: "checkpoint", child: { documentId: "document" }, target: { key: "missing" } });
  expect(failure.reason).toBe("invalidInput");
  expect(failure.cause).toBeUndefined();
  expect(inspectLogicalReferenceFailure({ ...failure })).toBeUndefined();
  expect(inspectLogicalReferenceFailure({ cause: failure })).toBeUndefined();
  expect(inspectLogicalReferenceFailure(JSON.parse(JSON.stringify(failure)))).toBeUndefined();
});

it("does not attach reference provenance to primitive generic failures", () => {
  const evidence = { origin: "close" as const, child: { tableId: CatalogTableIdSchema.make(1), tableName: "child", documentId: "document" },
    sourceColumn: "parent_id", target: { tableId: CatalogTableIdSchema.make(2), tableName: "parent", column: "id", key: "missing" } };
  for (const failure of [undefined, null, false, 1, "documentInvalid"]) {
    expect(() => retainLogicalReferenceFailure(failure, evidence)).not.toThrow();
    expect(inspectLogicalReferenceFailure(failure)).toBeUndefined();
  }
});

it("preserves the first reference provenance when a failure factory reuses an error across contexts", () => {
  const reused = new Error("shared generic failure");
  retainLogicalReferenceFailure(reused, { origin: "checkpoint", child: { tableId: CatalogTableIdSchema.make(1), tableName: "first_child", documentId: "first_document" },
    sourceColumn: "first_parent_id", target: { tableId: CatalogTableIdSchema.make(2), tableName: "first_parent", column: "id", key: "first_missing" } });
  const original = inspectLogicalReferenceFailure(reused);
  retainLogicalReferenceFailure(reused, { origin: "close", child: { tableId: CatalogTableIdSchema.make(3), tableName: "later_child", documentId: "later_document" },
    sourceColumn: "later_parent_id", target: { tableId: CatalogTableIdSchema.make(4), tableName: "later_parent", column: "key", key: "later_missing" } });
  expect(inspectLogicalReferenceFailure(reused)).toBe(original);
  expect(original).toEqual({ origin: "checkpoint", child: { tableId: 1, tableName: "first_child", documentId: "first_document" },
    sourceColumn: "first_parent_id", target: { tableId: 2, tableName: "first_parent", column: "id", key: "first_missing" } });
  expect(inspectLogicalReferenceFailure(new Error("shared generic failure"))).toBeUndefined();
});

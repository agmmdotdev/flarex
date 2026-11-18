import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/utils/common/get-selects-and-relations-from-object-array";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { compileProjection } from "../src/query/projection";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { decodeGraphCount } from "../src/local-graph/query";
import { relationPaths } from "../src/local-graph/module";
import type { GraphReadDefinition } from "../src/local-graph/model";
import { nativePreimageSelection } from "../src/workflow/preimage";

let metadata: ProductRuntimeMetadata, read: GraphReadDefinition;
beforeAll(async () => {
  metadata = await Effect.runPromise(captureProductSchema("native-preimage-tests").pipe(
    Effect.flatMap(schema => productRuntimeMetadata(schema.metadata.frame)),
  ));
  const table = Result.getOrThrow(metadata.readCatalog.table(metadata.collection.table.name));
  read = { model: metadata.collection.model, table,
    paths: Result.getOrThrow(relationPaths(metadata.readCatalog, table.name, ["products"])),
    command: defineGraphReadCommand("preimageCollectionRead", () => Effect.succeed([[], 0])),
    orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount };
});

describe("named native compensation preimages", () => {
  it("drops native Collection product_ids DTO paths before the strict DAL projection", () => {
    const { selects, relations } = getSelectsAndRelationsFromObjectArray([{ product_ids: ["product-existing"] }]);
    expect(relations).toEqual(["product_ids"]);
    expect(selects.every(field => field.startsWith("product_ids."))).toBe(true);
    const normalized = nativePreimageSelection({ select: selects, relations }, read, ["product_ids"]);
    expect(normalized).toEqual({ select: ["id"], relations: [] });
    const policy = metadata.relatedReads.get(read.table.name)?.projection;
    if (policy === undefined) throw new Error("Missing native Collection projection policy");
    expect(compileProjection(metadata.readCatalog, read.table.name, normalized.select, normalized.relations ?? [], policy)._tag)
      .toBe("Success");
    expect(compileProjection(metadata.readCatalog, read.table.name, selects, relations, policy))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("retains ordinary unknown relations and declared but unadmitted relationships for strict refusal", () => {
    const policy = metadata.relatedReads.get(read.table.name)?.projection;
    if (policy === undefined) throw new Error("Missing native Collection projection policy");
    for (const relation of ["unknown_relation", "products"]) {
      const normalized = nativePreimageSelection({ select: [], relations: [relation] }, { ...read, paths: [] }, ["product_ids"]);
      expect(normalized).toEqual({ select: ["id"], relations: [relation] });
      expect(compileProjection(metadata.readCatalog, read.table.name, normalized.select, normalized.relations ?? [],
        { ...policy, allowedPaths: [] }))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
  });

  it("drops only exact explicitly selected DTO paths while other named profiles retain their prior relation contract", () => {
    const dto = { select: [], relations: ["product_ids"] };
    expect(nativePreimageSelection(dto, read)).toEqual({ select: ["id"], relations: ["product_ids"] });
    expect(nativePreimageSelection({ select: [], relations: ["product_ids", "product_ids.nested", "unknown_relation", "products"] }, read, ["product_ids"]))
      .toEqual({ select: ["id", "products.id"], relations: ["product_ids.nested", "unknown_relation", "products"] });
    expect(nativePreimageSelection({ relations: ["product_ids", "products"] }, read, ["product_ids"]))
      .toEqual({ relations: ["products"] });
  });

  it("keeps primary keys for empty updates and metadata paths without changing actual admitted relations", () => {
    for (const update of [{}, { metadata: { key: "value" } }]) {
      const { selects, relations } = getSelectsAndRelationsFromObjectArray([update]);
      expect(nativePreimageSelection({ select: selects, relations }, read)).toEqual({ select: ["id"], relations: [] });
    }
    expect(nativePreimageSelection({ select: ["title"], relations: ["products"] }, read))
      .toEqual({ select: ["id", "title", "products.id"], relations: ["products"] });
    const implicit = { relations: ["products"] };
    expect(nativePreimageSelection(implicit, read)).toBe(implicit);
  });
});

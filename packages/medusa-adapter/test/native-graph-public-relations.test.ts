import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { decodeGraphCount } from "../src/local-graph/query";
import { graphNativeConfiguration, withNativeGraphMetadata } from "../src/local-graph/native-metadata";
import type { GraphModuleDefinition } from "../src/local-graph/model";
import type { ReadTable } from "../src/query/catalog";

const table = (name: string): ReadTable => ({ name, columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} });
const roots = table("root"), wrappers = table("wrapper"), lines = table("line");
const read = defineGraphReadCommand("publicRelationMetadata", () => Effect.die("Metadata proof must not execute"));
const relation = (name: string, targetTable: string, targetModel: string) => ({ name, targetTable, targetModel,
  type: "hasMany" as const, nullable: false, cascadeDelete: false, cascadeDetach: false });
const tables = [{ name: "root", relationships: [relation("items", "wrapper", "Wrapper")] },
  { name: "wrapper", relationships: [relation("item", "line", "Line")] },
  { name: "line", relationships: [relation("detail", "wrapper", "Wrapper")] }];
const base: GraphModuleDefinition = { aliases: [{ name: "root", model: "Root" }], reads: [
  { model: "Root", command: read, table: roots, paths: [
    { path: "items", table: lines, many: true }, { path: "items.detail", table: wrappers, many: false },
  ], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount },
] };

it("uses the admitted native public projection when a service flattens storage wrappers", () => {
  const graph = Result.getOrThrow(withNativeGraphMetadata(base, [], tables));
  const native = Result.getOrThrow(graphNativeConfiguration(graph.native));
  expect(native.entityRelations.get("Root")?.get("items")).toBe("Line");
  expect(native.entityRelations.get("Line")?.get("detail")).toBe("Wrapper");
});

it("refuses conflicting public relation targets across service reads", () => {
  const rootRead = base.reads[0];
  if (rootRead === undefined) throw new Error("Missing metadata fixture");
  const conflict = { ...base, reads: [...base.reads, { ...rootRead, paths: [{ path: "items", table: wrappers, many: true }] }] };
  expect(Result.isFailure(withNativeGraphMetadata(conflict, [], tables))).toBe(true);
});

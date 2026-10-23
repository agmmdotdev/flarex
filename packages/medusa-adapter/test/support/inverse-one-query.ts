import { Result } from "effect";
import { makeReadCatalog } from "../../src/query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../src/query/projection";
import type { CommerceRelation, CommerceRelations } from "../../src/query/relations";

export const inverseRelations: CommerceRelations = new Map<string, Map<string, CommerceRelation>>([
  ["neutral_parent", new Map([["child", { name: "child", sourcePrimaryKeys: ["id"], targetTable: "neutral_child", targetPrimaryKeys: ["id"], join: { type: "hasOne", foreignKeys: ["parent_id"] } }]])],
  ["neutral_child", new Map([["notes", { name: "notes", sourcePrimaryKeys: ["id"], targetTable: "neutral_note", targetPrimaryKeys: ["id"], join: { type: "hasMany", foreignKeys: ["child_id"] } }]])],
]);
export const inversePaths = ["child", "child.notes"];
export function inverseCatalog() {
  return makeReadCatalog([
    { name: "neutral_parent", columns: ["id", "deleted_at"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
    { name: "neutral_child", columns: ["id", "parent_id", "deleted_at"], primaryKeys: ["id"], foreignKeys: ["parent_id"], companions: {} },
    { name: "neutral_note", columns: ["id", "child_id", "deleted_at"], primaryKeys: ["id"], foreignKeys: ["child_id"], companions: {} },
  ], inverseRelations);
}
const scalar: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
export function inverseProjection() {
  return compileProjection(Result.getOrThrow(inverseCatalog()), "neutral_parent", ["id", "child.id", "child.notes.id"], inversePaths,
    { ...scalar, selectableRelations: ["child"], nested: new Map([["child", { ...scalar, selectableRelations: ["notes"], nested: new Map([["notes", scalar]]) }]]) });
}

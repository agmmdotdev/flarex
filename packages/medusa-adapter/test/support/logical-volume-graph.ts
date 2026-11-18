import { Effect, Result, Schema } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { lowerDmlSchema } from "../../src/schema/lower";
import type { SchemaTable } from "../../src/schema/model";
import type { CommerceRelation } from "../../src/query/relations";
import { commerceDecoder } from "../../src/value/decoder";
import type { GraphCatalog, GraphEntity, ReplacementProfile } from "../../src/write/graph-model";

/** Canonical neutral Volume/Edition metadata shared by real graph owner proofs. */
const table = (name: string, key: string, fields: readonly string[], foreignKeys: SchemaTable["foreignKeys"] = []): SchemaTable => ({
  name, columns: [...[key, ...fields].map(name => ({ name, type: "text" as const, primaryKey: name === key, nullable: false, generated: false })),
    ...["created_at", "updated_at", "deleted_at"].map(name => ({ name, type: "dateTime" as const, primaryKey: false, nullable: name === "deleted_at", generated: false }))],
  indexes: fields.includes("volume_isbn") ? [{ name: "editions.owner", columns: ["volume_isbn"], unique: false }] : [], foreignKeys,
});
export const volumes = table("volumes", "isbn", ["title"]), editions = table("editions", "serial", ["volume_isbn", "label"], [
  { name: "editions.volume", columns: ["volume_isbn"], referencedTable: "volumes", referencedColumns: ["isbn"] },
]);
export const volume: GraphEntity = { table: volumes, model: "Volume", keyColumn: "isbn", prefix: undefined };
const edition: GraphEntity = { table: editions, model: "Edition", keyColumn: "serial", prefix: undefined };
const decodeObject = commerceDecoder(Schema.JsonObject, "invalidInput");
export const decodeKey = commerceDecoder(Schema.String, "invalidInput");
const catalog: GraphCatalog = { entities: [volume, edition], tables: [volumes, editions], writablePivots: [],
  queryRelations: new Map([["volumes", new Map<string, CommerceRelation>([["editions", { name: "editions", sourcePrimaryKeys: ["isbn"],
    targetTable: "editions", targetPrimaryKeys: ["serial"], join: { type: "hasMany", foreignKeys: ["volume_isbn"] } }]])]]),
  decodeRow: (entity, input) => Result.gen(function* () {
    const supplied = yield* decodeObject(input); return { supplied, key: yield* decodeKey(supplied[entity.keyColumn]) };
  }), decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")) };
export const profile: ReplacementProfile = { catalog, operation: "update", repeatedOwnedReferences: "coalesceIdentical", replacementMembers: "active",
  ordering: new Map(), allowedRelations: entity => entity === volume ? ["editions"] : [], ownedToOne: () => [], mutableForeignKeys: () => false,
  admitSelection: () => Result.succeed(undefined), prepareProjection: () => Effect.void, toManyMode: () => Result.succeed("replace"),
  validateLink: () => Effect.fail(commerceError("unsupportedProfile")), projectionPaths: () => ["editions"],
  project: rows => Result.succeed(new Map([...rows].map(([name, members]) => [name, members.filter(row => row.deleted_at === null)]))) };
export const sourceKey = "medusa.neutral-owned-reference-repetition", evidence = { kind: "synthetic", sourceId: "neutral.owned-reference-repetition" };
export const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema([volumes, editions], "neutral-owned-reference-repetition")));

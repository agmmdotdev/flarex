import type { CollectionConfig } from "payload";
import { Result } from "effect";
import { compileDefinition, type Field } from "./definition.ts";
import { CoreError } from "./errors.ts";

/** Framework configuration admission/translation belongs to this bridge. */
export function compilePayloadDefinition(collection: CollectionConfig) {
  const fields: Field[] = [];
  if (collection.auth || collection.versions || collection.upload || collection.timestamps === false ||
    collection.lockDocuments !== false || collection.enableQueryPresets !== false) {
    return Result.fail(new CoreError({ reason: "unsupported" }));
  }
  for (const field of collection.fields) {
    if (!("name" in field) || (field.type !== "text" && field.type !== "number") || !field.required ||
      field.localized || field.hasMany) return Result.fail(new CoreError({ reason: "unsupported" }));
    fields.push({ name: field.name, kind: field.type, unique: field.unique === true });
  }
  // This native error projection identifies one field. Multi-unique profiles
  // need constraint-to-field evidence before they can be admitted.
  if (fields.filter(field => field.unique).length > 1) return Result.fail(new CoreError({ reason: "unsupported" }));
  return compileDefinition({ table: collection.slug, fields });
}

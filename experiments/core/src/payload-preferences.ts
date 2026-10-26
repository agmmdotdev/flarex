import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import type { SanitizedCollectionConfig } from "payload";
import { compileDefinition } from "./definition.ts";
import { CoreError } from "./errors.ts";

const PreferenceUser = Schema.Struct({ relationTo: Schema.Literal("users"), value: Schema.String });

/** Compile only the actual generated native preference collection used by this
 * non-auth workload. Its administrative fixture writer is not a user API or a
 * general polymorphic-reference/FK implementation. */
export function compilePayloadPreferences(config: SanitizedCollectionConfig) {
  const user = config.fields.find(field => "name" in field && field.name === "user");
  const key = config.fields.find(field => "name" in field && field.name === "key");
  const value = config.fields.find(field => "name" in field && field.name === "value");
  if (config.slug !== "payload-preferences" || config.auth || config.versions || config.upload || config.timestamps === false ||
    user?.type !== "relationship" || !user.required || !Array.isArray(user.relationTo) || user.relationTo.length !== 1 || user.relationTo[0] !== "users" ||
    key?.type !== "text" || key.required || key.index !== true || value?.type !== "json" || value.required) {
    return Result.fail(new CoreError({ reason: "unsupported" }));
  }
  return Result.gen(function* () {
    const base = yield* compileDefinition({ table: config.slug, fields: [
      { name: "user", kind: "json", unique: false }, { name: "key", kind: "text", nullable: true, unique: false },
      { name: "value", kind: "json", unique: false },
    ], equalities: [{ name: "by_key", field: "key" }] });
    return Object.freeze({ ...base,
      version: createHash("sha256").update(JSON.stringify({ profile: "payload-preferences-users-text-id", definition: base.version })).digest("hex"),
      decode: (input: unknown) => base.decode(input).pipe(Effect.tap(body => Schema.decodeUnknownEffect(PreferenceUser)(body.user, { onExcessProperty: "error" }).pipe(
        Effect.mapError(cause => new CoreError({ reason: "invalid", cause }))))),
    });
  });
}

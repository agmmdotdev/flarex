import { Schema } from "effect";

const leaseSchema = Schema.Struct({
  schemaName: Schema.String, migrationsSchema: Schema.String, leaseId: Schema.String,
  fresh: Schema.Boolean, seal: Schema.NullOr(Schema.String),
});
export const decodeStorageRequest = Schema.decodeUnknownSync(Schema.Union([
  Schema.Struct({ operation: Schema.Literal("acquire"), key: Schema.String }),
  Schema.Struct({ operation: Schema.Literal("release"), leaseId: Schema.String,
    healthy: Schema.Boolean, seal: Schema.NullOr(Schema.String) }),
]));
export const storageResponseSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), lease: Schema.optional(leaseSchema) }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
]);
export interface PostgresStorageSessionEndpoint {
  readonly url: string;
  readonly token: string;
  readonly connectionKey: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    postgresStorageSession?: PostgresStorageSessionEndpoint;
  }
}

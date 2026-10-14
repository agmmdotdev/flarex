import { Data, Effect } from "effect";
import { SalesChannel } from "@medusajs/sales-channel/models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";

export class SalesChannelSchemaError extends Data.TaggedError("SalesChannelSchemaError")<{
  readonly cause: unknown;
}> {}

/** One admitted native model; no link metadata or arbitrary model admission. */
export const captureSalesChannelMetadata = Effect.fn("SalesChannel.captureMetadata")(function* () {
  const source = yield* Effect.try({
    try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema([SalesChannel]))),
    catch: cause => new SalesChannelSchemaError({ cause }),
  });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => new SalesChannelSchemaError({ cause })));
  const table = compiled.tables[0];
  if (compiled.tables.length !== 1 || table?.name !== "sales_channel" || table.relationships.length !== 0 || table.foreignKeys.length !== 0
    || table.cascades.delete.length !== 0 || table.cascades.detach.length !== 0) {
    return yield* Effect.fail(new SalesChannelSchemaError({ cause: "Unsupported Sales Channel model set" }));
  }
  const metadata = yield* capturePrivateCanonicalValue(compiled, 1_048_576, {
    invalidInput: () => new SalesChannelSchemaError({ cause: "Invalid Sales Channel metadata" }),
    hashFailure: cause => new SalesChannelSchemaError({ cause }),
  });
  return metadata;
});

export const salesChannelSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/sales-channel/src/models/sales-channel.ts",
    "packages/modules/sales-channel/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts"]),
} as const);

/** The pinned single-model source, independent of deployment physical naming. */
export const compileSalesChannelDefinition = Effect.fn("SalesChannel.compileDefinition")(function* () {
  const metadata = yield* captureSalesChannelMetadata();
  const lowered = lowerDmlSchema(metadata.frame.tables, "commerce.sales-channel");
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ ...lowered, tables: lowered.tables.map(table => ({
    ...table, indexes: [...table.indexes, { indexId: "sales_channel.name-equality", kind: "textEquality" as const,
      columns: ["name"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "sales_channel.name-equality" } },
      { indexId: "sales_channel.disabled-equality", kind: "btree" as const,
        columns: ["is_disabled"], predicate: null,
        origin: { kind: "derived" as const, sourceId: "sales_channel.disabled-equality" } }],
  })) }));
  return Object.freeze({ schema, provenance: salesChannelSourceProvenance });
});

import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { prepareApplicationSchemaSource, type PreparedApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { defineSchema, defineTable } from "../../../../flarex/src/server";
import { v } from "../../../../flarex/src/values";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { createCoreCurrencyFixture, type CoreCurrencyFixtureOptions } from "../../../../medusa-adapter/test/support/core-currency-fixture";
import { getCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { coreNativeTestBudget } from "../../core/nativeTestBudget";

export const jointRelationCollections = [
  { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
  { slug: "articles", fields: [{ name: "headline", type: "text", required: true, unique: true },
    { name: "author", type: "relationship", relationTo: "authors" }] },
];

/** Genuine audit-only App + complete Currency + compiler-owned Payload sources. */
export async function jointApplicationRelationsFixture(driver: "pglite" | "postgres", options: Pick<CoreCurrencyFixtureOptions, "wrapRuntimeDriver" | "observeWrite"> = {}) {
  const compiled = await Effect.runPromise(compilePayloadCollections(jointRelationCollections));
  const application: PreparedApplicationSchemaSource = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({
    audit: defineTable({ name: v.string() }).index("by_name", ["name"]),
  })));
  expect(application.source.definition).toMatchObject({ kind: "documents", tables: [{ logicalName: "audit" }], relations: [] });
  const native = await createCoreCurrencyFixture(driver, { ...options, compiledPayload: compiled, application,
    applicationTable: "audit", allowPreferenceTransition: true });
  const incoming = (target: string, limit = 16) => Effect.gen(function* () {
    const command = getCmsCommand(inspectPayloadRuntimeForTest(native.payload.runtime).commands.findByID);
    if (command === undefined) return yield* Effect.die(new Error("Missing genuine native read command"));
    return yield* Effect.acquireUseRelease(native.database.beginNative(native.payloadBinding,
      { commandName: command.name, ...coreNativeTestBudget() }), operation => Effect.gen(function* () {
      const page = yield* operation.operations.incomingReferences("author", target, { limit });
      return { ...page, token: yield* operation.finishRead() };
    }), operation => operation.abort());
  });
  return { native, compiled, application, incoming };
}

export const decodeJointAuthor = Schema.decodeUnknownSync(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]));
export const decodeJointResult = Schema.decodeUnknownSync(Schema.Struct({
  currency: Schema.StructWithRest(Schema.Struct({ code: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
  cms: Schema.StructWithRest(Schema.Struct({ id: Schema.String, headline: Schema.String, author: Schema.NullOr(Schema.String) }),
    [Schema.Record(Schema.String, Schema.Json)]), applicationId: Schema.String,
}));

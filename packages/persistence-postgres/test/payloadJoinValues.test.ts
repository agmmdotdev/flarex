import { cmsRelationReadFailure } from "../src/cmsTransaction/relations";
import { ApplicationActivationError } from "../src/applicationActivation";
import { TrustedScopeAuthorityResolutionError, TrustedScopeAuthorityPortError } from "../src/scopeAuthorityResolution";
import { expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { PayloadConfigurationSchema } from "@flarex/analysis/internal/application-write-policy";
import { payloadJoinQuery, makePayloadPopulation } from "../../payload-adapter/src/testing";
import { payloadJoinConfiguration, payloadManyConfiguration, payloadScalarConfiguration, payloadRelationConfiguration } from "../../payload-adapter/src/conformanceProfile";
import { makePayloadConformanceRuntime } from "../../payload-adapter/src/testing";
import { isOptionalPostRelationSuccessor } from "../src/applicationWriteOwnership/Successor";
import { payloadScalarFields } from "../../payload-adapter/src/conformanceProfile";
import { payloadRelationManifest } from "./payloadRelationFixture";
import { policyManifestFixture } from "./applicationWritePolicyFixture";
import { runEffect } from "./effectTestRuntime";
import { makePayloadCollectionRuntime } from "../../payload-adapter/src/collectionRuntime";
import { payloadRelatedPostField } from "../../payload-adapter/src/contract";

const posts = makePayloadCollectionRuntime(payloadJoinConfiguration.tables[0]!);

it("keeps virtual metadata exact and old profiles unchanged", async () => {
  const decode = Schema.decodeUnknownResult(PayloadConfigurationSchema);
  for (const configuration of [payloadScalarConfiguration, payloadRelationConfiguration, payloadManyConfiguration, payloadJoinConfiguration]) {
    expect(Result.getOrThrow(decode(configuration))).toEqual(configuration);
  }
  expect(decode({ ...payloadManyConfiguration, joins: [] })).toMatchObject({ _tag: "Failure" });
  expect(decode({ ...payloadJoinConfiguration, joins: [] })).toMatchObject({ _tag: "Failure" });
  for (const configuration of [payloadManyConfiguration, payloadJoinConfiguration]) {
    expect(decode({ ...configuration, tables: configuration.tables.map(table => ({ ...table,
      fields: table.fields.map(field => field.name === "relatedPosts" ? { ...payloadRelatedPostField, name: "relatedPosts" } : field),
    })) })).toMatchObject({ _tag: "Failure" });
  }
  const scalar = (await policyManifestFixture(undefined, true, payloadScalarFields)).manifest;
  const joined = (await payloadRelationManifest(scalar, true, true)).manifest;
  for (const prior of [scalar, (await payloadRelationManifest(scalar)).manifest, (await payloadRelationManifest(scalar, true)).manifest]) {
    expect(isOptionalPostRelationSuccessor(prior, joined)).toBe(false);
  }
  expect(joined.schema.relations).toHaveLength(2);
  const posts = joined.schema.tables.find(table => table.name === "posts");
  if (posts?.validator.type !== "object") throw new Error("Missing posts");
  expect(Object.keys(posts.validator.value)).not.toContain("referencedBy");
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const conformance = yield* makePayloadConformanceRuntime("payload.content-joins");
    const config = conformance.payload.collections.posts?.config;
    expect(config?.joins.posts?.map(join => [join.field.name, join.field.on])).toEqual([
      ["referencedBy", "relatedPost"], ["referencedByMany", "relatedPosts"],
    ]);
    expect(config?.flattenedFields.filter(field => field.type === "join").map(field => [field.name, field.defaultSort, field.orderable, field.maxDepth]))
      .toEqual([["referencedBy", undefined, false, 1], ["referencedByMany", undefined, false, 1]]);
    expect(config?.flattenedFields.some(field => field.name.endsWith("_order"))).toBe(false);
  })));
});

it("refuses caller query expansion and only admits the sanitizer's empty predicate", () => {
  expect(Result.getOrThrow(payloadJoinQuery(undefined))).toEqual({ referencedBy: { limit: 8 }, referencedByMany: { limit: 8 } });
  expect(Result.getOrThrow(payloadJoinQuery(false))).toEqual({ referencedBy: false, referencedByMany: false });
  expect(Result.getOrThrow(payloadJoinQuery({ referencedBy: { limit: 16, page: 1, count: false, where: {} } }, true)).referencedBy).toEqual({ limit: 16 });
  for (const options of [{ count: true }, { limit: null }, { limit: 0 }, { limit: 17 }, { limit: 1.5 }, { page: 2 }, { where: {} }, { sort: "id" }, { cursor: "x" }]) {
    expect(payloadJoinQuery({ referencedBy: options })).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
  expect(payloadJoinQuery({ referencedBy: { where: { title: { equals: "secret" } } } }, true)).toMatchObject({ _tag: "Failure" });
});

it("charges combined forward and reverse references and repeated document copies", () => {
  const ids = Array.from({ length: 33 }, (_, index) => `id-${index}`);
  const ledger = makePayloadPopulation("payload.content-joins", posts);
  expect(ledger.roots([{ id: "root", relatedPosts: ids.slice(0, 32), referencedBy: { docs: [ids[32] ?? ""], hasNextPage: false } }]))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  const output = makePayloadPopulation("payload.content-joins", posts);
  Result.getOrThrow(output.roots(Array.from({ length: 32 }, () => ({ id: "root", relatedPosts: ids.slice(0, 32),
    referencedBy: { docs: ids.slice(0, 16), hasNextPage: true }, referencedByMany: { docs: ids.slice(16, 32), hasNextPage: false } }))));
  expect(output.outputBytes("posts", ids.slice(0, 32), ids.slice(0, 32).map(id => ({ id, title: "x".repeat(1800) }))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("preserves native storage and corruption failure categories", () => {
  const authority = new TrustedScopeAuthorityResolutionError({ reason: "scopeMetadataMissing", deploymentId: "missing" });
  for (const mismatch of ["invalidAuthority", "bindingChanged"] as const) {
    expect(cmsRelationReadFailure(authority, mismatch)).toMatchObject({ reason: mismatch, cause: authority });
  }
  const storage = new TrustedScopeAuthorityPortError({ operation: "scopeMetadataRead", cause: "unavailable" });
  expect(cmsRelationReadFailure(storage, "invalidAuthority")).toMatchObject({ reason: "resourceFailure", cause: storage });
  for (const [native, cms] of [["storedState", "storedCorruption"], ["resourceFailure", "resourceFailure"], ["expectedHead", "bindingChanged"]] as const) {
    const cause = new ApplicationActivationError({ operation: "validateSelection", reason: native, retryable: false });
    expect(cmsRelationReadFailure(cause, "bindingChanged")).toMatchObject({ reason: cms, cause });
  }
});

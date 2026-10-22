import { eq } from "drizzle-orm";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxSystemCommitAppRowChanges, fxSystemCommitRelationAdjacencyChanges,
  fxSystemCommits, fxSystemIdempotency } from "../../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../../persistence-postgres/src/commit/events/schema";
import { Cause, Effect, Schema } from "effect";
import { expect } from "vitest";
import type { LogicalSchemaExtension } from "flarex-protocol/internal/logical-schema-candidate";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError } from "../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { isJsonObject } from "flarex-protocol/json";
import { createHash } from "node:crypto";
import type { FlarexMetadataDatabase } from "../../../persistence-postgres/src/application/deployments";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { createMixedMutationProductFixture } from "./mixedMutationWorkerdFixture";

export type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
export const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
export const collections = [{ slug: "articles", fields: [
  { name: "headline", type: "text", required: true },
  { name: "featuredProduct", type: "text" },
] }];
export const extensions: readonly LogicalSchemaExtension[] = [{ name: "article_product", sourceKey: "payload",
  source: { table: { namespace: "app", logicalName: "articles" }, field: "featuredProduct" },
  target: { table: { namespace: "medusa", logicalName: "commerce.product/product" }, field: "id" },
  policy: "strongReference", liveness: { source: { kind: "current" },
    target: { kind: "softDeleteNull", field: "deleted_at" } },
  onTargetSoftDelete: "retain", onTargetDelete: "restrict" }];
const decodeSuccess = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }));
export const decodeArticle = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
export const decodeMixed = Schema.decodeUnknownSync(Schema.Struct({ article: Schema.Struct({ id: Schema.String }), id: Schema.String }));
export async function successfulValue(input: unknown) {
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(decodeSuccess(input).result.result))).value;
}
export async function expectCmsFailure(work: Promise<unknown>, reason: string) {
  const result = (await Promise.allSettled([work]))[0];
  if (result?.status !== "rejected" || !Cause.isCause(result.reason)) throw new Error("Expected native CMS failure Cause");
  const failure = result.reason.reasons[0];
  if (failure === undefined || !Cause.isFailReason(failure)) throw new Error("Expected typed native CMS failure");
  expect(failure.error).toMatchObject({ reason });
}
export function referenceSource(participant: string | undefined, target: string, productUpdate?: Fixture["seed"]["updateInput"]) {
  if (participant === undefined) throw new Error("Missing Payload participant");
  return `export default { users: { create: { isMutation: true, isPublic: true, _handler: async ctx => {
    const article = await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
      { collection: "articles", data: { headline: "Selected product", featuredProduct: ${JSON.stringify(target)} } });
    ${productUpdate === undefined ? "return article;" : `await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(productUpdate)});
      const product = await ctx.privateMixed.call("medusa.product", "retrieve", { id: ${JSON.stringify(target)} });
      const id = await ctx.db.insert("users", { name: product.title });
      return { article, id };`}
  } } } };`;
}
export async function commerceHost(fixture: Fixture) {
  const commands = fixture.product.runtime.commands;
  return Effect.runPromise(makeCommerceHost({ ...fixture.product.hostInput,
    commands: [commands.internalProductSoftDelete, commands.internalProductRestore] }));
}
// Native hard deletion emits a module event. Compose its real call validator
// and event contract, rather than using the eventless internal-service host.
export function prepareProductDeletion(fixture: Fixture) {
  return prepareProductTransition(fixture, "delete");
}
export async function prepareProductTransition(fixture: Fixture, operation: "delete" | "softDelete",
  options: Readonly<{ session?: Parameters<Parameters<Fixture["withStandaloneProductSession"]>[0]>[0];
    beforeCall?: Effect.Effect<void> }> = {}) {
  const catalog = fixture.product.runtime.metadata;
  const policy = fixture.product.runtime.logicalPolicy;
  const revision = createHash("sha256").update("private-reference-product-delete").digest("hex");
  const entities = operation === "delete" ? [catalog.product] :
    [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const selections = entities.map(entity => ({ name: entity.deletedEvent,
    contract: defineCommerceEventContract({ name: entity.deletedEvent,
      revision, internal: true, decode: policy.capture }) }));
  const contracts = selections.map(selection => selection.contract);
  const participant = defineAtomicCommerceParticipant("product");
  const command = fixture.product.runtime.commands[operation];
  const root = defineAtomicCommerceCommand("privateReferenceProductDelete", (ctx, args) => (options.beforeCall ?? Effect.void).pipe(Effect.andThen(ctx.call(participant, command, args))));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.currency.hostInput,
    ...(options.session === undefined ? {} : { session: options.session }),
    ...(options.beforeCall === undefined ? {} : { executionIsolation: "scopeExclusive" }),
    identityAndAccessPolicy: { profile: "private-reference-product-delete" },
    participants: [{ participant, logicalStorage: fixture.product.hostInput.logicalStorage,
      commands: [command], validateLogicalCall: policy.validateLogicalCall,
      events: { contracts, select: event => {
        const contract = isJsonObject(event) ? selections.find(candidate => candidate.name === event.name)?.contract : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
      } } }],
    commands: [root], events: { producerRevision: revision, contracts,
      subscribers: [{ id: "private-reference-product-delete", revision }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return host.run(host.newRequestKey(), root, fixture.seed.productId).pipe(Effect.ensuring(host.close));
}

export async function publishedCounts(fixture: Fixture) {
  return publishedScopeCounts(fixture.currency.persistence.drizzle, fixture.activation.anchor.scopeId);
}
export async function publishedScopeCounts(db: FlarexMetadataDatabase, scopeId: ScopeId) {
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  return {
    rows: (await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid))).length,
    revisions: (await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))).length,
    indexes: (await db.select().from(fxAppIndexEntryCurrent).where(eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid))).length,
    indexRevisions: (await db.select().from(fxAppIndexEntryRevisions).where(eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid))).length,
    rowFacts: (await db.select().from(fxSystemCommitAppRowChanges).where(eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid))).length,
    adjacencyFacts: (await db.select().from(fxSystemCommitRelationAdjacencyChanges).where(eq(fxSystemCommitRelationAdjacencyChanges.scopeUuid, scopeUuid))).length,
    commits: (await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid))).length,
    outcomes: (await db.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid))).length,
    events: (await db.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid))).length,
  };
}

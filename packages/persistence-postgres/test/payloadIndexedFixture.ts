import { Effect, Schema } from "effect";
import { eq } from "drizzle-orm";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { compilePayloadCollections, type CompiledPayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import { defineCmsCommand, makeCmsHost } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import type { CmsDocumentReadTestHooks } from "../src/cmsTransaction/documents";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppUniqueKeys, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxSystemCommits, fxSystemIdempotency, fxSystemCommitAppRowChanges, fxSystemCommitWakes } from "../src/schema";
import { cmsHostFixture } from "./cmsHostFixture";
import { preparedHostTestRuntime } from "./preparedHostRuntimeTestSupport";

const decodeBatch = Schema.decodeUnknownEffect(Schema.Number);
export const indexedFields = (title: string, category: string, amount: number) => ({ title, category, amount,
  createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" });
export const decodeIndexedPage = Schema.decodeUnknownSync(Schema.Struct({ totalDocs: Schema.Number,
  docs: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, amount: Schema.Number })) }));
export const decodeIndexedDocument = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String, amount: Schema.Number }));

export const makeIndexedPayloadFixture = Effect.fn("IndexedPayload.fixture")(function* (
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession,
  configuration?: CompiledPayloadCollections,
) {
  const compiled = configuration ?? (yield* compilePayloadCollections([{ slug: "items", fields: [
    { name: "title", type: "text", required: true, unique: true },
    { name: "category", type: "text", required: true },
    { name: "amount", type: "number", required: true, index: true },
  ], indexes: [{ fields: ["category", "amount"] }] }]));
  const { fixture } = yield* Effect.promise(() => cmsHostFixture(persistence, {}, compiled));
  const runtime = yield* makePayloadRuntime(compiled);
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(fixture.authority.scopeId));
  let scans = 0;
  const plans: Parameters<NonNullable<CmsDocumentReadTestHooks["observeIndexQuery"]>>[0][] = [];
  const hooks = { documentReads: {
    beforeRead: (selection: string) => Effect.sync(() => { if (selection === "scan") scans++; }),
    observeIndexQuery: (query: Parameters<NonNullable<CmsDocumentReadTestHooks["observeIndexQuery"]>>[0]) => { plans.push(query); },
  } };
  const seed = defineCmsCommand({ name: "seedIndexedRows", mode: "write", run: Effect.fn(function* (ctx, args) {
    const batch = yield* decodeBatch(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    for (let position = 0; position < 16; position++) {
      const value = batch * 16 + position;
      yield* ctx.documents.insert(ctx.context, ctx.transactionId, "items", indexedFields(`seed-${value}`, "unrelated", 1000 + value));
    }
    return null;
  }) });
  const input = { hostRuntime: preparedHostTestRuntime(persistence.drizzle), database: persistence.drizzle, controlDatabase: fixture.control.drizzle,
    session, deploymentId: fixture.deploymentId, authority: fixture.authorityPorts, pointCommitAuthority: fixture.pointCommitAuthority,
    application: fixture.relationActivation, identityAndAccessPolicy: { subject: "indexed-payload" }, commands: [...Object.values(runtime.commands), seed],
    materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
      developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle), uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
      candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation, pointCommitAuthority: fixture.pointCommitAuthority }) } };
  const host = yield* Effect.acquireRelease(makeCmsHost(input, hooks), value => value.close);
  const db = persistence.drizzle;
  const inventory = async () => ({
    rows: await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid)).orderBy(fxAppRowCurrent.rowId),
    revisions: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scope.scopeUuid)).orderBy(fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    indexes: await db.select().from(fxAppIndexEntryCurrent).where(eq(fxAppIndexEntryCurrent.scopeUuid, scope.scopeUuid)).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.encodedKey, fxAppIndexEntryCurrent.rowId),
    indexHistory: await db.select().from(fxAppIndexEntryRevisions).where(eq(fxAppIndexEntryRevisions.scopeUuid, scope.scopeUuid)).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.encodedKey, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
    claims: await db.select().from(fxAppUniqueKeys).where(eq(fxAppUniqueKeys.scopeUuid, scope.scopeUuid)).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.rowId),
    commits: await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scope.scopeUuid)).orderBy(fxSystemCommits.commitSeq),
    outcomes: await db.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scope.scopeUuid)).orderBy(fxSystemIdempotency.commitSeq),
    facts: await db.select().from(fxSystemCommitAppRowChanges).where(eq(fxSystemCommitAppRowChanges.scopeUuid, scope.scopeUuid)).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.rowId),
    wakes: await db.select().from(fxSystemCommitWakes).where(eq(fxSystemCommitWakes.scopeUuid, scope.scopeUuid)).orderBy(fxSystemCommitWakes.commitSeq),
  });
  return { runtime, input, host, seed, hooks, inventory, plans, fixture, scans: () => scans };
});
export type IndexedPayloadFixture = Effect.Success<ReturnType<typeof makeIndexedPayloadFixture>>;

import { eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { MetadataSequence } from "flarex-protocol/commit-protocol";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { FiniteMetadataError, type FiniteMetadataComparisonExpected } from "./finiteMetadataDependencies";
import { fxSystemApplicationActiveHeads } from "./applicationActivationSchema";
import { fxSystemApplicationWriteOwnership } from "./applicationWriteOwnership/Schema";
import { fxSystemScopeClocks } from "./schema";
import { fxSystemCommits, fxSystemIdempotency, fxSystemTransactionSessions } from "./schema";
import type { AppRowTransaction } from "./appRows";
import type { PgColumn } from "drizzle-orm/pg-core";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";

const outcomeField = <Column extends PgColumn>(column: Column) =>
  sql`(publication.outcome).${sql.identifier(column.name)}`.mapWith(column);
const headerField = <Column extends PgColumn>(column: Column) =>
  sql`(publication.retained_header).${sql.identifier(column.name)}`.mapWith(column);

/** Scalar selection uses the real Drizzle column decoders; composite text is
 * never interpreted by a handwritten driver parser. Outcome evidence stays
 * with the existing request/scalar/header policy owner. */
export function finitePublicationAnchorQuery(tx: AppRowTransaction, schemaName: string,
  input: Readonly<{ scopeUuid: string; sessionId: string; requestKey: string; expectedSession: string;
    expectedIdentityAccessPolicySha256: Uint8Array; expectedFunctionPath: string; expectedRequestSha256: Uint8Array }>) {
  const identity = outcomeField(fxSystemIdempotency.identityAccessPolicySha256);
  const path = outcomeField(fxSystemIdempotency.functionPath);
  const request = outcomeField(fxSystemIdempotency.requestSha256);
  const result = outcomeField(fxSystemIdempotency.resultBytes);
  const resultSha = outcomeField(fxSystemIdempotency.resultSha256);
  return tx.select({ reason: sql<string>`publication.reason`,
    databaseNow: sql`publication.database_now`.mapWith(fxSystemTransactionSessions.createdAt),
    mutable: {
      lifecycle: sql`publication.${sql.identifier(fxSystemTransactionSessions.lifecycle.name)}`.mapWith(fxSystemTransactionSessions.lifecycle),
      updatedAt: sql`publication.${sql.identifier(fxSystemTransactionSessions.updatedAt.name)}`.mapWith(fxSystemTransactionSessions.updatedAt),
      finiteLeaseExpiresAt: sql`publication.${sql.identifier(fxSystemTransactionSessions.finiteLeaseExpiresAt.name)}`.mapWith(fxSystemTransactionSessions.finiteLeaseExpiresAt),
      finiteClaimOwner: sql`publication.${sql.identifier(fxSystemTransactionSessions.finiteClaimOwner.name)}`.mapWith(fxSystemTransactionSessions.finiteClaimOwner),
      finiteClaimFence: sql`publication.${sql.identifier(fxSystemTransactionSessions.finiteClaimFence.name)}`.mapWith(fxSystemTransactionSessions.finiteClaimFence),
      finiteClaimedAt: sql`publication.${sql.identifier(fxSystemTransactionSessions.finiteClaimedAt.name)}`.mapWith(fxSystemTransactionSessions.finiteClaimedAt),
      finiteClaimExpiresAt: sql`publication.${sql.identifier(fxSystemTransactionSessions.finiteClaimExpiresAt.name)}`.mapWith(fxSystemTransactionSessions.finiteClaimExpiresAt),
    },
    outcome: {
      outcomeScopeUuid: outcomeField(fxSystemIdempotency.scopeUuid),
      outcomeRequestKey: outcomeField(fxSystemIdempotency.requestKey),
      identityHashByteLength: sql<number>`octet_length(${identity})`,
      identityMatches: sql<boolean>`${identity} = ${input.expectedIdentityAccessPolicySha256}`,
      functionPathValid: sql<boolean>`btrim(${path},
        U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff') <> ''`,
      functionPathMatches: sql<boolean>`${path} = ${input.expectedFunctionPath}`,
      requestHashByteLength: sql<number>`octet_length(${request})`,
      requestMatches: sql<boolean>`${request} = ${input.expectedRequestSha256}`,
      epochUuid: outcomeField(fxSystemIdempotency.epochUuid), commitSeq: outcomeField(fxSystemIdempotency.commitSeq),
      resultState: outcomeField(fxSystemIdempotency.resultState), resultEncoding: outcomeField(fxSystemIdempotency.resultEncoding),
      resultValueCodecVersion: outcomeField(fxSystemIdempotency.resultValueCodecVersion),
      resultSemanticBytes: outcomeField(fxSystemIdempotency.resultSemanticBytes),
      resultByteLength: sql<number | null>`octet_length(${result})`,
      resultSha256ByteLength: sql<number | null>`octet_length(${resultSha})`,
      resultExpiredAt: outcomeField(fxSystemIdempotency.resultExpiredAt), createdAt: outcomeField(fxSystemIdempotency.createdAt),
      retainedHeaderScopeUuid: headerField(fxSystemCommits.scopeUuid),
      retainedHeaderEpochUuid: headerField(fxSystemCommits.epochUuid),
      retainedHeaderCommitSeq: headerField(fxSystemCommits.commitSeq),
    },
  }).from(sql`${sql.identifier(schemaName)}.fx_observe_finite_publication(
    ${input.scopeUuid}::uuid, ${input.sessionId}::uuid, ${input.requestKey}::text,
    ${input.expectedSession}::jsonb) as publication`);
}

const decodeObservation = Schema.decodeUnknownEffect(Schema.Struct({
  consumed: Schema.Unknown,
  application: Schema.Unknown,
  ownership: Schema.Unknown,
  sources: Schema.Unknown,
}).annotate({ parseOptions: { onExcessProperty: "error" } }));

/** One actual bounded observation, with fixed named domain contributions.
 * Expectation construction and policy acceptance remain with their issuers.
 * In particular, returning source-two data does not run its decoder before
 * source-one closure, document and definition validation have completed. */
export const observeFinitePublicationMetadata = Effect.fn("FinitePublication.observeMetadata")(function* (
  tx: FlarexMetadataTransaction,
  schemaName: string,
  scopeId: ScopeId,
  capturedWatermark: MetadataSequence,
  consumed: readonly FiniteMetadataComparisonExpected[],
  application: readonly (readonly FiniteMetadataComparisonExpected[])[],
  sources: readonly (readonly (readonly FiniteMetadataComparisonExpected[])[])[],
) {
  const [row] = yield* runDrizzleStatementEffect(tx.select({
    consumed: sql<unknown>`${sql.identifier(schemaName)}.fx_compare_finite_metadata(${scopeId}::text,
      ${capturedWatermark.toString()}::bigint, ${JSON.stringify(consumed)}::jsonb)`,
    application: sql<unknown>`(select coalesce(jsonb_agg(
      ${sql.identifier(schemaName)}.fx_compare_finite_metadata(${scopeId}::text, null::bigint, page.value)
      order by page.ordinality), '[]'::jsonb)
      from jsonb_array_elements(${JSON.stringify(application)}::jsonb)
        with ordinality as page(value, ordinality))`,
    ownership: sql<unknown>`jsonb_build_object(
      'contract', ${fxSystemApplicationActiveHeads.readinessContractVersion},
      'retained', exists(select 1 from ${fxSystemApplicationWriteOwnership}
        where ${fxSystemApplicationWriteOwnership.scopeId} = ${scopeId}))`,
    sources: sql<unknown>`(select coalesce(jsonb_agg(
      (select coalesce(jsonb_agg(
        ${sql.identifier(schemaName)}.fx_compare_finite_metadata(${scopeId}::text, null::bigint, page.value)
        order by page.ordinality), '[]'::jsonb)
        from jsonb_array_elements(source.value) with ordinality as page(value, ordinality))
      order by source.ordinality), '[]'::jsonb)
      from jsonb_array_elements(${JSON.stringify(sources)}::jsonb)
        with ordinality as source(value, ordinality))`,
  }).from(fxSystemScopeClocks).leftJoin(fxSystemApplicationActiveHeads,
    eq(fxSystemApplicationActiveHeads.scopeId, fxSystemScopeClocks.scopeId))
    .where(eq(fxSystemScopeClocks.scopeId, scopeId)).limit(1),
  cause => new FiniteMetadataError({ reason: "resourceFailure", cause }));
  // Only the envelope is decoded here. Later named observations intentionally
  // stay unknown until their existing ordered policy owner consumes them.
  return yield* decodeObservation(row).pipe(Effect.mapError(cause =>
    new FiniteMetadataError({ reason: "invalidProjection", cause })));
});

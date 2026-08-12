import { and, eq, sql } from "drizzle-orm";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "../appRows";
import { detachDriverRows } from "../detachDriverRows";
import { observeDrizzleQuery } from "../drizzleQueryObservation";
import {
  fxSystemApplicationActivationsV1,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationRevisionsV2,
} from "../schema";
import type {
  StoredCommitAuthorityEvidenceLoaderOptionsV1,
} from "./postgresLoader";

const MAX_GRAPH_READINESS_FUNCTIONS = 1_024;

type CandidateRow = typeof fxSystemApplicationCandidatesV1.$inferSelect;
type AnalysisRow = Pick<
  typeof fxSystemApplicationAnalysesV1.$inferSelect,
  | "scopeId"
  | "analysisId"
  | "candidateId"
  | "sourceArtifactRootSha256"
  | "status"
  | "manifestSha256"
  | "manifestBytes"
>;
type RevisionRow = typeof fxSystemApplicationRevisionsV2.$inferSelect;
type PublicationRow = typeof fxSystemApplicationPublicationsV1.$inferSelect;
type FunctionRow = typeof fxSystemApplicationFunctionsV1.$inferSelect;
type SchemaRow = typeof fxSystemApplicationRevisionSchemasV1.$inferSelect;
type ReadinessRow = typeof fxSystemApplicationReadinessV1.$inferSelect;
type ReadinessFunctionRow = Pick<
  typeof fxSystemApplicationReadinessFunctionsV1.$inferSelect,
  | "scopeId"
  | "revisionId"
  | "readinessSha256"
  | "functionPath"
  | "runtimeTargetSha256"
  | "coldReceiptSha256"
>;
type ActivationRow = typeof fxSystemApplicationActivationsV1.$inferSelect;

export interface ApplicationGraphSelectorV1 {
  readonly scopeId: ScopeId;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly functionPath: string;
  readonly activationSequence: bigint;
}

export interface ApplicationGraphParentSizeRowV1 {
  readonly manifestByteLengthText: string | null;
  readonly schemaByteLengthText: string;
  readonly functionCatalogByteLengthText: string;
  readonly functionEntryByteLengthText: string;
  readonly readinessByteLengthText: string;
  readonly activationByteLengthText: string;
  readonly readinessSha256: Uint8Array;
}

export interface ApplicationGraphReadinessFunctionSizeRowV1 {
  readonly functionCountText: string;
  readonly functionPathByteLengthText: string;
}

export interface CapturedApplicationGraphRowsV1 {
  readonly parentSizeRows: ReadonlyArray<ApplicationGraphParentSizeRowV1>;
  readonly readinessFunctionSizeRows:
    ReadonlyArray<ApplicationGraphReadinessFunctionSizeRowV1>;
  readonly candidateRows: ReadonlyArray<CandidateRow>;
  readonly analysisRows: ReadonlyArray<AnalysisRow>;
  readonly revisionRows: ReadonlyArray<RevisionRow>;
  readonly publicationRows: ReadonlyArray<PublicationRow>;
  readonly functionRows: ReadonlyArray<FunctionRow>;
  readonly schemaRows: ReadonlyArray<SchemaRow>;
  readonly readinessRows: ReadonlyArray<ReadinessRow>;
  readonly readinessFunctionRows: ReadonlyArray<ReadinessFunctionRow>;
  readonly activationRows: ReadonlyArray<ActivationRow>;
}

export interface CapturedApplicationGraphSizeRowsV1 {
  readonly parentSizeRows: ReadonlyArray<ApplicationGraphParentSizeRowV1>;
  readonly readinessFunctionSizeRows:
    ReadonlyArray<ApplicationGraphReadinessFunctionSizeRowV1>;
}

export const EMPTY_APPLICATION_GRAPH_ROWS_V1: CapturedApplicationGraphRowsV1 =
  Object.freeze({
    parentSizeRows: Object.freeze([]),
    readinessFunctionSizeRows: Object.freeze([]),
    candidateRows: Object.freeze([]),
    analysisRows: Object.freeze([]),
    revisionRows: Object.freeze([]),
    publicationRows: Object.freeze([]),
    functionRows: Object.freeze([]),
    schemaRows: Object.freeze([]),
    readinessRows: Object.freeze([]),
    readinessFunctionRows: Object.freeze([]),
    activationRows: Object.freeze([]),
  });

export async function captureApplicationGraphSizeRowsV1(
  tx: AppRowTransaction,
  selector: ApplicationGraphSelectorV1,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
): Promise<CapturedApplicationGraphSizeRowsV1> {
  const parentQuery = tx.select({
    manifestByteLengthText: sql<string | null>`
      octet_length(${fxSystemApplicationAnalysesV1.manifestBytes})::bigint::text
    `,
    schemaByteLengthText: sql<string>`
      octet_length(${fxSystemApplicationPublicationsV1.schemaBytes})::bigint::text
    `,
    functionCatalogByteLengthText: sql<string>`
      octet_length(${fxSystemApplicationPublicationsV1.functionCatalogBytes})::bigint::text
    `,
    functionEntryByteLengthText: sql<string>`
      octet_length(${fxSystemApplicationFunctionsV1.entryBytes})::bigint::text
    `,
    readinessByteLengthText: sql<string>`
      octet_length(${fxSystemApplicationReadinessV1.readinessBytes})::bigint::text
    `,
    activationByteLengthText: sql<string>`
      octet_length(${fxSystemApplicationActivationsV1.activationBytes})::bigint::text
    `,
    readinessSha256: fxSystemApplicationReadinessV1.readinessSha256,
  }).from(fxSystemApplicationCandidatesV1)
    .innerJoin(fxSystemApplicationAnalysesV1, and(
      eq(fxSystemApplicationAnalysesV1.scopeId, fxSystemApplicationCandidatesV1.scopeId),
      eq(fxSystemApplicationAnalysesV1.candidateId, fxSystemApplicationCandidatesV1.candidateId),
      eq(fxSystemApplicationAnalysesV1.analysisId, selector.analysisId),
    ))
    .innerJoin(fxSystemApplicationRevisionsV2, and(
      eq(fxSystemApplicationRevisionsV2.scopeId, fxSystemApplicationCandidatesV1.scopeId),
      eq(fxSystemApplicationRevisionsV2.revisionId, selector.revisionId),
    ))
    .innerJoin(fxSystemApplicationPublicationsV1, and(
      eq(fxSystemApplicationPublicationsV1.scopeId, fxSystemApplicationCandidatesV1.scopeId),
      eq(fxSystemApplicationPublicationsV1.revisionId, selector.revisionId),
    ))
    .innerJoin(fxSystemApplicationFunctionsV1, and(
      eq(fxSystemApplicationFunctionsV1.scopeId, fxSystemApplicationCandidatesV1.scopeId),
      eq(fxSystemApplicationFunctionsV1.revisionId, selector.revisionId),
      eq(fxSystemApplicationFunctionsV1.functionPath, selector.functionPath),
    ))
    .innerJoin(fxSystemApplicationRevisionSchemasV1, and(
      eq(fxSystemApplicationRevisionSchemasV1.scopeId, fxSystemApplicationCandidatesV1.scopeId),
      eq(fxSystemApplicationRevisionSchemasV1.revisionId, selector.revisionId),
    ))
    .innerJoin(fxSystemApplicationReadinessV1, and(
      eq(fxSystemApplicationReadinessV1.scopeId, fxSystemApplicationCandidatesV1.scopeId),
      eq(fxSystemApplicationReadinessV1.revisionId, selector.revisionId),
    ))
    .innerJoin(fxSystemApplicationActivationsV1, and(
      eq(fxSystemApplicationActivationsV1.scopeId, fxSystemApplicationCandidatesV1.scopeId),
      eq(fxSystemApplicationActivationsV1.activationSequence, selector.activationSequence),
    ))
    .where(and(
      eq(fxSystemApplicationCandidatesV1.scopeId, selector.scopeId),
      eq(fxSystemApplicationCandidatesV1.candidateId, selector.candidateId),
    ))
    .limit(2);
  observeDrizzleQuery("applicationGraphSizes", parentQuery, options.observeQuery);
  const parentSizeRows = await parentQuery;
  const readinessSha256 = parentSizeRows[0]?.readinessSha256;
  if (parentSizeRows.length !== 1 || readinessSha256 === undefined) {
    return Object.freeze({
      parentSizeRows: detachDriverRows(parentSizeRows),
      readinessFunctionSizeRows: Object.freeze([]),
    });
  }
  const boundedChildren = tx.select({
    functionPath: fxSystemApplicationReadinessFunctionsV1.functionPath,
  }).from(fxSystemApplicationReadinessFunctionsV1).where(and(
    eq(fxSystemApplicationReadinessFunctionsV1.scopeId, selector.scopeId),
    eq(fxSystemApplicationReadinessFunctionsV1.revisionId, selector.revisionId),
    eq(fxSystemApplicationReadinessFunctionsV1.readinessSha256, readinessSha256),
  )).orderBy(fxSystemApplicationReadinessFunctionsV1.functionPath)
    .limit(MAX_GRAPH_READINESS_FUNCTIONS + 1).as("bounded_graph_functions");
  const childSizeQuery = tx.select({
    functionCountText: sql<string>`count(*)::bigint::text`,
    functionPathByteLengthText: sql<string>`
      coalesce(sum(octet_length(convert_to(
        ${boundedChildren.functionPath}, 'UTF8'
      ))), 0)::bigint::text
    `,
  }).from(boundedChildren);
  observeDrizzleQuery(
    "applicationGraphFunctionSizes",
    childSizeQuery,
    options.observeQuery,
  );
  return Object.freeze({
    parentSizeRows: detachDriverRows(parentSizeRows),
    readinessFunctionSizeRows: detachDriverRows(await childSizeQuery),
  });
}

export async function captureApplicationGraphPayloadRowsV1(
  tx: AppRowTransaction,
  selector: ApplicationGraphSelectorV1,
  sizes: CapturedApplicationGraphSizeRowsV1,
  options: StoredCommitAuthorityEvidenceLoaderOptionsV1,
): Promise<CapturedApplicationGraphRowsV1> {
  const readinessSha256 = sizes.parentSizeRows[0]?.readinessSha256;
  if (readinessSha256 === undefined) {
    return Object.freeze({ ...EMPTY_APPLICATION_GRAPH_ROWS_V1, ...sizes });
  }
  const queries = {
    candidate: tx.select().from(fxSystemApplicationCandidatesV1).where(and(
      eq(fxSystemApplicationCandidatesV1.scopeId, selector.scopeId),
      eq(fxSystemApplicationCandidatesV1.candidateId, selector.candidateId),
    )).limit(2),
    analysis: tx.select({
      scopeId: fxSystemApplicationAnalysesV1.scopeId,
      analysisId: fxSystemApplicationAnalysesV1.analysisId,
      candidateId: fxSystemApplicationAnalysesV1.candidateId,
      sourceArtifactRootSha256:
        fxSystemApplicationAnalysesV1.sourceArtifactRootSha256,
      status: fxSystemApplicationAnalysesV1.status,
      manifestSha256: fxSystemApplicationAnalysesV1.manifestSha256,
      manifestBytes: fxSystemApplicationAnalysesV1.manifestBytes,
    }).from(fxSystemApplicationAnalysesV1).where(and(
      eq(fxSystemApplicationAnalysesV1.scopeId, selector.scopeId),
      eq(fxSystemApplicationAnalysesV1.analysisId, selector.analysisId),
    )).limit(2),
    revision: tx.select().from(fxSystemApplicationRevisionsV2).where(and(
      eq(fxSystemApplicationRevisionsV2.scopeId, selector.scopeId),
      eq(fxSystemApplicationRevisionsV2.revisionId, selector.revisionId),
    )).limit(2),
    publication: tx.select().from(fxSystemApplicationPublicationsV1).where(and(
      eq(fxSystemApplicationPublicationsV1.scopeId, selector.scopeId),
      eq(fxSystemApplicationPublicationsV1.revisionId, selector.revisionId),
    )).limit(2),
    selectedFunction: tx.select().from(fxSystemApplicationFunctionsV1).where(and(
      eq(fxSystemApplicationFunctionsV1.scopeId, selector.scopeId),
      eq(fxSystemApplicationFunctionsV1.revisionId, selector.revisionId),
      eq(fxSystemApplicationFunctionsV1.functionPath, selector.functionPath),
    )).limit(2),
    schema: tx.select().from(fxSystemApplicationRevisionSchemasV1).where(and(
      eq(fxSystemApplicationRevisionSchemasV1.scopeId, selector.scopeId),
      eq(fxSystemApplicationRevisionSchemasV1.revisionId, selector.revisionId),
    )).limit(2),
    readiness: tx.select().from(fxSystemApplicationReadinessV1).where(and(
      eq(fxSystemApplicationReadinessV1.scopeId, selector.scopeId),
      eq(fxSystemApplicationReadinessV1.revisionId, selector.revisionId),
    )).limit(2),
    readinessFunctions: tx.select({
      scopeId: fxSystemApplicationReadinessFunctionsV1.scopeId,
      revisionId: fxSystemApplicationReadinessFunctionsV1.revisionId,
      readinessSha256:
        fxSystemApplicationReadinessFunctionsV1.readinessSha256,
      functionPath: fxSystemApplicationReadinessFunctionsV1.functionPath,
      runtimeTargetSha256:
        fxSystemApplicationReadinessFunctionsV1.runtimeTargetSha256,
      coldReceiptSha256:
        fxSystemApplicationReadinessFunctionsV1.coldReceiptSha256,
    })
      .from(fxSystemApplicationReadinessFunctionsV1)
      .where(and(
        eq(fxSystemApplicationReadinessFunctionsV1.scopeId, selector.scopeId),
        eq(fxSystemApplicationReadinessFunctionsV1.revisionId, selector.revisionId),
        eq(fxSystemApplicationReadinessFunctionsV1.readinessSha256, readinessSha256),
      ))
      .orderBy(fxSystemApplicationReadinessFunctionsV1.functionPath)
      .limit(MAX_GRAPH_READINESS_FUNCTIONS + 1),
    activation: tx.select().from(fxSystemApplicationActivationsV1).where(and(
      eq(fxSystemApplicationActivationsV1.scopeId, selector.scopeId),
      eq(
        fxSystemApplicationActivationsV1.activationSequence,
        selector.activationSequence,
      ),
    )).limit(2),
  };
  observeDrizzleQuery("applicationGraphCandidate", queries.candidate, options.observeQuery);
  observeDrizzleQuery("applicationGraphAnalysis", queries.analysis, options.observeQuery);
  observeDrizzleQuery("applicationGraphRevision", queries.revision, options.observeQuery);
  observeDrizzleQuery("applicationGraphPublication", queries.publication, options.observeQuery);
  observeDrizzleQuery("applicationGraphFunction", queries.selectedFunction, options.observeQuery);
  observeDrizzleQuery("applicationGraphSchema", queries.schema, options.observeQuery);
  observeDrizzleQuery("applicationGraphReadiness", queries.readiness, options.observeQuery);
  observeDrizzleQuery("applicationGraphReadinessFunctions", queries.readinessFunctions, options.observeQuery);
  observeDrizzleQuery("applicationGraphActivation", queries.activation, options.observeQuery);
  const candidateRows = await queries.candidate;
  const analysisRows = await queries.analysis;
  const revisionRows = await queries.revision;
  const publicationRows = await queries.publication;
  const functionRows = await queries.selectedFunction;
  const schemaRows = await queries.schema;
  const readinessRows = await queries.readiness;
  const readinessFunctionRows = await queries.readinessFunctions;
  const activationRows = await queries.activation;
  return Object.freeze({
    ...sizes,
    candidateRows: detachDriverRows(candidateRows),
    analysisRows: detachDriverRows(analysisRows),
    revisionRows: detachDriverRows(revisionRows),
    publicationRows: detachDriverRows(publicationRows),
    functionRows: detachDriverRows(functionRows),
    schemaRows: detachDriverRows(schemaRows),
    readinessRows: detachDriverRows(readinessRows),
    readinessFunctionRows: detachDriverRows(readinessFunctionRows),
    activationRows: detachDriverRows(activationRows),
  });
}

import {
  fxSystemApplicationRevisionsV2,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationAnalysesV1,
} from "../../database/schema";
import {
  type ApplicationManifestV1,
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import type {
  ApplicationTaskCatalogSnapshot,
  ApplicationTaskCatalogSnapshotPort,
  ApplicationTaskCatalogSnapshotError,
} from "../tasks/applicationTaskBindings";
import type {
  ApplicationReadinessAuthority,
  ApplicationReadinessResult,
} from "./contracts";
import {
  Effect,
  Result,
} from "effect";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  type ScopeClockRecord,
  type LockScopeClockForShareError,
  lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForShareInTransactionEffect,
} from "../../scope/scopeClock";
import {
  and,
  eq,
} from "drizzle-orm";
import {
  type ApplicationReadinessError,
  readinessFailure,
  readinessFailureValue,
} from "./errors";
import { query } from "./databaseBoundary";
import { notReady } from "./outcomes";
import {
  bytesEqualFullScan,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import {
  applicationSchemaPublicationFrameV1,
  applicationFunctionCatalogPublicationFrameV1,
  applicationPublicationCommitmentFrameV1,
  applicationFunctionEntryPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import { detachDriverRows } from "../../database/detachDriverRows";
import { sha256 } from "./frames";
import {
  MAX_FUNCTIONS,
  UTF8_FATAL,
} from "./limits";

export interface StoredBundle {
  readonly authority: ApplicationReadinessAuthority;
  readonly deploymentId: string;
  readonly revision: typeof fxSystemApplicationRevisionsV2.$inferSelect;
  readonly publication: typeof fxSystemApplicationPublicationsV1.$inferSelect;
  readonly manifest: ApplicationManifestV1;
  readonly functions: ReadonlyArray<
    typeof fxSystemApplicationFunctionsV1.$inferSelect
  >;
  readonly task: ApplicationTaskCatalogSnapshot;
}

export const reserveBundle = Effect.fn("ApplicationReadiness.reserveBundle")(
function* (
  tx: AppRowTransaction,
  authority: ApplicationReadinessAuthority,
  input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  },
  taskCatalog: ApplicationTaskCatalogSnapshotPort,
  rowLock: "share" | "update" = "update",
  lockedClock?: ScopeClockRecord,
): Effect.fn.Return<StoredBundle | Extract<ApplicationReadinessResult, {
  readonly status: "not_ready";
}>, ApplicationReadinessError | ApplicationTaskCatalogSnapshotError |
  LockScopeClockForShareError> {
    const clock = lockedClock ?? (yield* (rowLock === "share"
      ? lockScopeClockForSnapshotReadInTransactionEffect(tx, authority.scopeId)
      : lockScopeClockForShareInTransactionEffect(tx, authority.scopeId)));
    yield* requireExactAuthority(authority, clock);
    const revisionRows = yield* query(
      tx.select().from(fxSystemApplicationRevisionsV2).where(and(
        eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
        eq(fxSystemApplicationRevisionsV2.revisionId, input.revisionId),
      )).limit(1).for(rowLock),
    );
    const revision = revisionRows[0];
    if (revision === undefined) {
      return notReady(input.revisionId, "revisionMissing");
    }
    const selectedRows = yield* query(
      tx.select({
        candidate: fxSystemApplicationCandidatesV1,
        analysis: fxSystemApplicationAnalysesV1,
        publication: fxSystemApplicationPublicationsV1,
      }).from(fxSystemApplicationRevisionsV2)
        .leftJoin(fxSystemApplicationCandidatesV1, and(
          eq(fxSystemApplicationCandidatesV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
          eq(fxSystemApplicationCandidatesV1.candidateId, fxSystemApplicationRevisionsV2.candidateId),
        ))
        .leftJoin(fxSystemApplicationAnalysesV1, and(
          eq(fxSystemApplicationAnalysesV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
          eq(fxSystemApplicationAnalysesV1.analysisId, fxSystemApplicationRevisionsV2.analysisId),
        ))
        .leftJoin(fxSystemApplicationPublicationsV1, and(
          eq(fxSystemApplicationPublicationsV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
          eq(fxSystemApplicationPublicationsV1.revisionId, fxSystemApplicationRevisionsV2.revisionId),
        ))
        .where(and(
          eq(fxSystemApplicationRevisionsV2.scopeId, revision.scopeId),
          eq(fxSystemApplicationRevisionsV2.revisionId, revision.revisionId),
        )).limit(1),
    );
    return yield* authenticateStoredBundle(authority, input, revision, selectedRows[0],
      count => query(tx.select().from(fxSystemApplicationFunctionsV1).where(and(
        eq(fxSystemApplicationFunctionsV1.scopeId, revision.scopeId),
        eq(fxSystemApplicationFunctionsV1.revisionId, revision.revisionId),
      )).limit(count + 1)),
      () => taskCatalog.loadInTransaction(tx, authority, revision.revisionId));
  },
);

export interface CapturedBundleSelection {
  readonly candidate: typeof fxSystemApplicationCandidatesV1.$inferSelect | null;
  readonly analysis: typeof fxSystemApplicationAnalysesV1.$inferSelect | null;
  readonly publication: typeof fxSystemApplicationPublicationsV1.$inferSelect | null;
}

/** Authentication is reused by retained readers and SQL-closed finite preparation. */
export const authenticateStoredBundle = Effect.fn('ApplicationReadiness.authenticateBundle')(
function* (
  authority: ApplicationReadinessAuthority,
  input: { readonly deploymentId: string; readonly revisionId: string },
  revision: typeof fxSystemApplicationRevisionsV2.$inferSelect,
  selected: CapturedBundleSelection | undefined,
  readFunctions: (count: number) => Effect.Effect<ReadonlyArray<typeof fxSystemApplicationFunctionsV1.$inferSelect>, ApplicationReadinessError>,
  readTask: () => Effect.Effect<ApplicationTaskCatalogSnapshot | null, ApplicationTaskCatalogSnapshotError>,
) {
    const candidate = selected?.candidate;
    if (candidate === undefined || candidate === null ||
      candidate.storageGeneration !== authority.storageGeneration ||
      candidate.storageGenerationFence !== authority.storageGenerationFence ||
      candidate.epoch !== authority.epoch ||
      !bytesEqualFullScan(
        candidate.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      )) return yield* readinessFailure("authorityChanged");
    const analysis = selected?.analysis;
    if (analysis === undefined || analysis === null ||
      analysis.status !== "analyzed" ||
      analysis.manifestBytes === null || analysis.manifestSha256 === null ||
      analysis.candidateId !== revision.candidateId ||
      !bytesEqualFullScan(analysis.manifestSha256, revision.manifestSha256) ||
      !bytesEqualFullScan(
        analysis.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      )) {
      return yield* readinessFailure("storedState");
    }
    const manifest = yield* decodeStoredManifest(
      analysis.manifestBytes,
      analysis.manifestSha256,
    );
    const publication = selected?.publication;
    if (publication === undefined || publication === null) {
      return notReady(input.revisionId, "publicationMissing");
    }
    if (publication.candidateId !== revision.candidateId ||
      publication.analysisId !== revision.analysisId ||
      !bytesEqualFullScan(
        publication.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      ) ||
      !bytesEqualFullScan(publication.manifestSha256, revision.manifestSha256)) {
      return yield* readinessFailure("storedState");
    }
    const schemaFrame = yield* Effect.fromResult(
      applicationSchemaPublicationFrameV1(manifest).pipe(
        Result.mapError(cause => readinessFailureValue(
          "storedState",
          false,
          cause,
        )),
      ),
    );
    if (!bytesEqualFullScan(schemaFrame, publication.schemaBytes) ||
      !bytesEqualFullScan(yield* sha256(schemaFrame), publication.schemaSha256)) {
      return yield* readinessFailure("storedState");
    }
    const catalogFrame = yield* Effect.fromResult(applicationFunctionCatalogPublicationFrameV1(manifest).pipe(
      Result.mapError(cause => readinessFailureValue("storedState", false, cause))));
    if (!bytesEqualFullScan(catalogFrame, publication.functionCatalogBytes) ||
      !bytesEqualFullScan(yield* sha256(catalogFrame), publication.functionCatalogSha256))
      return yield* readinessFailure("storedState");
    const commitmentFrame = yield* Effect.fromResult(applicationPublicationCommitmentFrameV1({
      scopeId: authority.scopeId, revisionId: revision.revisionId, candidateId: revision.candidateId,
      analysisId: revision.analysisId, sourceArtifactRootSha256: manifest.sourceArtifact.rootSha256,
      manifestSha256: encodeBytesToLowercaseHex(revision.manifestSha256),
      schemaSha256: encodeBytesToLowercaseHex(publication.schemaSha256),
      functionCatalogSha256: encodeBytesToLowercaseHex(publication.functionCatalogSha256),
    }).pipe(Result.mapError(cause => readinessFailureValue("storedState", false, cause))));
    if (!bytesEqualFullScan(yield* sha256(commitmentFrame), publication.publicationSha256))
      return yield* readinessFailure("storedState");
    const functionRows = yield* readFunctions(manifest.functions.length);
    if (functionRows.length !== manifest.functions.length ||
      functionRows.length > MAX_FUNCTIONS) {
      return yield* readinessFailure("storedState");
    }
    const functionsByPath = new Map(
      functionRows.map(row => [row.functionPath, row] as const),
    );
    if (functionsByPath.size !== functionRows.length) {
      return yield* readinessFailure("storedState");
    }
    const functions: Array<(typeof functionRows)[number]> = [];
    for (const fn of manifest.functions) {
      const row = functionsByPath.get(fn.path);
      if (row === undefined) return yield* readinessFailure("storedState");
      functions.push(row);
    }
    yield* validateStoredFunctions(manifest, publication, functions);
    const task = yield* readTask();
    if (task === null) {
      return notReady(input.revisionId, "taskCatalogMissing");
    }
    if (task.candidateId !== revision.candidateId ||
      task.analysisId !== revision.analysisId ||
      !bytesEqualFullScan(
        task.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      ) ||
      !bytesEqualFullScan(task.publicationSha256, publication.publicationSha256)) {
      return yield* readinessFailure("storedState");
    }
    const ownedRevision = detachDriverRows([revision])[0];
    const ownedPublication = detachDriverRows([publication])[0];
    const ownedFunctions = detachDriverRows(functions);
    if (ownedRevision === undefined || ownedPublication === undefined) {
      return yield* readinessFailure("storedState");
    }
    return Object.freeze({
      authority,
      deploymentId: input.deploymentId,
      revision: ownedRevision,
      publication: ownedPublication,
      manifest,
      functions: ownedFunctions,
      task,
    });
  },
);

const validateStoredFunctions = Effect.fn(function* (
  manifest: ApplicationManifestV1,
  publication: typeof fxSystemApplicationPublicationsV1.$inferSelect,
  rows: ReadonlyArray<typeof fxSystemApplicationFunctionsV1.$inferSelect>,
): Effect.fn.Return<void, ApplicationReadinessError> {
    for (let index = 0; index < manifest.functions.length; index += 1) {
      const fn = manifest.functions[index];
      const row = rows[index];
      if (fn === undefined || row === undefined || row.functionPath !== fn.path ||
        row.moduleName !== fn.moduleName || row.exportName !== fn.exportName ||
        row.functionKind !== fn.kind || row.visibility !== fn.visibility ||
        !bytesEqualFullScan(
          row.functionCatalogSha256,
          publication.functionCatalogSha256,
        )) return yield* readinessFailure("storedState");
      const bytes = yield* Effect.fromResult(
        applicationFunctionEntryPublicationFrameV1(fn).pipe(
          Result.mapError(cause => readinessFailureValue(
            "storedState",
            false,
            cause,
          )),
        ),
      );
      if (!bytesEqualFullScan(bytes, row.entryBytes) ||
        !bytesEqualFullScan(yield* sha256(bytes), row.entrySha256)) {
        return yield* readinessFailure("storedState");
      }
    }
  });

const decodeStoredManifest = Effect.fn(
  "ApplicationReadiness.decodeStoredManifest",
)(function* (
  bytes: Uint8Array,
  expectedSha256: Uint8Array,
): Effect.fn.Return<ApplicationManifestV1, ApplicationReadinessError> {
  if (!bytesEqualFullScan(yield* sha256(bytes), expectedSha256)) {
    return yield* readinessFailure("storedState");
  }
  const value = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(bytes)),
    catch: cause => readinessFailureValue("storedState", false, cause),
  });
  const canonical = yield* Effect.fromResult(
    canonicalizeApplicationManifestV1(value).pipe(
      Result.mapError(cause => readinessFailureValue(
        "storedState",
        false,
        cause,
      )),
    ),
  );
  if (!bytesEqualFullScan(canonical.canonicalBytes, bytes)) {
    return yield* readinessFailure("storedState");
  }
  return canonical.manifest;
});

export function requireExactAuthority(
  authority: ApplicationReadinessAuthority,
  clock: ScopeClockRecord,
): Effect.Effect<void, ApplicationReadinessError> {
  return clock.scopeId === authority.scopeId &&
      clock.storageGeneration === authority.storageGeneration &&
      clock.storageGenerationFence === authority.storageGenerationFence &&
      clock.epoch === authority.epoch
    ? Effect.void
    : readinessFailure("authorityChanged");
}

export function storedBundlesEqual(left: StoredBundle, right: StoredBundle): boolean {
  if (left.deploymentId !== right.deploymentId ||
    left.authority.scopeId !== right.authority.scopeId ||
    left.authority.storageGeneration !== right.authority.storageGeneration ||
    left.authority.storageGenerationFence !==
      right.authority.storageGenerationFence ||
    left.authority.epoch !== right.authority.epoch ||
    left.revision.revisionId !== right.revision.revisionId ||
    left.revision.candidateId !== right.revision.candidateId ||
    left.revision.analysisId !== right.revision.analysisId ||
    left.publication.revisionId !== right.publication.revisionId ||
    left.task.revisionId !== right.task.revisionId ||
    left.functions.length !== right.functions.length ||
    !bytesEqualFullScan(
      left.revision.sourceArtifactRootSha256,
      right.revision.sourceArtifactRootSha256,
    ) ||
    !bytesEqualFullScan(
      left.revision.manifestSha256,
      right.revision.manifestSha256,
    ) ||
    !bytesEqualFullScan(
      left.publication.publicationSha256,
      right.publication.publicationSha256,
    ) ||
    !bytesEqualFullScan(
      left.publication.schemaSha256,
      right.publication.schemaSha256,
    ) ||
    !bytesEqualFullScan(
      left.publication.functionCatalogSha256,
      right.publication.functionCatalogSha256,
    ) ||
    !bytesEqualFullScan(
      left.task.taskCatalogBindingSha256,
      right.task.taskCatalogBindingSha256,
    ) ||
    left.task.runtimeHostIdentity !== right.task.runtimeHostIdentity ||
    left.task.compatibilityDate !== right.task.compatibilityDate) return false;
  return left.functions.every((entry, index) => {
    const other = right.functions[index];
    return other !== undefined && entry.functionPath === other.functionPath &&
      bytesEqualFullScan(entry.entrySha256, other.entrySha256);
  });
}

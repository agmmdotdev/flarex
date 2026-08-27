import {
  bytesEqualFullScan,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, asc, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

import type { CatalogEdgeDefinitionId } from "flarex-protocol/catalog";

import {
  ApplicationActiveHeadStateError,
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
  type DecodedApplicationActiveHead,
} from "./applicationActiveHeadRead";
import {
  fxSystemApplicationReadiness,
  fxSystemApplicationReadinessRelations,
  fxSystemApplicationRevisionSchemas,
} from "./applicationRelationSchema";
import type { AppRowTransaction } from "./appRows";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import { isRetryableSqlTransactionCause } from
  "./locatedReadCommittedEffect";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import type { ScopeClockRecord } from "./scopeClock";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const READINESS_FRAME_KEYS = Object.freeze([
  "format", "version", "status", "scopeId", "deploymentId", "revisionId",
  "candidateId", "analysisId", "storageGeneration",
  "storageGenerationFence", "epoch", "sourceArtifactRootSha256",
  "manifestSha256", "publicationSha256", "applicationSchemaSha256",
  "functionCatalogSha256", "schemaVersionId", "schemaManifestSha256",
  "manifestSchemaBindingSha256", "boundPublicationSha256",
  "taskCatalogBindingSha256", "runtimeHostIdentity", "compatibilityDate",
  "coldReceiptSetSha256", "candidateValidationReceiptSha256",
  "uniqueConstraintStatus", "uniqueConstraintEligibilitySha256",
  "physicalReadinessSha256", "relationSet", "coldReceipts", "readyAt",
]);
const READINESS_RELATION_SET_KEYS = Object.freeze([
  "version", "frontierCommitSeq", "relationCount", "readinessSha256",
]);
const RELATION_SET_FRAME_KEYS = Object.freeze([
  "format", "version", "scopeId", "deploymentId",
  "applicationManifestSha256", "manifestSchemaBindingSha256",
  "applicationSchemaSha256", "schemaVersionId", "schemaVersion",
  "schemaManifestSha256", "boundPublicationSha256", "storageGeneration",
  "storageGenerationFence", "epoch", "frontierCommitSeq", "relationCount",
  "relations",
]);
const RELATION_SET_CHILD_KEYS = Object.freeze([
  "relationOrdinal", "relationId", "sourceTableId", "targetTableId",
  "semanticDefinitionSha256", "edgeDefinitionId",
  "physicalDefinitionSha256", "readinessKind", "attemptFence",
  "readinessSha256",
]);

const applicationRelationServingInspectorBrand: unique symbol = Symbol(
  "Flarex/ApplicationRelationServingInspector",
);

/** Private nominal capability for the exact E01/RA01 serving composition. */
export interface ApplicationRelationServingInspector {
  readonly [applicationRelationServingInspectorBrand]: true;
}

const applicationRelationServingInspectorStates = new WeakMap<object, true>();

export type ApplicationRelationServingInspection =
  | Readonly<{
      readonly status: "not_serving";
      readonly reason: "no_active_application";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
    }>
  | Readonly<{
      readonly status: "not_serving";
      readonly reason: "active_readiness_v1";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly activeRevisionId: string;
    }>
  | Readonly<{
      readonly status: "not_serving";
      readonly reason: "definition_not_active";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly activeRevisionId: string;
    }>
  | Readonly<{
      readonly status: "serving";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly activeRevisionId: string;
    }>;

export class ApplicationRelationServingInspectorUnavailableError
  extends Data.TaggedError(
    "ApplicationRelationServingInspectorUnavailableError",
  )<{
    readonly reason: "compositionMissing";
  }> {}

export class ApplicationRelationServingStaleAuthorityError
  extends Data.TaggedError("ApplicationRelationServingStaleAuthorityError")<{
    readonly scopeId: TrustedScopeAuthority["scopeId"];
    readonly reason: "storageGeneration" | "storageGenerationFence" | "epoch";
  }> {}

export type InspectApplicationRelationServingError =
  | ApplicationRelationServingInspectorUnavailableError
  | ApplicationRelationServingStaleAuthorityError
  | ApplicationActiveHeadStateError;

export function createApplicationRelationServingInspector():
  ApplicationRelationServingInspector {
  const inspector: ApplicationRelationServingInspector = Object.freeze({
    [applicationRelationServingInspectorBrand]: true as const,
  });
  applicationRelationServingInspectorStates.set(inspector, true);
  return inspector;
}

export function hasApplicationRelationServingInspectorAuthority(
  value: unknown,
): value is ApplicationRelationServingInspector {
  return typeof value === "object" && value !== null &&
    applicationRelationServingInspectorStates.has(value);
}

/**
 * Runs under E01-A's caller-owned transaction after its scope-clock UPDATE
 * lock. Serving requires one coherent relation activation plus its exact
 * readiness root and dense child set; a revision or readiness digest alone is
 * never sufficient.
 */
export const inspectApplicationRelationServingDefinitionInTransactionEffect =
  Effect.fn("ApplicationRelationServing.inspectDefinitionInTransaction")(
    function* (
      inspector: ApplicationRelationServingInspector,
      tx: AppRowTransaction,
      input: Readonly<{
        readonly authority: TrustedScopeAuthority;
        readonly clock: ScopeClockRecord;
        readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      }>,
    ): Effect.fn.Return<
      ApplicationRelationServingInspection,
      InspectApplicationRelationServingError
    > {
      if (!applicationRelationServingInspectorStates.has(inspector)) {
        return yield* Effect.fail(
          new ApplicationRelationServingInspectorUnavailableError({
            reason: "compositionMissing",
          }),
        );
      }
      if (input.authority.scopeId !== input.clock.scopeId) {
        return yield* Effect.fail(
          new ApplicationRelationServingInspectorUnavailableError({
            reason: "compositionMissing",
          }),
        );
      }
      for (const reason of [
        "storageGeneration",
        "storageGenerationFence",
        "epoch",
      ] as const) {
        if (input.authority[reason] !== input.clock[reason]) {
          return yield* Effect.fail(
            new ApplicationRelationServingStaleAuthorityError({
              scopeId: input.authority.scopeId,
              reason,
            }),
          );
        }
      }
      const active = yield*
        readCoherentApplicationActiveHeadForShareInTransactionEffect(
          tx,
          input.authority.scopeId,
        );
      if (active === null) {
        return Object.freeze({
          status: "not_serving",
          reason: "no_active_application",
          edgeDefinitionId: input.edgeDefinitionId,
        });
      }
      if (active.head.readinessKind === "legacy") {
        return Object.freeze({
          status: "not_serving",
          reason: "active_readiness_v1",
          edgeDefinitionId: input.edgeDefinitionId,
          activeRevisionId: active.head.revisionId,
        });
      }
      const children = yield* loadActiveRelationReadinessChildren(
        tx,
        active.head,
        input.authority,
        input.clock,
      );
      const matches = children.filter(
        child => child.edgeDefinitionId === input.edgeDefinitionId,
      );
      if (matches.length > 1) {
        return yield* storedState(active.head.revisionId);
      }
      return matches.length === 0
        ? Object.freeze({
            status: "not_serving",
            reason: "definition_not_active",
            edgeDefinitionId: input.edgeDefinitionId,
            activeRevisionId: active.head.revisionId,
          })
        : Object.freeze({
            status: "serving",
            edgeDefinitionId: input.edgeDefinitionId,
            activeRevisionId: active.head.revisionId,
          });
    },
  );

type ActiveRelationHead = Extract<
  DecodedApplicationActiveHead,
  { readonly readinessKind: "relation" }
>;

const loadActiveRelationReadinessChildren = Effect.fn(
  "ApplicationRelationServing.loadActiveReadinessChildren",
)(function* (
  tx: AppRowTransaction,
  head: ActiveRelationHead,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): Effect.fn.Return<
  ReadonlyArray<typeof fxSystemApplicationReadinessRelations.$inferSelect>,
  ApplicationActiveHeadStateError
> {
  const roots = yield* query(
    tx.select().from(fxSystemApplicationReadiness).where(and(
      eq(fxSystemApplicationReadiness.scopeId, head.scopeId),
      eq(fxSystemApplicationReadiness.revisionId, head.revisionId),
      eq(fxSystemApplicationReadiness.readinessSha256, head.readinessSha256),
      eq(
        fxSystemApplicationReadiness.relationSetReadinessSha256,
        head.relationSetReadinessSha256,
      ),
      eq(fxSystemApplicationReadiness.relationCount, head.relationCount),
    )).limit(2).for("share"),
    head.revisionId,
  );
  const root = roots[0];
  if (roots.length !== 1 || root === undefined ||
    root.readinessCodecVersion !== 2 ||
    root.relationSetCodecVersion !== 1 ||
    root.deploymentId !== authority.deploymentId ||
    root.storageGeneration !== clock.storageGeneration ||
    root.storageGenerationFence !== clock.storageGenerationFence ||
    root.epoch !== clock.epoch ||
    root.relationFrontierCommitSeq > clock.lastCommitSeq ||
    root.relationCount !== head.relationCount ||
    !bytesEqualFullScan(root.readinessSha256, head.readinessSha256) ||
    !bytesEqualFullScan(
      root.relationSetReadinessSha256,
      head.relationSetReadinessSha256,
    )) return yield* storedState(head.revisionId);
  const schemaRows = yield* query(
    tx.select().from(fxSystemApplicationRevisionSchemas).where(and(
      eq(fxSystemApplicationRevisionSchemas.scopeId, head.scopeId),
      eq(fxSystemApplicationRevisionSchemas.revisionId, head.revisionId),
    )).limit(2).for("share"),
    head.revisionId,
  );
  const revisionSchema = schemaRows[0];
  const rootReadyAt = databaseTimestampFromUnknown(root.readyAt);
  const boundAt = databaseTimestampFromUnknown(revisionSchema?.boundAt);
  if (schemaRows.length !== 1 || revisionSchema === undefined ||
    rootReadyAt === null || boundAt === null ||
    boundAt.getTime() !== rootReadyAt.getTime() ||
    revisionSchema.scopeId !== root.scopeId ||
    revisionSchema.revisionId !== root.revisionId ||
    revisionSchema.deploymentId !== root.deploymentId ||
    revisionSchema.schemaVersionId !== root.schemaVersionId ||
    !Number.isSafeInteger(revisionSchema.schemaVersion) ||
    revisionSchema.schemaVersion < 1 ||
    !bytesEqualFullScan(revisionSchema.manifestSha256, root.manifestSha256) ||
    !bytesEqualFullScan(
      revisionSchema.publicationSha256,
      root.publicationSha256,
    ) || !bytesEqualFullScan(
      revisionSchema.applicationSchemaSha256,
      root.applicationSchemaSha256,
    ) || !bytesEqualFullScan(
      revisionSchema.schemaManifestSha256,
      root.schemaManifestSha256,
    ) || !bytesEqualFullScan(
      revisionSchema.manifestSchemaBindingSha256,
      root.manifestSchemaBindingSha256,
    ) || !bytesEqualFullScan(
      revisionSchema.boundPublicationSha256,
      root.boundPublicationSha256,
    )) return yield* storedState(head.revisionId);
  const readinessFrame = yield* validateCanonicalEvidence(
    root.readinessBytes,
    root.readinessSha256,
    head.revisionId,
  );
  const relationSetFrame = yield* validateCanonicalEvidence(
    root.relationSetReadinessBytes,
    root.relationSetReadinessSha256,
    head.revisionId,
  );
  if (!applicationRelationReadinessFrameMatchesRow(readinessFrame, root) ||
    !applicationRelationSetFrameMatchesRow(
      relationSetFrame,
      root,
      revisionSchema.schemaVersion,
    )) {
    return yield* storedState(head.revisionId);
  }
  const children = yield* query(
    tx.select().from(fxSystemApplicationReadinessRelations).where(and(
      eq(fxSystemApplicationReadinessRelations.scopeId, head.scopeId),
      eq(
        fxSystemApplicationReadinessRelations.revisionId,
        head.revisionId,
      ),
    )).orderBy(
      asc(fxSystemApplicationReadinessRelations.relationOrdinal),
    ).for("share"),
    head.revisionId,
  );
  if (!childrenMatchRelationSet(children, relationSetFrame, root)) {
    return yield* storedState(head.revisionId);
  }
  return children;
});

export function applicationRelationReadinessFrameMatchesRow(
  value: unknown,
  root: typeof fxSystemApplicationReadiness.$inferSelect,
): boolean {
  if (!hasExactOwnDataKeys(value, READINESS_FRAME_KEYS) ||
    value.format !== "flarex.application-readiness" || value.version !== 2 ||
    value.status !== "ready" || value.scopeId !== root.scopeId ||
    value.deploymentId !== root.deploymentId ||
    value.revisionId !== root.revisionId ||
    value.candidateId !== root.candidateId ||
    value.analysisId !== root.analysisId ||
    value.storageGeneration !== root.storageGeneration ||
    value.storageGenerationFence !== root.storageGenerationFence.toString() ||
    value.epoch !== root.epoch ||
    value.sourceArtifactRootSha256 !==
      encodeBytesToLowercaseHex(root.sourceArtifactRootSha256) ||
    value.manifestSha256 !== encodeBytesToLowercaseHex(root.manifestSha256) ||
    value.publicationSha256 !==
      encodeBytesToLowercaseHex(root.publicationSha256) ||
    value.applicationSchemaSha256 !==
      encodeBytesToLowercaseHex(root.applicationSchemaSha256) ||
    value.functionCatalogSha256 !==
      encodeBytesToLowercaseHex(root.functionCatalogSha256) ||
    value.schemaVersionId !== root.schemaVersionId ||
    value.schemaManifestSha256 !==
      encodeBytesToLowercaseHex(root.schemaManifestSha256) ||
    value.manifestSchemaBindingSha256 !==
      encodeBytesToLowercaseHex(root.manifestSchemaBindingSha256) ||
    value.boundPublicationSha256 !==
      encodeBytesToLowercaseHex(root.boundPublicationSha256) ||
    value.taskCatalogBindingSha256 !==
      encodeBytesToLowercaseHex(root.taskCatalogBindingSha256) ||
    value.runtimeHostIdentity !== root.runtimeHostIdentity ||
    value.compatibilityDate !== root.compatibilityDate ||
    value.coldReceiptSetSha256 !==
      encodeBytesToLowercaseHex(root.coldReceiptSetSha256) ||
    value.candidateValidationReceiptSha256 !==
      encodeBytesToLowercaseHex(root.candidateValidationReceiptSha256) ||
    value.uniqueConstraintStatus !== root.uniqueConstraintStatus ||
    value.uniqueConstraintEligibilitySha256 !==
      encodeBytesToLowercaseHex(root.uniqueConstraintEligibilitySha256) ||
    value.physicalReadinessSha256 !==
      encodeBytesToLowercaseHex(root.physicalReadinessSha256) ||
    !Array.isArray(value.coldReceipts) || value.coldReceipts.length !== 0) {
    return false;
  }
  const readyAt = databaseTimestampFromUnknown(root.readyAt);
  const relationSet = value.relationSet;
  return readyAt !== null && value.readyAt === readyAt.toISOString() &&
    hasExactOwnDataKeys(relationSet, READINESS_RELATION_SET_KEYS) &&
    relationSet.version === 1 &&
    relationSet.frontierCommitSeq === root.relationFrontierCommitSeq.toString() &&
    relationSet.relationCount === root.relationCount &&
    relationSet.readinessSha256 ===
      encodeBytesToLowercaseHex(root.relationSetReadinessSha256);
}

export function applicationRelationSetFrameMatchesRow(
  value: unknown,
  root: typeof fxSystemApplicationReadiness.$inferSelect,
  schemaVersion: number,
): boolean {
  return hasExactOwnDataKeys(value, RELATION_SET_FRAME_KEYS) &&
    value.format === "flarex.application-relation-set-readiness" &&
    value.version === 1 && value.scopeId === root.scopeId &&
    value.deploymentId === root.deploymentId &&
    value.applicationManifestSha256 ===
      encodeBytesToLowercaseHex(root.manifestSha256) &&
    value.manifestSchemaBindingSha256 ===
      encodeBytesToLowercaseHex(root.manifestSchemaBindingSha256) &&
    value.applicationSchemaSha256 ===
      encodeBytesToLowercaseHex(root.applicationSchemaSha256) &&
    value.schemaVersionId === root.schemaVersionId &&
    value.schemaVersion === schemaVersion &&
    value.schemaManifestSha256 ===
      encodeBytesToLowercaseHex(root.schemaManifestSha256) &&
    value.boundPublicationSha256 ===
      encodeBytesToLowercaseHex(root.boundPublicationSha256) &&
    value.storageGeneration === root.storageGeneration &&
    value.storageGenerationFence === root.storageGenerationFence.toString() &&
    value.epoch === root.epoch &&
    value.frontierCommitSeq === root.relationFrontierCommitSeq.toString() &&
    value.relationCount === root.relationCount &&
    Array.isArray(value.relations) &&
    value.relations.length === root.relationCount;
}

function childrenMatchRelationSet(
  children: ReadonlyArray<
    typeof fxSystemApplicationReadinessRelations.$inferSelect
  >,
  relationSet: unknown,
  root: typeof fxSystemApplicationReadiness.$inferSelect,
): boolean {
  if (!hasExactOwnDataKeys(relationSet, RELATION_SET_FRAME_KEYS)) return false;
  const encodedRelations = relationSet.relations;
  if (!Array.isArray(encodedRelations) ||
    children.length !== root.relationCount ||
    encodedRelations.length !== root.relationCount) return false;
  return children.every((child, index) => {
    const encoded = encodedRelations[index];
    if (!hasExactOwnDataKeys(encoded, RELATION_SET_CHILD_KEYS)) return false;
    const expectedOrdinal = index + 1;
    const expectedAttemptFence = child.readinessKind === "physical"
      ? child.physicalAttemptFence?.toString()
      : child.semanticAttemptFence?.toString();
    return child.scopeId === root.scopeId &&
      child.revisionId === root.revisionId &&
      child.relationOrdinal === expectedOrdinal &&
      child.relationCount === root.relationCount &&
      child.schemaVersionId === root.schemaVersionId &&
      bytesEqualFullScan(child.readinessSha256, root.readinessSha256) &&
      bytesEqualFullScan(
        child.relationSetReadinessSha256,
        root.relationSetReadinessSha256,
      ) && encoded.relationOrdinal === expectedOrdinal &&
      encoded.relationId === child.relationId &&
      encoded.sourceTableId === child.sourceTableId &&
      encoded.targetTableId === child.targetTableId &&
      encoded.semanticDefinitionSha256 ===
        encodeBytesToLowercaseHex(child.semanticDefinitionSha256) &&
      encoded.edgeDefinitionId === child.edgeDefinitionId &&
      encoded.physicalDefinitionSha256 ===
        encodeBytesToLowercaseHex(child.physicalDefinitionSha256) &&
      encoded.readinessKind === child.readinessKind &&
      encoded.attemptFence === expectedAttemptFence &&
      encoded.readinessSha256 ===
        encodeBytesToLowercaseHex(child.relationReadinessSha256);
  });
}

const validateCanonicalEvidence = Effect.fn(
  "ApplicationRelationServing.validateCanonicalEvidence",
)(function* (
  bytes: Uint8Array,
  expectedSha256: Uint8Array,
  revisionId: string,
): Effect.fn.Return<unknown, ApplicationActiveHeadStateError> {
  const actualSha256 = yield* Effect.tryPromise({
    try: async () => new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: cause => new ApplicationActiveHeadStateError({
      reason: "resourceFailure",
      retryable: false,
      revisionId,
      cause,
    }),
  });
  if (!bytesEqualFullScan(actualSha256, expectedSha256)) {
    return yield* storedState(revisionId);
  }
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(bytes)),
    catch: cause => new ApplicationActiveHeadStateError({
      reason: "storedState",
      retryable: false,
      revisionId,
      cause,
    }),
  });
  if (!isJson(parsed) || !bytesEqualFullScan(
    UTF8.encode(encodeCanonicalJson(parsed, invariant)),
    bytes,
  )) return yield* storedState(revisionId);
  return parsed;
});

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  revisionId?: string,
): Effect.Effect<ReadonlyArray<Row>, ApplicationActiveHeadStateError> {
  return runDrizzleStatementEffect(statement, cause =>
    new ApplicationActiveHeadStateError({
      reason: "resourceFailure",
      retryable: isRetryableSqlTransactionCause(cause),
      ...(revisionId === undefined ? {} : { revisionId }),
      cause,
    })
  );
}

function storedState(revisionId?: string) {
  return Effect.fail(new ApplicationActiveHeadStateError({
    reason: "storedState",
    retryable: false,
    ...(revisionId === undefined ? {} : { revisionId }),
  }));
}

function invariant(): never {
  throw new Error("Application relation serving evidence lost JSON form.");
}

import { Effect, Schema, Result } from "effect";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ApplicationDocumentMaterializationOptions, ApplicationDocumentDefinitionCommand,
  PreparedPointCommitCandidateSchemaWriteGuard, PreparedPointCommitApplicationRelations } from "./model";
import { prepareCandidateSchemaWriteGuard, runCandidateSchemaWriteGuard, validateApplicationUniqueTransitionBudget } from "./materialization";
import { hasApplicationRelationCommitAuthorityForPointCommit } from "../../application/relations/applicationRelationCommit";
import { hasApplicationDocumentOrderedIndexComposition } from "./indexComposition";
import { hasResolvedApplicationRelationSchemaAuthorityDatabase, type ApplicationRelationSchemaAuthority } from "../../application/relations/applicationRelationSchemaAuthority";
import { hasAppSchemaCandidateWriteGuardComposition, type AppSchemaCandidateWriteGuardPlanningHead } from "../catalog/appSchemaCandidateValidation";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../unique/appUniqueConstraintDefinitions";
import type { LocatedAppIndexDefinitionV1 } from "../indexes/appIndexDefinitions";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../../execution/transactionSessionActivation";
import type { ScopePublicationOptions } from "../../commit/publication/scopePublicationModel";
import { enterLogicalDocumentMaterialization, logicalMaterializationError, projectLogicalDocumentMaterializationFailure } from "../documents/logicalDocuments/materialization";
import { captureHostPreparationLifetime, chargeHostPreparation, type PreparedHostPreparationLifetime } from "../../execution/preparation/preparedHostRuntime";
import { isLocatedAppIndexDefinitionV1 } from "../indexes/appIndexDefinitions";
import { isLocatedAppUniqueConstraintDefinitionV1 } from "../unique/appUniqueConstraintDefinitions";
import { hasAppUniqueConstraintDefinitionAuthorityForControlDbV1 } from "../unique/appUniqueConstraintCommitV1";

export type ApplicationParticipantOptions = ApplicationDocumentMaterializationOptions & ScopePublicationOptions;
declare const participantPreparationBrand: unique symbol;
export interface PreparedApplicationParticipant { readonly [participantPreparationBrand]: true }
export interface PreparedApplicationParticipantState {
  readonly lifetime: PreparedHostPreparationLifetime;
  readonly schema: ApplicationRelationSchemaAuthority;
  readonly command: ApplicationDocumentDefinitionCommand;
  readonly intrinsic: readonly LocatedAppIndexDefinitionV1[];
  readonly developer: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly candidate: PreparedPointCommitCandidateSchemaWriteGuard;
  readonly relations: PreparedPointCommitApplicationRelations | null;
  readonly options: ApplicationParticipantOptions;
}

const preparations = new WeakMap<PreparedApplicationParticipant, PreparedApplicationParticipantState>();
const participantDisposal = (token: PreparedApplicationParticipant) => () => { preparations.delete(token); };

export const readPreparedApplicationDocumentParticipant = Effect.fn("ApplicationParticipant.readPreparation")(function* (
  token: PreparedApplicationParticipant,
) {
  const state = preparations.get(token);
  if (state === undefined) return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
  yield* Effect.fromResult(state.lifetime.checkOpen()).pipe(Effect.mapError(cause => logicalMaterializationError("invalidAuthority", cause)));
  return state;
});

const decodeParticipantDeploymentId = Schema.decodeUnknownResult(
  TransactionGrantDeploymentIdV1Schema,
);

/** Source-private document lowering; domain participants retain write authority. */
export const prepareApplicationDocumentParticipant = Effect.fn("ApplicationParticipant.prepare")(
  function* (
    schema: ApplicationRelationSchemaAuthority,
    controlDb: FlarexMetadataDatabase,
    authority: TrustedScopeAuthority,
    ports: PointMutationSessionAuthorityResolutionPortsV1,
    options: ApplicationParticipantOptions,
    tableIds: readonly CatalogTableId[],
    mechanics: Readonly<{ intrinsic: readonly LocatedAppIndexDefinitionV1[]; developer: readonly LocatedAppIndexDefinitionV1[];
      unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
      relations: PreparedPointCommitApplicationRelations | null;
      planningHead: AppSchemaCandidateWriteGuardPlanningHead | undefined }>,
  ) {
    if (
      !hasResolvedApplicationRelationSchemaAuthorityDatabase(schema, controlDb) ||
      !hasApplicationDocumentOrderedIndexComposition(controlDb, options) ||
      !hasAppUniqueConstraintDefinitionAuthorityForControlDbV1(options.uniqueConstraints, controlDb) ||
      options.candidateSchemaWriteGuard === undefined
    ) {
      return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
    }
    const lifetime = yield* captureHostPreparationLifetime();
    if (lifetime === undefined || mechanics.planningHead === undefined)
      return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
    const scope = yield* Effect.fromResult(
      projectScopeIdUuidV1Result(authority.scopeId),
    );
    const deploymentId = yield* Effect.fromResult(
      decodeParticipantDeploymentId(schema.deploymentId),
    );
    const command: ApplicationDocumentDefinitionCommand = Object.freeze({
      authorityPins: Object.freeze({
        deploymentId,
        scopeId: scope.scopeId,
        schemaVersionId: schema.schemaVersionId,
      }),
      rowIntents: Object.freeze(tableIds
        .toSorted((a, b) => a - b)
        .map((tableId) => Object.freeze({ tableId }))),
      candidatePlanningHead: mechanics.planningHead,
    });
    const intrinsic = mechanics.intrinsic;
    const developer = mechanics.developer;
    const unique = mechanics.unique;
    const allowed = new Set(tableIds);
    if (intrinsic.some(definition => !isLocatedAppIndexDefinitionV1(definition) ||
      definition.scopeId !== authority.scopeId || definition.deploymentId !== schema.deploymentId ||
      definition.access.kind !== "by_creation_time" || !allowed.has(definition.access.tableId)) ||
      intrinsic.length !== allowed.size || new Set(intrinsic.map(definition => definition.access.tableId)).size !== allowed.size ||
      developer.some(definition => !isLocatedAppIndexDefinitionV1(definition) ||
      definition.scopeId !== authority.scopeId || definition.deploymentId !== schema.deploymentId ||
      definition.access.kind !== "developer" || !allowed.has(definition.access.tableId)) ||
      unique.some(definition => !isLocatedAppUniqueConstraintDefinitionV1(definition) ||
        definition.scopeId !== authority.scopeId || definition.deploymentId !== schema.deploymentId ||
        definition.schemaVersionId !== schema.schemaVersionId || !allowed.has(definition.tableId)))
      return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
    let previousIndex = 0;
    for (const definition of developer) {
      if (definition.indexDefinitionId <= previousIndex) return yield* Effect.fail(logicalMaterializationError("storedCorruption"));
      previousIndex = definition.indexDefinitionId;
    }
    let previousUnique = 0;
    for (const definition of unique) {
      if (definition.uniqueConstraintDefinitionId <= previousUnique) return yield* Effect.fail(logicalMaterializationError("storedCorruption"));
      previousUnique = definition.uniqueConstraintDefinitionId;
    }
    yield* Effect.fromResult(validateApplicationUniqueTransitionBudget(command.rowIntents, unique))
      .pipe(Effect.mapError(projectLogicalDocumentMaterializationFailure));
    const candidate = yield* prepareCandidateSchemaWriteGuard(
      command,
      {
        hasRelationAuthority: (port) =>
          hasApplicationRelationCommitAuthorityForPointCommit(port, ports),
        hasCandidateGuardAuthority: (port) =>
          hasAppSchemaCandidateWriteGuardComposition(port, ports),
      },
      options,
    );
    if (candidate === null)
      return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
    const relations = schema.relations.length === 0 ? null : mechanics.relations;
    if (
      schema.relations.length > 0 &&
      (relations?.definitions === null ||
        relations === null ||
        options.applicationRelations !== relations.port ||
        !hasApplicationRelationCommitAuthorityForPointCommit(relations.port, ports) ||
        relations.definitions.applicationSchemaSha256 !==
          schema.applicationSchemaSha256 ||
        relations.definitions.schemaManifestSha256 !==
          schema.schemaManifestSha256 ||
        relations.definitions.boundPublicationSha256 !==
          schema.boundPublicationSha256 ||
        relations.definitions.definitions.length !==
          schema.relations.length)
    )
      return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
    yield* chargeHostPreparation({ command: { authorityPins: command.authorityPins, rowIntents: command.rowIntents },
      intrinsicIds: intrinsic.map(definition => definition.indexDefinitionId),
      developerIds: developer.map(definition => definition.indexDefinitionId), uniqueIds: unique.map(definition => definition.uniqueConstraintDefinitionId) })
      .pipe(Effect.mapError(cause => logicalMaterializationError("limitExceeded", cause)));
    // SAFETY: this existing issuer authenticates the inert preparation identity.
    const prepared = Object.freeze({}) as PreparedApplicationParticipant;
    preparations.set(prepared, Object.freeze({
      lifetime,
      schema,
      command,
      intrinsic,
      developer,
      unique,
      candidate,
      relations,
      options,
    }));
    const dispose = participantDisposal(prepared);
    const registered = lifetime.onDispose(dispose);
    if (Result.isFailure(registered)) dispose();
    yield* Effect.fromResult(registered).pipe(Effect.mapError(cause => logicalMaterializationError("limitExceeded", cause)));
    return prepared;
  },
);

/** Application authority and candidate validation remain mandatory at this
 * semantic boundary; the shared kernel owns only transaction-local materialization. */
export const enterApplicationDocumentParticipant = Effect.fn("ApplicationParticipant.enter")(
  function* (
    prepared: PreparedApplicationParticipant, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, scopeClock: ScopeClockRecord, schema: ApplicationRelationSchemaAuthority,
  ) {
    const preparation = yield* readPreparedApplicationDocumentParticipant(prepared);
    const requireAdmission = Effect.suspend(() =>
      preparations.has(prepared) && schema === preparation.schema && authority.scopeId === preparation.command.authorityPins.scopeId
        ? Effect.void : Effect.fail(logicalMaterializationError("invalidAuthority")));
    // Refuse foreign opaque handles before dereferencing their prepared fields.
    yield* requireAdmission;
    return yield* enterLogicalDocumentMaterialization({
      coverage: "activeApplication",
      command: preparation.command, intrinsic: preparation.intrinsic, developer: preparation.developer, unique: preparation.unique,
      relations: preparation.relations, options: preparation.options, requireAdmission,
      validateWrites: (commitSeq, changes) => runCandidateSchemaWriteGuard(tx, preparation.candidate, authority, scopeClock, commitSeq,
        changes.flatMap(row => row.kind === "live" ? [{ tableId: row.tableId, rowId: row.rowId, document: row.document }] : []))
        .pipe(Effect.mapError(projectLogicalDocumentMaterializationFailure)),
    }, tx, authority, scopeClock);
  },
);

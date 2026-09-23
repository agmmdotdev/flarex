import { Effect, Schema } from "effect";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ApplicationDocumentMaterializationOptions, ApplicationDocumentDefinitionCommand,
  PreparedPointCommitCandidateSchemaWriteGuard, PreparedPointCommitApplicationRelations } from "./model";
import { prepareIntrinsicIndexDefinitions, prepareDeveloperIndexDefinitions, prepareUniqueConstraintDefinitions,
  prepareCandidateSchemaWriteGuard, prepareApplicationRelationDefinitions, runCandidateSchemaWriteGuard } from "./materialization";
import { hasApplicationRelationCommitAuthorityForPointCommit } from "../applicationRelationCommit";
import { hasApplicationDocumentOrderedIndexComposition } from "./indexComposition";
import { hasResolvedApplicationRelationSchemaAuthorityDatabase, type ApplicationRelationSchemaAuthority } from "../applicationRelationSchemaAuthority";
import { hasAppSchemaCandidateWriteGuardComposition } from "../appSchemaCandidateValidation";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { ScopeClockRecord } from "../scopeClock";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../transactionSessionActivation";
import type { ScopePublicationOptions } from "../commitPublication/scopePublicationModel";
import { enterLogicalDocumentMaterialization, logicalMaterializationError, projectLogicalDocumentMaterializationFailure } from "../logicalDocuments/materialization";

export type ApplicationParticipantOptions = ApplicationDocumentMaterializationOptions & ScopePublicationOptions;
export interface PreparedApplicationParticipant {
  readonly schema: ApplicationRelationSchemaAuthority;
  readonly command: ApplicationDocumentDefinitionCommand;
  readonly intrinsic: readonly LocatedAppIndexDefinitionV1[];
  readonly developer: readonly LocatedAppIndexDefinitionV1[];
  readonly unique: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly candidate: PreparedPointCommitCandidateSchemaWriteGuard;
  readonly relations: PreparedPointCommitApplicationRelations | null;
  readonly options: ApplicationParticipantOptions;
}

const preparations = new WeakSet<object>();

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
  ) {
    if (
      !hasResolvedApplicationRelationSchemaAuthorityDatabase(schema, controlDb) ||
      !hasApplicationDocumentOrderedIndexComposition(controlDb, options) ||
      options.uniqueConstraints === undefined ||
      options.candidateSchemaWriteGuard === undefined
    ) {
      return yield* Effect.fail(logicalMaterializationError("invalidAuthority"));
    }
    const scope = yield* Effect.fromResult(
      projectScopeIdUuidV1Result(authority.scopeId),
    );
    const deploymentId = yield* Effect.fromResult(
      decodeParticipantDeploymentId(schema.deploymentId),
    );
    const command: ApplicationDocumentDefinitionCommand = {
      authorityPins: {
        deploymentId,
        scopeId: scope.scopeId,
        schemaVersionId: schema.schemaVersionId,
      },
      rowIntents: tableIds
        .toSorted((a, b) => a - b)
        .map((tableId) => ({ tableId })),
    };
    const intrinsic = yield* prepareIntrinsicIndexDefinitions(command, options);
    const developer = yield* prepareDeveloperIndexDefinitions(command, options);
    const unique = yield* prepareUniqueConstraintDefinitions(command, options);
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
    const relations =
      schema.relations.length === 0
        ? null
        : yield* prepareApplicationRelationDefinitions(
            command,
            {
              hasRelationAuthority: (port) =>
                hasApplicationRelationCommitAuthorityForPointCommit(
                  port,
                  ports,
                ),
              hasCandidateGuardAuthority: (port) =>
                hasAppSchemaCandidateWriteGuardComposition(port, ports),
            },
            options,
          );
    if (
      schema.relations.length > 0 &&
      (relations?.definitions === null ||
        relations === null ||
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
    const prepared: PreparedApplicationParticipant = Object.freeze({
      schema,
      command,
      intrinsic,
      developer,
      unique,
      candidate,
      relations,
      options,
    });
    preparations.add(prepared);
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
    const requireAdmission = Effect.suspend(() =>
      preparations.has(prepared) && schema === prepared.schema && authority.scopeId === prepared.command.authorityPins.scopeId
        ? Effect.void : Effect.fail(logicalMaterializationError("invalidAuthority")));
    // Refuse foreign opaque handles before dereferencing their prepared fields.
    yield* requireAdmission;
    return yield* enterLogicalDocumentMaterialization({
      coverage: "activeApplication",
      command: prepared.command, intrinsic: prepared.intrinsic, developer: prepared.developer, unique: prepared.unique,
      relations: prepared.relations, options: prepared.options, requireAdmission,
      validateWrites: (commitSeq, changes) => runCandidateSchemaWriteGuard(tx, prepared.candidate, authority, scopeClock, commitSeq,
        changes.flatMap(row => row.kind === "live" ? [{ tableId: row.tableId, rowId: row.rowId, document: row.document }] : []))
        .pipe(Effect.mapError(projectLogicalDocumentMaterializationFailure)),
    }, tx, authority, scopeClock);
  },
);

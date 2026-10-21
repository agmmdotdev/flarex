import { prepareFiniteApplicationExecutionSchema } from "../../commit/authority/postgresLoader";
import {
  disposePublicationDefinitions,
  preparePublicationDefinitions,
  readPublicationDefinitionPreparationPayload,
} from "../../commit/publication/definitionPreparation";
import {
  disposeFiniteMetadataProjection,
  prepareFiniteMetadataProjection,
  readFiniteMetadataProjectionPreparationPayload,
} from "../../execution/finiteMetadataDependencies";
import {
  chargeHostPreparation,
  registerHostPreparationDisposal,
} from "../../execution/preparation/preparedHostRuntime";
import { prepareLogicalStorageMetadataProjection } from "../../storage/catalog/logicalStorageReadiness";
import { locatePublishedAppIndexDefinitionsEffect } from "../../storage/indexes/appIndexDefinitions";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../../storage/unique/appUniqueConstraintCommitV1";
import { readApplicationMetadataUniqueRequirements } from "../readiness/acceptance";
import { locateApplicationRelationBindingForCommitEffect } from "../relations/binding/Repository";
import type { ActivePreparation } from "./bindingPreparation";
import type { ApplicationActiveSelection, ApplicationExecutableActiveSelection, ApplicationRelationActiveSelectionBasis } from "./contracts";
import type { FlarexMetadataDatabase } from "../deployments";
import type { OriginalSchemaVersionRead } from "../../storage/catalog/schemaVersionArtifacts";
import { readApplicationRelationMetadataUniqueRequirements, type ApplicationRelationPreparationInputs } from "../relations/applicationRelationReadinessFold";
import type { LocatedApplicationRelationBinding } from "../relations/binding/Model";
import { activationError, activationFailure } from "./errors";
import { readApplicationBindingTargetProtection, readApplicationSelectionState } from "./selectionIdentity";
import type { canonicalizeApplicationManifest } from "@flarex/analysis/application-analysis";
import { Effect, type Result, Schema } from "effect";
import {
  MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";

export const prepareApplicationExecutionMetadataProjection = Effect.fn("ApplicationActivation.prepareExecutionMetadataProjection")(function* (
  basis: Readonly<{ manifest: Result.Result.Success<ReturnType<typeof canonicalizeApplicationManifest>>["manifest"];
    runtimeHostIdentity: string; compatibilityDate: string }>,
) {
  return yield* prepareFiniteMetadataProjection({ indexes: [], unique: [], application: {
    functions: basis.manifest.functions.map(fn => ({ path: fn.path, semantic: { ...fn } })),
    groups: [{ group: "legacy_dynamic_worker_v1", semantic: { sourceArtifact: basis.manifest.sourceArtifact,
      runtimeHostIdentity: basis.runtimeHostIdentity, compatibilityDate: basis.compatibilityDate } }],
  } });
});

export const prepareFiniteApplicationSchemaMetadataProjection = Effect.fn("ApplicationActivation.prepareFiniteSchemaMetadataProjection")(
  function* (selection: ApplicationActiveSelection, basis: ApplicationExecutableActiveSelection["basis"]) {
    yield* Effect.fromResult(readApplicationBindingTargetProtection(selection));
    const requirements = basis.physicalRequirements;
    if (requirements.manifest.kind === "appSchema") return yield* prepareLogicalStorageMetadataProjection({
      deploymentId: basis.deploymentId, schemaVersionId: basis.schemaVersionId, profile: "nativeApplication",
    }, requirements, []);
    const selected = readApplicationSelectionState(selection);
    if (selected === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
    const unique = selected.kind === "legacy"
      ? yield* readApplicationMetadataUniqueRequirements(selected.readinessRepository, selected.readiness, basis.schemaVersionId)
      : yield* readApplicationRelationMetadataUniqueRequirements({ repository: selected.readinessRepository, readiness: selected.readiness }, basis.schemaVersionId);
    return yield* prepareLogicalStorageMetadataProjection({ deploymentId: basis.deploymentId,
      schemaVersionId: basis.schemaVersionId, profile: "nativeApplication" }, requirements, unique.members);
  },
);

export const prepareFiniteApplicationMetadataProjections = Effect.fn(function* (selection: ApplicationActiveSelection, prepared: ActivePreparation) {
      const execution = yield* prepareApplicationExecutionMetadataProjection(prepared.basis);
      yield* registerHostPreparationDisposal(() => { disposeFiniteMetadataProjection(execution); });
      const nativeApplication = yield* prepareFiniteApplicationSchemaMetadataProjection(selection, prepared.basis);
      yield* registerHostPreparationDisposal(() => { disposeFiniteMetadataProjection(nativeApplication); });
      const executionPayload = yield* Effect.fromResult(readFiniteMetadataProjectionPreparationPayload(execution));
      const nativePayload = yield* Effect.fromResult(readFiniteMetadataProjectionPreparationPayload(nativeApplication));
      const schema = yield* prepareFiniteApplicationExecutionSchema(prepared.originalControl, prepared.basis);
      const indexes = yield* locatePublishedAppIndexDefinitionsEffect(prepared.originalControl.database,
        prepared.basis.physicalRequirements, prepared.basis.authority.scopeId);
      const deploymentId = yield* Schema.decodeUnknownEffect(TransactionGrantDeploymentIdV1Schema)(prepared.basis.deploymentId)
        .pipe(Effect.mapError(cause => activationError("read", "storedState", prepared.basis.revisionId, false, cause)));
      const unique = yield* createAppUniqueConstraintDefinitionPortV1(prepared.originalControl.database).locate({
        deploymentId, scopeId: decodeReplacementScopeIdV1(prepared.basis.authority.scopeId),
        schemaVersionId: prepared.basis.schemaVersionId, tableIds: schema.stableBindings.map(binding => binding.tableId),
        maximumDefinitions: MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1,
      });
      if (unique === null) return yield* activationFailure("read", "storedState", prepared.basis.revisionId);
      const relations = yield* locateApplicationRelationBindingForCommitEffect(prepared.originalControl.database, {
        deploymentId: prepared.basis.deploymentId, schemaVersionId: prepared.basis.schemaVersionId });
      const definitions = preparePublicationDefinitions(indexes, unique);
      yield* registerHostPreparationDisposal(() => { disposePublicationDefinitions(definitions); });
      yield* chargeHostPreparation(readPublicationDefinitionPreparationPayload(definitions));
      yield* chargeHostPreparation({ execution: executionPayload, nativeApplication: nativePayload, schema });
      yield* chargeHostPreparation({ indexes: indexes.map(index => ({ ...index, createdAt: index.createdAt.getTime() })),
        unique: unique.map(definition => ({ ...definition, createdAt: definition.createdAt.getTime() })),
        relations: relations === null ? null : { ...relations,
          schemaArtifact: { ...relations.schemaArtifact, createdAt: relations.schemaArtifact.createdAt.getTime() } } });
      return Object.freeze({ execution, nativeApplication, schema, publicationDefinitions: Object.freeze({ prepared: definitions, relations }) });
    });

export const prepareCompositeFiniteApplicationMetadataProjections = Effect.fn("ApplicationActivation.prepareCompositeFiniteMetadata")(
  function* (selection: ApplicationActiveSelection, basis: ApplicationRelationActiveSelectionBasis,
    database: FlarexMetadataDatabase, artifact: OriginalSchemaVersionRead,
    inputs: ApplicationRelationPreparationInputs, relations: LocatedApplicationRelationBinding) {
    const execution = yield* prepareApplicationExecutionMetadataProjection(basis);
    yield* registerHostPreparationDisposal(() => { disposeFiniteMetadataProjection(execution); });
    const nativeApplication = yield* prepareFiniteApplicationSchemaMetadataProjection(selection, basis);
    yield* registerHostPreparationDisposal(() => { disposeFiniteMetadataProjection(nativeApplication); });
    const schema = yield* prepareFiniteApplicationExecutionSchema({ database, artifact }, basis);
    const definitions = preparePublicationDefinitions(inputs.indexes, inputs.unique);
    yield* registerHostPreparationDisposal(() => { disposePublicationDefinitions(definitions); });
    yield* chargeHostPreparation(readPublicationDefinitionPreparationPayload(definitions)).pipe(
      Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, { stage: "compositeFiniteDefinitions", cause })));
    yield* chargeHostPreparation({ schema, execution: yield* Effect.fromResult(readFiniteMetadataProjectionPreparationPayload(execution)),
      nativeApplication: yield* Effect.fromResult(readFiniteMetadataProjectionPreparationPayload(nativeApplication)) }).pipe(
        Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, { stage: "compositeFiniteProjections", cause })));
    return Object.freeze({ execution, nativeApplication, schema,
      publicationDefinitions: Object.freeze({ prepared: definitions, relations }) });
  });

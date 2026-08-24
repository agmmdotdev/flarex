import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

import { ApplicationSchemaBindingSha256HexSchema } from
  "flarex-protocol/internal/application-schema-binding";
import {
  RelationOccurrenceSha256,
  RelationOccurrenceSha256Error,
  type RelationOccurrenceSha256Api,
} from "flarex-protocol/internal/relation-occurrence-v1";
import type { TransactionGrantDeploymentIdV1 } from
  "flarex-protocol/transaction-grant";

import {
  applyAppRelationEdgeChangesInTransactionEffect,
  hasIncomingAppRelationEdgeInTransactionEffect,
  type AppRelationEdgeReadError,
  type ApplyAppRelationEdgeChangesResult,
} from "../appRelationEdges";
import {
  locateApplicationRelationBindingForCommitEffect,
  type LocatedApplicationRelationBinding,
} from "../applicationRelationBinding";
import type { AppRowTransaction } from "../appRows";
import type { FlarexMetadataDatabase } from "../deployments";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from
  "../transactionSessionActivation";
import {
  type ApplicationRelationCommitPort,
  ApplicationRelationCommitCorruptionError,
  type ApplicationRelationRowTransition,
  ApplicationRelationCommitUnavailableError,
  type ApplyApplicationRelationCommitEdgesError,
  type ApplyApplicationRelationCommitEdgesInput,
  type LocatedApplicationRelationDefinition,
  type LocatedApplicationRelationDefinitionSet,
  type PrepareApplicationRelationCommitError,
  type PreparedApplicationRelationCommit,
  ApplicationRelationTargetDeleteRestrictedError,
} from "./Model";
import { lowerApplicationRelationCommitResult } from "./Policy";

interface ApplicationRelationCommitPortState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly pointCommitAuthority:
    PointMutationSessionAuthorityResolutionPortsV1;
  readonly occurrenceSha256: RelationOccurrenceSha256Api;
}

const applicationRelationCommitPortStates = new WeakMap<
  object,
  ApplicationRelationCommitPortState
>();
const locatedApplicationRelationDefinitionSetStates = new WeakMap<
  object,
  ApplicationRelationCommitPortState
>();

interface PreparedApplicationRelationCommitState {
  readonly port: ApplicationRelationCommitPortState;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
}

const preparedApplicationRelationCommitStates = new WeakMap<
  object,
  PreparedApplicationRelationCommitState
>();

const webCryptoRelationOccurrenceSha256 = RelationOccurrenceSha256.of({
  digest: (bytes) => Effect.tryPromise({
    try: async () => new Uint8Array(await globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: (cause) => new RelationOccurrenceSha256Error({
      operation: "digest",
      cause,
    }),
  }),
});

/** Control-catalog adapter for C09's private point-commit composition. */
export function createApplicationRelationCommitPort(
  controlDb: FlarexMetadataDatabase,
  pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1,
): ApplicationRelationCommitPort {
  const state = Object.freeze({
    controlDb,
    pointCommitAuthority,
    occurrenceSha256: webCryptoRelationOccurrenceSha256,
  });
  const locate: ApplicationRelationCommitPort["locate"] = Effect.fn(
    "ApplicationRelationCommit.locate",
  )(function* (input) {
    const located = yield* locateApplicationRelationBindingForCommitEffect(
      controlDb,
      input,
    );
    if (located === null) return null;
    const projected = yield* Effect.fromResult(
      projectLocatedApplicationRelationDefinitionSetResult(
        located,
        input.deploymentId,
      ),
    );
    locatedApplicationRelationDefinitionSetStates.set(projected, state);
    return projected;
  });
  const port = Object.freeze({ locate });
  const declaredControlDb = Object.getOwnPropertyDescriptor(
    pointCommitAuthority,
    "applicationControlDb",
  );
  if (
    declaredControlDb === undefined ||
    (
      Object.hasOwn(declaredControlDb, "value") &&
      declaredControlDb.value === controlDb
    )
  ) {
    applicationRelationCommitPortStates.set(port, state);
  }
  return port;
}

/** Process-local private authority check; structural copies fail closed. */
export function hasApplicationRelationCommitAuthority(
  value: unknown,
): value is ApplicationRelationCommitPort {
  return typeof value === "object" && value !== null &&
    applicationRelationCommitPortStates.has(value);
}

/** Exact control-catalog composition check for the private C09 capability. */
export function hasApplicationRelationCommitAuthorityForControlDb(
  value: unknown,
  controlDb: FlarexMetadataDatabase,
): value is ApplicationRelationCommitPort {
  return typeof value === "object" && value !== null &&
    applicationRelationCommitPortStates.get(value)?.controlDb === controlDb;
}

/** Exact same-factory check used by the existing point-commit owner. */
export function hasApplicationRelationCommitAuthorityForPointCommit(
  value: unknown,
  pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1,
): value is ApplicationRelationCommitPort {
  return typeof value === "object" && value !== null &&
    applicationRelationCommitPortStates.get(value)?.pointCommitAuthority ===
      pointCommitAuthority;
}

/** Exact same-factory check for a located R02 definition set. */
export function hasLocatedApplicationRelationDefinitionSetAuthority(
  port: ApplicationRelationCommitPort,
  value: unknown,
): value is LocatedApplicationRelationDefinitionSet {
  if (typeof value !== "object" || value === null) return false;
  const portState = applicationRelationCommitPortStates.get(port);
  return portState !== undefined &&
    locatedApplicationRelationDefinitionSetStates.get(value) === portState;
}

/**
 * Same-factory preparation wrapper. Only its result can cross the private C09
 * write boundary; the lowerer remains a genuinely pure policy function.
 */
export function prepareApplicationRelationCommitResult(
  definitions: LocatedApplicationRelationDefinitionSet,
  transitionsInput: ReadonlyArray<ApplicationRelationRowTransition>,
): Result.Result<
  PreparedApplicationRelationCommit,
  PrepareApplicationRelationCommitError
> {
  const state = locatedApplicationRelationDefinitionSetStates.get(definitions);
  if (state === undefined) {
    return Result.fail(commitCorruption("invalidDefinitionSet"));
  }
  return lowerApplicationRelationCommitResult(
    definitions,
    transitionsInput,
  ).pipe(Result.map((prepared) => {
    preparedApplicationRelationCommitStates.set(prepared, Object.freeze({
      port: state,
      definitions,
    }));
    return prepared;
  }));
}

/**
 * Same-factory one-definition view used only by the E01 physical builder.
 * The original located set remains the authority; callers cannot construct or
 * filter a structurally similar set and cross this boundary.
 */
export function prepareApplicationRelationDefinitionBuildResult(
  definitions: LocatedApplicationRelationDefinitionSet,
  edgeDefinitionId: LocatedApplicationRelationDefinition["edge"]["edgeDefinitionId"],
  transitionsInput: ReadonlyArray<ApplicationRelationRowTransition>,
): Result.Result<
  PreparedApplicationRelationCommit,
  PrepareApplicationRelationCommitError
> {
  const state = locatedApplicationRelationDefinitionSetStates.get(definitions);
  if (state === undefined) {
    return Result.fail(commitCorruption("invalidDefinitionSet"));
  }
  const matches = definitions.definitions.filter((definition) =>
    definition.edge.edgeDefinitionId === edgeDefinitionId
  );
  const definition = matches[0];
  if (definition === undefined || matches.length !== 1) {
    return Result.fail(commitCorruption("invalidDefinitionSet"));
  }
  const narrowed = Object.freeze({
    ...definitions,
    definitions: Object.freeze([definition]),
  });
  locatedApplicationRelationDefinitionSetStates.set(narrowed, state);
  return prepareApplicationRelationCommitResult(narrowed, transitionsInput);
}

function projectLocatedApplicationRelationDefinitionSetResult(
  located: LocatedApplicationRelationBinding,
  deploymentId: TransactionGrantDeploymentIdV1,
): Result.Result<
  LocatedApplicationRelationDefinitionSet,
  ApplicationRelationCommitCorruptionError
> {
  return Result.gen(function* () {
    if (located.deploymentId !== deploymentId) {
      return yield* Result.fail(commitCorruption("invalidDefinitionSet"));
    }
    const semantics = new Map(located.binding.semanticDefinitions.map(
      (semantic) => [semantic.relationId, semantic] as const,
    ));
    const edges = new Map(located.binding.edgeDefinitions.map(
      (edge) => [edge.edgeDefinitionId, edge] as const,
    ));
    const definitions: LocatedApplicationRelationDefinition[] = [];
    for (const binding of located.binding.relationBindings) {
      const semantic = semantics.get(binding.relationId);
      const edge = edges.get(binding.edgeDefinitionId);
      if (
        semantic === undefined || edge === undefined ||
        semantic.semanticDefinitionSha256 !==
          binding.semanticDefinitionSha256 ||
        semantic.definition.relationId !== binding.relationId ||
        semantic.definition.sourceTableId !== binding.sourceTableId ||
        semantic.definition.targetTableId !== binding.targetTableId ||
        edge.definition.sourceTableId !== binding.sourceTableId ||
        edge.definition.targetTableId !== binding.targetTableId
      ) {
        return yield* Result.fail(commitCorruption("invalidDefinitionSet"));
      }
      definitions.push(Object.freeze({
        binding,
        semantic: semantic.definition,
        edge: Object.freeze({
          relationId: binding.relationId,
          edgeDefinitionId: binding.edgeDefinitionId,
          physical: edge.definition,
        }),
      }));
    }
    if (definitions.length !== located.binding.relationBindings.length) {
      return yield* Result.fail(commitCorruption("invalidDefinitionSet"));
    }
    return Object.freeze({
      deploymentId,
      schemaVersionId: located.schemaVersionId,
      applicationSchemaSha256: located.binding.applicationSchemaSha256,
      schemaManifestSha256: located.binding.schemaManifestSha256,
      boundPublicationSha256: ApplicationSchemaBindingSha256HexSchema.make(
        encodeBytesToLowercaseHex(located.boundPublicationSha256),
      ),
      definitions: Object.freeze(definitions),
    });
  });
}

/** Runtime check used by the transaction owner before validating targets. */
export function hasPreparedApplicationRelationCommitAuthority(
  port: ApplicationRelationCommitPort,
  prepared: unknown,
  schemaVersionId: LocatedApplicationRelationDefinitionSet["schemaVersionId"],
): prepared is PreparedApplicationRelationCommit {
  if (typeof prepared !== "object" || prepared === null) return false;
  const portState = applicationRelationCommitPortStates.get(port);
  const preparedState = preparedApplicationRelationCommitStates.get(prepared);
  return portState !== undefined && preparedState?.port === portState &&
    preparedState.definitions.schemaVersionId === schemaVersionId;
}

/** Applies C09's already-lowered batch through the exact S12 aggregate. */
export const applyApplicationRelationCommitEdgesInTransactionEffect = Effect.fn(
  "ApplicationRelationCommit.applyEdgesInTransaction",
)(function* (
  port: ApplicationRelationCommitPort,
  tx: AppRowTransaction,
  input: ApplyApplicationRelationCommitEdgesInput,
): Effect.fn.Return<
  ApplyAppRelationEdgeChangesResult,
  ApplyApplicationRelationCommitEdgesError
> {
  const state = applicationRelationCommitPortStates.get(port);
  if (
    state === undefined ||
    !hasPreparedApplicationRelationCommitAuthority(
      port,
      input.prepared,
      input.schemaVersionId,
    )
  ) {
    return yield* Effect.fail(new ApplicationRelationCommitUnavailableError({
      reason: "compositionMissing",
    }));
  }
  return yield* applyAppRelationEdgeChangesInTransactionEffect(
    tx,
    {
      scopeId: input.scopeId,
      schemaVersionId: input.schemaVersionId,
      commitSeq: input.commitSeq,
      actions: input.prepared.actions,
    },
  ).pipe(
    Effect.provideService(
      RelationOccurrenceSha256,
      state.occurrenceSha256,
    ),
  );
});

export const assertApplicationRelationRestrictProbesInTransactionEffect =
  Effect.fn(
    "ApplicationRelationCommit.assertRestrictProbesInTransaction",
  )(function* (
    port: ApplicationRelationCommitPort,
    tx: AppRowTransaction,
    scopeId: ApplyApplicationRelationCommitEdgesInput["scopeId"],
    prepared: PreparedApplicationRelationCommit,
  ): Effect.fn.Return<
    void,
    | ApplicationRelationCommitUnavailableError
    | ApplicationRelationTargetDeleteRestrictedError
    | AppRelationEdgeReadError
  > {
    const preparedState = preparedApplicationRelationCommitStates.get(prepared);
    const state = applicationRelationCommitPortStates.get(port);
    if (state === undefined || preparedState?.port !== state) {
      return yield* Effect.fail(
        new ApplicationRelationCommitUnavailableError({
          reason: "compositionMissing",
        }),
      );
    }
    for (const probe of prepared.restrictProbes) {
      const hasIncoming = yield* hasIncomingAppRelationEdgeInTransactionEffect(
        tx,
        {
          scopeId,
          definition: probe.definition,
          targetRowId: probe.targetRowId,
        },
      );
      if (hasIncoming) {
        return yield* Effect.fail(
          new ApplicationRelationTargetDeleteRestrictedError({
            relationId: probe.relationId,
            targetDocumentId: probe.targetDocumentId,
          }),
        );
      }
    }
  });

function commitCorruption(
  reason: ApplicationRelationCommitCorruptionError["reason"],
  cause?: unknown,
): ApplicationRelationCommitCorruptionError {
  return new ApplicationRelationCommitCorruptionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

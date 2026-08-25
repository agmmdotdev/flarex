import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "../deployments";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from
  "../transactionSessionActivation";
import {
  hasApplicationRelationCommitAuthorityForControlDb,
  hasApplicationRelationCommitAuthorityForPointCommit,
  hasLocatedApplicationRelationDefinitionSetAuthority,
  prepareApplicationRelationReadOverlayResult,
  type ApplicationRelationCommitPort,
  type LocatedApplicationRelationDefinition,
  type LocatedApplicationRelationDefinitionSet,
} from "../applicationRelationCommit";
import {
  getApplicationRelationReadinessFoldDefinitionAuthority,
  hasApplicationRelationReadinessFoldAuthorityFor,
  type ApplicationRelationReadinessFoldRepository,
} from "../applicationRelationReadinessFold";
import {
  type ApplicationRelationReadCapability,
  type ApplicationRelationReadPort,
  ApplicationRelationReadUnavailableError,
  makeApplicationRelationReadCapability,
  type ResolveApplicationRelationReadCapabilityInput,
  type ResolvedApplicationRelationReadCapability,
} from "./Model";

interface ApplicationRelationReadPortState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly definitions: ApplicationRelationCommitPort;
  readonly readiness: ApplicationRelationReadinessFoldRepository;
}

interface ApplicationRelationReadCapabilityState {
  readonly port: ApplicationRelationReadPortState;
  readonly deploymentId: ResolveApplicationRelationReadCapabilityInput[
    "deploymentId"
  ];
  readonly scopeId: ResolveApplicationRelationReadCapabilityInput["scopeId"];
  readonly schemaVersionId: ResolveApplicationRelationReadCapabilityInput[
    "schemaVersionId"
  ];
  readonly definitions: LocatedApplicationRelationDefinitionSet;
  readonly definition: LocatedApplicationRelationDefinition;
  readonly storageGenerationFence:
    ResolvedApplicationRelationReadCapability["storageGenerationFence"];
  readonly epoch: ResolvedApplicationRelationReadCapability["epoch"];
}

const portStates = new WeakMap<object, ApplicationRelationReadPortState>();
const capabilityStates = new WeakMap<
  object,
  ApplicationRelationReadCapabilityState
>();

export function createApplicationRelationReadPort(
  controlDb: FlarexMetadataDatabase,
  authority: PointMutationSessionAuthorityResolutionPortsV1,
  definitions: ApplicationRelationCommitPort,
  readiness: ApplicationRelationReadinessFoldRepository,
): ApplicationRelationReadPort {
  const state = Object.freeze({ controlDb, authority, definitions, readiness });
  const compositionIsExact = () =>
    hasApplicationRelationCommitAuthorityForControlDb(definitions, controlDb) &&
    hasApplicationRelationCommitAuthorityForPointCommit(definitions, authority);

  const prepare: ApplicationRelationReadPort["prepare"] = Effect.fn(
    "ApplicationRelationRead.prepare",
  )(function* (input) {
    if (!compositionIsExact()) {
      return yield* unavailable("invalidComposition");
    }
    if (
      !hasApplicationRelationReadinessFoldAuthorityFor(
        readiness,
        input.readiness,
        controlDb,
        input.deploymentId,
      )
    ) {
      return yield* unavailable("readinessUnavailable");
    }
    const definitionAuthority =
      getApplicationRelationReadinessFoldDefinitionAuthority(
      readiness,
      input.readiness,
    );
    if (definitionAuthority === null) {
      return yield* unavailable("definitionSetUnavailable");
    }
    const located = definitionAuthority.definitions;
    if (
      !hasLocatedApplicationRelationDefinitionSetAuthority(
        definitions,
        located,
      ) ||
      located.definitions.length !== input.readiness.relationCount
    ) {
      return yield* unavailable("definitionSetUnavailable");
    }
    const matches = located.definitions.filter((definition) =>
      definition.binding.relationId === input.relationId
    );
    const definition = matches[0];
    if (definition === undefined || matches.length !== 1) {
      return yield* unavailable("definitionNotFound");
    }
    yield* Effect.fromResult(prepareApplicationRelationReadOverlayResult(
      located,
      definition.edge.edgeDefinitionId,
      Object.freeze([]),
    ).pipe(
      Result.mapError(() => unavailableValue("definitionNotEligible")),
    ));
    const capability = makeApplicationRelationReadCapability();
    capabilityStates.set(capability, Object.freeze({
      port: state,
      deploymentId: input.deploymentId,
      scopeId: input.readiness.scopeId,
      schemaVersionId: input.readiness.schemaVersionId,
      definitions: located,
      definition,
      storageGenerationFence: definitionAuthority.storageGenerationFence,
      epoch: definitionAuthority.epoch,
    }));
    return capability;
  });

  const resolve: ApplicationRelationReadPort["resolve"] = (
    capability,
    input,
  ) => resolveCapabilityResult(state, capability, input);

  const lowerOverlay: ApplicationRelationReadPort["lowerOverlay"] = (
    capability,
    input,
    transitions,
  ) => resolveCapabilityResult(state, capability, input).pipe(
    Result.flatMap((resolved) =>
      prepareApplicationRelationReadOverlayResult(
        resolved.definitions,
        resolved.definition.edge.edgeDefinitionId,
        transitions,
      )
    ),
  );

  const port = Object.freeze({ readiness, prepare, resolve, lowerOverlay });
  if (compositionIsExact()) portStates.set(port, state);
  return port;
}

export function hasApplicationRelationReadPortAuthorityForControlDb(
  value: unknown,
  controlDb: FlarexMetadataDatabase,
): value is ApplicationRelationReadPort {
  return typeof value === "object" && value !== null &&
    portStates.get(value)?.controlDb === controlDb;
}

export function hasApplicationRelationReadPortAuthorityForPointCommit(
  value: unknown,
  authority: PointMutationSessionAuthorityResolutionPortsV1,
): value is ApplicationRelationReadPort {
  return typeof value === "object" && value !== null &&
    portStates.get(value)?.authority === authority;
}

function resolveCapabilityResult(
  expectedPort: ApplicationRelationReadPortState,
  capability: ApplicationRelationReadCapability,
  input: ResolveApplicationRelationReadCapabilityInput,
): Result.Result<
  ResolvedApplicationRelationReadCapability,
  ApplicationRelationReadUnavailableError
> {
  const state = capabilityStates.get(capability);
  if (
    state?.port !== expectedPort ||
    state.deploymentId !== input.deploymentId ||
    state.scopeId !== input.scopeId ||
    state.schemaVersionId !== input.schemaVersionId
  ) {
    return Result.fail(unavailableValue("capabilityMismatch"));
  }
  return Result.succeed(Object.freeze({
    definition: state.definition,
    definitions: state.definitions,
    storageGenerationFence: state.storageGenerationFence,
    epoch: state.epoch,
  }));
}

function unavailable(
  reason: ApplicationRelationReadUnavailableError["reason"],
): Effect.Effect<never, ApplicationRelationReadUnavailableError> {
  return Effect.fail(unavailableValue(reason));
}

function unavailableValue(
  reason: ApplicationRelationReadUnavailableError["reason"],
): ApplicationRelationReadUnavailableError {
  return new ApplicationRelationReadUnavailableError({ reason });
}

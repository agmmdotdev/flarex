import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "../deployments";
import {
  applicationRelationActiveSelectionMatchesSnapshot,
  claimApplicationRelationActiveSelection,
  validateApplicationRelationActiveSelectionForReadiness,
  validateApplicationRelationActiveSelectionInTransaction,
  type ApplicationActiveSelection,
  type ApplicationRelationActiveSelectionSnapshot,
  type AcceptedApplicationBinding,
  readAcceptedApplicationBinding,
} from "../applicationActivation";
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
  type ApplicationRelationReadinessFoldRepository,
  type ApplicationRelationReadinessActivationBasis,
} from "../applicationRelationReadinessFold";
import type { AppRowTransaction } from "../appRows";
import type { ScopeClockRecord } from "../scopeClock";
import {
  type ApplicationRelationSourceReference,
  type ApplicationRelationReadCapability,
  type ApplicationRelationReadPort,
  ApplicationRelationReadUnavailableError,
  makeApplicationRelationReadCapability,
  type ResolveApplicationRelationReadCapabilityInput,
  type ResolvedApplicationRelationReadCapability,
  type ValidatedApplicationRelationReadCapability,
} from "./Model";

interface ApplicationRelationReadPortState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly definitions: ApplicationRelationCommitPort;
  readonly readiness: ApplicationRelationReadinessFoldRepository;
}

interface ApplicationRelationReadCapabilityState {
  readonly port: ApplicationRelationReadPortState;
  readonly acceptance: Readonly<{ kind: "standalone"; selection: ApplicationActiveSelection;
    selectionSnapshot: ApplicationRelationActiveSelectionSnapshot }> | Readonly<{
      kind: "transaction"; binding: AcceptedApplicationBinding; tx: AppRowTransaction; clock: ScopeClockRecord }>;
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
  )(input => prepareCapability(
    state,
    compositionIsExact,
    input,
    definition => definition.binding.relationId === input.relationId,
  ));

  const prepareBySource: ApplicationRelationReadPort["prepareBySource"] =
    Effect.fn(
      "ApplicationRelationRead.prepareBySource",
    )(input => prepareCapability(
      state,
      compositionIsExact,
      input,
      definition => relationSourceMatches(
        definition,
        input.relation,
      ),
    ));

  const resolve: ApplicationRelationReadPort["resolve"] = (
    capability,
    input,
  ) => resolveCapabilityStateResult(state, capability, input).pipe(
    Result.map(resolvedCapabilityFromState),
  );

  const prepareAcceptedBySource: ApplicationRelationReadPort["prepareAcceptedBySource"] = Effect.fn(
    "ApplicationRelationRead.prepareAcceptedBySource",
  )(function* (input) {
    if (!compositionIsExact()) return yield* unavailable("invalidComposition");
    const active = yield* Effect.fromResult(readAcceptedApplicationBinding(input.binding, input.tx, input.clock, readiness));
    if (active.deploymentId !== input.deploymentId) return yield* unavailable("capabilityMismatch");
    return yield* issueCapability(state, input.deploymentId, active,
      { kind: "transaction", binding: input.binding, tx: input.tx, clock: { ...input.clock } },
      definition => relationSourceMatches(definition, input.relation));
  });

  const validateInTransaction: ApplicationRelationReadPort[
    "validateInTransaction"
  ] = Effect.fn(
    "ApplicationRelationRead.validateInTransaction",
  )(function* (capability, input, tx, currentClock) {
    const capabilityState = yield* Effect.fromResult(
      resolveCapabilityStateResult(state, capability, input),
    );
    const acceptance = capabilityState.acceptance;
    const active = acceptance.kind === "transaction"
      ? yield* Effect.fromResult(readAcceptedApplicationBinding(acceptance.binding, tx, currentClock, readiness))
      : yield* validateApplicationRelationActiveSelectionInTransaction(acceptance.selection, tx, currentClock);
    if (acceptance.kind === "standalone" && !applicationRelationActiveSelectionMatchesSnapshot(
      active, acceptance.selectionSnapshot,
    )) {
      return yield* unavailable("capabilityMismatch");
    }
    return Object.freeze({
      activeSelection: Object.freeze({
        activationSequence: active.activationSequence,
        activeHeadSha256: new Uint8Array(active.headSha256),
      }),
    } satisfies ValidatedApplicationRelationReadCapability);
  });

  const lowerOverlay: ApplicationRelationReadPort["lowerOverlay"] = (
    capability,
    input,
    transitions,
  ) => resolveCapabilityStateResult(state, capability, input).pipe(
    Result.map(resolvedCapabilityFromState),
    Result.flatMap((resolved) =>
      prepareApplicationRelationReadOverlayResult(
        resolved.definitions,
        resolved.definition.edge.edgeDefinitionId,
        transitions,
      )
    ),
  );

  const port = Object.freeze({
    readiness,
    prepare,
    prepareBySource,
    prepareAcceptedBySource,
    resolve,
    validateInTransaction,
    lowerOverlay,
  });
  if (compositionIsExact()) portStates.set(port, state);
  return port;
}

const prepareCapability = Effect.fn(
  "ApplicationRelationRead.prepareCapability",
)(function* (
  state: ApplicationRelationReadPortState,
  compositionIsExact: () => boolean,
  input: Readonly<{
    readonly deploymentId: ApplicationRelationReadCapabilityState["deploymentId"];
    readonly selection: ApplicationActiveSelection;
  }>,
  matchesDefinition: (
    definition: LocatedApplicationRelationDefinition,
  ) => boolean,
) {
  if (!compositionIsExact()) {
    return yield* unavailable("invalidComposition");
  }
  const { readiness, authority } = state;
  const active = yield* validateApplicationRelationActiveSelectionForReadiness(
    readiness,
    input.selection,
    input.deploymentId,
    {
      scopeMetadata: authority.scopeMetadata,
      provisioningReceipts: authority.provisioningReceipts,
      scopeClockTargets: authority.scopeSessionTargets,
    },
  );
  const selectionSnapshot = yield* Effect.fromResult(
    claimApplicationRelationActiveSelection(input.selection),
  );
  return yield* issueCapability(state, input.deploymentId, active,
    { kind: "standalone", selection: input.selection, selectionSnapshot }, matchesDefinition);
});

const issueCapability = Effect.fn("ApplicationRelationRead.issueCapability")(function* (
  state: ApplicationRelationReadPortState, deploymentId: ApplicationRelationReadCapabilityState["deploymentId"],
  active: ApplicationRelationReadinessActivationBasis, acceptance: ApplicationRelationReadCapabilityState["acceptance"],
  matchesDefinition: (definition: LocatedApplicationRelationDefinition) => boolean,
) {
  const { definitions } = state;
  const located = active.definitions;
  if (
    !hasLocatedApplicationRelationDefinitionSetAuthority(
      definitions,
      located,
    ) ||
    located.definitions.length !== active.relationCount
  ) {
    return yield* unavailable("definitionSetUnavailable");
  }
  const matches = located.definitions.filter(matchesDefinition);
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
    acceptance,
    deploymentId,
    scopeId: active.authority.scopeId,
    schemaVersionId: active.schemaVersionId,
    definitions: located,
    definition,
    storageGenerationFence: active.authority.storageGenerationFence,
    epoch: active.authority.epoch,
  }));
  return capability;
});

function relationSourceMatches(
  definition: LocatedApplicationRelationDefinition,
  relation: ApplicationRelationSourceReference,
): boolean {
  const expected = definition.semantic.declaration.source;
  const actual = relation.source;
  return expected.table === actual.table &&
    expected.path.length === actual.path.length &&
    expected.path.every((segment, index) => {
      const candidate = actual.path[index];
      return candidate !== undefined && candidate.kind === segment.kind &&
        candidate.name === segment.name;
    });
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

function resolveCapabilityStateResult(
  expectedPort: ApplicationRelationReadPortState,
  capability: ApplicationRelationReadCapability,
  input: ResolveApplicationRelationReadCapabilityInput,
): Result.Result<
  ApplicationRelationReadCapabilityState,
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
  if (state.acceptance.kind === "transaction") {
    const { binding, tx, clock } = state.acceptance;
    return readAcceptedApplicationBinding(binding, tx, clock, expectedPort.readiness).pipe(
      Result.mapError(() => unavailableValue("capabilityMismatch")), Result.map(() => state));
  }
  return Result.succeed(state);
}

function resolvedCapabilityFromState(
  state: ApplicationRelationReadCapabilityState,
): ResolvedApplicationRelationReadCapability {
  return Object.freeze({
    definition: state.definition,
    definitions: state.definitions,
    storageGenerationFence: state.storageGenerationFence,
    epoch: state.epoch,
  });
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

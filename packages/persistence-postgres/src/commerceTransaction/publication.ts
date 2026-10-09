import { acceptCommercePublication, publishCommerceAtoms } from "./publicationBoundary";
import type { CanonicalJsonOutcome } from "../jsonOutcome";
import { fxSystemFrameworkInitializations } from "../frameworkSchema/installation/initializationSchema";
import { fxSystemLogicalSourceInitializations } from "../logicalStorageInitialization";
import { requireCommerceAdmission, requireCommercePublication, type CommerceAdmission } from "./admission";
import { consumeCommerceRows, type CommerceRowClosure } from "./store";
import { commerceError, type CommerceTransactionError } from "./model";
import type { BoundedRequestLifetime } from "../boundedRequestLifetime";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { Effect } from "effect";
import { projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";
import { type ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";
import { allocateScopePublicationResult, readScopePublicationDatabaseTime, writeScopePublicationPrefix,
  beginScopePublicationPrefix,
  advanceScopePublicationClock, reproveScopePublicationPrefix, type ScopePublicationPrefixProof } from "../commitPublication/publication";
import type { ScopePublicationContribution, ScopePublicationKernel, ScopePublicationOptions } from "../commitPublication/scopePublicationModel";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { appendDerivedCommerceIdEvents, consumeCommerceEvents,
  type CommerceEventClosure } from "../atomicCommerce/events";
import { consumeLogicalCommerceClosure, prepareLogicalCommerceContribution, type LogicalCommerceClosure } from "./logicalParticipant";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../scopeClock";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { ScopeClockRecord } from "../scopeClock";
import type { DataBindingHeadToken } from "../frameworkSchema/binding/model";

/** Authenticated domain contribution; allocation and settlement belong to the root. */
export const consumeCommerceContribution = Effect.fn("CommerceCommit.consumeContribution")(function* (
 admission: CommerceAdmission, lifetime: BoundedRequestLifetime<CommerceTransactionError>, closure: CommerceRowClosure,
) {
 const state = yield* requireCommerceAdmission(admission);
 yield* requireCommercePublication(admission);
 const facts = yield* consumeCommerceRows(closure, admission, lifetime);
 return facts.map(fact => ({ ...fact, installationSha256: state.reference.installation.installationSha256, artifactSha256: state.descriptor.artifact.identity.artifactSha256 }));
});

type CommerceCommitInput = Readonly<{ kind: "logical"; closure: LogicalCommerceClosure;
  initialization?: Readonly<{ stepId: string; datasetSha256: string; expectedRowCount: number; contractSha256: string }> }> |
  Readonly<{ kind: "physical"; admission: CommerceAdmission; closure: CommerceRowClosure;
    additional: readonly Readonly<{ admission: CommerceAdmission; closure: CommerceRowClosure }>[];
    events?: CommerceEventClosure }> |
  Readonly<{ kind: "atomic"; factLimit: number; participants: readonly (Readonly<{ kind: "physical"; admission: CommerceAdmission; closure: CommerceRowClosure }> |
    Readonly<{ kind: "logical"; closure: LogicalCommerceClosure }>)[]; events?: CommerceEventClosure }>;

type CommonState = Readonly<{ tx: FlarexMetadataTransaction; authority: TrustedScopeAuthority; clock: ScopeClockRecord;
  head: DataBindingHeadToken | null }>;

/** Mixed participants are authenticated against one transaction, binding and
 * scope clock before any materialization or publication is allowed. */
const prepareAtomicContribution = Effect.fn("CommerceCommit.prepareAtomic")(function* (
  input: Extract<CommerceCommitInput, { kind: "atomic" }>, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  let root: CommonState | undefined;
  let publicationClock: ScopeClockRecord | undefined;
  const facts: Effect.Success<ReturnType<typeof consumeCommerceContribution>> = [];
  const logical: Effect.Success<ReturnType<typeof consumeLogicalCommerceClosure>>[] = [];
  for (const member of input.participants) {
    const closed = member.kind === "logical" ? yield* consumeLogicalCommerceClosure(member.closure, lifetime) : undefined;
    const state = member.kind === "physical" ? yield* requireCommerceAdmission(member.admission) : closed?.state;
    if (state === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    if (root === undefined) root = state;
    else if (state.tx !== root.tx || state.authority !== root.authority || state.clock !== root.clock ||
      state.head === null || root.head === null || !sameBindingValue(state.head, root.head))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    if (member.kind === "physical") {
      if ((yield* requireCommerceAdmission(member.admission)).bootstrap) return yield* Effect.fail(commerceError("invalidAuthority"));
      const entered = yield* requireCommercePublication(member.admission);
      if (publicationClock !== undefined && publicationClock !== entered)
        return yield* Effect.fail(commerceError("invalidAuthority"));
      publicationClock = entered;
      facts.push(...yield* consumeCommerceContribution(member.admission, lifetime, member.closure));
    } else {
      if (closed === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      logical.push(closed);
    }
  }
  if (root === undefined || root.head === null) return yield* Effect.fail(commerceError("invalidAuthority"));
  const hasReplacement = logical.some(member => member.changes.referenceReplacements.length !== 0);
  return { state: root, publicationClock, facts, logical,
    events: input.events === undefined || hasReplacement ? undefined : yield* consumeCommerceEvents(input.events, lifetime),
    deferredEvents: hasReplacement ? input.events : undefined };
});

const preparePhysicalContribution = Effect.fn("CommerceCommit.preparePhysical")(function* (
  input: Extract<CommerceCommitInput, { kind: "physical" }>, lifetime: BoundedRequestLifetime<CommerceTransactionError>,
) {
  const { admission, closure, additional, events } = input;
  const state = yield* requireCommerceAdmission(admission);
  const publicationClock = yield* requireCommercePublication(admission);
  const facts = yield* consumeCommerceContribution(admission, lifetime, closure);
  for (const member of additional) {
    const participant = yield* requireCommerceAdmission(member.admission);
    if ((yield* requireCommercePublication(member.admission)) !== publicationClock)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    if (state.bootstrap || participant.bootstrap || participant.tx !== state.tx || participant.clock !== state.clock ||
      participant.authority !== state.authority || participant.head === null || state.head === null ||
      !sameBindingValue(participant.head, state.head)) return yield* Effect.fail(commerceError("invalidAuthority"));
    facts.push(...yield* consumeCommerceContribution(member.admission, lifetime, member.closure));
  }
  return { state, publicationClock, facts,
    events: events === undefined ? undefined : yield* consumeCommerceEvents(events, lifetime) };
});

/** One allocation/outcome publisher for both admitted storage representations.
 * Logical participants lower pending rows; retained physical consumers supply
 * already-executed row facts. Neither representation owns settlement. */
export const finalizeCommerceCommit = Effect.fn("CommerceCommit.finalize")(function* (
  input: CommerceCommitInput,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>,
  identity: ResolveCommittedPointOutcomeInputV1,
  result: CanonicalJsonOutcome,
  resultSha256: Uint8Array,
  options: ScopePublicationOptions = {},
): Effect.fn.Return<CommitSeq, CommerceTransactionError> {
  if (!lifetime.isClosing()) return yield* Effect.fail(commerceError("invalidAuthority"));
  const physical = input.kind === "physical" ? yield* preparePhysicalContribution(input, lifetime) : undefined;
  const logical = input.kind === "logical" ? yield* consumeLogicalCommerceClosure(input.closure, lifetime) : undefined;
  const atomic = input.kind === "atomic" ? yield* prepareAtomicContribution(input, lifetime) : undefined;
  const state = physical?.state ?? logical?.state ?? atomic?.state;
  if (state === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const publicationClock = physical?.publicationClock ?? atomic?.publicationClock ?? (yield* lockScopeClockForOrdinaryWriteInTransactionEffect(state.tx, state.authority.scopeId)
    .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause))));
  if (publicationClock.scopeId !== state.clock.scopeId || publicationClock.epoch !== state.clock.epoch ||
      publicationClock.storageGeneration !== state.clock.storageGeneration || publicationClock.storageGenerationFence !== state.clock.storageGenerationFence ||
      publicationClock.oldestAvailableCommitSeq !== state.clock.oldestAvailableCommitSeq || publicationClock.lastCommitSeq < state.clock.lastCommitSeq)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(publicationClock.epoch)).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  if (identity.scopeUuid !== scope.scopeUuid) return yield* Effect.fail(commerceError("invalidAuthority"));
  const logicalMembers = logical === undefined ? atomic?.logical ?? [] : [logical];
  const deltas = yield* Effect.forEach(logicalMembers, member => prepareLogicalCommerceContribution(
    member, publicationClock, input.kind === "atomic" && atomic?.deferredEvents !== undefined));
  const replacements = deltas.filter(delta => delta.hasReferenceReplacement);
  if (replacements.length > 1) return yield* Effect.fail(commerceError("invalidAuthority"));
  if (replacements.length === 1) {
    if (atomic?.deferredEvents === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
    yield* appendDerivedCommerceIdEvents(atomic.deferredEvents, lifetime, replacements[0]?.derivedIds ?? []);
  }
  const atomicEvents = atomic?.deferredEvents === undefined ? atomic?.events :
    yield* consumeCommerceEvents(atomic.deferredEvents, lifetime);
  const clock = { record: publicationClock, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid };
  const now = yield* publishCommerceAtoms(() => readScopePublicationDatabaseTime(state.tx, scope.scopeId, options));
  const allocation = yield* Effect.fromResult(allocateScopePublicationResult(clock, now))
    .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
  const relationalFacts = (physical ?? atomic)?.facts ?? [];
  if (input.kind === "atomic" && relationalFacts.length > input.factLimit)
    return yield* Effect.fail(commerceError("limitExceeded"));
  const contribution: ScopePublicationContribution = {
    authorityPins: { scopeId: scope.scopeId, requestKey: identity.requestKey, functionPath: identity.expectedFunctionPath },
    rowIntents: [], identityAccessPolicySha256: identity.expectedIdentityAccessPolicySha256,
    requestSha256: identity.expectedRequestSha256, resultSha256, successfulResult: result,
    ...((physical ?? atomic) === undefined ? {} : { relationalFacts }),
    ...(physical?.events !== undefined ? { events: physical.events } : atomicEvents !== undefined ? { events: atomicEvents } : {}),
  };
  const adjacencyChanges: ScopePublicationKernel["relationAdjacencyChanges"][number][] = [];
  const kernel: ScopePublicationKernel = { clock, ...allocation,
    relationAdjacencyChanges: adjacencyChanges };
  let prefix: ScopePublicationPrefixProof;
  if (deltas.length === 0) {
    prefix = yield* publishCommerceAtoms(signal => writeScopePublicationPrefix(state.tx, contribution, kernel, options, signal));
  } else {
    // Header and fact pages are uncommitted until this owner settles its one
    // transaction. The shared publisher validates ordered revision-bound facts.
    const writer = yield* publishCommerceAtoms(signal => beginScopePublicationPrefix(state.tx, contribution, kernel, options, signal));
    let logicalRows = 0;
    for (const delta of deltas) {
      const precedingRows = logicalRows;
      const lowered = yield* delta.materialize(allocation.commitSeq, rows => Effect.gen(function* () {
        if (logicalRows + rows.length + relationalFacts.length >
          (input.kind === "atomic" ? input.factLimit : Infinity))
          return yield* Effect.fail(commerceError("limitExceeded"));
        yield* publishCommerceAtoms(signal => writer.appendRows(rows, signal));
        logicalRows += rows.length;
      }));
      if (logicalRows - precedingRows !== lowered.rowCount)
        return yield* Effect.fail(commerceError("invalidAuthority"));
      adjacencyChanges.push(...lowered.adjacencyChanges);
    }
    prefix = yield* publishCommerceAtoms(signal => writer.finish(signal));
  }
  if (physical?.state.bootstrap) {
    const { state: physicalState, facts } = physical;
    const initialization = physicalState.descriptor.initialization;
    if (initialization === null) return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (facts.length !== initialization.expectedRowCount || facts.some(fact => fact.operation !== "insert")) return yield* Effect.fail(commerceError("seedMismatch"));
    const stored = yield* runDrizzleStatementEffect(state.tx.insert(fxSystemFrameworkInitializations).values({
      scopeUuid: scope.scopeUuid, installationSha256: physicalState.reference.installation.installationSha256,
      artifactSha256: physicalState.descriptor.artifact.identity.artifactSha256, stepId: initialization.stepId,
      contractSha256: physicalState.descriptor.contractSha256, datasetSha256: initialization.datasetSha256,
      rowCount: initialization.expectedRowCount, commitSeq: allocation.commitSeq,
    }).returning({ stepId: fxSystemFrameworkInitializations.stepId }), cause => commerceError("statementFailure", cause));
    if (stored.length !== 1 || stored[0]?.stepId !== initialization.stepId) return yield* Effect.fail(commerceError("storedCorruption"));
  }
  if (logical !== undefined && input.kind === "logical" && input.initialization !== undefined) {
    const initialization = input.initialization;
    const seedDelta = deltas[0];
    if (seedDelta === undefined || seedDelta.changes.length !== initialization.expectedRowCount ||
      seedDelta.changes.some(change => change.kind !== "live")) return yield* Effect.fail(commerceError("seedMismatch"));
    const recorded = yield* runDrizzleStatementEffect(state.tx.insert(fxSystemLogicalSourceInitializations).values({
      scopeUuid: scope.scopeUuid, sourceKey: logical.state.sourceKey, sourceSha256: logical.state.sourceSha256,
      stepId: initialization.stepId, contractSha256: initialization.contractSha256, datasetSha256: initialization.datasetSha256,
      rowCount: initialization.expectedRowCount, commitSeq: allocation.commitSeq,
    }).returning({ stepId: fxSystemLogicalSourceInitializations.stepId }), cause => commerceError("statementFailure", cause));
    if (recorded.length !== 1 || recorded[0]?.stepId !== initialization.stepId) return yield* Effect.fail(commerceError("storedCorruption"));
  }
  if (physical?.state.bootstrap || (logical !== undefined && input.kind === "logical" && input.initialization !== undefined))
    yield* publishCommerceAtoms(() => reproveScopePublicationPrefix(prefix));
  yield* acceptCommercePublication(advanceScopePublicationClock(state.tx, contribution, kernel, options));
  return allocation.commitSeq;
});

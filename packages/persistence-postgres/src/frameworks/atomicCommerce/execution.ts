import { observeExecution } from "../../execution/diagnostics/operation";
import { readExactScopeWriteClockObservation } from "../../scope/scopeClock";
// Quiet calls retain lazy operation bodies; actual caller/SDK policy owns diagnostic spans.
import { Cause, Effect, Exit } from "effect";
import type { Json } from "flarex-protocol/json";
import { canonicalizeJsonOutcome } from "../../values/jsonOutcome";
import { captureCommerceJsonData } from "../commerceTransaction/request";
import {
  makeBoundedRequestLifetime,
  type BoundedRequestContext,
  type BoundedRequestLifetime,
} from "../../execution/preparation/boundedRequestLifetime";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import type { CommerceAdmission } from "../commerceTransaction/admission";
import { requireCommerceAdmission } from "../commerceTransaction/admission";
import { makeCommerceStore, type CommerceRowClosure } from "../commerceTransaction/store";
import { inspectLogicalCommerceActivity, makeLogicalCommerceParticipant,
  type LogicalCommerceClosure } from "../commerceTransaction/logicalParticipant";
import {
  requireLogicalRelationalAdmission,
} from "../../storage/documents/logicalDocuments/relationalAdmission";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { makeCommerceCommandContext } from "../commerceTransaction/context";
import { getCommerceCommand, type CommerceCommand } from "../commerceTransaction/commands";
import { finalizeCommerceCommit } from "../commerceTransaction/publication";
import type { AtomicCommerceContext } from "./commands";
import {
  makeAtomicEventCapture,
  type AtomicCommerceCallObservation,
  type CommerceEventClosure,
} from "./events";
import type { PreparedAtomicCommerceConfiguration } from "./configuration";
import type { AtomicCommerceAdmission } from "./admission";
import {
  invalidateAcceptedApplicationBindingInTransaction,
} from "../../application/activation/acceptedBinding";
import type { LogicalCommerceCallObservation } from "./participants";
import {
  hashAtomicCommerceBytes,
  type CapturedAtomicCommerceRequest,
  type AtomicCommerceRequestEvidence,
} from "./request";

type ExecutionConfiguration = Pick<
  PreparedAtomicCommerceConfiguration<never>,
  "members" | "eventPolicy" | "limits" | "eventLimit" | "factLimit" | "owner" | "executionIsolation" | "scopeId"
>;

const scopeExclusions = new WeakMap<AtomicCommerceContext, Effect.Effect<void, CommerceTransactionError>>();
/** Authenticate live outer exclusion without lending a clock or transaction. */
export const requireAtomicCommerceScopeExclusion = (context: AtomicCommerceContext): Effect.Effect<void, CommerceTransactionError> =>
  Effect.suspend(() => scopeExclusions.get(context) ?? Effect.fail(commerceError("invalidAuthority")));
type CommerceContribution = Readonly<{ kind: "physical"; admission: CommerceAdmission; closure: CommerceRowClosure }> |
  Readonly<{ kind: "logical"; closure: LogicalCommerceClosure }>;
type PhysicalWorking = Effect.Success<ReturnType<typeof makeCommerceStore>>;
type LogicalWorking = Effect.Success<ReturnType<typeof makeLogicalCommerceParticipant>>;
type Working = PhysicalWorking | LogicalWorking;
type OpenContribution = Readonly<{ kind: "physical"; token: AtomicCommerceAdmission; admission: CommerceAdmission; working: PhysicalWorking }> |
  Readonly<{ kind: "logical"; token: AtomicCommerceAdmission; working: LogicalWorking }>;
interface AtomicCommerceExecution {
  readonly context: AtomicCommerceContext;
  readonly openMissingContributions: () => Effect.Effect<void, CommerceTransactionError>;
  readonly closeContributions: () => Effect.Effect<
    {
      readonly root: CommerceContribution;
      readonly additional: readonly CommerceContribution[];
      readonly events: CommerceEventClosure | undefined;
    },
    CommerceTransactionError
  >;
}

/** Recursive commands borrow one call's store, event buffer and manager lineage. */
function makeParticipantInvocation(
  member: ExecutionConfiguration["members"][number],
  working: Working,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>,
  id: string,
  eventCapture: ReturnType<typeof makeAtomicEventCapture> | undefined,
) {
  const events: Json[] = [];
  const invoke = Effect.fnUntraced(function* (
    manager: BoundedRequestContext,
    nested: CommerceCommand,
    nestedArgs: Json,
  ): Effect.fn.Return<Pick<AtomicCommerceCallObservation, "input" | "result">, CommerceTransactionError> {
    const operation = getCommerceCommand(nested);
    if (operation === undefined || !member.commands.has(nested))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const value = yield* Effect.fromResult(
      captureCommerceJsonData(nestedArgs, lifetime.remainingBytes()),
    );
    yield* Effect.fromResult(lifetime.charge(value.bytes));
    const commandContext = makeCommerceCommandContext(
      lifetime,
      working,
      id,
      manager,
      (current, nestedCommand, nestedInput) =>
        invoke(current, nestedCommand, nestedInput).pipe(Effect.map((call) => call.result)),
      (current, event) =>
        lifetime.operation(
          current,
          id,
          "write",
          Effect.gen(function* () {
            if (eventCapture === undefined || member.events === undefined)
              return yield* Effect.fail(commerceError("unadmittedEvent"));
            events.push(yield* eventCapture.captureSelected(member.events, event));
          }),
        ),
    );
    const output = yield* operation.run(commandContext, value.value);
    const result = yield* Effect.fromResult(
      captureCommerceJsonData(output, lifetime.remainingBytes()),
    );
    yield* Effect.fromResult(lifetime.charge(result.bytes));
    return Object.freeze({
      input: value.value,
      result: result.value,
    });
  }, work => observeExecution("AtomicCommerce.invokeParticipant", work, "caller"));
  return { invoke, events };
}

/** One request-local instance owns stores, observations and participant invocation.
 * Only context crosses into command code; closure capabilities stay with the root. */
function makeAtomicCommerceExecution(
  configuration: ExecutionConfiguration,
  admissions: readonly AtomicCommerceAdmission[],
  first: AtomicCommerceAdmission,
  tx: FlarexMetadataTransaction,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>,
  id: string,
  key: CapturedAtomicCommerceRequest["key"],
): AtomicCommerceExecution {
  const { members, eventPolicy, factLimit } = configuration;
  const eventCapture =
    eventPolicy === undefined
      ? undefined
      : makeAtomicEventCapture(
          first.kind === "physical" ? requireCommerceAdmission(first.admission).pipe(Effect.asVoid) :
            requireLogicalRelationalAdmission(first.admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure), Effect.asVoid),
          lifetime,
          key,
          eventPolicy,
          configuration.eventLimit,
        );
  const contributions: OpenContribution[] = [];
  const logicalWork = new Map<AtomicCommerceAdmission, LogicalWorking>();
  const logicalCalls = new Map<AtomicCommerceAdmission, LogicalCommerceCallObservation[]>();
  const makeWorking = Effect.fnUntraced(function* (
    admission: AtomicCommerceAdmission, manager: BoundedRequestContext,
  ): Effect.fn.Return<Working, CommerceTransactionError> {
    if (admission.kind === "physical") {
      const working = yield* makeCommerceStore(admission.admission, lifetime, id);
      contributions.push({ kind: "physical", token: admission, admission: admission.admission, working });
      return working;
    }
    const existing = logicalWork.get(admission);
    if (existing !== undefined) return existing;
    const member = members[admissions.indexOf(admission)];
    if (member?.kind !== "logical") return yield* Effect.fail(commerceError("invalidAuthority"));
    const created = yield* makeLogicalCommerceParticipant(admission.admission, tx, lifetime, manager, id,
      member.allowReferenceReplacement === true, member.selectedResources);
    logicalWork.set(admission, created);
    contributions.push({ kind: "logical", token: admission, working: created });
    return created;
  }, work => observeExecution("AtomicCommerce.makeWorking", work, "caller"));
  let facts = 0;
  let replacementPlanned = false;
  const observations: AtomicCommerceCallObservation[] = [];
  const callParticipant: AtomicCommerceContext["call"] =
    (participant, command, inputArgs) => observeExecution("AtomicCommerce.callParticipant", Effect.suspend(() =>
      lifetime.nested(
        lifetime.context,
        id,
        (child): Effect.Effect<Json, CommerceTransactionError> =>
          Effect.gen(function* () {
            if (replacementPlanned) return yield* Effect.fail(commerceError("invalidAuthority"));
            const index = members.findIndex((member) => member.participant === participant);
            const member = members[index];
            const admission = admissions[index];
            const root = getCommerceCommand(command);
            if (
              member === undefined ||
              admission === undefined ||
              root === undefined ||
              !member.commands.has(command)
            )
              return yield* Effect.fail(commerceError("invalidAuthority"));
            const working: Working = yield* makeWorking(admission, child);
            const fromAttempt = admission.kind === "logical" && "attemptCount" in working ? working.attemptCount() : undefined;
            const fromLifecycle = admission.kind === "logical" && "lifecycleCount" in working ? working.lifecycleCount() : undefined;
            const cursor = member.kind === "logical" && (member.validateLogicalCall !== undefined || member.allowReferenceReplacement === true) && "activityCursor" in working
              ? working.activityCursor() : undefined;
            const { invoke, events } = makeParticipantInvocation(member, working, lifetime, id, eventCapture);
            const call: Pick<AtomicCommerceCallObservation, "input" | "result"> = yield* invoke(child, command, inputArgs);
            if (cursor !== undefined && "callActivity" in working) {
              const activity = yield* working.callActivity(cursor);
              if (root.mode === "read" && (activity.mutations.length !== 0 || activity.lifecycle.length !== 0 ||
                activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 || events.length !== 0))
                return yield* Effect.fail(commerceError("receiptMismatch"));
              if (member.validateLogicalCall !== undefined) yield* member.validateLogicalCall(Object.freeze({ commandName: root.name, mode: root.mode,
                input: call.input, result: call.result, events: Object.freeze([...events]),
                fromAttempt: 0, toAttempt: activity.mutations.length,
                fromLifecycle: 0, toLifecycle: activity.lifecycle.length }), activity, command);
              if (activity.referenceReplacements.length !== 0) replacementPlanned = true;
            }
            if (fromAttempt !== undefined && fromLifecycle !== undefined && "attemptCount" in working && "lifecycleCount" in working) {
              const calls = logicalCalls.get(admission) ?? [];
              calls.push(Object.freeze({ commandName: root.name, mode: root.mode, input: call.input, result: call.result,
                events: Object.freeze([...events]),
                fromAttempt, toAttempt: working.attemptCount(),
                fromLifecycle, toLifecycle: working.lifecycleCount() }));
              logicalCalls.set(admission, calls);
            }
            if (admission.kind === "physical") {
              if (!("snapshot" in working)) return yield* Effect.fail(commerceError("invalidAuthority"));
              const rows = working.snapshot();
              facts += rows.length;
              if (facts > factLimit) return yield* Effect.fail(commerceError("limitExceeded"));
              if (member.validate !== undefined) {
                const validation: Effect.Effect<void, CommerceTransactionError> = member.validate(
                  events, rows, root.name, working.lifecycleSnapshot(), working.observationSnapshot());
                yield* validation;
              }
            }
            // Inputs/results are the already charged, recursively frozen
            // captures. Only the validated outer call becomes evidence.
            if (eventCapture !== undefined)
              observations.push(Object.freeze({ participant, command, ...call }));
            return call.result;
          }),
        getCommerceCommand(command)?.mode,
      )), "caller");
  const context = Object.freeze<AtomicCommerceContext>({
    eventGroupId: key,
    checkpoint: lifetime.operation(lifetime.context, id, "read", Effect.void),
    capture: (value, normalize) =>
      lifetime.operation(
        lifetime.context,
        id,
        "read",
        Effect.gen(function* () {
          const normalized = normalize === undefined ? value : yield* Effect.fromResult(normalize(value));
          const intermediate = yield* Effect.fromResult(
            captureCommerceJsonData(normalized, lifetime.remainingBytes()),
          );
          yield* Effect.fromResult(lifetime.charge(intermediate.bytes));
          return intermediate.value;
        }),
      ),
    emit: (contract, message) =>
      lifetime.operation(
        lifetime.context,
        id,
        "write",
        Effect.suspend(() => replacementPlanned ? Effect.fail(commerceError("invalidAuthority")) : eventCapture === undefined
          ? Effect.fail(commerceError("unadmittedEvent"))
          : eventCapture.capture(contract, message).pipe(Effect.asVoid)),
      ),
    refuse: (error) => lifetime.operation(lifetime.context, id, "write", Effect.fail(error)),
    call: callParticipant,
  });
  scopeExclusions.set(context, lifetime.operation(lifetime.context, id, "read", Effect.suspend(() =>
    configuration.executionIsolation === "scopeExclusive" && readExactScopeWriteClockObservation(tx, configuration.scopeId) !== undefined
      ? Effect.void : Effect.fail(commerceError("unsupportedProfile")))));
  const openMissingContributions = Effect.fnUntraced(function* () {
    // Opening a logical table is a bounded request operation, so admitted but
    // unused participants must be constructed while the lifetime is still open.
    for (const admission of admissions) {
      if (!contributions.some((member) => member.token === admission)) yield* makeWorking(admission, lifetime.context);
    }
  }, work => observeExecution("AtomicCommerce.openMissingContributions", work, "caller"));
  const closeContributions = Effect.fnUntraced(function* () {
    if (admissions.some(admission => !contributions.some(member => member.token === admission)))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const closed: CommerceContribution[] = [];
    let derivedIdEvent: ExecutionConfiguration["members"][number]["derivedIdEvent"];
    for (const contribution of contributions) {
      if (contribution.kind === "physical") closed.push({ kind: "physical", admission: contribution.admission,
        closure: yield* contribution.working.close() });
      else {
        const closure = yield* contribution.working.close();
        const member = members[admissions.indexOf(contribution.token)];
        if (member === undefined || member.kind !== "logical") return yield* Effect.fail(commerceError("invalidAuthority"));
        const activity = yield* inspectLogicalCommerceActivity(closure, lifetime);
        if (activity.setNull.length !== 0 && member.allowSetNull !== true)
          return yield* Effect.fail(commerceError("invalidAuthority"));
        if (activity.referenceReplacements.length !== 0) {
          if (activity.referenceReplacements.length !== 1 || member.allowReferenceReplacement !== true ||
            member.derivedIdEvent === undefined || derivedIdEvent !== undefined)
            return yield* Effect.fail(commerceError("invalidAuthority"));
          derivedIdEvent = member.derivedIdEvent;
        }
        if (member.validateLogical !== undefined) {
          yield* member.validateLogical(Object.freeze([...(logicalCalls.get(contribution.token) ?? [])]),
            activity.mutations, activity.lifecycle, activity.observedRows, activity.setNull,
            activity.referenceReplacements);
        }
        closed.push({ kind: "logical", closure });
      }
    }
    const root = closed[0];
    if (root === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    if (derivedIdEvent !== undefined && eventCapture === undefined)
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    const eventClosure = eventCapture === undefined ? undefined : yield* eventCapture.close(observations, derivedIdEvent);
    return {
      root,
      additional: closed.slice(1),
      events: eventClosure,
    };
  }, work => observeExecution("AtomicCommerce.closeContributions", work, "caller"));
  return { context, openMissingContributions, closeContributions };
}

/** Execute only after replay misses. The existing lifetime and publisher retain
 * failure latching, timeout, closure authentication and settlement ordering. */
export const executeAtomicCommerceRequest = Effect.fnUntraced(function* (
  configuration: ExecutionConfiguration,
  request: CapturedAtomicCommerceRequest,
  evidence: AtomicCommerceRequestEvidence,
  admissions: readonly AtomicCommerceAdmission[],
  tx: FlarexMetadataTransaction,
): Effect.fn.Return<Json, CommerceTransactionError> {
  const first = admissions[0];
  if (first === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const id = crypto.randomUUID();
  const lifetime = yield* makeBoundedRequestLifetime(
    commerceError,
    configuration.limits,
    configuration.owner,
    Object.freeze({ requestId: Symbol("atomic.commerce.request") }),
    id,
    "write",
  );
  return yield* Effect.gen(function* () {
    const execution = makeAtomicCommerceExecution(
      configuration,
      admissions,
      first,
      tx,
      lifetime,
      id,
      request.key,
    );
    yield* Effect.fromResult(lifetime.charge(evidence.bytes));
    const value = yield* Effect.gen(function* () {
      const output = yield* request.definition.run(execution.context, request.args);
      // An unused logical member still needs a closure. Open it before seal,
      // inside the same Cause boundary as participant command execution.
      yield* execution.openMissingContributions();
      return output;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          // Preserve any earlier participant refusal alongside a later
          // failure, including failures swallowed by trusted command code.
          const sealed = yield* Effect.exit(lifetime.seal);
          return yield* Effect.failCause(Exit.isFailure(sealed) ? Cause.combine(cause, sealed.cause) : cause);
        }),
      ),
    );
    // Check rollback-only before result accounting can report a closed
    // budget and obscure the participant's original failure.
    yield* lifetime.seal;
    const capturedResult = yield* Effect.fromResult(
      captureCommerceJsonData(value, lifetime.remainingBytes()),
    );
    yield* Effect.fromResult(lifetime.charge(capturedResult.bytes));
    const result = yield* Effect.fromResult(canonicalizeJsonOutcome(capturedResult.value)).pipe(
      Effect.mapError(projectCommerceRequestFailure),
    );
    invalidateAcceptedApplicationBindingInTransaction(tx);
    const { root, additional, events } = yield* execution.closeContributions();
    yield* finalizeCommerceCommit(
      { kind: "atomic", participants: [root, ...additional], factLimit: configuration.factLimit,
        ...(events === undefined ? {} : { events }) },
      lifetime,
      evidence.lookup,
      result,
      yield* hashAtomicCommerceBytes(result.canonicalBytes),
    );
    return result.valueJson;
  }).pipe(
    Effect.timeoutOrElse({
      duration: configuration.limits.commandMs,
      orElse: () => Effect.fail(commerceError("deadlineExceeded")),
    }),
    Effect.ensuring(lifetime.close),
  );
}, work => observeExecution("AtomicCommerce.executeRequest", work, "caller"));

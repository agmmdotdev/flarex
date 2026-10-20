import { observeExecution } from "../../execution/diagnostics/operation";
import { readExactScopeWriteClockObservation } from "../../scope/scopeClock";
// Quiet calls retain lazy operation bodies; actual caller/SDK policy owns diagnostic spans.
import { Cause, Effect, Exit, Result } from "effect";
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
import { withCommerceCommandContext } from "../commerceTransaction/context";
import { getCommerceCommand, type CommerceCommand } from "../commerceTransaction/commands";
import { finalizeCommerceCommit } from "../commerceTransaction/publication";
import type { AtomicCommerceContext } from "./commands";
import {
  makeAtomicEventCapture,
  admitCommercePendingEventCancellation,
  type AtomicCommerceCallObservation,
  type CommerceEventClosure,
} from "./events";
import type { PreparedAtomicCommerceConfiguration } from "./configuration";
import { makeCommerceOperations, type CommerceOperations } from "../commerceTransaction/operations";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { commitEventLimits } from "../../commit/events/model";
import type { AtomicCommerceAdmission } from "./admission";
import {
  invalidateAcceptedApplicationBindingInTransaction,
} from "../../application/activation/acceptedBinding";
import type { LogicalCommerceCallObservation } from "./participants";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { confirmAtomicCommerceTaskChild, requireAtomicCommerceTaskChildSettlement } from "./taskChild";
import {
  hashAtomicCommerceBytes,
  type CapturedAtomicCommerceRequest,
  type AtomicCommerceRequestEvidence,
} from "./request";

type ExecutionConfiguration = Pick<
  PreparedAtomicCommerceConfiguration<never>,
  "members" | "eventPolicy" | "limits" | "eventLimit" | "factLimit" | "owner" | "executionIsolation" | "operationScheduling" | "borrowedOperationScheduling" | "scopeId"
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
  borrowedCallLimit: number | undefined,
) {
  const events: Json[] = [];
  const detach = "detachDeletedReference" in working ? working.detachDeletedReference : undefined;
  const cursor = detach === undefined || !("activityCursor" in working) ? undefined : working.activityCursor();
  const commandWorking = detach === undefined ? working : { ...working,
    detachDeletedReference: (manager: BoundedRequestContext, selection: Parameters<typeof detach>[1]) => detach(manager, selection, cursor),
  };
  const invoke = Effect.fnUntraced(function* (
    manager: BoundedRequestContext,
    nested: CommerceCommand,
    nestedArgs: Json,
    capturedInput?: Readonly<{ value: Json }>,
  ): Effect.fn.Return<Pick<AtomicCommerceCallObservation, "input" | "result">, CommerceTransactionError> {
    const operation = getCommerceCommand(nested);
    if (operation === undefined || !member.commands.has(nested))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    let value = capturedInput;
    if (value === undefined) {
      const captured = yield* Effect.fromResult(captureCommerceJsonData(nestedArgs, lifetime.remainingBytes()));
      yield* Effect.fromResult(lifetime.charge(captured.bytes));
      value = captured;
    }
    const input = value.value;
    const output = yield* withCommerceCommandContext(
      lifetime,
      commandWorking,
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
      borrowedCallLimit,
      context => operation.run(context, input),
    );
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
  operations: CommerceOperations | undefined,
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
      member.allowReferenceReplacement === true, member.selectedResources, member.logicalPublication,
      member.reconstitution, member.allowPreservingDeletionUpsert, member.allowActiveRestoreUpdate === true, member.allowStorageInsertionOrder === true,
      member.setNullPolicy, member.detachDeletedReferences === true, member.allowRecordedRowReplay === true);
    logicalWork.set(admission, created);
    contributions.push({ kind: "logical", token: admission, working: created });
    return created;
  }, work => observeExecution("AtomicCommerce.makeWorking", work, "caller"));
  let facts = 0;
  let replacementPlanned = false;
  const observations: AtomicCommerceCallObservation[] = [];
  const callParticipantNow = (
    participant: Parameters<AtomicCommerceContext["call"]>[0],
    command: CommerceCommand, inputArgs: Json, capturedInput?: Readonly<{ value: Json }>,
  ) => observeExecution("AtomicCommerce.callParticipant", Effect.suspend(() =>
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
            const { invoke, events } = makeParticipantInvocation(member, working, lifetime, id, eventCapture,
              configuration.borrowedOperationScheduling === "queued" ? configuration.limits.calls : undefined);
            const call: Pick<AtomicCommerceCallObservation, "input" | "result"> = yield* invoke(child, command, inputArgs, capturedInput);
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
  const prepareCapture = (value: unknown) => Result.gen(function* () {
    const captured = yield* captureCommerceJsonData(value, lifetime.remainingBytes());
    yield* lifetime.charge(captured.bytes);
    return captured;
  });
  const rootOperation = <A>(work: Effect.Effect<A, CommerceTransactionError>): Effect.Effect<A, CommerceTransactionError> =>
    operations === undefined ? work : operations.submit(() => Result.succeed(undefined), () => work);
  const callParticipant: AtomicCommerceContext["call"] = (participant, command, inputArgs) =>
    operations === undefined ? callParticipantNow(participant, command, inputArgs) :
      operations.submit(() => {
        const index = members.findIndex(member => member.participant === participant);
        const member = members[index];
        if (replacementPlanned || member === undefined || admissions[index] === undefined ||
          getCommerceCommand(command) === undefined || !member.commands.has(command))
          return Result.fail(commerceError("invalidAuthority"));
        return prepareCapture(inputArgs);
      },
        captured => callParticipantNow(participant, command, captured.value, captured));
  const context = Object.freeze<AtomicCommerceContext>({
    eventGroupId: key,
    checkpoint: rootOperation(lifetime.operation(lifetime.context, id, "read", Effect.void)),
    capture: (value, normalize) => operations !== undefined ? operations.submit(
      () => (normalize === undefined ? Result.succeed(value) : normalize(value)).pipe(Result.flatMap(prepareCapture)),
      captured => lifetime.operation(lifetime.context, id, "read", Effect.succeed(captured.value)),
    ) : lifetime.operation(
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
    emit: (contract, message) => operations !== undefined ? operations.submit(
      () => Result.gen(function* () {
        if (replacementPlanned) return yield* Result.fail(commerceError("invalidAuthority"));
        if (eventPolicy === undefined || !eventPolicy.allowed.has(contract))
          return yield* Result.fail(commerceError("unadmittedEvent"));
        const captured = yield* capturePrivateJsonData(message,
          Math.min(commitEventLimits.bytes, lifetime.remainingBytes()), commerceError);
        yield* lifetime.charge(captured.bytes);
        return captured;
      }),
      captured => lifetime.operation(lifetime.context, id, "write", Effect.suspend(() =>
        replacementPlanned ? Effect.fail(commerceError("invalidAuthority")) : eventCapture === undefined
          ? Effect.fail(commerceError("unadmittedEvent"))
          : eventCapture.capturePrecharged(contract, captured.value, captured.bytes).pipe(Effect.asVoid))),
    ) : lifetime.operation(
        lifetime.context,
        id,
        "write",
        Effect.suspend(() => replacementPlanned ? Effect.fail(commerceError("invalidAuthority")) : eventCapture === undefined
          ? Effect.fail(commerceError("unadmittedEvent"))
          : eventCapture.capture(contract, message).pipe(Effect.asVoid)),
      ),
    refuse: (error) => operations === undefined
      ? lifetime.operation(lifetime.context, id, "write", Effect.fail(error))
      : operations.submit(() => Result.fail(error), () => Effect.fail(error)),
    clearPendingEvents: contract => operations !== undefined ? operations.submit(
      () => replacementPlanned ? Result.fail(commerceError("invalidAuthority")) : admitCommercePendingEventCancellation(eventPolicy, contract),
      () => lifetime.operation(lifetime.context, id, "write", Effect.suspend(() =>
        replacementPlanned ? Effect.fail(commerceError("invalidAuthority")) : eventCapture === undefined
          ? Effect.fail(commerceError("unadmittedEvent")) : eventCapture.clearPending(contract))),
    ) : lifetime.operation(lifetime.context, id, "write", Effect.suspend(() =>
      replacementPlanned ? Effect.fail(commerceError("invalidAuthority")) : eventCapture === undefined
        ? Effect.fail(commerceError("unadmittedEvent")) : eventCapture.clearPending(contract))),
    call: callParticipant,
  });
  scopeExclusions.set(context, rootOperation(lifetime.operation(lifetime.context, id, "read", Effect.suspend(() =>
    configuration.executionIsolation === "scopeExclusive" && readExactScopeWriteClockObservation(tx, configuration.scopeId) !== undefined
      ? Effect.void : Effect.fail(commerceError("unsupportedProfile"))))));
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
        if (activity.mutations.some(mutation => mutation.deletedReference !== undefined) && member.detachDeletedReferences !== true)
          return yield* Effect.fail(commerceError("invalidAuthority"));
        if (activity.setNull.length !== 0 && (member.setNullPolicy === undefined ||
          activity.setNull.some(intent => intent.managedUpdate !== member.setNullPolicy?.managedUpdate)))
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
  authority: TrustedScopeAuthority,
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
  return yield* Effect.acquireUseRelease(
    configuration.operationScheduling === "queued"
      ? makeCommerceOperations(lifetime, configuration.limits.calls, lifetime.context) : Effect.succeed(undefined),
    operations => Effect.gen(function* () {
    const execution = makeAtomicCommerceExecution(
      configuration,
      admissions,
      first,
      tx,
      lifetime,
      id,
      request.key,
      operations,
    );
    yield* Effect.fromResult(lifetime.charge(evidence.bytes));
    const value = yield* Effect.gen(function* () {
      const output = yield* request.definition.run(execution.context, request.args);
      // Escaped calls must fail closed before unused stores can be opened.
      if (operations !== undefined) yield* operations.seal;
      // An unused logical member still needs a closure. Open it before seal,
      // inside the same Cause boundary as participant command execution.
      yield* execution.openMissingContributions();
      return output;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          // Preserve any earlier participant refusal alongside a later
          // failure, including failures swallowed by trusted command code.
          const scheduled = operations === undefined ? undefined : yield* Effect.exit(operations.seal);
          const sealed = yield* Effect.exit(lifetime.seal);
          const schedulingCause = scheduled !== undefined && Exit.isFailure(scheduled)
            ? Cause.combine(cause, scheduled.cause) : cause;
          return yield* Effect.failCause(Exit.isFailure(sealed) ? Cause.combine(schedulingCause, sealed.cause) : schedulingCause);
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
    const resultSha256 = yield* hashAtomicCommerceBytes(result.canonicalBytes);
    if (request.taskChild !== undefined)
      yield* requireAtomicCommerceTaskChildSettlement(tx, request.taskChild, authority);
    yield* finalizeCommerceCommit(
      { kind: "atomic", participants: [root, ...additional], factLimit: configuration.factLimit,
        ...(events === undefined ? {} : { events }),
        ...(request.taskChild?.eligibility === undefined ? {} : { eligibility: request.taskChild.eligibility }) },
      lifetime,
      evidence.lookup,
      result,
      resultSha256,
    );
    if (request.taskChild !== undefined)
      yield* confirmAtomicCommerceTaskChild(tx, request.taskChild, authority, resultSha256);
    return result.valueJson;
  }).pipe(
    Effect.timeoutOrElse({
      duration: configuration.limits.commandMs,
      orElse: () => Effect.fail(commerceError("deadlineExceeded")),
    }),
    ),
    operations => (operations === undefined ? Effect.void : operations.close).pipe(Effect.andThen(lifetime.close)),
  );
}, work => observeExecution("AtomicCommerce.executeRequest", work, "caller"));

import { Cause, Effect, Option, Result, Schema, Semaphore } from "effect";
import {
  decodeNativeWorkflowCheckpointJson, mergeNativeWorkflowCheckpointForSave, TransactionCheckpoint, TransactionOrchestrator,
  type IDistributedTransactionStorage, type DistributedTransactionType, type TransactionStep,
} from "@medusajs/orchestration/transaction";
import { WorkflowManager } from "@medusajs/orchestration/workflow/workflow-manager";
import type { NativeWorkflowRuntime } from "@medusajs/orchestration/runtime";
import { TransactionState, TransactionStepState, TransactionStepStatus } from "@medusajs/utils/orchestration/types";
import { MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES, type TrustedWorkflowCheckpointDescriptor } from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeTrustedWorkflowCheckpointStore, type PreparedTrustedWorkflowCheckpoint,
} from "@flarex/persistence-postgres/internal/trusted-workflow-checkpoint";
import {
  revokeTrustedWorkflowExecutionSubject, inspectTrustedWorkflowInterpreterSubject, type TrustedWorkflowInterpreterSubject,
} from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual, type Json } from "flarex-protocol/json";
import { commerceDecoder } from "../value/decoder";

export type DurableNativeEffectBoundary = <A, E>(work: Effect.Effect<A, E>) => Promise<A>;
const boundaryFailures = new WeakSet<object>();
class NativeBoundaryFailure extends Error {
  constructor() { super("Native workflow Effect boundary failed"); boundaryFailures.add(this); }
}
/** Identity guard for the real Promise marker; its full Cause remains with the
 * owning attempt and must never be classified as an ordinary provider error. */
export function isDurableNativeBoundaryFailure(value: unknown): boolean {
  return typeof value === "object" && value !== null && boundaryFailures.has(value);
}
export const nativeCheckpointCodec = "medusa.native-checkpoint.json.v1";
export const nativeCompoundCheckpointCodec = "medusa.native-checkpoint.compound.json.v1";
const utf8 = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const Counter = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Time = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const JsonRecord = Schema.Record(Schema.String, Schema.Json);
const State = Schema.Struct({ state: Schema.Literals(Object.values(TransactionStepState)), status: Schema.Literals(Object.values(TransactionStepStatus)) });
const Step = Schema.Struct({
  id: Schema.String, uuid: Schema.optionalKey(Schema.String), depth: Counter, definition: Schema.Json,
  invoke: State, compensate: State, attempts: Counter, failures: Counter,
  temporaryFailedAt: Schema.optionalKey(Schema.NullOr(Time)), lastAttempt: Schema.NullOr(Time),
  retryRescheduledAt: Schema.optionalKey(Schema.NullOr(Time)), hasScheduledRetry: Schema.optionalKey(Schema.Boolean),
  timedOutAt: Schema.optionalKey(Schema.NullOr(Time)), startedAt: Schema.optionalKey(Time),
  next: Schema.Array(Schema.String), saveResponse: Schema.Boolean, _v: Schema.optionalKey(Counter),
  stepFailed: Schema.optionalKey(Schema.Boolean),
});
const Root = Schema.Struct({ id: Schema.Literal("_root"), next: Schema.Array(Schema.String) });
const Wire = Schema.Struct({
  flow: Schema.Struct({
    modelId: Schema.String, transactionId: Schema.String, runId: Schema.String,
    options: Schema.optionalKey(Schema.Json), definition: Schema.Json, metadata: Schema.optionalKey(JsonRecord),
    hasAsyncSteps: Schema.Boolean, hasFailedSteps: Schema.Boolean, hasSkippedOnFailureSteps: Schema.Boolean,
    hasWaitingSteps: Schema.Boolean, hasSkippedSteps: Schema.Boolean, hasRevertedSteps: Schema.Boolean,
    timedOutAt: Schema.NullOr(Time), startedAt: Schema.optionalKey(Time), cancelledAt: Schema.optionalKey(Time),
    temporaryFailedAt: Schema.optionalKey(Schema.NullOr(Time)), state: Schema.Literals(Object.values(TransactionState)),
    steps: Schema.Record(Schema.String, Schema.Union([Root, Step])), _v: Counter,
  }),
  context: Schema.Struct({ payload: Schema.optionalKey(Schema.Json), invoke: JsonRecord, compensate: JsonRecord }),
  errors: Schema.Array(Schema.Struct({ action: Schema.String, handlerType: Schema.Literals(["invoke", "compensate"]), error: Schema.Json })),
});
const decodeWire = commerceDecoder(Wire, "storedCorruption");
const CompoundWire = Schema.Struct({ parent: Wire, child: Schema.NullOr(Wire) });
const decodeCompoundWire = commerceDecoder(CompoundWire, "storedCorruption");
// The native synchronous child response retains a JSON projection of its real
// WorkflowResult. Read only the native identity/checkpoint portion; the native
// result DTO and transient class fields are not a second execution authority.
const RetainedChild = Schema.Struct({
  __type: Schema.Literal("Symbol(WorkflowWorkflowData)"),
  output: Schema.Struct({
    __type: Schema.Literal("Symbol(WorkflowStepResponse)"),
    compensateInput: Schema.Struct({ transaction: Schema.Struct({
      flow: Wire.fields.flow, context: Wire.fields.context, errors: Wire.fields.errors,
      modelId: Schema.String, transactionId: Schema.String, runId: Schema.String, payload: Schema.Json,
    }) }),
  }),
});
const decodeRetainedChild = Schema.decodeUnknownResult(RetainedChild);
const graphBytes = (value: unknown) => JSON.stringify(value, (key, entry: unknown) => key === "uuid" ? undefined : entry);

interface DurableNativeCheckpointIdentity {
  readonly workflowId: string;
  readonly transactionId: string;
  readonly expectedInput: Json;
  /** A fixed parent profile may pin its native event-policy identity. */
  readonly expectedEventGroupId?: string;
  readonly expectedParentStepIdempotencyKey?: string;
}
export interface DurableNativeCheckpointedChild {
  readonly workflowId: string;
  readonly transactionId: string;
  readonly parentStepId: string;
  /** A trusted profile validates the original child payload, including its
   * relationship to the fixed parent input. This grants no service authority. */
  readonly validateInput: (input: Json) => Result.Result<void, CommerceTransactionError>;
}
const nativeFailure = (reason: "unsupportedProfile" | "storedCorruption") => commerceError(reason);

function validateCheckpoint(raw: unknown, input: DurableNativeCheckpointIdentity) {
  const wire = Result.getOrThrow(decodeWire(raw));
  if (wire.flow.modelId !== input.workflowId || wire.flow.transactionId !== input.transactionId ||
    wire.context.payload === undefined || !jsonEqual(wire.context.payload, input.expectedInput)) throw nativeFailure("storedCorruption");
  if (input.expectedEventGroupId !== undefined) {
    const metadata = wire.flow.metadata;
    if (metadata?.eventGroupId !== input.expectedEventGroupId ||
      (input.expectedParentStepIdempotencyKey === undefined
        ? ((metadata.preventReleaseEvents !== undefined && metadata.preventReleaseEvents !== false) ||
          metadata.parentStepIdempotencyKey !== undefined ||
          (metadata.cancelingFromParentStep !== undefined && metadata.cancelingFromParentStep !== false))
        : (metadata.parentStepIdempotencyKey !== input.expectedParentStepIdempotencyKey ||
          metadata.preventReleaseEvents !== true ||
          (metadata.cancelingFromParentStep !== undefined && typeof metadata.cancelingFromParentStep !== "boolean"))))
      throw nativeFailure("storedCorruption");
  }
  const definition = WorkflowManager.getWorkflow(input.workflowId);
  if (definition === undefined || graphBytes(wire.flow.definition) !== graphBytes(definition.flow_)) throw nativeFailure("storedCorruption");
  // Compare the stored topology with the genuine native builder. Do not
  // author a second graph decoder or reconstruct native execution state.
  const [expected] = TransactionOrchestrator.buildSteps(definition.flow_);
  if (Object.keys(expected).length !== Object.keys(wire.flow.steps).length) throw nativeFailure("storedCorruption");
  for (const [key, step] of Object.entries(wire.flow.steps)) {
    const native = expected[key];
    if (native === undefined || step.id !== native.id || graphBytes(step.next) !== graphBytes(native.next)) throw nativeFailure("storedCorruption");
    if ("definition" in step && (step.depth !== native.depth || graphBytes(step.definition) !== graphBytes(native.definition))) throw nativeFailure("storedCorruption");
  }
};
export const decodeDurableNativeCheckpoint = (bytes: Uint8Array, input: DurableNativeCheckpointIdentity) => Effect.try({
  try: () => {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES) throw nativeFailure("storedCorruption");
    return decodeNativeWorkflowCheckpointJson(decoder.decode(bytes), raw => validateCheckpoint(raw, input));
  }, catch: cause => commerceError("storedCorruption", cause),
});
export interface CompoundCheckpointIdentity extends DurableNativeCheckpointIdentity {
  readonly expectedEventGroupId: string;
  readonly checkpointedChild: DurableNativeCheckpointedChild;
}
const decodeStoredOptions = Schema.decodeUnknownResult(Schema.Struct({ store: Schema.Literal(true), storeExecution: Schema.Literal(true) }));
function validateStoredOptions(checkpoint: typeof Wire.Type) {
  // Other native options remain with the native flow owner; this profile pins
  // only the two retention flags and synchronous topology.
  Result.getOrThrow(decodeStoredOptions(checkpoint.flow.options));
  if (checkpoint.flow.hasAsyncSteps) throw nativeFailure("storedCorruption");
}
function childIdentity(input: CompoundCheckpointIdentity, payload: Json): DurableNativeCheckpointIdentity {
  Result.getOrThrow(input.checkpointedChild.validateInput(payload));
  return { workflowId: input.checkpointedChild.workflowId, transactionId: input.checkpointedChild.transactionId,
    expectedInput: payload, expectedEventGroupId: input.expectedEventGroupId,
    expectedParentStepIdempotencyKey: `${input.workflowId}:${input.transactionId}:${input.checkpointedChild.parentStepId}:invoke` };
}
function decodeCompoundCheckpoint(bytes: Uint8Array, input: CompoundCheckpointIdentity) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES) throw nativeFailure("storedCorruption");
  const wire = Result.getOrThrow(decodeCompoundWire(JSON.parse(decoder.decode(bytes))));
  validateStoredOptions(wire.parent);
  const parent = decodeNativeWorkflowCheckpointJson(JSON.stringify(wire.parent), raw => validateCheckpoint(raw, input));
  const parentStep = Object.values(parent.flow.steps).find(step => step.definition?.action === input.checkpointedChild.parentStepId);
  if (parentStep === undefined) throw nativeFailure("storedCorruption");
  const child = wire.child === null ? undefined : (() => {
    validateStoredOptions(wire.child);
    if (wire.child.context.payload === undefined || wire.child.flow.runId !== wire.parent.flow.runId ||
      parentStep.invoke.state === TransactionStepState.DORMANT || parentStep.invoke.state === TransactionStepState.NOT_STARTED)
      throw nativeFailure("storedCorruption");
    const identity = childIdentity(input, wire.child.context.payload);
    return decodeNativeWorkflowCheckpointJson(JSON.stringify(wire.child), raw => validateCheckpoint(raw, identity));
  })();
  const retained = wire.parent.context.invoke[input.checkpointedChild.parentStepId];
  if (retained !== undefined) {
    const reference = Result.getOrThrow(decodeRetainedChild(retained)).output.compensateInput.transaction;
    const childPayload = wire.child?.context.payload;
    if (child === undefined || reference.modelId !== input.checkpointedChild.workflowId ||
      reference.transactionId !== input.checkpointedChild.transactionId || reference.runId !== parent.flow.runId ||
      childPayload === undefined || reference.context.payload === undefined ||
      !jsonEqual(reference.payload, childPayload) || !jsonEqual(reference.context.payload, childPayload))
      throw nativeFailure("storedCorruption");
    validateCheckpoint({ flow: reference.flow, context: reference.context, errors: reference.errors },
      childIdentity(input, reference.payload));
  }
  return { parent, child };
}
export const decodeDurableNativeCompoundCheckpoint = Effect.fn("NativeWorkflow.decodeCompoundCheckpoint")((bytes: Uint8Array, input: CompoundCheckpointIdentity) => Effect.try({
  try: () => decodeCompoundCheckpoint(bytes, input), catch: cause => commerceError("storedCorruption", cause),
}));
export interface NativeWaitProposal {
  readonly waitId: string;
  readonly nativeStartedAtMs: number;
  readonly timeoutMs: number;
  readonly deadlineAtMs: number;
}
type DurableNativeStorageTopology = {
  readonly uncheckpointedChild: Readonly<{ workflowId: string; transactionId: string }>;
  readonly checkpointedChild?: never;
  /** Only the selected async child admits the existing immediate retry. */
  readonly recoveryStepId?: string;
  readonly waitStepId: string;
  readonly timeoutMs: number;
} | {
  /** Exactly one genuine synchronous child is retained with its native parent. */
  readonly checkpointedChild: DurableNativeCheckpointedChild;
  readonly expectedEventGroupId: string;
  readonly uncheckpointedChild?: never;
  readonly recoveryStepId?: never;
  readonly waitStepId?: never;
  readonly timeoutMs?: never;
};

/** One native parent checkpoint borrows the existing Task owner. There is no
 * SQL loan, timer or capability retained across the durable confirmation wait. */
export const makeDurableNativeStorage = Effect.fn("NativeWorkflow.makeStorage")(function* <HashFailure>(input: {
  readonly subject: TrustedWorkflowInterpreterSubject;
  readonly checkpointStore: ReturnType<typeof makeTrustedWorkflowCheckpointStore<HashFailure>>;
  readonly runEffect: DurableNativeEffectBoundary;
  readonly clock: NativeWorkflowRuntime["clock"];
  readonly workflowId: string;
  readonly transactionId: string;
  readonly expectedInput: Json;
  readonly expectedEventGroupId?: string;
  readonly requiredCheckpoint?: TrustedWorkflowCheckpointDescriptor;
} & DurableNativeStorageTopology) {
  const pins = yield* Effect.fromResult(inspectTrustedWorkflowInterpreterSubject(input.subject));
  if (pins.runId !== input.transactionId) return yield* commerceError("invalidAuthority");
  const gate = yield* Semaphore.make(1);
  const parentKey = `dtrx:${input.workflowId}:${input.transactionId}`;
  const selectedChild = input.checkpointedChild;
  const inlineChild = input.uncheckpointedChild;
  const childIdentityPins = selectedChild ?? inlineChild;
  if (childIdentityPins === undefined) return yield* nativeFailure("unsupportedProfile");
  const childKey = `dtrx:${childIdentityPins.workflowId}:${childIdentityPins.transactionId}`;
  const codec = selectedChild === undefined ? nativeCheckpointCodec : nativeCompoundCheckpointCodec;
  const compoundIdentity: CompoundCheckpointIdentity | undefined = input.checkpointedChild === undefined ? undefined : {
    workflowId: input.workflowId, transactionId: input.transactionId, expectedInput: input.expectedInput,
    expectedEventGroupId: input.expectedEventGroupId, checkpointedChild: input.checkpointedChild,
  };
  if (selectedChild !== undefined && (selectedChild.parentStepId !== `${selectedChild.workflowId}-as-step` ||
    selectedChild.transactionId !== `${selectedChild.parentStepId}-${input.transactionId}`))
    return yield* nativeFailure("unsupportedProfile");
  const maximumNativeAttempt = Math.min(pins.attemptNumber, pins.definition.boundPolicy.runAttempt.retry.maxAttempts);
  const sameChildId = (id: string) => {
    if (id === childIdentityPins.transactionId) return true;
    if (inlineChild === undefined || input.recoveryStepId === undefined) return false;
    for (let attempt = 2; attempt <= maximumNativeAttempt; attempt++)
      if (id === `${inlineChild.transactionId}-attempt-${attempt}`) return true;
    return false;
  };
  const sameChildKey = (key: string) => key === childKey ||
    (key.startsWith(`dtrx:${childIdentityPins.workflowId}:`) &&
      sameChildId(key.slice(`dtrx:${childIdentityPins.workflowId}:`.length)));
  let sticky: Cause.Cause<unknown> | undefined;
  let revision = 0n;
  let loaded = false;
  let current: TransactionCheckpoint | undefined;
  let currentChild: TransactionCheckpoint | undefined;
  let prepared: PreparedTrustedWorkflowCheckpoint | undefined;
  let wait: NativeWaitProposal | undefined;
  let retryRequested = false;
  let terminalWakeRequested = false;
  let closed = false;
  const pending = new Set<Promise<void>>();
  const retain = <A>(promise: Promise<A>): Promise<A> => {
    const settled = promise.then(() => {}, () => {});
    pending.add(settled);
    void settled.then(() => { pending.delete(settled); });
    return promise;
  };
  const poison = (cause: Cause.Cause<unknown>) => {
    if (sticky === undefined) sticky = cause;
    revokeTrustedWorkflowExecutionSubject(input.subject);
  };
  const assertHealthy = Effect.suspend(() => sticky !== undefined ? Effect.failCause(sticky)
    : closed ? Effect.fail(commerceError("closed")) : Effect.void);
  const serial = <A, E>(work: Effect.Effect<A, E>) => gate.withPermit(assertHealthy.pipe(Effect.andThen(work)));
  const protect = <A, E>(work: Effect.Effect<A, E>) => assertHealthy.pipe(Effect.andThen(work), Effect.tapCause(cause => Effect.sync(() => poison(cause))));
  const boundary: DurableNativeEffectBoundary = async work => {
    try { return await input.runEffect(protect(work)); }
    catch (cause) {
      if (sticky === undefined) poison(Cause.fail(cause));
      throw new NativeBoundaryFailure();
    }
  };
  const decode = (bytes: Uint8Array) => decodeDurableNativeCheckpoint(bytes, input);
  const decodeCompound = (bytes: Uint8Array) => compoundIdentity === undefined
    ? Effect.fail(nativeFailure("unsupportedProfile")) : decodeDurableNativeCompoundCheckpoint(bytes, compoundIdentity);
  const rememberWait = (checkpoint: TransactionCheckpoint) => {
    if (input.timeoutMs === undefined) return;
    for (const step of Object.values(checkpoint.flow.steps)) {
      if (step.definition?.action !== input.waitStepId || step.invoke.state !== TransactionStepState.INVOKING ||
        step.invoke.status !== TransactionStepStatus.WAITING || step.startedAt === undefined) continue;
      const deadlineAtMs = step.startedAt + input.timeoutMs;
      if (!Number.isSafeInteger(deadlineAtMs)) throw nativeFailure("storedCorruption");
      wait = Object.freeze({ waitId: input.waitStepId, nativeStartedAtMs: step.startedAt,
        timeoutMs: input.timeoutMs, deadlineAtMs });
    }
  };

  const encode = (checkpoint: unknown) => Effect.try({
    try: () => {
      // Genuine JSON encoding invokes native StepResponse.toJSON and preserves
      // native undefined/Error/Date behavior before the opaque core byte API.
      const bytes = utf8.encode(JSON.stringify(checkpoint));
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES) throw nativeFailure("unsupportedProfile");
      return bytes;
    }, catch: cause => commerceError("unsupportedProfile", cause),
  });
  const load = Effect.fn("NativeWorkflow.loadCheckpoint")(function* () {
    if (loaded) return current;
    const result = yield* input.checkpointStore.load(input.subject);
    if (Option.isNone(result)) {
      if (input.requiredCheckpoint !== undefined) return yield* nativeFailure("storedCorruption");
    } else {
      const value = result.value;
      if (value.codec !== codec || (input.requiredCheckpoint !== undefined &&
        (value.revision < input.requiredCheckpoint.revision || (value.revision === input.requiredCheckpoint.revision &&
          (value.byteLength !== input.requiredCheckpoint.byteLength || !bytesEqualFullScan(value.sha256, input.requiredCheckpoint.sha256))))))
        return yield* nativeFailure("storedCorruption");
      if (compoundIdentity === undefined) current = yield* decode(value.bytes);
      else {
        const compound = yield* decodeCompound(value.bytes);
        current = compound.parent;
        currentChild = compound.child;
      }
      revision = value.revision;
      rememberWait(current);
      // A fresh process cannot retain the old opaque prepared handle. Prepare
      // the authenticated unchanged bytes for the continuation owner's CAS.
      prepared = yield* input.checkpointStore.prepare({ expectedRevision: revision - 1n, codec, bytes: value.bytes });
    }
    loaded = true;
    return current;
  });
  const sameParent = (transaction: DistributedTransactionType) => transaction.modelId === input.workflowId && transaction.transactionId === input.transactionId;
  const storage: IDistributedTransactionStorage = {
    get: key => boundary(serial(Effect.gen(function* () {
      const child = sameChildKey(key);
      if (child && compoundIdentity === undefined) return undefined;
      if (!child && key !== parentKey) return yield* nativeFailure("unsupportedProfile");
      // Each hydration gets its own genuine checkpoint; native buildSteps
      // mutates it while restoring methods.
      yield* load();
      const value = child ? currentChild : current;
      if (value === undefined) return undefined;
      if (compoundIdentity === undefined) return yield* encode(value).pipe(Effect.flatMap(decode));
      if (current === undefined) return yield* nativeFailure("storedCorruption");
      const snapshot = yield* encode({ parent: current, child: currentChild ?? null }).pipe(Effect.flatMap(decodeCompound));
      return child ? snapshot.child : snapshot.parent;
    }))),
    save: async (key, checkpoint, _ttl, options) => {
      const outcome = await boundary(serial(Effect.gen(function* () {
      const child = key === childKey && compoundIdentity !== undefined;
      if (!child && key !== parentKey) return yield* nativeFailure("unsupportedProfile");
      yield* load();
      // Native merge mutates checkpoints. Detach both branches before borrowing
      // either one, keeping one shared Task revision and serialization gate.
      const detached = current === undefined ? undefined : compoundIdentity === undefined
        ? { parent: yield* encode(current).pipe(Effect.flatMap(decode)), child: undefined }
        : yield* encode({ parent: current, child: currentChild ?? null }).pipe(Effect.flatMap(decodeCompound));
      const stored = child ? detached?.child : detached?.parent;
      const merged = Result.try({ try: () => mergeNativeWorkflowCheckpointForSave(checkpoint, stored, options), catch: cause => cause });
      if (Result.isFailure(merged)) {
        if (merged.failure instanceof Error && TransactionOrchestrator.isExpectedError(merged.failure))
          return { kind: "nativeControl" as const, error: merged.failure };
        return yield* Effect.die(merged.failure);
      }
      if (child && current === undefined) return yield* nativeFailure("storedCorruption");
      const bytes = yield* encode(compoundIdentity === undefined ? checkpoint : {
        parent: child ? current : checkpoint, child: child ? checkpoint : currentChild ?? null,
      });
      const snapshot = compoundIdentity === undefined ? { parent: yield* decode(bytes), child: undefined }
        : yield* decodeCompound(bytes);
      const next = yield* input.checkpointStore.prepare({ expectedRevision: revision, codec, bytes });
      const saved = yield* input.checkpointStore.save(input.subject, next);
      revision = saved.checkpoint.revision;
      current = snapshot.parent;
      currentChild = snapshot.child;
      rememberWait(snapshot.parent);
      prepared = next;
      const returned = compoundIdentity === undefined ? { parent: yield* decode(bytes), child: undefined }
        : yield* decodeCompound(bytes);
      const savedCheckpoint = child ? returned.child : returned.parent;
      if (savedCheckpoint === undefined) return yield* nativeFailure("storedCorruption");
      return { kind: "saved" as const, checkpoint: savedCheckpoint };
      })));
      // Native expected control is not a failed core operation. Let the
      // genuine orchestrator handle it after the Effect boundary succeeded.
      if (outcome.kind === "nativeControl") throw outcome.error;
      return outcome.checkpoint;
    },
    scheduleStepTimeout: (transaction, step, _timestamp, interval) => boundary(Effect.try({ try: () => {
      if (input.timeoutMs === undefined || !sameParent(transaction) || step.definition.action !== input.waitStepId || interval * 1000 !== input.timeoutMs ||
        step.startedAt === undefined || !Number.isSafeInteger(step.startedAt)) throw nativeFailure("unsupportedProfile");
      const proposal = Object.freeze({ waitId: input.waitStepId, nativeStartedAtMs: step.startedAt,
        timeoutMs: input.timeoutMs, deadlineAtMs: step.startedAt + input.timeoutMs });
      if (!Number.isSafeInteger(proposal.deadlineAtMs) || (wait !== undefined && graphBytes(wait) !== graphBytes(proposal))) throw nativeFailure("storedCorruption");
      wait = proposal;
    }, catch: cause => commerceError("unsupportedProfile", cause) })),
    clearStepTimeout: transaction => boundary(sameParent(transaction) ? Effect.void : Effect.fail(nativeFailure("unsupportedProfile"))),
    clearTransactionTimeout: transaction => boundary(sameParent(transaction) ||
      (transaction.modelId === childIdentityPins.workflowId && sameChildId(transaction.transactionId))
      ? Effect.void : Effect.fail(nativeFailure("unsupportedProfile"))),
    scheduleRetry: (transaction, step, _timestamp, interval) => boundary(serial(Effect.gen(function* () {
      const latest = yield* load();
      if (pins.executionMode !== "workflow" || !sameParent(transaction) || input.recoveryStepId === undefined ||
        step.definition.action !== input.recoveryStepId || step.definition.async !== true || step.definition.nested !== true ||
        interval !== 0 || step.attempts < 1 || step.attempts > maximumNativeAttempt)
        return yield* nativeFailure("unsupportedProfile");
      // A nested child's older callback can receive the parent's provider
      // failure after compensation already finished. Native queues one wake
      // from that stale FAILED step. Preserve the newer merged FAILED parent;
      // the interpreter consumes the wake with one genuine run below.
      if (latest?.flow.state === TransactionState.FAILED && transaction.getFlow().state === TransactionState.WAITING_TO_COMPENSATE &&
        step.invoke.state === TransactionStepState.FAILED && step.invoke.status === TransactionStepStatus.PERMANENT_FAILURE &&
        step.compensate.state === TransactionStepState.DORMANT && step.compensate.status === TransactionStepStatus.IDLE &&
        !step.hasScheduledRetry && step.retryRescheduledAt == null) {
        terminalWakeRequested = true;
        return;
      }
      if (step.invoke.status !== TransactionStepStatus.WAITING || !step.hasScheduledRetry ||
        !step.retryRescheduledAt || step.attempts + 1 > maximumNativeAttempt)
        return yield* nativeFailure("unsupportedProfile");
      // The native retry metadata was already checkpointed by retryStep. The
      // caller consumes this immediate proposal with the genuine parent run;
      // no autonomous scheduler survives this attempt.
      retryRequested = true;
    }))),
    clearRetry: (transaction, step) => boundary(sameParent(transaction) && input.recoveryStepId !== undefined &&
      step.definition.action === input.recoveryStepId && step.attempts >= 1 && step.attempts <= maximumNativeAttempt
      ? Effect.void : Effect.fail(nativeFailure("unsupportedProfile"))),
    scheduleTransactionTimeout: () => boundary(Effect.fail(nativeFailure("unsupportedProfile"))),
    clearExpiredExecutions: () => boundary(Effect.fail(nativeFailure("unsupportedProfile"))),
  };
  const runtime: NativeWorkflowRuntime = { storage, clock: input.clock, background: { execute: work => {
    if (closed) { poison(Cause.fail(nativeFailure("unsupportedProfile"))); return; }
    // Start synchronously, as native `void exec()` did, while retaining every
    // result. Capture thrown/rejected work before it can become unhandled.
    let promise: Promise<unknown>;
    try { promise = work(); } catch (cause) { poison(Cause.fail(cause)); return; }
    retain(promise.then(() => {}, cause => { if (sticky === undefined) poison(Cause.fail(cause)); }));
  } } };
  const drain = Effect.tryPromise({ try: async () => {
    while (pending.size > 0) await Promise.all([...pending]);
  }, catch: cause => cause });
  return Object.freeze({ runtime, boundary, drain, assertHealthy,
    runNative: <A>(work: () => Promise<A>) => retain(work()),
    checkpoint: protect(serial(load())),
    poison: (cause: Cause.Cause<unknown>) => Effect.sync(() => poison(cause)),
    latest: Effect.sync(() => prepared === undefined ? undefined : Object.freeze({ prepared, revision })),
    waitProposal: Effect.sync(() => wait),
    retryRequested: Effect.sync(() => retryRequested),
    terminalWakeRequested: Effect.sync(() => terminalWakeRequested),
    close: Effect.sync(() => { closed = true; }),
  });
});

import { Clock, Effect, Exit, Result, Schema } from "effect";
import { TransactionState } from "@medusajs/orchestration/transaction";
import type { WorkflowContainer } from "@medusajs/orchestration/runtime";
import { WorkflowOrchestratorService, WorkflowsModuleService } from "@medusajs/workflows-sdk/durable/engine";
import { markFulfillmentAsDeliveredWorkflow, markFulfillmentAsDeliveredWorkflowId } from "@medusajs/core-flows/durable/fulfillment/mark-fulfillment-as-delivered";
import { updateFulfillmentWorkflowId } from "@medusajs/core-flows/durable/fulfillment/update-fulfillment";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { makeTrustedWorkflowCheckpointStore } from "@flarex/persistence-postgres/internal/trusted-workflow-checkpoint";
import { makeTrustedWorkflowEventEligibilityStore } from "@flarex/persistence-postgres/internal/trusted-workflow-event-eligibility";
import { inspectTrustedWorkflowInterpreterSubject, type TrustedWorkflowInterpreterSubject, type TrustedWorkflowExecutionSubject,
  type TrustedWorkflowControlSubject } from "@flarex/persistence-postgres/internal/trusted-workflow-execution-subject";
import { prepareCommitEventEligibility } from "@flarex/persistence-postgres/internal/commit-event-eligibility";
import { commerceError, CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { compileFulfillmentCreationContracts, captureFulfillmentBusinessDates } from "../../modules/fulfillment/fulfillment-create-input";
import { captureFulfillmentCreationMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import { decodeFulfillmentShipmentRead, decodeFulfillmentShipmentUpdate } from "../../modules/fulfillment/fulfillment-shipment-input";
import { makeDurableNativeStorage, decodeDurableNativeCompoundCheckpoint, nativeCompoundCheckpointCodec,
  type DurableNativeEffectBoundary } from "../../workflow/durable-native-storage";
import { makeFulfillmentDeliveryLocking } from "../../workflow/durable-locking";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { prepareFulfillmentDeliveryDatabase } from "./delivery-database";
import { fulfillmentDeliveryPolicy, fulfillmentDeliveryProfile, type FulfillmentDeliveryInput } from "./delivery-input";

type Database = Effect.Success<ReturnType<typeof prepareFulfillmentDeliveryDatabase>>;
type Locking = Effect.Success<ReturnType<typeof makeFulfillmentDeliveryLocking>>;
type TaskOptions = Omit<Parameters<typeof makeTrustedWorkflowEventEligibilityStore>[0], "roles">;
const childStep = `${updateFulfillmentWorkflowId}-as-step`;
const decodeChildInput = commerceDecoder(Schema.Struct({ id: Schema.String, delivered_at: Schema.String }), "storedCorruption");
const decodeQueryCall = commerceDecoder(Schema.Tuple([
  Schema.Struct({ entryPoint: Schema.Literal("fulfillment"), fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("delivered_at"), Schema.Literal("canceled_at")]),
    variables: Schema.Struct({ id: Schema.String }) }),
  Schema.Struct({ throwIfKeyNotFound: Schema.Literal(true) }),
]), "unsupportedProfile");

function containerFor(services: ReadonlyMap<string, unknown>): WorkflowContainer {
  return { resolve<Value>(name: string, options?: { allowUnregistered?: boolean }): Value {
    if (!services.has(name) && !options?.allowUnregistered) throw commerceError("unsupportedProfile");
    // SAFETY: the fixed trusted native graph supplies each service. The generic
    // framework resolver cannot express this key/value correlation.
    return services.get(name) as Value;
  } };
}
const checkpointIdentity = (input: FulfillmentDeliveryInput, runId: string) => ({
  workflowId: markFulfillmentAsDeliveredWorkflowId, transactionId: runId, expectedInput: input,
  expectedEventGroupId: runId, checkpointedChild: { workflowId: updateFulfillmentWorkflowId,
    transactionId: `${childStep}-${runId}`, parentStepId: childStep,
    validateInput: (raw: Json) => decodeChildInput(raw).pipe(Result.flatMap(value => value.id === input.id
      ? Result.succeed(undefined) : Result.fail(commerceError("storedCorruption")))),
  },
});

/** Genuine native parent and child execution outside SQL. Authenticated short
 * database children, callback receipts and native checkpoints keep their owners.
 * An acquisition receipt never authorizes resuming an expired or restarted lock. */
export const makeFulfillmentDeliveryInterpreter = Effect.fn("FulfillmentDelivery.makeInterpreter")(function* <HashFailure>(config: {
  readonly task: TaskOptions;
  readonly checkpointStore: ReturnType<typeof makeTrustedWorkflowCheckpointStore<HashFailure>>;
  readonly database: Database;
  readonly locking: Locking;
  readonly revision: string;
  readonly runEffect: DurableNativeEffectBoundary;
}) {
  const metadata = yield* captureFulfillmentCreationMetadata();
  const contracts = yield* Effect.fromResult(compileFulfillmentCreationContracts(metadata.frame));
  const decodeResult = (raw: unknown) => Effect.fromResult(captureCommerceInput(raw)).pipe(
    Effect.flatMap(value => Effect.fromResult(contracts.decodeOutput(value))));
  const eligibility = yield* makeTrustedWorkflowEventEligibilityStore({ ...config.task, roles: [
    { role: "delivery-forward", policyRevision: config.revision, maximumCommits: 3, maximumOccurrences: 1 },
    { role: "delivery-inverse", policyRevision: config.revision, maximumCommits: 1, maximumOccurrences: 1 },
  ] });
  const readResult = Effect.fn("FulfillmentDelivery.readResult")(function* (input: {
    readonly input: FulfillmentDeliveryInput; readonly runId: string;
    readonly checkpoint: Readonly<{ codec: string; bytes: Uint8Array }>;
  }) {
    if (input.checkpoint.codec !== nativeCompoundCheckpointCodec) return yield* commerceError("storedCorruption");
    const checkpoint = yield* decodeDurableNativeCompoundCheckpoint(input.checkpoint.bytes, checkpointIdentity(input.input, input.runId));
    if (checkpoint.parent === undefined) return yield* commerceError("storedCorruption");
    if (checkpoint.parent.flow.state !== TransactionState.DONE) return null;
    return yield* Effect.tryPromise({ try: () => Promise.resolve(markFulfillmentAsDeliveredWorkflow().resolveResult(checkpoint.parent!)),
      catch: cause => commerceError("storedCorruption", cause) }).pipe(Effect.flatMap(decodeResult));
  });
  const execute = Effect.fn("FulfillmentDelivery.interpret")(function* (input: {
    readonly subject: TrustedWorkflowInterpreterSubject; readonly input: FulfillmentDeliveryInput;
    readonly observedAtMs: number; readonly cancellationRequested: boolean;
  }) {
    const pins = yield* Effect.fromResult(inspectTrustedWorkflowInterpreterSubject(input.subject));
    if (pins.definition.executionProfile !== fulfillmentDeliveryProfile || !jsonEqual(pins.definition.executionPolicy, fulfillmentDeliveryPolicy) ||
      (input.cancellationRequested && pins.executionMode !== "control") || !Number.isSafeInteger(input.observedAtMs) || input.observedAtMs < 0)
      return yield* commerceError("invalidAuthority");
    const clock = yield* Clock.Clock, started = clock.monotonicTimeNanosUnsafe();
    const bridge = yield* makeDurableNativeStorage({ ...checkpointIdentity(input.input, pins.runId), subject: input.subject,
      checkpointStore: config.checkpointStore, runEffect: config.runEffect,
      clock: { now: () => input.observedAtMs + Number((clock.monotonicTimeNanosUnsafe() - started) / 1_000_000n) } });
    const services = new Map<string, unknown>(), container = containerFor(services);
    const engine = new WorkflowOrchestratorService(bridge.runtime, container), module = new WorkflowsModuleService(engine);
    services.set("workflows", module);
    const group = (inverse: boolean) => ({ role: inverse ? "delivery-inverse" : "delivery-forward", occurrence: 1 });
    const dispatch = <Value extends Parameters<Database["ordinary"]["runTaskChild"]>[2]>(value: Value) => Effect.gen(function* () {
      if (pins.executionMode !== "workflow") return yield* commerceError("invalidAuthority");
      yield* config.locking.assertAcquisitionObservation(input.subject, input.input.id);
      const gates = yield* Effect.fromResult(prepareCommitEventEligibility([yield* eligibility.open(input.subject, group(false))]));
      // SAFETY: inspection authenticated the exact opaque ordinary subject;
      // core entry and settlement repeat live mode/binding/lease checks.
      return yield* config.database.ordinary.runTaskChild(input.subject as TrustedWorkflowExecutionSubject,
        value.kind === "query" ? 1n : value.kind === "retrieve" ? 2n : 3n, value, gates);
    });
    const inverse = (id: string) => Effect.gen(function* () {
      const gates = yield* Effect.fromResult(prepareCommitEventEligibility([yield* eligibility.open(input.subject, group(true))]));
      const value = { id, data: { delivered_at: null } };
      // SAFETY: each exact issuer mode was authenticated above; neither branch
      // issues capabilities. The core repeats current authority at settlement.
      return pins.executionMode === "control"
        ? yield* config.database.inverse.runControlChild(input.subject as TrustedWorkflowControlSubject, 4n, value, gates)
        : yield* config.database.inverse.runTaskChild(input.subject as TrustedWorkflowExecutionSubject, 4n, value, gates);
    });
    // A native business error from a successfully refused short call remains
    // native failure data. Core/authority/corruption failures poison the bridge.
    const nativeCall = async <A>(work: Effect.Effect<A, unknown>) => {
      const result = await bridge.boundary(work.pipe(Effect.map(value => ({ kind: "returned" as const, value })),
        Effect.catch(error => error instanceof CommerceTransactionError && error.reason === "adapterFailure" && error.cause instanceof MedusaError
          ? Effect.succeed({ kind: "businessFailure" as const, error: error.cause }) : Effect.fail(error))));
      if (result.kind === "businessFailure") throw result.error;
      return result.value;
    };
    const checkId = (id: unknown) => id === input.input.id ? Effect.void : Effect.fail(commerceError("unsupportedProfile"));
    services.set("remoteQuery", async (...args: unknown[]) => {
      const [query] = await bridge.boundary(Effect.fromResult(captureCommerceInput(args).pipe(Result.flatMap(decodeQueryCall))));
      await bridge.boundary(checkId(query.variables.id));
      return nativeCall(dispatch({ kind: "query", id: query.variables.id }));
    });
    services.set("fulfillment", {
      retrieveFulfillment: async (id: unknown, config: unknown) => {
        const value = await bridge.boundary(Effect.fromResult(decodeFulfillmentShipmentRead({ id, config })));
        await bridge.boundary(checkId(value.id));
        if (value.config === undefined) return bridge.boundary(Effect.fail(commerceError("unsupportedProfile")));
        return nativeCall(dispatch({ kind: "retrieve", id: value.id, config: value.config }));
      },
      updateFulfillment: async (id: unknown, data: unknown) => {
        await bridge.boundary(checkId(id));
        const value = await bridge.boundary(Effect.fromResult(captureFulfillmentBusinessDates(data).pipe(Result.flatMap(decodeFulfillmentShipmentUpdate))));
        if (!("delivered_at" in value)) return bridge.boundary(Effect.fail(commerceError("unsupportedProfile")));
        return value.delivered_at === null ? nativeCall(inverse(input.input.id))
          : nativeCall(dispatch({ kind: "update", id: input.input.id, data: { delivered_at: value.delivered_at } }));
      },
    });
    services.set("locking", config.locking.serviceFor({ subject: input.subject, id: input.input.id, boundary: bridge.boundary }));
    const decide = (rawGroup: unknown, decision: "released" | "cleared") => bridge.boundary(Effect.gen(function* () {
      if (rawGroup !== pins.runId) return yield* commerceError("invalidAuthority");
      for (const isInverse of decision === "released" ? [false] : [false, true]) {
        const selection = group(isInverse), current = yield* eligibility.inspect(input.subject, selection);
        // Native clear affects only currently pending messages. Previously
        // published forward events stay published during later cancellation.
        if (current.state !== "held") {
          if (decision === "released" && current.state !== "released") return yield* commerceError("receiptMismatch");
          continue;
        }
        yield* eligibility.decide(input.subject, selection, decision);
      }
    }));
    services.set("event_bus", { releaseGroupedEvents: (group: unknown) => decide(group, "released"),
      clearGroupedEvents: (group: unknown) => decide(group, "cleared") });
    const foreign = <A>(work: () => Promise<A>) => Effect.tryPromise({ try: () => bridge.runNative(work),
      catch: cause => commerceError("adapterFailure", cause) }).pipe(Effect.catchCause(cause =>
        bridge.assertHealthy.pipe(Effect.andThen(Effect.failCause(cause)))));
    return yield* Effect.gen(function* () {
      const stored = yield* bridge.checkpoint;
      if (stored !== undefined && [TransactionState.DONE, TransactionState.FAILED, TransactionState.REVERTED].includes(stored.flow.state) &&
        !(pins.executionMode === "control" && stored.flow.state === TransactionState.DONE)) {
        const transaction = yield* foreign(() => engine.getRunningTransaction(markFulfillmentAsDeliveredWorkflowId, pins.runId));
        yield* foreign(() => markFulfillmentAsDeliveredWorkflow(container).recoverTerminalEvents(transaction, { runtime: bridge.runtime }));
      } else if (pins.executionMode === "control") {
        if (stored === undefined) return yield* commerceError("resultUnavailable");
        if (stored.flow.cancelledAt !== undefined || stored.flow.state === TransactionState.COMPENSATING || stored.flow.state === TransactionState.WAITING_TO_COMPENSATE)
          yield* foreign(() => module.run(markFulfillmentAsDeliveredWorkflowId, { transactionId: pins.runId, input: input.input,
            context: { eventGroupId: pins.runId }, throwOnError: false }));
        else yield* foreign(() => module.cancel(markFulfillmentAsDeliveredWorkflowId, { transactionId: pins.runId,
          context: { eventGroupId: pins.runId }, throwOnError: false }));
      } else yield* foreign(() => module.run(markFulfillmentAsDeliveredWorkflow, { transactionId: pins.runId, input: input.input,
        context: { eventGroupId: pins.runId }, throwOnError: false }));
      yield* bridge.drain;
      yield* bridge.assertHealthy;
      const transaction = yield* foreign(() => engine.getRunningTransaction(markFulfillmentAsDeliveredWorkflowId, pins.runId));
      if (!transaction.hasFinished()) return yield* commerceError("resultUnavailable");
      const state = transaction.getFlow().state;
      const result = yield* Effect.exit(foreign(() => Promise.resolve(markFulfillmentAsDeliveredWorkflow(container).resolveResult(transaction))).pipe(Effect.flatMap(decodeResult)));
      yield* bridge.assertHealthy;
      if (Exit.isFailure(result) && state === TransactionState.DONE) return yield* Effect.failCause(result.cause);
      return Object.freeze({ kind: "finished" as const, state, result: Exit.isSuccess(result) ? result.value : null, errors: transaction.getErrors() });
    }).pipe(Effect.onExit(exit => Effect.uninterruptible(Effect.gen(function* () {
      if (Exit.isFailure(exit)) yield* bridge.poison(exit.cause);
      yield* bridge.drain.pipe(Effect.ensuring(bridge.close));
    }))));
  });
  return Object.freeze({ execute, readResult });
});

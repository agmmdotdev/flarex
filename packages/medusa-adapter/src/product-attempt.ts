import { Effect, Result, Schema } from "effect";
import { captureAtomicCommerceEvents, commerceCommandIdentity, defineCommerceEventContract,
  admittedCommerceEventGroup, makeBorrowedLogicalAttempt, prepareAdmittedCommerceEventIntents,
  prepareAtomicCommerceEvents, runCommerceCommand, type CommerceCommand,
  type CommitEventSubscriber, type ParticipantEventSelection, type CommittedEvent,
  type LogicalDocumentChanges } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { isJsonObject } from "flarex-protocol/json";
import { captureCommerceInput } from "./commerce-input";
import { commerceDecoder } from "./commerce-decoder";
import { makeLocalProductCommands } from "./product-service";

type ProductRuntime = Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
type ProductAttemptCommand = Readonly<{ command: CommerceCommand; args: Json }>;

const ProductId = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeUpdate = commerceDecoder(Schema.Struct({
  id: ProductId,
  data: Schema.Struct({ title: Schema.String, handle: Schema.String, status: Schema.Literal("published") }),
}), "unsupportedProfile");
const decodeRetrieve = commerceDecoder(Schema.Struct({ id: ProductId }), "unsupportedProfile");
const decodeListByHandle = commerceDecoder(Schema.Struct({
  filters: Schema.Struct({ handle: Schema.String }),
}), "unsupportedProfile");

/** Selects only the native Product calls admitted in the private mixed attempt.
 * The runtime owns their service, manager and event receipt policy; the root
 * attempt authenticates and settles each selected command. */
export function bindPrivateProductAttempt(runtime: Pick<ProductRuntime, "commands" | "logicalPolicy" | "metadata">) {
  const bind = <Input extends Json>(command: CommerceCommand, decode: (input: unknown) => Result.Result<Input, CommerceTransactionError>) =>
    (input: unknown): Result.Result<ProductAttemptCommand, CommerceTransactionError> =>
      Result.gen(function* () {
        const captured = yield* captureCommerceInput(input);
        const args = yield* decode(captured);
        return { command, args };
      });
  return Object.freeze({
    update: bind(runtime.commands.update, decodeUpdate),
    retrieve: bind(runtime.commands.retrieve, decodeRetrieve),
    listByHandle: bind(runtime.commands.list, decodeListByHandle),
    logicalPolicy: runtime.logicalPolicy,
    metadata: runtime.metadata,
  });
}

/** Private host entry point. Preparation has no request manager or live service;
 * each admitted invocation constructs the actual Product service with the
 * root's borrowed operation context. */
export const preparePrivateProductAttempt = Effect.fn("ProductAdapter.preparePrivateAttempt")(function* () {
  return bindPrivateProductAttempt(yield* makeLocalProductCommands());
});

export type PrivateProductAttemptOperation = "update" | "retrieve" | "listByHandle";
type PrivateProductAttemptBinding = ReturnType<typeof bindPrivateProductAttempt>;
type BorrowedProductAttempt = Effect.Success<ReturnType<typeof makeBorrowedLogicalAttempt>>;
export type PrivateProductAttemptExecution = Readonly<{ result: Json;
  changes: LogicalDocumentChanges;
  events: readonly Json[];
  eventIntents: readonly CommittedEvent[];
  workBytes: number;
  workCalls: number }>;
export type PrivateProductAttemptEventPolicy = Readonly<{
  selection: ParticipantEventSelection;
  policy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>>;
}>;

/** The trusted host pins one native Product event contract and subscribers.
 * Neither revision nor subscriber selection comes from the sandbox frame. */
export const preparePrivateProductAttemptEventPolicy = Effect.fn("ProductAdapter.preparePrivateEvents")(
  function* (binding: PrivateProductAttemptBinding, input: Readonly<{
    producerRevision: string; contractRevision: string;
    subscribers: readonly CommitEventSubscriber[];
  }>): Effect.fn.Return<PrivateProductAttemptEventPolicy, CommerceTransactionError> {
    const name = binding.metadata.product.updatedEvent;
    const contract = defineCommerceEventContract({ name, revision: input.contractRevision,
      internal: true, decode: binding.logicalPolicy.capture });
    const selection: ParticipantEventSelection = Object.freeze({
      contracts: Object.freeze([contract]),
      select: (message: Json) => isJsonObject(message) && message.name === name
        ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")),
    });
    const captured = yield* Effect.fromResult(captureAtomicCommerceEvents({
      producerRevision: input.producerRevision, contracts: [contract],
      subscribers: input.subscribers,
      validate: events => events.every(event => event.contract === name && event.internal)
        ? Effect.void : Effect.fail(commerceError("unadmittedEvent")),
    }));
    const policy = yield* prepareAtomicCommerceEvents(captured);
    return Object.freeze({ selection, policy });
  });

/** Run one checked native operation inside the root's borrowed context. The
 * command token authenticates the selected service method; event capture stays
 * with Product while the root records and settles the resulting intent. */
export const executePrivateProductAttemptOperation: (
  binding: PrivateProductAttemptBinding, borrowed: BorrowedProductAttempt,
  operation: unknown, input: unknown, eventPolicy: PrivateProductAttemptEventPolicy,
) => Effect.Effect<PrivateProductAttemptExecution, CommerceTransactionError> =
  Effect.fn("ProductAdapter.executePrivateAttempt")(function* (
  binding: PrivateProductAttemptBinding, borrowed: BorrowedProductAttempt,
  operation: unknown, input: unknown,
  eventPolicy: PrivateProductAttemptEventPolicy,
): Effect.fn.Return<PrivateProductAttemptExecution, CommerceTransactionError> {
  const select = operation === "update" ? binding.update
    : operation === "retrieve" ? binding.retrieve
      : operation === "listByHandle" ? binding.listByHandle : undefined;
  if (select === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const selected = yield* Effect.fromResult(select(input));
  const identity = commerceCommandIdentity(selected.command);
  if (identity === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const cursor = borrowed.activityCursor();
  const nativeContext = Object.freeze({ ...borrowed.context,
    captureLocalEvent: (event: unknown) => Effect.flatMap(binding.logicalPolicy.capture(event),
      captured => borrowed.context.captureLocalEvent(captured)),
  });
  const result = yield* borrowed.withinDeadline(runCommerceCommand(selected.command, nativeContext, selected.args));
  const activity = yield* borrowed.callActivity(cursor);
  const closed = yield* borrowed.close;
  if (identity.mode === "read" && (activity.mutations.length !== 0 || activity.lifecycle.length !== 0 ||
    activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 || closed.events.length !== 0))
    return yield* Effect.fail(commerceError("receiptMismatch"));
  yield* binding.logicalPolicy.validateLogicalCall(Object.freeze({ commandName: identity.name, mode: identity.mode,
    input: selected.args, result, events: closed.events, fromAttempt: 0, toAttempt: activity.mutations.length,
    fromLifecycle: 0, toLifecycle: activity.lifecycle.length }), activity, selected.command);
  const eventIntents = yield* prepareAdmittedCommerceEventIntents(eventPolicy.policy,
    eventPolicy.selection, closed.events, admittedCommerceEventGroup(borrowed.rootIdentity));
  return Object.freeze({ result, changes: closed.changes, events: closed.events,
    eventIntents, workBytes: closed.workBytes, workCalls: closed.workCalls });
});

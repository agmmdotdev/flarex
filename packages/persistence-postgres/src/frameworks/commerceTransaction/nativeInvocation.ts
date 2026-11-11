import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CoreNativeBindingMetadata, CoreNativeOperations } from "../../core/api";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { observeExecution } from "../../execution/diagnostics/operation";
import { getCommerceCommand, type CommerceCommand } from "./commands";
import { makeCommerceCommandContext } from "./context";
import { captureCommerceJsonData } from "./json";
import { commerceError, type CommerceTransactionError } from "./model";
import { makeNativeCommerceParticipant } from "./nativeStore";
import type { CommerceResources } from "./resources";

/** Native command translation over a confined existing operation. The outer
 * owner retains request claims, event publication, finalization and settlement. */
export const makeBorrowedNativeCommerceInvocation = Effect.fn("NativeCommerce.makeInvocation")(function* (
  input: Readonly<{
    operations: CoreNativeOperations;
    metadata: CoreNativeBindingMetadata;
    commands: readonly CommerceCommand[];
    lifetime: BoundedRequestLifetime<CommerceTransactionError>;
    transactionId: string;
    unixTime: number;
    resources: CommerceResources;
    mode: "read" | "write";
    readBinding: Effect.Effect<CoreNativeBindingMetadata, CommerceTransactionError>;
    captureEvent?: (context: BoundedRequestContext, event: unknown) => Effect.Effect<void, CommerceTransactionError>;
  }>,
) {
  const { lifetime, transactionId } = input;
  const allowed = new Set(input.commands);
  const working = yield* makeNativeCommerceParticipant(input.operations, input.metadata, lifetime,
    lifetime.context, transactionId, input.unixTime, input.resources);
  const invoke = Effect.fn("NativeCommerce.invoke")(function* (
    context: BoundedRequestContext, token: CommerceCommand, args: Json,
  ): Effect.fn.Return<Json, CommerceTransactionError> {
    const metadata = yield* input.readBinding;
    const definition = getCommerceCommand(token);
    if (!allowed.has(token) || definition === undefined || input.mode === "read" && definition.mode !== "read")
      return yield* commerceError("invalidAuthority");
    if (!metadata.commands.some(command => command.name === definition.name && command.mode === definition.mode))
      return yield* commerceError("bindingChanged");
    yield* lifetime.checkpoint(context);
    const captured = yield* lifetime.fromResult(captureCommerceJsonData(args, lifetime.remainingBytes()));
    yield* lifetime.fromResult(lifetime.charge(captured.bytes));
    const captureEvent = (manager: BoundedRequestContext, event: unknown) => lifetime.operation(manager, transactionId, "write",
      input.captureEvent === undefined ? Effect.fail(commerceError("unadmittedEvent")) : input.captureEvent(manager, event));
    const result = yield* observeExecution(`NativeCommerce.invoke/${definition.name}`, definition.run(
      makeCommerceCommandContext(lifetime, working, transactionId, context, invoke, captureEvent), captured.value));
    yield* lifetime.checkpoint(context);
    const output = yield* lifetime.fromResult(captureCommerceJsonData(result, lifetime.remainingBytes()));
    yield* lifetime.fromResult(lifetime.charge(output.bytes));
    return output.value;
  });
  const borrow = Effect.fn("NativeCommerce.borrow")(function* (token: CommerceCommand, args: Json) {
    // Enter before selection/capture so caught refusals and dropped callbacks
    // remain owned by this root, including commands that perform no storage work.
    return yield* lifetime.nested(lifetime.context, transactionId,
      context => invoke(context, token, args), getCommerceCommand(token)?.mode);
  });
  return Object.freeze({ invoke, borrow, working });
});

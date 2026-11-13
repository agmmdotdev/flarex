import { Cause, Effect, Result, Schema } from "effect";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import { WorkflowDefinitionError, type PreparedWorkflow, type WorkflowContainer } from "@medusajs/workflows-sdk";
import { getOrderDetailWorkflow } from "@medusajs/core-flows/order/get-order-detail";
import { getOrdersListWorkflow } from "@medusajs/core-flows/order/get-orders-list";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommercePromiseOwner } from "../../module/promise-owner";
import { captureWorkflowInput } from "../../workflow/value";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import { StoreOrderListFilters, storeOrderPageLimit, storeOrderReadResources } from "../../modules/order/store-read-input";

const Fields = Schema.Array(Schema.String.check(Schema.isBetweenLength(1, 256))).check(Schema.isMaxLength(256));
const decodeDetail = commerceDecoder(Schema.Struct({ fields: Fields, order_id: ScalarId,
  filters: Schema.Struct({ is_draft_order: Schema.Literal(false) }),
}), "invalidInput");
const decodeList = commerceDecoder(Schema.Struct({ fields: Fields, variables: Schema.Struct({ filters: StoreOrderListFilters,
  take: QueryLimit.check(Schema.isLessThanOrEqualTo(storeOrderPageLimit)), skip: QueryOffset,
  order: Schema.optionalKey(Schema.UndefinedOr(Schema.Struct({ id: Schema.Literals(["ASC", "DESC"]) }))),
}) }), "invalidInput");

export interface StoreOrderReadPorts {
  readonly graph: (value: unknown, options?: unknown) => Effect.Effect<unknown, CommerceTransactionError>;
  readonly remoteQuery: (value: unknown, options?: unknown) => Effect.Effect<unknown, CommerceTransactionError>;
}
const definitionFailure = (failure: WorkflowDefinitionError) => commerceError("unsupportedProfile", failure);

/** Read workflow composition owns no database, transaction or durable outcome.
 * Each native service fetch retains its existing protected read operation. */
export const prepareStoreOrderReadWorkflows = Effect.fn("StoreOrder.prepareReads")(function* (ports: StoreOrderReadPorts) {
  const { graph, remoteQuery } = ports;
  const detail = yield* Effect.fromResult(getOrderDetailWorkflow.prepare()).pipe(Effect.mapError(definitionFailure));
  const list = yield* Effect.fromResult(getOrdersListWorkflow.prepare()).pipe(Effect.mapError(definitionFailure));
  const run = Effect.fn("StoreOrder.readWorkflow")(function* (definition: PreparedWorkflow, input: unknown) {
    const owner = yield* makeCommercePromiseOwner();
    return yield* owner.withClose(Effect.gen(function* () {
      const query = Object.assign((value: unknown, options?: unknown) => owner.run(remoteQuery(value, options)), {
        maxPageSize: storeOrderPageLimit,
        graph: (value: unknown, options?: unknown) => owner.run(graph(value, options)),
      });
      function resolve<Value>(name: string): Value;
      function resolve<Value>(name: string, options: { readonly allowUnregistered: true }): Value | undefined;
      function resolve<Value>(name: string, _options?: { readonly allowUnregistered: true }): Value | undefined {
        owner.assertOpen();
        if (arguments.length !== 1 || name !== "query") owner.reject(commerceError("invalidAuthority"));
        // SAFETY: this fixed native read closure resolves only its Query ABI;
        // actual descriptors still enter the supplied authenticated read ports.
        return query as Value;
      }
      const container: WorkflowContainer = Object.freeze({ resolve });
      const checkpoint = owner.invoke(async () => undefined);
      const result = yield* executeWorkflow(definition, input, { context: { container, eventGroupId: `store-order-read/${crypto.randomUUID()}` },
        resolutionNodes: storeOrderReadResources.valueNodes,
        checkpoint, capture: value => checkpoint.pipe(Effect.andThen(Effect.fromResult(captureWorkflowInput(value, "preserveOwnUndefined", storeOrderReadResources)))),
        invoke: work => owner.invoke(async () => work(), error => error instanceof WorkflowDefinitionError ? definitionFailure(error) : undefined),
      }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, failure =>
        failure instanceof WorkflowDefinitionError ? definitionFailure(failure) : failure))));
      if (owner.hasPending()) return yield* Effect.fail(commerceError("overlappingOperation"));
      return yield* Effect.fromResult(captureWorkflowInput(result, "preserveOwnUndefined", storeOrderReadResources));
    }));
  });
  return Object.freeze({
    detail: Effect.fn("StoreOrder.detail")(function* (input: unknown) {
      const args = yield* Effect.fromResult(captureWorkflowInput(input, "preserveOwnUndefined", storeOrderReadResources).pipe(Result.flatMap(decodeDetail)));
      return yield* run(detail, args);
    }),
    list: Effect.fn("StoreOrder.list")(function* (input: unknown) {
      const args = yield* Effect.fromResult(captureWorkflowInput(input, "preserveOwnUndefined", storeOrderReadResources).pipe(Result.flatMap(decodeList)));
      return yield* run(list, args);
    }),
  });
});

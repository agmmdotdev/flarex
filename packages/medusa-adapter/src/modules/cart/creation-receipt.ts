import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { jsonEqual } from "flarex-protocol/json";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { validateCartCreated } from "./creation-forward-receipt";
import { validateCartCreationInverse } from "./creation-inverse-receipt";
import { decodeCartCreationReceipt } from "./creation-input";
import type { prepareCartCreationRepository } from "./creation-repository";


const id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.CART), object: Schema.Literals(["cart", "address", "line_item", "line_item_tax_line", "line_item_adjustment",
    "cart_creation_operation", "cart_creation_cart", "cart_creation_address"]), action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([id, Schema.Array(id).check(Schema.isLengthBetween(1, 8))]) }) }), defaultCommerceResources);

export const captureCartCreationEvent = Effect.fn("CartCreation.captureEvent")(function* (input: unknown) {
  const message = yield* decode(input), { object, action } = message.metadata;
  if (message.name !== buildModuleResourceEventName({ prefix: Modules.CART, objectName: object, action }) ||
    action === "updated" && object !== "cart_creation_operation" ||
    action === "deleted" && object !== "cart" && object !== "address") return yield* Effect.fail(commerceError("unadmittedEvent"));
  return message;
});

const objects: Readonly<Record<string, string>> = { cart: "cart", cart_address: "address", cart_line_item: "line_item",
  cart_line_item_tax_line: "line_item_tax_line", cart_line_item_adjustment: "line_item_adjustment",
  cart_creation_operation: "cart_creation_operation", cart_creation_cart: "cart_creation_cart", cart_creation_address: "cart_creation_address" };
type Expected = Readonly<{ object: string; action: string; id: string }>;
const token = ({ object, action, id }: Expected) => JSON.stringify([object, action, id]);

/** The fresh ownership profile retains exact private event identities and
 * generation without promising MikroORM's sibling-claim flush order. Public
 * Cart/Address/Line Item events retain their genuine native sequence. */
export function cartCreationPolicy(prepared: Result.Result.Success<ReturnType<typeof prepareCartCreationRepository>>) {
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("CartCreation.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (call.mode !== "write" || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const expected: Expected[] = [];
    if (call.commandName === "cartCreateWithOwnership") {
      const created = yield* validateCartCreated(prepared, call, activity);
      for (const item of created) {
        const object = objects[item.table];
        if (object === undefined || typeof item.row.id !== "string") return yield* Effect.fail(mismatch());
        expected.push({ object, action: "created", id: item.row.id });
      }
    } else if (call.commandName === "cartCompensateCreation") {
      const outcome = yield* validateCartCreationInverse(prepared, call, activity);
      expected.push(...outcome.deletedCartIds.map(id => ({ object: "cart", action: "deleted", id })),
        ...outcome.deletedAddressIds.map(id => ({ object: "address", action: "deleted", id })));
      if (outcome.status === "compensated") {
        const receipt = yield* Effect.fromResult(decodeCartCreationReceipt(call.input));
        expected.push({ object: "cart_creation_operation", action: "updated", id: receipt.operation_id });
      }
    } else return yield* Effect.fail(mismatch());
    const publicEvents = expected.filter(item => !item.object.startsWith("cart_creation_")),
      privateEvents = new Set(expected.filter(item => item.object.startsWith("cart_creation_")).map(token));
    if (privateEvents.size !== expected.length - publicEvents.length) return yield* Effect.fail(mismatch());
    const observedPublic: Expected[] = [];
    let privatePhase = false, operationSeen = false;
    for (const event of call.events) {
      const message = yield* captureCartCreationEvent(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const current = { object: message.metadata.object, action: message.metadata.action, id };
        if (current.object.startsWith("cart_creation_")) {
          if (current.object === "cart_creation_operation") {
            if (operationSeen || privatePhase) return yield* Effect.fail(mismatch());
            operationSeen = true;
          } else if (!operationSeen) return yield* Effect.fail(mismatch());
          privatePhase = true;
          if (!privateEvents.delete(token(current))) return yield* Effect.fail(mismatch());
        } else {
          if (privatePhase) return yield* Effect.fail(mismatch());
          observedPublic.push(current);
        }
      }
    }
    if (privateEvents.size || !jsonEqual(observedPublic, publicEvents)) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: captureCartCreationEvent, validateLogicalCall };
}

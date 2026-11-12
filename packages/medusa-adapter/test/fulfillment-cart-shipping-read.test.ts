import { beforeAll, expect, it } from "vitest";
import { Cause, Context, Effect, Exit, Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareCartShippingRead } from "../src/modules/fulfillment/cart-shipping-read";
import { cartShippingReadPolicy } from "../src/modules/fulfillment/cart-shipping-receipt";
import type { CommerceRelationRows } from "../src/query/relations";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";

let prepared: Result.Result.Success<ReturnType<typeof prepareCartShippingRead>>;
const Annotation = Context.Service<string>("CartShippingReceiptTest/Annotation");
beforeAll(async () => { prepared = Result.getOrThrow(prepareCartShippingRead((await runEffect(captureServiceZoneCreationMetadata())).frame)); });

it("refuses truncation before the native whole-cohort list can be labeled complete", async () => {
  const selected = [{ id: "option-first" }, { id: "option-second" }];
  // This port supplies an already selected cohort only; it implements neither
  // predicate matching nor persistence, DML validation or transaction behavior.
  const rows: CommerceRelationRows = (table, _predicate, _order, options) => {
    expect(table).toBe("shipping_option"); expect(options).toEqual({ includeIdentities: true });
    return Effect.succeed(selected);
  };
  const query = (limit?: number) => ({ where: {}, options: { fields: ["id"], populate: [], ...(limit === undefined ? {} : { limit }) } });
  expect(await runEffectFailure(prepared.read(rows, "shipping_option", query(1))))
    .toMatchObject({ reason: "unsupportedProfile" });
  expect(await runEffect(prepared.read(rows, "shipping_option", query()))).toEqual({ rows: selected, count: 2 });
  expect(await runEffect(prepared.read(rows, "shipping_option", query(256)))).toEqual({ rows: selected, count: 2 });
});

it.each([false, true])("maps native typed receipt failures while retaining a mixed Cause: %s", async mixed => {
  const original = commerceError("resourceFailure"), defect = new TypeError("Native Shipping read defect");
  const source = Cause.annotate(mixed ? Cause.combine(Cause.combine(Cause.fail(original), Cause.die(defect)), Cause.interrupt(731)) : Cause.fail(original),
    Context.make(Annotation, "native-shipping-read"));
  let nativeReads = 0;
  const policy = cartShippingReadPolicy({ ...prepared,
    // The real native list calls its bound DAL and crosses the real Promise
    // owner twice. Only the selected read completion is supplied by this port.
    read: Effect.fn("CartShippingReceiptTest.nativeRead")(function* (_rows: CommerceRelationRows, table: string) {
      expect(table).toBe("shipping_option"); nativeReads++;
      return yield* Effect.failCause(source);
    }),
  }, new Map([["shippingOptionCountForCartShipping", "shipping_option"]]));
  const call: Parameters<LogicalCallReceiptValidation>[0] = { commandName: "shippingOptionCountForCartShipping", mode: "read",
    input: { filters: { id: "option-first" }, config: { select: ["id"] } }, result: [[], 0], events: [],
    fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
  const activity: Parameters<LogicalCallReceiptValidation>[1] = { observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] };
  const exit = await Effect.runPromiseExit(policy.validateLogicalCall(call, activity));
  expect(nativeReads).toBe(1);
  if (Exit.isSuccess(exit)) throw new Error("Expected native receipt failure");
  expect(exit.cause.reasons.map(reason => reason._tag)).toEqual(source.reasons.map(reason => reason._tag));
  const failures = exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({ reason: "receiptMismatch", cause: original });
  expect(failures[0]?.cause).toBe(original);
  if (mixed) {
    expect(exit.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect);
    expect(exit.cause.reasons.find(Cause.isInterruptReason)?.fiberId).toBe(731);
  }
  for (const reason of exit.cause.reasons) expect(reason.annotations.get(Annotation.key)).toBe("native-shipping-read");
});

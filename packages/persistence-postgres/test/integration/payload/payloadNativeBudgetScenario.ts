import { Cause, Effect, Result, Schema, type Scope } from "effect";
import type { Json } from "flarex-protocol/json";
import { expect } from "vitest";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError, type CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import { makeIndexedPayloadFixture } from "./payloadIndexedFixture";

export const payloadNativeBudgetCases = ["hidden-count", "hidden-find", "shared-prior-input"] as const;
export type PayloadNativeBudgetCase = typeof payloadNativeBudgetCases[number];
const decodeBase = Schema.decodeUnknownEffect(Schema.Int);
const decodePadding = Schema.decodeUnknownEffect(Schema.Struct({ padding: Schema.String }));

/** Actual Local API seeding and hidden physical members, with one CMS budget. */
export const payloadNativeBudgetScenario: (
  target: Parameters<typeof makeIndexedPayloadFixture>[0], mode: PayloadNativeBudgetCase,
) => Effect.Effect<void, unknown, Scope.Scope> = Effect.fn("Payload.nativeBudget")(function* (target, mode) {
  const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
    { name: "title", type: "text", required: true, unique: true },
    { name: "category", type: "text", required: true },
    { name: "amount", type: "number", required: true, index: true },
    { name: "note", type: "text", required: true },
  ], indexes: [{ fields: ["amount", "category"] }] }]);
  const tested = yield* makeIndexedPayloadFixture(target, compiled);
  const commands = inspectPayloadRuntimeForTest(tested.runtime).commands;
  const note = "n".repeat(16_384);
  const total = mode === "shared-prior-input" ? 40 : 80;
  const seed = defineCmsCommand({ name: "seedNativeBudgetRows", mode: "write", run: Effect.fn(function* (ctx, input) {
    const base = yield* decodeBase(input).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    for (let offset = 0; offset < 4; offset++) yield* ctx.nested(commands.create, { collection: "items", data: {
      title: `budget-${base + offset}`, category: "hidden", amount: 15, note,
    } });
    return null;
  }) });
  let bodies = 0;
  let checkpoint: Result.Result<Json, CmsTransactionError> | undefined;
  const query = { collection: "items", where: { amount: { greater_than_equal: 10, less_than_equal: 20 },
    category: { equals: "selected" } } };
  const attempt = defineCmsCommand({ name: "observeNativeBudgetRows", mode: "write", run: Effect.fn(function* (ctx, input) {
    bodies++;
    const args = yield* decodePadding(input).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    expect(args.padding.length).toBe(mode === "shared-prior-input" ? 450_000 : 0);
    checkpoint = yield* ctx.nested(mode === "hidden-find" ? commands.find : commands.count, query).pipe(Effect.result);
    return null;
  }) });
  const host = yield* Effect.acquireRelease(tested.openHost([seed, attempt]), value => value.close);
  for (let base = 0; base < total; base += 4) yield* host.run(host.newRequestKey(), seed, base);
  const before = yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause });
  expect(before.rows).toHaveLength(total);
  if (mode === "shared-prior-input") expect(yield* tested.host.read(commands.count, query)).toEqual({ totalDocs: 0 });
  const outcome = yield* host.run(host.newRequestKey(), attempt, { padding: mode === "shared-prior-input" ? "p".repeat(450_000) : "" }).pipe(Effect.result);
  expect(outcome).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
  expect(checkpoint).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  if (checkpoint === undefined || Result.isSuccess(checkpoint) || Result.isSuccess(outcome)) throw new Error("Expected sticky native budget refusal");
  const originalFailure = checkpoint.failure;
  const rollbackCause = outcome.failure.cause;
  if (!Cause.isCause(rollbackCause)) throw new Error("Expected the original native budget Cause");
  expect(rollbackCause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === originalFailure)).toHaveLength(1);
  expect(bodies).toBe(1);
  expect(yield* Effect.tryPromise({ try: tested.inventory, catch: cause => cause })).toEqual(before);
  // Every seeded body is individually below the 64 KiB document limit. The
  // refusal comes from retained hidden members plus the same request's input.
  expect(note.length).toBeLessThan(65_536);
});

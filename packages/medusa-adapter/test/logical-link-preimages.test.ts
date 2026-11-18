import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { LinkPreimageOperationHandleSchema } from "@medusajs/link-modules";
import { PromotionActions } from "@medusajs/framework/utils/portable";
import type { LinkPreimageOperationRequest } from "@medusajs/types";
import { prepareCoreLinkPreimages } from "./support/core-link-preimage-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { projectNativeRow } from "../src/repository/result";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreLinkPreimages>>;
beforeAll(async () => { connected = await prepareCoreLinkPreimages(driver, close => cleanup.push(close)); }, 240_000);
afterAll(() => finishOrderFixture(cleanup.reverse()), 180_000);
const request = (name: string, mutations: LinkPreimageOperationRequest["mutations"]): LinkPreimageOperationRequest => ({ kind: "preimage", operationId: name, mutations });
const pair = (name: string) => ({ primary: "cart-" + name, foreign: "promotion-" + name });
const selected = async (cart: string) => (await connected.rows()).filter(row => row.cart_id === cart).map(projectNativeRow);
function failureReasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? failureReasons(reason.error)
    : Cause.isDieReason(reason) ? failureReasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return [...("reason" in value && typeof value.reason === "string" ? [value.reason] : []), ...failureReasons(value.cause)];
}

describe("native exact Link preimages on Core", { concurrent: false }, () => {
  it("executes the genuine native empty ADD callback through the real stored Link query without writing an operation", async () => {
    const cart = "cart-native-empty";
    await connected.run({ action: "create", pairs: [[cart, "native-empty-existing", {}]] });
    const before = await selected(cart), operations = connected.evidence;
    expect(await connected.run({ action: "nativeForward", input: { id: cart } })).toBeNull();
    expect(await selected(cart)).toEqual(before);
    const actual = operations("cartPromotionCount");
    expect(actual.call.mode).toBe("read"); expect(actual.activity.mutations).toEqual([]);
    expect(actual.call.result).toEqual([[{ cart_id: cart, promotion_id: "native-empty-existing" }], 1]);
  }, 120_000);
  it("restores four original Link rows through the genuine native REPLACE callback and its retained inverse across commits", async () => {
    const cart = "cart-native-replace-empty";
    const pairs: Array<[string, string, Record<string, never>]> = Array.from({ length: 4 }, (_, index) => [cart, "native-replace-" + index, {}]);
    await connected.run({ action: "create", pairs }); const before = await selected(cart);
    const value = await connected.run({ action: "nativeForward", input: { id: cart, action: PromotionActions.REPLACE } });
    const handle = Schema.decodeUnknownSync(LinkPreimageOperationHandleSchema)(value);
    expect(handle.request.mutations.map(mutation => mutation.action)).toEqual(["dismiss"]);
    expect((await selected(cart)).every(row => row.deleted_at !== null)).toBe(true);
    await connected.run({ action: "nativeInverse", handle }); expect(await selected(cart)).toEqual(before);
    await connected.run({ action: "nativeInverse", handle }); expect(await selected(cart)).toEqual(before);
    expect(connected.evidence("cartPromotionCompensatePreimages").call.result).toMatchObject({ status: "alreadyCompensated" });
  }, 120_000);
  it("refuses the actual native retained inverse after another writer supersedes its original Link generation", async () => {
    const cart = "cart-native-superseded", foreign = "native-superseded";
    await connected.run({ action: "create", pairs: [[cart, foreign, {}]] });
    const handle = Schema.decodeUnknownSync(LinkPreimageOperationHandleSchema)(await connected.run({ action: "nativeForward", input: { id: cart, action: PromotionActions.REPLACE } }));
    await connected.run({ action: "create", pairs: [[cart, foreign, {}]] }); const before = await connected.snapshot();
    const exit = await Effect.runPromiseExit(connected.host.run(connected.host.newRequestKey(), { action: "nativeInverse", handle }));
    expect(Exit.isFailure(exit)).toBe(true); if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("superseded");
    expect(await connected.snapshot()).toEqual(before);
  }, 120_000);

  it("restores an already active native Link's exact ID and timestamps across committed calls", async () => {
    const target = pair("existing"); await connected.run({ action: "create", pairs: [[target.primary, target.foreign, {}]] });
    const before = await selected(target.primary), input = request("existing-preimage", [{ action: "create", pairs: [target] }]);
    expect(await connected.run({ action: "apply", request: input })).toMatchObject({ changedPairs: 1, replayed: false });
    expect((await selected(target.primary))[0]?.id).not.toBe(before[0]?.id);
    expect(await connected.run({ action: "compensate", handle: connected.handle(input) })).toMatchObject({ status: "compensated", changedPairs: 1 });
    expect(await selected(target.primary)).toEqual(before);
    expect(await connected.run({ action: "compensate", handle: connected.handle(input) })).toMatchObject({ status: "alreadyCompensated" });
    expect(await selected(target.primary)).toEqual(before);
  }, 120_000);
  it("keeps native dismiss-before-create REPLACE overlap and restores each exact preimage", async () => {
    const cart = "cart-replace", kept = { primary: cart, foreign: "promotion-a" }, removed = { primary: cart, foreign: "promotion-b" }, added = { primary: cart, foreign: "promotion-c" };
    await connected.run({ action: "create", pairs: [[cart, kept.foreign, {}], [cart, removed.foreign, {}]] });
    const before = await selected(cart), input = request("replace-preimage", [{ action: "dismiss", pairs: [kept, removed] }, { action: "create", pairs: [kept, added] }]);
    await connected.run({ action: "apply", request: input });
    expect((await selected(cart)).filter(row => row.deleted_at === null).map(row => row.promotion_id).sort()).toEqual([kept.foreign, added.foreign]);
    await connected.run({ action: "compensate", handle: connected.handle(input) });
    const after = await selected(cart); expect(after.filter(row => row.promotion_id !== added.foreign)).toEqual(before);
    expect(after.find(row => row.promotion_id === added.foreign)?.deleted_at).toBeTypeOf("string");
  }, 120_000);
  it("retains default refusal and covers the complete four-old/four-new cohort with its named allowance", async () => {
    const cart = "cart-maximum", old = Array.from({ length: 4 }, (_, index) => ({ primary: cart, foreign: "old-" + index })),
      added = Array.from({ length: 4 }, (_, index) => ({ primary: cart, foreign: "new-" + index }));
    await connected.run({ action: "create", pairs: old.map(pair => [pair.primary, pair.foreign, {}]) });
    const before = await selected(cart), input = request("maximum-preimage", [{ action: "dismiss", pairs: old }, { action: "create", pairs: added }]);
    const durable = await connected.snapshot();
    const refused = await Effect.runPromiseExit(connected.ordinary.run(connected.ordinary.newRequestKey(), { action: "apply", request: input }));
    expect(Exit.isFailure(refused)).toBe(true); if (Exit.isFailure(refused)) expect(failureReasons(refused.cause)).toContain("limitExceeded");
    expect(await connected.snapshot()).toEqual(durable);
    const forward = await connected.measured({ action: "apply", request: input }); expect(forward.value).toMatchObject({ changedPairs: 8 });
    const inverse = await connected.measured({ action: "compensate", handle: connected.handle(input) });
    expect(forward.calls).toBeGreaterThan(64); expect(forward.calls).toBeLessThanOrEqual(128); expect(inverse.calls).toBeLessThanOrEqual(128);
    console.info("Native Cart-Promotion maximum actual bounded calls", { forward: forward.calls, inverse: inverse.calls });
    const after = await selected(cart); expect(after.filter(row => typeof row.promotion_id === "string" && row.promotion_id.startsWith("old-"))).toEqual(before);
    expect(after.filter(row => typeof row.promotion_id === "string" && row.promotion_id.startsWith("new-")).every(row => typeof row.deleted_at === "string")).toBe(true);
  }, 120_000);
  it.each([false, true])("restores exact historical inactive=%s data", async inactive => {
    const target = pair("inactive-" + inactive);
    await connected.run({ action: "create", pairs: [[target.primary, target.foreign, {}]] });
    if (inactive) await connected.run({ action: "dismiss", pairs: [[target.primary, target.foreign]] });
    const before = await selected(target.primary), input = request("historical-" + inactive, [{ action: "dismiss", pairs: [target] }]);
    await connected.run({ action: "apply", request: input }); await connected.run({ action: "compensate", handle: connected.handle(input) });
    expect(await selected(target.primary)).toEqual(before);
  }, 120_000);
  it("fences absent targets and refuses a later writer without mutating durable state", async () => {
    const target = pair("absent"), input = request("absent-preimage", [{ action: "dismiss", pairs: [target] }]);
    expect(await connected.run({ action: "apply", request: input })).toMatchObject({ changedPairs: 0 });
    await connected.run({ action: "create", pairs: [[target.primary, target.foreign, {}]] }); const before = await connected.snapshot();
    const exit = await Effect.runPromiseExit(connected.host.run(connected.host.newRequestKey(), { action: "compensate", handle: connected.handle(input) }));
    expect(Exit.isFailure(exit)).toBe(true); if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("superseded");
    expect(await connected.snapshot()).toEqual(before);
  }, 120_000);
  it("rolls forward and inverse faults back with receipts, history and events, then permits retry", async () => {
    const target = pair("fault"), input = request("fault-preimage", [{ action: "create", pairs: [target] }]);
    const expectLateFailure = async (args: Parameters<typeof connected.host.run>[1]) => {
      const key = connected.host.newRequestKey();
      const exit = await Effect.runPromiseExit(connected.host.run(key, args));
      if (Exit.isSuccess(exit)) throw new Error("Expected native Link rollback");
      expect(Cause.pretty(exit.cause)).toContain("Late native Link preimage parent fault");
      expect((await connected.fixture.inventory()).outcomes).toContainEqual(expect.objectContaining({
        value: expect.objectContaining({ key, kind: "nativeRoot", state: "failed" }),
      }));
    };
    const before = await connected.snapshot();
    await expectLateFailure({ action: "apply", request: input, failAfter: true });
    expect(await connected.snapshot()).toEqual(before);
    await connected.run({ action: "apply", request: input }); const applied = await connected.snapshot();
    await expectLateFailure({ action: "compensate", handle: connected.handle(input), failAfter: true });
    expect(await connected.snapshot()).toEqual(applied);
    const key = connected.host.newRequestKey(), args: Parameters<typeof connected.host.run>[1] = { action: "compensate", handle: connected.handle(input) };
    const result = await Effect.runPromise(connected.host.run(key, args)), after = await connected.snapshot();
    expect(await Effect.runPromise(connected.host.run(key, args))).toEqual(result); expect(await connected.snapshot()).toEqual(after);
  }, 120_000);
  it("rejects altered real closed receipts for rows, fences, complete reads, lifecycle and events", async () => {
    const target = pair("receipts"), input = request("receipt-preimage", [{ action: "create", pairs: [target] }]);
    await connected.run({ action: "create", pairs: [[target.primary, target.foreign, {}]] });
    await connected.run({ action: "apply", request: input }); const forward = connected.evidence("cartPromotionApplyPreimages");
    await connected.run({ action: "compensate", handle: connected.handle(input) }); const inverse = connected.evidence("cartPromotionCompensatePreimages");
    for (const original of [forward, inverse]) {
      await Effect.runPromise(connected.links.policy.validateLogicalCall(original.call, original.activity));
      const changes: (typeof original)[] = [
        { ...original, call: { ...original.call, events: [] } },
        { ...original, activity: { ...original.activity, relationalReads: original.activity.relationalReads.filter(read => read.table !== "cart_promotion") } },
        { ...original, activity: { ...original.activity, mutations: original.activity.mutations.map(mutation => mutation.table === "link_pair_revision" && mutation.after !== null
          ? { ...mutation, after: { ...mutation.after, revision: "forged-fence" } } : mutation) } },
        { ...original, activity: { ...original.activity, mutations: original.activity.mutations.map(mutation => mutation.table === "cart_promotion" && mutation.after !== null
          ? { ...mutation, after: { ...mutation.after, id: "forged-link-id" } } : mutation) } },
      ];
      if (original.activity.lifecycle.length) changes.push({ ...original, activity: { ...original.activity, lifecycle: [] } });
      for (const changed of changes) {
        const exit = await Effect.runPromiseExit(connected.links.policy.validateLogicalCall(changed.call, changed.activity));
        expect(Exit.isFailure(exit)).toBe(true); if (Exit.isFailure(exit)) expect(failureReasons(exit.cause)).toContain("receiptMismatch");
      }
    }
  }, 120_000);
});

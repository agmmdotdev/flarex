import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { MedusaError } from "@medusajs/utils/common/errors";
import { currencyGraph } from "../src/modules/currency/service";
import { prepareLocalGraph } from "../src/local-graph/query";
import { validateNativeQueryKeys } from "@medusajs/orchestration/joiner-key-validation";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { promiseFailureObserver } from "./support/promise-failure-observer";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";

const participant = defineAtomicCommerceParticipant("queryKeyUnit");
const graph = Result.getOrThrow(currencyGraph.pipe(Result.flatMap(module => prepareLocalGraph([{ participant, module }]))));
const request = (filters?: Record<string, Json>, pagination = { take: 4, skip: 0 }) => ({
  entity: "currency", fields: ["name"], ...(filters === undefined ? {} : { filters }), pagination,
});
const options = { throwIfKeyNotFound: true };
const bind = (result: Json, calls: Json[]) => graph.bind({
  eventGroupId: "query-key-unit", checkpoint: Effect.void, recordFailure: promiseFailureObserver(),
  capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
  clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")), refuse: Effect.fail,
  call: (_participant, _command, input) => { calls.push(input); return Effect.succeed(result); },
} satisfies AtomicCommerceContext);

describe("bounded graph native root-key validation", () => {
  it("fetches the real natural key in the same call and masks it after validation", async () => {
    const calls: Json[] = [], rows = [[{ code: "usd", name: "US Dollar" }], 1];
    expect(await runEffect(bind(rows, calls).graph(request({ code: ["usd", "usd"] }), options)))
      .toEqual({ data: [{ name: "US Dollar" }], metadata: { count: 1, skip: 0, take: 4 } });
    expect(calls).toEqual([{ filters: { code: ["usd"] },
      config: { select: ["name"], relations: [], order: { code: "ASC" }, skip: 0, take: 4 } }]);
    expect(rows).toEqual([[{ code: "usd", name: "US Dollar" }], 1]);
  });
  it("retains native primary-filter and partial-missing errors in requested key order", async () => {
    const cases = [
      [request(), [], "Currency: Primary key(s) [code, id] not found in filters"],
      [request({ code: null }), [], "Currency: Value for primary key code not found in filters"],
      [request({ code: ["missing-b", "usd", "missing-a", "missing-b"] }), [{ code: "usd", name: "US Dollar" }],
        "Currency code not found: missing-b, missing-a"],
    ] as const;
    for (const [input, rows, message] of cases) {
      const calls: Json[] = [], failure = await runEffectFailure(bind([[...rows], rows.length], calls).graph(input, options));
      expect(failure).toMatchObject({ reason: "adapterFailure", cause: { type: MedusaError.Types.NOT_FOUND, message } });
      expect(calls).toHaveLength(rows.length === 0 ? 0 : 1);
    }
    expect(await runEffect(bind([[], 0], []).graph(request({ code: [] }), options)))
      .toEqual({ data: [], metadata: { count: 0, skip: 0, take: 4 } });
  });
  it("refuses unsupported flags, selectors and incomplete pages without changing ordinary reads", async () => {
    for (const supplied of [{ throwIfKeyNotFound: true, throwIfRelationNotFound: true }, { unknown: true }]) {
      const calls: Json[] = [];
      expect(await runEffectFailure(bind([[], 0], calls).graph(request({ code: [] }), supplied)))
        .toMatchObject({ reason: "unsupportedProfile" });
      expect(calls).toEqual([]);
    }
    const calls: Json[] = [];
    expect(await runEffectFailure(bind([[], 0], calls).graph(request({ code: { $in: ["usd"] } }), options)))
      .toMatchObject({ reason: "unsupportedProfile" });
    expect(calls).toEqual([]);
    expect(await runEffectFailure(bind([[{ code: "usd", name: "US Dollar" }], 2], []).graph(request({ code: ["usd", "eur"] }, { take: 1, skip: 0 }), options)))
      .toMatchObject({ reason: "adapterFailure", cause: { message: "Currency code not found: eur" } });
    expect(await runEffectFailure(bind([[], 2], []).graph(request({ code: ["usd", "eur"] }, { take: 1, skip: 0 }), options)))
      .toMatchObject({ reason: "storedCorruption" });
    for (const supplied of [{}, { throwIfKeyNotFound: false }])
      expect(await runEffect(bind([[], 0], []).graph(request({ code: [] }), supplied)))
        .toEqual({ data: [], metadata: { count: 0, skip: 0, take: 4 } });
    expect(await runEffect(bind([[], 0], []).graph(request({ code: "missing" }))))
      .toEqual({ data: [], metadata: { count: 0, skip: 0, take: 4 } });
  });
  it("preserves foreign throws as original defects through the actual Promise classification owner", async () => {
    for (const defect of [new Error("foreign graph defect"),
      new MedusaError(MedusaError.Types.INVALID_DATA, "unexpected native graph failure")]) {
      const result = await runEffect(Effect.exit(makeCommercePromiseOwner().pipe(Effect.flatMap(owner => owner.withClose(owner.invoke(async () =>
        validateNativeQueryKeys({ uniqueIds: ["usd"],
          resData: [{ get code() { throw defect; } }], expand: { serviceConfig: { serviceName: "Currency", primaryKeys: ["code"] } },
          pkField: "code", options: { throwIfKeyNotFound: true } })))))));
      if (Exit.isSuccess(result)) throw new Error("Expected original native graph defect");
      expect(result.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toContain(defect);
      expect(result.cause.reasons.some(Cause.isFailReason)).toBe(false);
    }
  });
});

import { Cause, Deferred, Effect, Exit, Fiber, type Scope } from "effect";
import { expect } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import { inspectPayloadRuntimeForTest, makePayloadConformanceRuntime } from "../../../payload-adapter/src/testing";
import type { PayloadConformanceRuntime } from "../../../payload-adapter/src/testing/conformance";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import type { Json } from "flarex-protocol/json";
import { makeCurrencyAnnouncementHost } from "../../../persistence-postgres/src/frameworks/crossDomainCommand/host";
import type { CompositeFailure } from "../../../persistence-postgres/src/frameworks/crossDomainCommand/model";
import { currencyAnnouncementWrite, withCurrencyService } from "../../src/modules/currency/service";
import type { CoreCurrencyFixture } from "./core-currency-fixture";

export type Native12CurrencyScope = Parameters<Parameters<typeof withCurrencyService>[1]>[0];
type Native12AnnouncementHost = Effect.Success<ReturnType<typeof makeCurrencyAnnouncementHost>>;
interface Native12CurrentObservations {
  readonly native: PayloadConformanceRuntime;
  readonly announcement: (work: (scope: Native12CurrencyScope) => Promise<void>) =>
    Effect.Effect<{ readonly host: Native12AnnouncementHost; readonly calls: () => number }, CompositeFailure, Scope.Scope>;
  readonly publish: (code: string, name: string) => Effect.Effect<Json, CommerceTransactionError>;
  readonly removeAbsentProbe: () => Effect.Effect<Json, CommerceTransactionError>;
}
type Native12PreparationFailure = Effect.Error<ReturnType<typeof makePayloadConformanceRuntime>>;
export const native12RemoveAbsentProbe = defineCommerceCommand("native12HardDelete", "write", ctx =>
  withCurrencyService(ctx, async ({ repository, context }) => {
    await repository.delete({ code: "xab" }, context);
    return null;
  }));

/** Authentic native callbacks on the existing private three-source root. No
 * substitute working set, isolation policy, or publication owner lives here. */
export const makeNative12CurrentObservations = Effect.fn("Native12.current.prepare")(function* (
  fixture: CoreCurrencyFixture,
): Effect.fn.Return<Native12CurrentObservations, Native12PreparationFailure, Scope.Scope> {
  const native = yield* makePayloadConformanceRuntime();
  const competitor = fixture.host;
  const publish = (code: string, name: string) => competitor.run(competitor.newRequestKey(),
    currencyAnnouncementWrite, { code, name, symbol: "N", symbol_native: "N" });
  const announcement = (work: (scope: Native12CurrencyScope) => Promise<void>) => {
    let calls = 0;
    const command = defineCommerceCommand("currencyAnnouncementWrite", "write", (ctx, value) => {
      if (!isNonArrayRecord(value) || typeof value.code !== "string") return ctx.refuse(commerceError("invalidInput"));
      const code = value.code;
      return withCurrencyService(ctx, async scope => {
        calls++;
        await work(scope);
        await scope.internal.upsert([value], scope.context);
        return scope.service.retrieveCurrency(code, {}, scope.context);
      });
    });
    return fixture.announcement({ currencyCommand: command,
      cmsCommand: inspectPayloadRuntimeForTest(native.runtime).commands.create }).pipe(Effect.map(host => ({ host, calls: () => calls })));
  };
  return { native, announcement, publish,
    removeAbsentProbe: () => competitor.run(competitor.newRequestKey(), native12RemoveAbsentProbe, null) };
});

/** User data/history/publications exclude the Core claim-control revisions. */
export async function native12DataInventory(fixture: CoreCurrencyFixture) {
  const inventory = await fixture.inventory();
  return { rows: inventory.rows, rowChanges: inventory.revisions,
    commits: [...new Set(inventory.revisions.map(revision => revision.timestamp))].toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0) };
}

export const native12Arguments = (code: string, title: string) => ({
  currency: { code, name: title, symbol: "N", symbol_native: "N" },
  cms: { collection: "posts", data: { title, publishedAt: "2026-09-23" } },
  application: { name: title },
});

/** Surface an authentic command failure before its callback reaches the pause,
 * instead of concealing that failure behind the orchestration timeout. */
export const awaitNative12Pause = <Value, Failure>(entered: Deferred.Deferred<void>, fiber: Fiber.Fiber<Value, Failure>) =>
  Deferred.await(entered).pipe(Effect.raceFirst(Fiber.join(fiber).pipe(Effect.andThen(
    Effect.die(new Error("Native12 command completed before its observation pause")),
  ))));

export function expectNative12Failure<Value, Failure extends { readonly reason: string }>(
  exit: Exit.Exit<Value, Failure>, reason: string,
): void {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const reasons = exit.cause.reasons.filter(Cause.isFailReason).map(entry => entry.error.reason);
    expect(reasons).toContain(reason);
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(false);
  }
}

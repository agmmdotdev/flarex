import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import {
  finalizeAuthenticatedAnalysisSessionV1,
  type AuthenticatedAnalysisSessionCleanupV1,
} from "../../support/fsv03PrivateAnalyzerToPostgresHarness";
import type {
  AuthenticatedDeclarativeV2CommandSessionV1,
} from "@flarex/persistence-postgres/internal/system-test/authenticatedDeclarativeV2CommandBridgeV1";

const SESSION = Object.freeze({
  _tag: "AuthenticatedDeclarativeV2CommandSessionV1" as const,
}) satisfies AuthenticatedDeclarativeV2CommandSessionV1;

const OPERATION_RESULT = Object.freeze({
  operationUsage: Object.freeze({
    calls: 0,
    rows: 0,
    frameBytes: 0,
    canonicalBytes: 0,
    hashBytes: 0,
    elapsedMilliseconds: 0,
  }),
});

function cleanupWithFailingAbandon(
  onAbandon: () => void,
  cleanupFailure: Error,
): AuthenticatedAnalysisSessionCleanupV1 {
  return Object.freeze({
    release: () => Effect.succeed(OPERATION_RESULT),
    abandon: () => {
      onAbandon();
      return Effect.fail(cleanupFailure);
    },
  });
}

describe("FSV03 authenticated analysis-session finalization", () => {
  it("preserves the originating typed failure when abandonment also fails", async () => {
    const primaryFailure = new Error("sentinel primary analysis failure");
    const cleanupFailure = new Error("sentinel abandonment failure");
    let abandonCalls = 0;
    const cleanup = cleanupWithFailingAbandon(
      () => {
        abandonCalls += 1;
      },
      cleanupFailure,
    );

    const exit = await Effect.runPromiseExit(Effect.scoped(
      Effect.acquireRelease(
        Effect.succeed(SESSION),
        (session, useExit) => finalizeAuthenticatedAnalysisSessionV1(
          cleanup,
          session,
          useExit,
        ),
      ).pipe(Effect.flatMap(() => Effect.fail(primaryFailure))),
    ));

    expect(abandonCalls).toBe(1);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(primaryFailure);
      expect(Cause.pretty(exit.cause)).not.toContain(cleanupFailure.message);
    }
  });

  it("preserves interruption when abandonment also fails", async () => {
    const cleanupFailure = new Error("sentinel interrupted abandonment failure");
    let abandonCalls = 0;
    const cleanup = cleanupWithFailingAbandon(
      () => {
        abandonCalls += 1;
      },
      cleanupFailure,
    );
    const entered = await Effect.runPromise(Deferred.make<void>());
    const fiber = Effect.runFork(Effect.scoped(
      Effect.acquireRelease(
        Effect.succeed(SESSION),
        (session, useExit) => finalizeAuthenticatedAnalysisSessionV1(
          cleanup,
          session,
          useExit,
        ),
      ).pipe(
        Effect.tap(() => Deferred.succeed(entered, undefined)),
        Effect.flatMap(() => Effect.never),
      ),
    ));
    await Effect.runPromise(Deferred.await(entered));

    const completion = Effect.runPromise(Fiber.await(fiber));
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await completion;

    expect(abandonCalls).toBe(1);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(Cause.pretty(exit.cause)).not.toContain(cleanupFailure.message);
    }
  });
});

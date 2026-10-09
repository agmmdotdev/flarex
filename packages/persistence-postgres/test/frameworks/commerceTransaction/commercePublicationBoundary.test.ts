import { Cause, Context, Effect, Exit } from "effect";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { expect, it } from "vitest";
import { ScopePublicationCorruptionError, ScopePublicationResourceError, ScopePublicationSqlFailure } from "../../../src/commit/publication/scopePublicationModel";
import { acceptCommercePublication, publishCommerceAtoms } from "../../../src/frameworks/commerceTransaction/publicationBoundary";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

it("preserves publication corruption, resource and SQL categories with their original cause", async () => {
  const cases = [
    [new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid" }), "storedCorruption"],
    [new ScopePublicationResourceError({ dimension: "commitSequence", maximum: 10n }), "resourceFailure"],
    [new ScopePublicationSqlFailure({ operation: "writeCommitChange", cause: new Error("SQL failure") }), "statementFailure"],
    [new DrizzleQueryError("insert", [], new Error("Relational insert failure")), "statementFailure"],
  ] as const;
  for (const [cause, reason] of cases) {
    const error = await runEffectFailure(publishCommerceAtoms(() => Promise.reject(cause)));
    expect(error.reason).toBe(reason);
    expect(error.cause).toBe(cause);
  }
});

it("preserves unexpected publication defects instead of classifying them as SQL failures", async () => {
  const defect = new Error("unexpected publication defect");
  const exit = await runEffect(Effect.exit(publishCommerceAtoms(() => Promise.reject(defect))));
  if (Exit.isSuccess(exit)) throw new Error("Expected a defect");
  expect(exit.cause.reasons).toHaveLength(1);
  const reason = exit.cause.reasons[0];
  if (reason === undefined || !Cause.isDieReason(reason)) throw new Error("Expected a Die cause");
  expect(reason.defect).toBe(defect);
});

it("composes final publication without replacing defects, interruption or combined causes", async () => {
  class PublicationMarker extends Context.Service<PublicationMarker, string>()("PublicationMarker") {}
  const defect = new Error("final reference cleanup defect");
  const failure = new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid" });
  const work = Effect.failCause(Cause.annotate(Cause.fail(failure), Context.make(PublicationMarker, "final-state")))
    .pipe(Effect.ensuring(Effect.die(defect)));
  const original = await runEffect(Effect.exit(work));
  const projected = await runEffect(Effect.exit(acceptCommercePublication(work)));
  if (Exit.isSuccess(original) || Exit.isSuccess(projected)) throw new Error("Expected combined failure");
  expect(projected.cause.reasons.map(reason => reason._tag)).toEqual(original.cause.reasons.map(reason => reason._tag));
  expect(projected.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
  const mapped = projected.cause.reasons.find(Cause.isFailReason);
  if (mapped === undefined) throw new Error("Expected typed publication failure");
  expect(mapped.error).toMatchObject({ reason: "storedCorruption", cause: failure });
  expect(Context.getOrUndefined(Cause.reasonAnnotations(mapped), PublicationMarker)).toBe("final-state");
  const interrupted = await runEffect(Effect.exit(acceptCommercePublication(Effect.interrupt)));
  if (Exit.isSuccess(interrupted)) throw new Error("Expected interruption");
  expect(Cause.hasInterrupts(interrupted.cause)).toBe(true);
});

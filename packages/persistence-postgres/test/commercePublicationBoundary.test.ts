import { Cause, Effect, Exit } from "effect";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { expect, it } from "vitest";
import { ScopePublicationCorruptionError, ScopePublicationResourceError, ScopePublicationSqlFailure } from "../src/commitPublication/scopePublicationModel";
import { publishCommerceAtoms } from "../src/commerceTransaction/publicationBoundary";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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

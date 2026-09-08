import { expect, it } from "vitest";
import { ScopePublicationCorruptionError, ScopePublicationResourceError, ScopePublicationSqlFailure } from "../src/commitPublication/scopePublicationModel";
import { projectCompositeFailure, projectCompositePublicationFailure } from "../src/crossDomainCommand/model";

it("retains publication corruption and resource categories through both root boundaries", () => {
  const cases = [
    [new ScopePublicationCorruptionError({ reason: "scopeClockInvalid" }), "storedCorruption"],
    [new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid" }), "storedCorruption"],
    [new ScopePublicationResourceError({ dimension: "commitSequence", maximum: 100n }), "resourceFailure"],
    [new ScopePublicationResourceError({ dimension: "outboxSequence", maximum: 100n }), "resourceFailure"],
    [new ScopePublicationSqlFailure({ operation: "writeOutcome", cause: new Error("SQL failure") }), "resourceFailure"],
  ] as const;
  for (const [cause, reason] of cases) {
    for (const project of [projectCompositeFailure, projectCompositePublicationFailure]) {
      const failure = project(cause);
      expect(failure).toMatchObject({ _tag: "CompositeCommandError", reason });
      expect(failure.cause).toBe(cause);
    }
  }
});

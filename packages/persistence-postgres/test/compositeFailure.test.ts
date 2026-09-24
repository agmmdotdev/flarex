import { expect, it } from "vitest";
import { ScopePublicationCorruptionError, ScopePublicationResourceError, ScopePublicationSqlFailure } from "../src/commitPublication/scopePublicationModel";
import { projectCompositeFailure, projectCompositePublicationFailure } from "../src/crossDomainCommand/model";
import { LogicalDocumentSourceAdmissionError } from "../src/logicalDocuments/documentAdmission";
import { LogicalApplicationSourceAdmissionError } from "../src/logicalDocuments/applicationAdmission";
import { LogicalRelationalAdmissionError } from "../src/logicalDocuments/relationalAdmission";
import { LogicalStorageDefinitionError } from "../src/logicalStorageDefinitions";
import { IndexBuildStatePersistenceError } from "../src/indexBuildStates";
import { DataBindingError } from "../src/frameworkSchema/binding/errors";

it("retains publication corruption and resource categories through both root boundaries", () => {
  const cases = [
    [new ScopePublicationCorruptionError({ reason: "scopeClockInvalid" }), "storedCorruption"],
    [new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid" }), "storedCorruption"],
    [new ScopePublicationResourceError({ dimension: "commitSequence", maximum: 100n }), "resourceFailure"],
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

it("retains selected-source provider outages as resource failures", () => {
  const provider = new Error("Provider unavailable");
  for (const cause of [
    new LogicalDocumentSourceAdmissionError({ reason: "resourceFailure", cause: provider }),
    new LogicalStorageDefinitionError({ reason: "resourceFailure", cause: provider }),
    new IndexBuildStatePersistenceError("readRequiredIndexBuildStates", provider),
    new DataBindingError({ reason: "resourceFailure", cause: provider }),
  ]) {
    const failure = projectCompositeFailure(cause);
    expect(failure).toMatchObject({ _tag: "CompositeCommandError", reason: "resourceFailure" });
    expect(failure.cause).toBe(cause);
  }
  expect(projectCompositeFailure(new DataBindingError({ reason: "invalidAuthority" })))
    .toMatchObject({ reason: "invalidAuthority" });
});

it("retains unsupported source profiles through the composite boundary", () => {
  for (const cause of [
    new LogicalApplicationSourceAdmissionError({ reason: "unsupportedProfile" }),
    new LogicalDocumentSourceAdmissionError({ reason: "unsupportedProfile" }),
    new LogicalRelationalAdmissionError({ reason: "unsupportedProfile" }),
  ]) {
    const failure = projectCompositeFailure(cause);
    expect(failure).toMatchObject({ _tag: "CompositeCommandError", reason: "unsupportedProfile" });
    expect(failure.cause).toBe(cause);
  }
});

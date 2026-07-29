import {
  canonicalDeclarativeFunctionPathV1,
  makeCanonicalDeclarativeProgramBudgetV1,
  makeCanonicalDeclarativeProgramFixtureV1,
  type CanonicalDeclarativeProgramV1,
} from "@flarex/declarative-program/v1";
import {
  makeDeclarativeV2MaterializationBudgetV1,
  materializeDeclarativeV2ArtifactsV1,
  type DeclarativeV2ArtifactIngressPlanV1,
} from "@flarex/declarative-materializer/v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1,
  PRIVATE_STANDARD_APPLICATION_CORPUS_VERSION_V1,
  listPrivateStandardApplicationCorpusCaseIdsV1,
  makePrivateStandardApplicationCorpusCaseV1,
  selectPrivateStandardApplicationCorpusV1,
  type PrivateStandardApplicationCanonicalFailureV1,
  type PrivateStandardApplicationCorpusCaseV1,
  type PrivateStandardApplicationMaterializationFailureV1,
  type PrivateStandardApplicationValidFactsV1,
} from "./corpusV1";
import type {
  PrivateStandardApplicationDefinitionFixtureV1,
} from "./definitionFixtureV1";

describe("private standard application corpus V1", () => {
  for (const caseId of listPrivateStandardApplicationCorpusCaseIdsV1()) {
    it(`reproduces ${caseId}`, () => {
      const corpusCase =
        makePrivateStandardApplicationCorpusCaseV1(caseId);
      const repeated =
        makePrivateStandardApplicationCorpusCaseV1(caseId);
      expectIndependentFixtureAllocation(
        corpusCase.fixture,
        repeated.fixture,
      );
      switch (corpusCase.kind) {
        case "valid":
          if (repeated.kind !== "valid") {
            throw new Error(`Expected repeated valid corpus case ${caseId}.`);
          }
          expectValidCase(
            corpusCase.fixture,
            repeated.fixture,
            corpusCase.expected,
          );
          return;
        case "canonicalFailure":
          if (repeated.kind !== "canonicalFailure") {
            throw new Error(
              `Expected repeated canonical-failure corpus case ${caseId}.`,
            );
          }
          expectCanonicalFailure(
            corpusCase.fixture,
            repeated.fixture,
            corpusCase.expected,
          );
          return;
        case "materializationFailure":
          if (repeated.kind !== "materializationFailure") {
            throw new Error(
              `Expected repeated materialization-failure corpus case ${caseId}.`,
            );
          }
          expectMaterializationFailure(
            corpusCase.fixture,
            repeated.fixture,
            corpusCase.expected,
          );
          return;
      }
      unreachableCorpusCase(corpusCase);
    });
  }

  it("selects a stable bounded rotation and records explicit replay IDs", () => {
    const first = selectPrivateStandardApplicationCorpusV1({
      seed: 0,
      maximumCases: 3,
    });
    const repeated = selectPrivateStandardApplicationCorpusV1({
      seed: 0,
      maximumCases: 3,
    });
    expect(first).toEqual({
      corpusVersion: PRIVATE_STANDARD_APPLICATION_CORPUS_VERSION_V1,
      seed: 0,
      caseIds: [
        PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
          .validOrdersPointMutation,
        PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
          .validMultiModuleFunctionMetadata,
        PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1
          .canonicalDuplicateFunctionPath,
      ],
    });
    expect(repeated).toEqual(first);
    expect(repeated).not.toBe(first);
    expect(repeated.caseIds).not.toBe(first.caseIds);
  });

  it("wraps selection and never repeats a case within one replay", () => {
    const allCaseIds = listPrivateStandardApplicationCorpusCaseIdsV1();
    const replay = selectPrivateStandardApplicationCorpusV1({
      seed: allCaseIds.length - 1,
      maximumCases: allCaseIds.length + 10,
    });

    expect(replay.caseIds).toHaveLength(allCaseIds.length);
    expect(new Set(replay.caseIds).size).toBe(allCaseIds.length);
    expect(replay.caseIds[0]).toBe(allCaseIds.at(-1));
    expect(replay.caseIds[1]).toBe(allCaseIds[0]);
  });

  it("returns fresh case-ID lists", () => {
    const first = listPrivateStandardApplicationCorpusCaseIdsV1();
    const second = listPrivateStandardApplicationCorpusCaseIdsV1();

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("keeps the selectable order complete with the exported catalog", () => {
    const ordered = listPrivateStandardApplicationCorpusCaseIdsV1();
    const exported = Object.values(
      PRIVATE_STANDARD_APPLICATION_CORPUS_CASE_ID_V1,
    );

    expect(new Set(ordered).size).toBe(ordered.length);
    expect([...ordered].sort()).toEqual([...exported].sort());
  });

  it.each([
    { seed: -1, maximumCases: 1 },
    { seed: Number.NaN, maximumCases: 1 },
    { seed: Number.POSITIVE_INFINITY, maximumCases: 1 },
    { seed: 0.5, maximumCases: 1 },
    { seed: 0, maximumCases: -1 },
    { seed: 0, maximumCases: Number.NaN },
    { seed: 0, maximumCases: Number.POSITIVE_INFINITY },
    { seed: 0, maximumCases: 0.5 },
  ])("rejects invalid selection input %#", (input) => {
    expect(() => selectPrivateStandardApplicationCorpusV1(input))
      .toThrow(RangeError);
  });
});

function expectValidCase(
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
  repeatedFixture: PrivateStandardApplicationDefinitionFixtureV1,
  expected: PrivateStandardApplicationValidFactsV1,
): void {
  const first = materializeValidFixture(fixture);
  const second = materializeValidFixture(repeatedFixture);

  expect(logicalModulePaths(first.program)).toEqual(
    expected.logicalModulePaths,
  );
  expect(functionPaths(first.program)).toEqual(expected.functionPaths);
  expect(first.program.schema.tables.map((table) => table.logicalName))
    .toEqual(expected.tableNames);
  expect(first.program.schema.indexes.map(
    (index) => `${index.tableLogicalName}:${index.descriptor}`,
  )).toEqual(expected.indexNames);
  expect(first.plan.source.modules.map((module) => module.path))
    .toEqual(expected.artifactModulePaths);
  expect(second.plan.semantic.bytes).toEqual(first.plan.semantic.bytes);
  expect(second.plan.source.modules.map((module) => module.sourceBytes))
    .toEqual(first.plan.source.modules.map((module) => module.sourceBytes));
  expect(second.plan.source.modules.map((module) => module.sourceMapBytes))
    .toEqual(first.plan.source.modules.map((module) => module.sourceMapBytes));
}

function expectIndependentFixtureAllocation(
  first: PrivateStandardApplicationDefinitionFixtureV1,
  second: PrivateStandardApplicationDefinitionFixtureV1,
): void {
  expect(second).not.toBe(first);
  expect(second.programBudgetInput).not.toBe(first.programBudgetInput);
  expect(second.programInput).not.toBe(first.programInput);
  expect(second.programInput.schema).not.toBe(first.programInput.schema);
  expect(second.programInput.modules).not.toBe(first.programInput.modules);
  expect(second.materializationBudgetInput)
    .not.toBe(first.materializationBudgetInput);
  expect(second.graphInput).not.toBe(first.graphInput);
  expect(second.graphInput.modules).not.toBe(first.graphInput.modules);

  expect(second.graphInput.modules.map((module) => module.path))
    .toEqual(first.graphInput.modules.map((module) => module.path));
  for (const firstModule of first.graphInput.modules) {
    const secondModule = second.graphInput.modules.find(
      (candidate) => candidate.path === firstModule.path,
    );
    if (secondModule === undefined) {
      throw new Error(`Expected repeated fixture module ${firstModule.path}.`);
    }
    expect(secondModule.sourceBytes.buffer)
      .not.toBe(firstModule.sourceBytes.buffer);
    if (firstModule.sourceMapBytes === null) {
      expect(secondModule.sourceMapBytes).toBeNull();
    } else {
      if (secondModule.sourceMapBytes === null) {
        throw new Error(
          `Expected repeated fixture source map ${firstModule.path}.`,
        );
      }
      expect(secondModule.sourceMapBytes.buffer)
        .not.toBe(firstModule.sourceMapBytes.buffer);
    }
  }
}

function expectCanonicalFailure(
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
  repeatedFixture: PrivateStandardApplicationDefinitionFixtureV1,
  expected: PrivateStandardApplicationCanonicalFailureV1,
): void {
  const first = canonicalFailure(fixture);
  const repeated = canonicalFailure(repeatedFixture);

  expect({ ...first }).toEqual(expected);
  expect({ ...repeated }).toEqual(expected);
}

function expectMaterializationFailure(
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
  repeatedFixture: PrivateStandardApplicationDefinitionFixtureV1,
  expected: PrivateStandardApplicationMaterializationFailureV1,
): void {
  const first = materializationFailure(fixture);
  const repeated = materializationFailure(repeatedFixture);

  expect({ ...first }).toEqual(expected);
  expect({ ...repeated }).toEqual(expected);
}

function canonicalFailure(
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
) {
  const budget = Result.getOrThrow(
    makeCanonicalDeclarativeProgramBudgetV1(fixture.programBudgetInput),
  );
  return expectResultFailure(
    makeCanonicalDeclarativeProgramFixtureV1(
      fixture.programInput,
      budget,
    ),
    "Expected canonical corpus case to fail.",
  );
}

function materializationFailure(
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
) {
  const programBudget = Result.getOrThrow(
    makeCanonicalDeclarativeProgramBudgetV1(fixture.programBudgetInput),
  );
  const program = Result.getOrThrow(
    makeCanonicalDeclarativeProgramFixtureV1(
      fixture.programInput,
      programBudget,
    ),
  );
  const materializationBudget = Result.getOrThrow(
    makeDeclarativeV2MaterializationBudgetV1(
      fixture.materializationBudgetInput,
    ),
  );
  return expectResultFailure(
    materializeDeclarativeV2ArtifactsV1(
      program,
      fixture.graphInput,
      materializationBudget,
    ),
    "Expected materialization corpus case to fail.",
  );
}

function materializeValidFixture(
  fixture: PrivateStandardApplicationDefinitionFixtureV1,
): {
  readonly program: CanonicalDeclarativeProgramV1;
  readonly plan: DeclarativeV2ArtifactIngressPlanV1;
} {
  const programBudget = Result.getOrThrow(
    makeCanonicalDeclarativeProgramBudgetV1(fixture.programBudgetInput),
  );
  const program = Result.getOrThrow(
    makeCanonicalDeclarativeProgramFixtureV1(
      fixture.programInput,
      programBudget,
    ),
  );
  const materializationBudget = Result.getOrThrow(
    makeDeclarativeV2MaterializationBudgetV1(
      fixture.materializationBudgetInput,
    ),
  );
  const plan = Result.getOrThrow(materializeDeclarativeV2ArtifactsV1(
    program,
    fixture.graphInput,
    materializationBudget,
  ));
  return { program, plan };
}

function logicalModulePaths(
  program: CanonicalDeclarativeProgramV1,
): ReadonlyArray<string> {
  return program.modules.map((module) => module.modulePath);
}

function functionPaths(
  program: CanonicalDeclarativeProgramV1,
): ReadonlyArray<string> {
  return program.modules.flatMap((module) =>
    module.functions.map((fn) =>
      canonicalDeclarativeFunctionPathV1(
        module.modulePath,
        fn.exportName,
      )
    )
  );
}

function expectResultFailure<Success, Failure>(
  result: Result.Result<Success, Failure>,
  message: string,
): Failure {
  return Result.match(result, {
    onFailure: (failure) => failure,
    onSuccess: () => {
      throw new Error(message);
    },
  });
}

function unreachableCorpusCase(value: never): never {
  throw new Error(`Unhandled corpus case ${String(value)}.`);
}

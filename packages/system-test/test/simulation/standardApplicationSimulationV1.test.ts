import { Effect } from "effect";
import { expect, it } from "vitest";

import {
  defineStandardApplicationSimulationV1,
  type StandardApplicationSimulationV1,
} from "@flarex/system-test/simulation/v1";
import { makeCreateAndReadDefinitionV1 } from
  "./support/createAndReadDefinitionV1";
import { makeCreateAndReadFunctionSourcesV1 } from
  "./support/createAndReadFunctionSourcesV1";

it("defines an owned immutable Standard Application simulation config", () => {
  const input: StandardApplicationSimulationV1<void, true, never> = {
    version: 1,
    simulationId: "definition-contract",
    application: {
      applicationId: "definition-contract",
      revisionName: "definition-contract-v1",
      define: () => makeCreateAndReadDefinitionV1({
        tableName: "records",
        mutationModulePath: "recordCommands",
        queryModulePath: "records",
        mutationArtifactPath: "recordMutation",
        queryArtifactPath: "recordQuery",
        ...makeCreateAndReadFunctionSourcesV1("records"),
        fields: {
          value: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      }),
    },
    setup: () => Effect.void,
    workload: () => Effect.succeed(true),
    expectedRuntimeExecutions: {
      mutations: 0,
      queries: 0,
    },
  };

  const simulation = defineStandardApplicationSimulationV1(input);

  expect(simulation).not.toBe(input);
  expect(simulation.application).not.toBe(input.application);
  expect(simulation.expectedRuntimeExecutions)
    .not.toBe(input.expectedRuntimeExecutions);
  expect(Object.isFrozen(simulation)).toBe(true);
  expect(Object.isFrozen(simulation.application)).toBe(true);
  expect(Object.isFrozen(simulation.expectedRuntimeExecutions)).toBe(true);
  expect(simulation).toMatchObject({
    version: 1,
    simulationId: "definition-contract",
    application: {
      applicationId: "definition-contract",
      revisionName: "definition-contract-v1",
    },
    expectedRuntimeExecutions: {
      mutations: 0,
      queries: 0,
    },
  });
});

it("rejects invalid runtime-execution expectations at definition time", () => {
  const input: StandardApplicationSimulationV1<void, void, never> = {
    version: 1,
    simulationId: "invalid-expectations",
    application: {
      applicationId: "invalid-expectations",
      revisionName: "invalid-expectations-v1",
      define: () => makeCreateAndReadDefinitionV1({
        tableName: "records",
        mutationModulePath: "recordCommands",
        queryModulePath: "records",
        mutationArtifactPath: "recordMutation",
        queryArtifactPath: "recordQuery",
        ...makeCreateAndReadFunctionSourcesV1("records"),
        fields: {
          value: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      }),
    },
    setup: () => Effect.void,
    workload: () => Effect.void,
    expectedRuntimeExecutions: {
      mutations: -1,
      queries: 0,
    },
  };

  expect(() => defineStandardApplicationSimulationV1(input)).toThrow(
    "Standard Application simulation runtime expectations must be non-negative safe integers.",
  );
});

it("captures each runtime-execution expectation exactly once", () => {
  let mutationReads = 0;
  let queryReads = 0;
  const input: StandardApplicationSimulationV1<void, void, never> = {
    version: 1,
    simulationId: "single-read-expectations",
    application: {
      applicationId: "single-read-expectations",
      revisionName: "single-read-expectations-v1",
      define: () => makeCreateAndReadDefinitionV1({
        tableName: "records",
        mutationModulePath: "recordCommands",
        queryModulePath: "records",
        mutationArtifactPath: "recordMutation",
        queryArtifactPath: "recordQuery",
        ...makeCreateAndReadFunctionSourcesV1("records"),
        fields: {
          value: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      }),
    },
    setup: () => Effect.void,
    workload: () => Effect.void,
    expectedRuntimeExecutions: {
      get mutations() {
        mutationReads += 1;
        return mutationReads === 1 ? 0 : -1;
      },
      get queries() {
        queryReads += 1;
        return queryReads === 1 ? 0 : -1;
      },
    },
  };

  const simulation = defineStandardApplicationSimulationV1(input);

  expect(mutationReads).toBe(1);
  expect(queryReads).toBe(1);
  expect(simulation.expectedRuntimeExecutions).toEqual({
    mutations: 0,
    queries: 0,
  });
});

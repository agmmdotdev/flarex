import {
  prepareApplication,
  produceApplicationSource,
  type ApplicationPreparationPolicy,
} from "@flarex/application-definition";
import { Effect, Result } from "effect";
import { expect, it } from "vitest";

import { standardV1 } from
  "@flarex/standard-application-definition/v1";

import {
  defineStandardApplicationSimulationV1,
  type StandardApplicationSimulationV1,
} from "@flarex/system-test/simulation/v1";
import {
  makeCreateAndReadDefinitionV1,
  makeCreateAndReadModulesV1,
} from
  "./support/createAndReadDefinitionV1";
import { makeCreateAndReadFunctionSourcesV1 } from
  "./support/createAndReadFunctionSourcesV1";

const RECORD_FIELDS = { value: standardV1.string() } as const;
const RECORD_MODULES = makeCreateAndReadModulesV1({
  tableName: "records",
  fields: RECORD_FIELDS,
  mutationModulePath: "recordCommands",
  queryModulePath: "records",
});

const PREPARATION_POLICY = Object.freeze({
  maximumModules: 8,
  maximumFunctions: 32,
  maximumIdentifierUtf8Bytes: 4_096,
  maximumValidatorNodes: 512,
  maximumValidatorDepth: 32,
  maximumValidatorStringUtf8Bytes: 4_096,
  maximumSourceBytes: 16_384,
  maximumSourceMapBytes: 1_024,
  maximumBytesMaterialized: 128_000,
  maximumSemanticRecords: 256,
  maximumSemanticRecordBytes: 8_000,
  maximumSemanticStreamBytes: 64_000,
}) satisfies ApplicationPreparationPolicy;

it("defines an owned immutable Standard Application simulation config", () => {
  const allowedOrigins = ["https://api.example.com"];
  const actionFetch = async () => new Response(null, { status: 204 });
  const input: StandardApplicationSimulationV1<void, true, never> = {
    version: 1,
    simulationId: "definition-contract",
    application: {
      applicationId: "definition-contract",
      revisionName: "definition-contract-v1",
      actionHost: { allowedOrigins, fetch: actionFetch },
      define: () => makeCreateAndReadDefinitionV1({
        tableName: "records",
        ...RECORD_MODULES,
        mutationArtifactPath: "recordMutation",
        queryArtifactPath: "recordQuery",
        ...makeCreateAndReadFunctionSourcesV1("records"),
        fields: RECORD_FIELDS,
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
  expect(Object.isFrozen(simulation.application.actionHost)).toBe(true);
  expect(Object.isFrozen(
    simulation.application.actionHost?.allowedOrigins,
  )).toBe(true);
  expect(simulation.application.actionHost?.allowedOrigins)
    .not.toBe(allowedOrigins);
  expect(simulation.application.actionHost?.fetch).toBe(actionFetch);
  allowedOrigins.push("https://changed.example.com");
  expect(simulation.application.actionHost?.allowedOrigins).toEqual([
    "https://api.example.com",
  ]);
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
        ...RECORD_MODULES,
        mutationArtifactPath: "recordMutation",
        queryArtifactPath: "recordQuery",
        ...makeCreateAndReadFunctionSourcesV1("records"),
        fields: RECORD_FIELDS,
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
        ...RECORD_MODULES,
        mutationArtifactPath: "recordMutation",
        queryArtifactPath: "recordQuery",
        ...makeCreateAndReadFunctionSourcesV1("records"),
        fields: RECORD_FIELDS,
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

it("composes owned supplemental function modules without making them execution roots", () => {
  const sourceBytes = new TextEncoder().encode(
    "export function inspect() { return null; }",
  );
  const definition = makeCreateAndReadDefinitionV1({
    tableName: "records",
    ...RECORD_MODULES,
    mutationArtifactPath: "recordMutation",
    queryArtifactPath: "recordQuery",
    ...makeCreateAndReadFunctionSourcesV1("records"),
    fields: RECORD_FIELDS,
    additionalFunctionModules: [{
      module: standardV1.module("recordInspection", {
        inspect: standardV1.internalQuery({
          args: standardV1.any(),
          returns: standardV1.null(),
        }),
      }),
      artifactModulePath: "recordInspectionArtifact",
      sourceBytes,
    }],
  });
  sourceBytes.fill(0);

  expect(definition.modules.map(module => ({
    path: module.path,
    sourcePath: module.source.path,
    functions: Object.keys(module.functions),
  }))).toEqual([{
    path: "recordCommands",
    sourcePath: "recordMutation",
    functions: ["create"],
  }, {
    path: "recordInspection",
    sourcePath: "recordInspectionArtifact",
    functions: ["inspect"],
  }, {
    path: "records",
    sourcePath: "recordQuery",
    functions: ["get"],
  }]);
  expect(definition.modules[1]?.functions.inspect).toMatchObject({
    kind: "query",
    visibility: "internal",
  });
  expect("programInput" in definition).toBe(false);
  expect("graphInput" in definition).toBe(false);

  const prepared = Result.getOrThrow(
    prepareApplication(definition, PREPARATION_POLICY),
  );
  const produced = Result.getOrThrow(produceApplicationSource(prepared));
  const inspectionSource = produced.modules.find(module =>
    module.path === "recordInspectionArtifact"
  );
  expect(inspectionSource?.sourceBytes).not.toEqual(sourceBytes);
  expect(new TextDecoder().decode(inspectionSource?.sourceBytes)).toBe(
    "export function inspect() { return null; }",
  );
  expect(produced.executionPath).toBe("_flarex/application.js");
});

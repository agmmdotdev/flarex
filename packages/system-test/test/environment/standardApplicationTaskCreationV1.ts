import {
  decodeTaskRunCreationRequestKeyV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  defineStandardApplicationTaskV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import {
  standardV1,
} from "@flarex/standard-application-definition/v1";
import {
  defineStandardApplicationSimulationV1,
} from "@flarex/system-test/simulation/v1";
import { Effect, Result } from "effect";

import {
  makeCreateAndReadDefinitionV1,
  makeCreateAndReadModulesV1,
} from "../simulation/support/createAndReadDefinitionV1";
import { makeCreateAndReadFunctionSourcesV1 } from
  "../simulation/support/createAndReadFunctionSourcesV1";

export const standardApplicationTaskCreationV1 = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "systemTest.prepareRecipe",
    handler: {
      logicalModulePath: "recipeCommands",
      artifactModulePath: "recipeMutation",
      exportName: "prepareRecipe",
    },
    payload: standardV1.object({
      recipeId: standardV1.string(),
      servings: standardV1.number(),
    }),
    output: standardV1.object({ prepared: standardV1.boolean() }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 300,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  }),
);

const request = Object.freeze({
  version: 1 as const,
  requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
    "system-test:task-creation-replay",
  )),
  payload: Object.freeze({ recipeId: "recipe-1", servings: 4 }),
  executionIdentity: Object.freeze({
    kind: "user" as const,
    user: Object.freeze({
      tokenIdentifier: "standard-application-system-test",
      subject: "task-user-1",
      issuer: "https://system-test.flarex.invalid",
    }),
  }),
});

export const standardApplicationTaskCreationSimulationV1 =
  defineStandardApplicationSimulationV1({
    version: 1,
    simulationId: "typed-task-creation-replay",
    application: {
      applicationId: "typed-task-creation-replay",
      revisionName: "system-test-typed-task-creation-replay",
      define: taskApplicationDefinition,
      defineTasks: () => [standardApplicationTaskCreationV1],
    },
    setup: () => Effect.void,
    workload: client => Effect.gen(function* () {
      const first = yield* client.createTaskRun(
        standardApplicationTaskCreationV1.reference,
        request,
      );
      const replay = yield* client.createTaskRun(
        standardApplicationTaskCreationV1.reference,
        request,
      );
      return Object.freeze({ first, replay });
    }),
    expectedRuntimeExecutions: { mutations: 0, queries: 0 },
  });

export interface StandardApplicationTaskCreationStateV1
  extends Readonly<Record<string, unknown>>
{
  readonly catalog_count: string;
  readonly definition_count: string;
  readonly legacy_definition_revision_count: string;
  readonly run_count: string;
  readonly request_count: string;
  readonly attempt_count: string;
  readonly pending_count: string;
  readonly dispatch_count: string;
}

export async function readStandardApplicationTaskCreationStateV1(
  persistence: Readonly<{
    readonly query: <Row extends Record<string, unknown>>(
      sql: string,
    ) => PromiseLike<Readonly<{ readonly rows: ReadonlyArray<Row> }>>;
  }>,
): Promise<ReadonlyArray<StandardApplicationTaskCreationStateV1>> {
  const result = await persistence.query<StandardApplicationTaskCreationStateV1>(`
    select
      (select count(*)::text from fx_system_application_task_catalog_v1) as catalog_count,
      (select count(*)::text from fx_system_application_task_definition_v1) as definition_count,
      (select count(*)::text from fx_system_durable_task_definition_revision_v1) as legacy_definition_revision_count,
      (select count(*)::text from fx_system_durable_task_run_v1) as run_count,
      (select count(*)::text from fx_system_durable_task_run_request_v1) as request_count,
      (select count(*)::text from fx_system_durable_task_attempt_identity_v1) as attempt_count,
      (select count(*)::text from fx_system_durable_task_compute_pending_v1) as pending_count,
      (select count(*)::text from fx_system_durable_task_compute_dispatch_v1) as dispatch_count
  `);
  return result.rows;
}

function taskApplicationDefinition() {
  const fields = {
    title: standardV1.string(),
    servings: standardV1.number(),
  } as const;
  return makeCreateAndReadDefinitionV1({
    tableName: "recipes",
    ...makeCreateAndReadModulesV1({
      tableName: "recipes",
      fields,
      mutationModulePath: "recipeCommands",
      queryModulePath: "recipes",
    }),
    mutationArtifactPath: "recipeMutation",
    queryArtifactPath: "recipeQuery",
    mutationSourceBytes: new TextEncoder().encode([
      'export function create(ctx,a){return ctx.db.insert("recipes",a)}',
      "export async function prepareRecipe(_ctx, payload) {",
      "  return { prepared: payload.servings > 0 };",
      "}",
    ].join("\n")),
    querySourceBytes:
      makeCreateAndReadFunctionSourcesV1("recipes").querySourceBytes,
    fields,
  });
}

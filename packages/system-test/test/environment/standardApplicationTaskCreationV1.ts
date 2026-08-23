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
import type {
  CreateStandardApplicationTaskRunError,
  StandardApplicationTaskRunCreationReceipt,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import { Effect, Result } from "effect";
import { TransactionRequestKeyV1Schema } from
  "flarex-protocol/transaction-session";

import {
  makeCreateAndReadDefinitionV1,
  makeCreateAndReadModulesV1,
} from "../simulation/support/createAndReadDefinitionV1";
import type {
  StandardApplicationLegacySimulationMutationErrorV1,
  StandardApplicationSystemTestClientV1,
  StandardApplicationSystemTestSetupClientV1,
  StandardApplicationTypedReferenceV1Error,
} from "../../src/environment/standardApplicationEnvironmentV1";
import type {
  StandardApplicationTaskDeliveryV1Error,
  StandardApplicationTaskRetryScheduledDeliveryReceiptV1,
  StandardApplicationTaskSucceededDeliveryReceiptV1,
} from "../../src/environment/standardApplicationTaskDeliveryV1";

const RECIPE_FIELDS = {
  title: standardV1.string(),
  servings: standardV1.number(),
} as const;
const RECIPE_DOCUMENT = standardV1.object({
  _id: standardV1.id("recipes"),
  _creationTime: standardV1.number(),
  ...RECIPE_FIELDS,
});
const RECIPE_MODULES = makeCreateAndReadModulesV1({
  tableName: "recipes",
  fields: RECIPE_FIELDS,
  mutationModulePath: "recipeCommands",
  queryModulePath: "recipes",
});
const RECIPE_CREATE = RECIPE_MODULES.mutationModule.reference("create");
const PREPARATION_FIELDS = {
  recipeId: standardV1.string(),
  title: standardV1.string(),
  subject: standardV1.string(),
} as const;
const PREPARATION_MODULE = standardV1.module("preparationCommands", {
  create: standardV1.publicMutation({
    args: standardV1.object(PREPARATION_FIELDS),
    returns: standardV1.id("preparations"),
  }),
});
const RECIPE_SETUP_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "system-test:task-query-callback:setup",
);
const TASK_IDENTITY_SUBJECT = "task-user-1";

interface StandardApplicationTaskSetupV1 {
  readonly recipeId: string;
}

interface StandardApplicationTaskWorkloadProofV1 {
  readonly first: StandardApplicationTaskRunCreationReceipt;
  readonly replay: StandardApplicationTaskRunCreationReceipt;
  readonly delivery: StandardApplicationTaskSucceededDeliveryReceiptV1<Readonly<{
    readonly prepared: boolean;
    readonly preparationId: string;
    readonly title: string;
    readonly subject: string;
  }>>;
  readonly failedFirst: StandardApplicationTaskRunCreationReceipt;
  readonly failedReplay: StandardApplicationTaskRunCreationReceipt;
  readonly failedDelivery:
    StandardApplicationTaskRetryScheduledDeliveryReceiptV1;
}

type StandardApplicationTaskSimulationErrorV1 =
  | StandardApplicationLegacySimulationMutationErrorV1
  | StandardApplicationTypedReferenceV1Error
  | CreateStandardApplicationTaskRunError
  | StandardApplicationTaskDeliveryV1Error;

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
    output: standardV1.object({
      prepared: standardV1.boolean(),
      preparationId: standardV1.id("preparations"),
      title: standardV1.string(),
      subject: standardV1.string(),
    }),
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
    maximumDurationInSeconds: 30,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  }),
);

export const standardApplicationTaskFailureV1 = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "systemTest.failRecipePreparation",
    handler: {
      logicalModulePath: "recipeCommands",
      artifactModulePath: "recipeMutation",
      exportName: "failRecipePreparation",
    },
    payload: standardV1.object({ recipeId: standardV1.string() }),
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
    maximumDurationInSeconds: 30,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  }),
);

const setupTaskQueryCallbackV1 = Effect.fn(
  "StandardApplicationTaskQueryCallback.setupV1",
)(function* (
  client: StandardApplicationSystemTestSetupClientV1,
): Effect.fn.Return<
  StandardApplicationTaskSetupV1,
  StandardApplicationTaskSimulationErrorV1
> {
  const created = yield* client.mutation(
    RECIPE_CREATE,
    { title: "Task soup", servings: 4 },
    RECIPE_SETUP_REQUEST_KEY,
  );
  if (
    created.status !== "committed" ||
    created.disposition !== "published" ||
    typeof created.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The Task query callback setup did not publish a recipe.",
    ));
  }
  return Object.freeze({ recipeId: created.value });
});

const runTaskQueryCallbackV1 = Effect.fn(
  "StandardApplicationTaskQueryCallback.workloadV1",
)(function* (
  client: StandardApplicationSystemTestClientV1,
  setup: StandardApplicationTaskSetupV1,
): Effect.fn.Return<
  StandardApplicationTaskWorkloadProofV1,
  StandardApplicationTaskSimulationErrorV1
> {
  const request = Object.freeze({
    version: 1 as const,
    requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
      "system-test:task-creation-replay",
    )),
    payload: Object.freeze({ recipeId: setup.recipeId, servings: 4 }),
    executionIdentity: Object.freeze({
      kind: "user" as const,
      user: Object.freeze({
        tokenIdentifier: "standard-application-system-test",
        subject: TASK_IDENTITY_SUBJECT,
        issuer: "https://system-test.flarex.invalid",
      }),
    }),
  });
  const first = yield* client.tasks.create(
    standardApplicationTaskCreationV1.reference,
    request,
  );
  const replay = yield* client.tasks.create(
    standardApplicationTaskCreationV1.reference,
    request,
  );
  const delivery = yield* client.tasks.deliver(
    standardApplicationTaskCreationV1.reference,
    first,
  );
  if (delivery.status !== "succeeded") {
    return yield* Effect.die(new Error(
      "The successful Task unexpectedly scheduled a retry.",
    ));
  }
  const failedRequest = Object.freeze({
    ...request,
    requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
      "system-test:task-failure-retry-replay",
    )),
    payload: Object.freeze({ recipeId: setup.recipeId }),
  });
  const failedFirst = yield* client.tasks.create(
    standardApplicationTaskFailureV1.reference,
    failedRequest,
  );
  const failedReplay = yield* client.tasks.create(
    standardApplicationTaskFailureV1.reference,
    failedRequest,
  );
  const failedDelivery = yield* client.tasks.deliver(
    standardApplicationTaskFailureV1.reference,
    failedFirst,
  );
  if (failedDelivery.status !== "retry_scheduled") {
    return yield* Effect.die(new Error(
      "The failing Task did not schedule its bound retry.",
    ));
  }
  return Object.freeze({
    first,
    replay,
    delivery,
    failedFirst,
    failedReplay,
    failedDelivery,
  });
});

export const standardApplicationTaskCreationSimulationV1 =
  defineStandardApplicationSimulationV1({
    version: 1,
    simulationId: "typed-task-creation-replay",
    application: {
      applicationId: "typed-task-creation-replay",
      revisionName: "system-test-typed-task-creation-replay",
      define: taskApplicationDefinition,
      defineTasks: () => [
        standardApplicationTaskCreationV1,
        standardApplicationTaskFailureV1,
      ],
    },
    setup: setupTaskQueryCallbackV1,
    workload: runTaskQueryCallbackV1,
    expectedRuntimeExecutions: { mutations: 2, queries: 1 },
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
  readonly transaction_session_count: string;
  readonly committed_transaction_session_count: string;
  readonly child_mutation_effect_count: string;
  readonly confirmed_child_mutation_effect_count: string;
  readonly child_mutation_outcome_count: string;
  readonly ready_run_count: string;
  readonly terminal_run_count: string;
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
      (select count(*)::text from fx_system_durable_task_compute_dispatch_v1) as dispatch_count,
      (select count(*)::text from fx_system_tx_session) as transaction_session_count,
      (select count(*)::text from fx_system_tx_session where lifecycle = 'committed') as committed_transaction_session_count,
      (select count(*)::text from fx_system_external_effect_attempt_v1 where effect_kind = 'child_mutation') as child_mutation_effect_count,
      (select count(*)::text from fx_system_external_effect_attempt_v1 where effect_kind = 'child_mutation' and state = 'confirmed') as confirmed_child_mutation_effect_count,
      (select count(*)::text from fx_system_external_effect_attempt_v1 where effect_kind = 'child_mutation' and child_mutation_outcome_sha256 is not null) as child_mutation_outcome_count,
      (select count(*)::text from fx_system_durable_task_run_v1 where phase = 'ready' and due_kind = 'start_attempt') as ready_run_count,
      (select count(*)::text from fx_system_durable_task_run_v1 where phase = 'terminal') as terminal_run_count
  `);
  return result.rows;
}

function taskApplicationDefinition() {
  return makeCreateAndReadDefinitionV1({
    tableName: "recipes",
    mutationModule: RECIPE_MODULES.mutationModule,
    queryModule: standardV1.module("recipes", {
      get: standardV1.publicQuery({
        args: standardV1.object({ id: standardV1.string() }),
        returns: standardV1.object({
          recipe: standardV1.nullable(RECIPE_DOCUMENT),
          subject: standardV1.string(),
        }),
      }),
    }),
    mutationArtifactPath: "recipeMutation",
    queryArtifactPath: "recipeQuery",
    mutationSourceBytes: new TextEncoder().encode([
      'export function create(ctx,a){return ctx.db.insert("recipes",a)}',
      "export function failRecipePreparation() {",
      "  throw new Error('simulated recipe preparation failure');",
      "}",
      "export async function prepareRecipe(ctx, payload) {",
      "  const result = await ctx.runQuery('recipes:get', { id: payload.recipeId });",
      "  if (result.recipe === null) throw new Error('recipe missing');",
      "  const preparationId = await ctx.runMutation('preparationCommands:create', {",
      "    recipeId: payload.recipeId,",
      "    title: result.recipe.title,",
      "    subject: result.subject,",
      "  });",
      "  return {",
      "    prepared: result.recipe.servings === payload.servings,",
      "    preparationId,",
      "    title: result.recipe.title,",
      "    subject: result.subject,",
      "  };",
      "}",
    ].join("\n")),
    querySourceBytes: new TextEncoder().encode([
      "export async function get(ctx, { id }) {",
      "  const identity = await ctx.auth.getUserIdentity();",
      "  return {",
      "    recipe: await ctx.db.get(id),",
      "    subject: identity?.subject ?? 'anonymous',",
      "  };",
      "}",
    ].join("\n")),
    fields: RECIPE_FIELDS,
    additionalTables: [{
      logicalName: "preparations",
      fields: PREPARATION_FIELDS,
    }],
    additionalFunctionModules: [{
      module: PREPARATION_MODULE,
      artifactModulePath: "preparationMutation",
      sourceBytes: new TextEncoder().encode(
        'export function create(ctx,a){return ctx.db.insert("preparations",a)}',
      ),
    }],
  });
}

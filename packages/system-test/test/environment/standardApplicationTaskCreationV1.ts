import {
  decodeTaskRunCreationRequestKeyV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  defineStandardApplicationTaskV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import {
  standardV1,
} from "@flarex/standard-application-definition/internal/legacy-authoring";
import {
  defineApplication,
  defineModule,
  defineSchema,
  defineTable,
  mutation,
  query,
  sourceModule,
  task,
  v,
} from "@flarex/application-definition";
import { defineSimulation } from "@flarex/system-test/simulation";
import type {
  CreateStandardApplicationTaskRunError,
  StandardApplicationTaskRunCreationReceipt,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import { Effect, Result } from "effect";
import { TransactionRequestKeyV1Schema } from
  "flarex-protocol/transaction-session";

import type {
  RunMutationError,
  StartTaskError,
  TaskRun,
  SimulationClient,
  SimulationSetupClient,
} from "@flarex/system-test/environment";
import type {
  StandardApplicationTaskDeliveryV1Error,
  StandardApplicationTaskCancelledDeliveryReceiptV1,
  StandardApplicationTaskRecoveredDeliveryReceiptV1,
  StandardApplicationTaskResultPublicationUncertainReceiptV1,
  StandardApplicationTaskRetryScheduledDeliveryReceiptV1,
  StandardApplicationTaskSucceededDeliveryReceiptV1,
} from "../../src/environment/standardApplicationTaskDeliveryV1";

const RECIPE_FIELDS = {
  title: v.string(),
  servings: v.number(),
} as const;
const RECIPE_DOCUMENT = v.object({
  _id: v.id("recipes"),
  _creationTime: v.number(),
  ...RECIPE_FIELDS,
});
const PREPARATION_FIELDS = {
  recipeId: v.string(),
  title: v.string(),
  subject: v.string(),
} as const;
const RECIPE_MUTATION_SOURCE = new TextEncoder().encode([
  'export function create(ctx,a){return ctx.db.insert("recipes",a)}',
  "export function failRecipePreparation() {",
  "  throw new Error('simulated recipe preparation failure');",
  "}",
  "export async function waitForCancellation() {",
  "  await new Promise(() => {});",
  "  return { completed: true };",
  "}",
  "export function completeCancellationRace() {",
  "  return { completed: true };",
  "}",
  "export function taskFaultProbe(_ctx, payload) {",
  "  return { probe: payload.probe };",
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
].join("\n"));
const RECIPE_QUERY_SOURCE = new TextEncoder().encode([
  "export async function get(ctx, { id }) {",
  "  const identity = await ctx.auth.getUserIdentity();",
  "  return {",
  "    recipe: await ctx.db.get(id),",
  "    subject: identity?.subject ?? 'anonymous',",
  "  };",
  "}",
].join("\n"));
const PREPARATION_SOURCE = new TextEncoder().encode(
  'export function create(ctx,a){return ctx.db.insert("preparations",a)}',
);
const RECIPE_MUTATION_MODULE = defineModule({
  path: "recipeCommands",
  source: sourceModule({ path: "recipeMutation", bytes: RECIPE_MUTATION_SOURCE }),
  functions: {
    create: mutation({
      args: v.object(RECIPE_FIELDS),
      returns: v.id("recipes"),
    }),
  },
});
const RECIPE_QUERY_MODULE = defineModule({
  path: "recipes",
  source: sourceModule({ path: "recipeQuery", bytes: RECIPE_QUERY_SOURCE }),
  functions: {
    get: query({
      args: v.object({ id: v.string() }),
      returns: v.object({
        recipe: v.nullable(RECIPE_DOCUMENT),
        subject: v.string(),
      }),
    }),
  },
});
const PREPARATION_MODULE = defineModule({
  path: "preparationCommands",
  source: sourceModule({ path: "preparationMutation", bytes: PREPARATION_SOURCE }),
  functions: {
    create: mutation({
      args: v.object(PREPARATION_FIELDS),
      returns: v.id("preparations"),
    }),
  },
});
const RECIPE_CREATE = RECIPE_MUTATION_MODULE.reference("create");
const RECIPE_SETUP_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "system-test:task-query-callback:setup",
);
const TASK_IDENTITY_SUBJECT = "task-user-1";

interface StandardApplicationTaskSetupV1 {
  readonly recipeId: string;
}

type PrepareRecipeTaskOutput = Readonly<{
  readonly prepared: boolean;
  readonly preparationId: string;
  readonly title: string;
  readonly subject: string;
}>;

interface StandardApplicationTaskWorkloadProofV1 {
  readonly first: TaskRun<PrepareRecipeTaskOutput>;
  readonly replay: TaskRun<PrepareRecipeTaskOutput>;
  readonly delivery:
    StandardApplicationTaskSucceededDeliveryReceiptV1<PrepareRecipeTaskOutput>;
  readonly failedFirst: StandardApplicationTaskRunCreationReceipt;
  readonly failedReplay: StandardApplicationTaskRunCreationReceipt;
  readonly failedDelivery:
    StandardApplicationTaskRetryScheduledDeliveryReceiptV1;
  readonly cancelledFirst: StandardApplicationTaskRunCreationReceipt;
  readonly cancelledReplay: StandardApplicationTaskRunCreationReceipt;
  readonly cancelledDelivery:
    StandardApplicationTaskCancelledDeliveryReceiptV1;
  readonly raceFirst: StandardApplicationTaskRunCreationReceipt;
  readonly raceReplay: StandardApplicationTaskRunCreationReceipt;
  readonly raceDelivery: StandardApplicationTaskSucceededDeliveryReceiptV1<
    Readonly<{ readonly completed: boolean }>
  >;
  readonly duplicateFirst: StandardApplicationTaskRunCreationReceipt;
  readonly duplicateReplay: StandardApplicationTaskRunCreationReceipt;
  readonly duplicateDelivery: StandardApplicationTaskSucceededDeliveryReceiptV1<
    Readonly<{ readonly probe: string }>
  >;
  readonly completionLostFirst: StandardApplicationTaskRunCreationReceipt;
  readonly completionLostReplay: StandardApplicationTaskRunCreationReceipt;
  readonly completionLostDelivery:
    StandardApplicationTaskSucceededDeliveryReceiptV1<
      Readonly<{ readonly probe: string }>
    >;
  readonly publicationReconciledFirst:
    StandardApplicationTaskRunCreationReceipt;
  readonly publicationReconciledReplay:
    StandardApplicationTaskRunCreationReceipt;
  readonly publicationReconciledDelivery:
    StandardApplicationTaskSucceededDeliveryReceiptV1<
      Readonly<{ readonly probe: string }>
    >;
  readonly publicationUncertainFirst: StandardApplicationTaskRunCreationReceipt;
  readonly publicationUncertainReplay:
    StandardApplicationTaskRunCreationReceipt;
  readonly publicationUncertainDelivery:
    StandardApplicationTaskResultPublicationUncertainReceiptV1;
  readonly recoveryFirst: StandardApplicationTaskRunCreationReceipt;
  readonly recoveryReplay: StandardApplicationTaskRunCreationReceipt;
  readonly recoveryDelivery: StandardApplicationTaskRecoveredDeliveryReceiptV1<
    Readonly<{ readonly probe: string }>
  >;
}

type StandardApplicationTaskSimulationErrorV1 =
  | RunMutationError
  | StartTaskError
  | CreateStandardApplicationTaskRunError
  | StandardApplicationTaskDeliveryV1Error;

export const standardApplicationTaskCreationV1 = Result.getOrThrow(
  task({
    id: "systemTest.prepareRecipe",
    handler: {
      module: RECIPE_MUTATION_MODULE,
      exportName: "prepareRecipe",
    },
    payload: v.object({
      recipeId: v.string(),
      servings: v.number(),
    }),
    returns: v.object({
      prepared: v.boolean(),
      preparationId: v.id("preparations"),
      title: v.string(),
      subject: v.string(),
    }),
    attempts: {
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
    compute: "standard-1x",
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

export const standardApplicationTaskCancellationWaitV1 = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "systemTest.waitForCancellation",
    handler: {
      logicalModulePath: "recipeCommands",
      artifactModulePath: "recipeMutation",
      exportName: "waitForCancellation",
    },
    payload: standardV1.object({ probe: standardV1.string() }),
    output: standardV1.object({ completed: standardV1.boolean() }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 1,
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

export const standardApplicationTaskCancellationRaceV1 = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "systemTest.completeCancellationRace",
    handler: {
      logicalModulePath: "recipeCommands",
      artifactModulePath: "recipeMutation",
      exportName: "completeCancellationRace",
    },
    payload: standardV1.object({ probe: standardV1.string() }),
    output: standardV1.object({ completed: standardV1.boolean() }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 1,
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

export const standardApplicationTaskFaultProbeV1 = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "systemTest.taskFaultProbe",
    handler: {
      logicalModulePath: "recipeCommands",
      artifactModulePath: "recipeMutation",
      exportName: "taskFaultProbe",
    },
    payload: standardV1.object({ probe: standardV1.string() }),
    output: standardV1.object({ probe: standardV1.string() }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 1,
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

export const standardApplicationTaskRecoveryProbeV1 = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "systemTest.taskRecoveryProbe",
    handler: {
      logicalModulePath: "recipeCommands",
      artifactModulePath: "recipeMutation",
      exportName: "taskFaultProbe",
    },
    payload: standardV1.object({ probe: standardV1.string() }),
    output: standardV1.object({ probe: standardV1.string() }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 2,
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
  client: SimulationSetupClient,
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
  client: SimulationClient,
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
  const first = yield* client.startTask(
    standardApplicationTaskCreationV1.reference,
    request.payload,
    {
      requestKey: request.requestKey,
      identity: request.executionIdentity,
    },
  );
  const replay = yield* client.startTask(
    standardApplicationTaskCreationV1.reference,
    request.payload,
    {
      requestKey: request.requestKey,
      identity: request.executionIdentity,
    },
  );
  const delivery = yield* client.tasks.deliver(
    standardApplicationTaskCreationV1.reference,
    first,
    { kind: "completion" },
  );
  if (delivery.status !== "succeeded") {
    return yield* Effect.die(new Error(
      "The successful Task unexpectedly scheduled a retry.",
    ));
  }
  const recoveryRequest = Object.freeze({
    ...request,
    requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
      "system-test:task-fresh-host-recovery",
    )),
    payload: Object.freeze({ probe: "fresh-host-recovery" }),
  });
  const recoveryFirst = yield* client.tasks.create(
    standardApplicationTaskRecoveryProbeV1.reference,
    recoveryRequest,
  );
  const recoveryReplay = yield* client.tasks.create(
    standardApplicationTaskRecoveryProbeV1.reference,
    recoveryRequest,
  );
  const recoveryDelivery = yield* client.tasks.deliver(
    standardApplicationTaskRecoveryProbeV1.reference,
    recoveryFirst,
    { kind: "recovery", recovery: "expired_attempt_takeover" },
  );
  if (recoveryDelivery.status !== "recovered") {
    return yield* Effect.die(new Error(
      "The fresh Task host did not recover the expired attempt.",
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
    { kind: "completion" },
  );
  if (failedDelivery.status !== "retry_scheduled") {
    return yield* Effect.die(new Error(
      "The failing Task did not schedule its bound retry.",
    ));
  }
  const cancelledRequest = Object.freeze({
    ...request,
    requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
      "system-test:task-cancellation-before-completion-replay",
    )),
    payload: Object.freeze({ probe: "cancel-before-completion" }),
  });
  const cancelledFirst = yield* client.tasks.create(
    standardApplicationTaskCancellationWaitV1.reference,
    cancelledRequest,
  );
  const cancelledReplay = yield* client.tasks.create(
    standardApplicationTaskCancellationWaitV1.reference,
    cancelledRequest,
  );
  const cancelledDelivery = yield* client.tasks.deliver(
    standardApplicationTaskCancellationWaitV1.reference,
    cancelledFirst,
    {
      kind: "cancellation",
      order: "cancellation_before_completion",
    },
  );
  if (cancelledDelivery.status !== "cancelled") {
    return yield* Effect.die(new Error(
      "The cancellation-first Task did not acknowledge cancellation.",
    ));
  }
  const raceRequest = Object.freeze({
    ...request,
    requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
      "system-test:task-completion-cancellation-race-replay",
    )),
    payload: Object.freeze({ probe: "completion-before-cancellation" }),
  });
  const raceFirst = yield* client.tasks.create(
    standardApplicationTaskCancellationRaceV1.reference,
    raceRequest,
  );
  const raceReplay = yield* client.tasks.create(
    standardApplicationTaskCancellationRaceV1.reference,
    raceRequest,
  );
  const raceDelivery = yield* client.tasks.deliver(
    standardApplicationTaskCancellationRaceV1.reference,
    raceFirst,
    {
      kind: "cancellation",
      order: "completion_before_cancellation",
    },
  );
  if (raceDelivery.status !== "succeeded") {
    return yield* Effect.die(new Error(
      "The completed Task did not win the cancellation race.",
    ));
  }
  const makeFaultRequest = (fault:
    | "duplicate-delivery"
    | "completion-response-lost"
    | "result-publication-reconciled"
    | "result-publication-uncertain") => Object.freeze({
    ...request,
    requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
      `system-test:task-fault:${fault}`,
    )),
    payload: Object.freeze({ probe: fault }),
  });
  const duplicateRequest = makeFaultRequest("duplicate-delivery");
  const duplicateFirst = yield* client.tasks.create(
    standardApplicationTaskFaultProbeV1.reference,
    duplicateRequest,
  );
  const duplicateReplay = yield* client.tasks.create(
    standardApplicationTaskFaultProbeV1.reference,
    duplicateRequest,
  );
  const duplicateDelivery = yield* client.tasks.deliver(
    standardApplicationTaskFaultProbeV1.reference,
    duplicateFirst,
    { kind: "fault", fault: "duplicate_delivery" },
  );
  if (duplicateDelivery.status !== "succeeded") {
    return yield* Effect.die(new Error(
      "The duplicate Task delivery did not preserve terminal success.",
    ));
  }
  const completionLostRequest = makeFaultRequest("completion-response-lost");
  const completionLostFirst = yield* client.tasks.create(
    standardApplicationTaskFaultProbeV1.reference,
    completionLostRequest,
  );
  const completionLostReplay = yield* client.tasks.create(
    standardApplicationTaskFaultProbeV1.reference,
    completionLostRequest,
  );
  const completionLostDelivery = yield* client.tasks.deliver(
    standardApplicationTaskFaultProbeV1.reference,
    completionLostFirst,
    { kind: "fault", fault: "completion_response_lost" },
  );
  if (completionLostDelivery.status !== "succeeded") {
    return yield* Effect.die(new Error(
      "The lost completion response did not replay to terminal success.",
    ));
  }
  const publicationReconciledRequest = makeFaultRequest(
    "result-publication-reconciled",
  );
  const publicationReconciledFirst = yield* client.tasks.create(
    standardApplicationTaskFaultProbeV1.reference,
    publicationReconciledRequest,
  );
  const publicationReconciledReplay = yield* client.tasks.create(
    standardApplicationTaskFaultProbeV1.reference,
    publicationReconciledRequest,
  );
  const publicationReconciledDelivery = yield* client.tasks.deliver(
    standardApplicationTaskFaultProbeV1.reference,
    publicationReconciledFirst,
    { kind: "fault", fault: "result_publication_reconciled" },
  );
  if (publicationReconciledDelivery.status !== "succeeded") {
    return yield* Effect.die(new Error(
      "The lost publication response did not reconcile to terminal success.",
    ));
  }
  const publicationUncertainRequest = makeFaultRequest(
    "result-publication-uncertain",
  );
  const publicationUncertainFirst = yield* client.tasks.create(
    standardApplicationTaskFaultProbeV1.reference,
    publicationUncertainRequest,
  );
  const publicationUncertainReplay = yield* client.tasks.create(
    standardApplicationTaskFaultProbeV1.reference,
    publicationUncertainRequest,
  );
  const publicationUncertainDelivery = yield* client.tasks.deliver(
    standardApplicationTaskFaultProbeV1.reference,
    publicationUncertainFirst,
    { kind: "fault", fault: "result_publication_uncertain" },
  );
  if (publicationUncertainDelivery.status !== "result_publication_uncertain") {
    return yield* Effect.die(new Error(
      "The unresolved publication response fabricated a settled outcome.",
    ));
  }
  return Object.freeze({
    first,
    replay,
    delivery,
    failedFirst,
    failedReplay,
    failedDelivery,
    cancelledFirst,
    cancelledReplay,
    cancelledDelivery,
    raceFirst,
    raceReplay,
    raceDelivery,
    duplicateFirst,
    duplicateReplay,
    duplicateDelivery,
    completionLostFirst,
    completionLostReplay,
    completionLostDelivery,
    publicationReconciledFirst,
    publicationReconciledReplay,
    publicationReconciledDelivery,
    publicationUncertainFirst,
    publicationUncertainReplay,
    publicationUncertainDelivery,
    recoveryFirst,
    recoveryReplay,
    recoveryDelivery,
  });
});

export const standardApplicationTaskCreationSimulationV1 =
  defineSimulation({
    simulationId: "typed-task-creation-replay",
    application: {
      applicationId: "typed-task-creation-replay",
      revisionName: "system-test-typed-task-creation-replay",
      define: taskApplicationDefinition,
      defineTasks: () => [
        standardApplicationTaskCreationV1,
        standardApplicationTaskFailureV1,
        standardApplicationTaskCancellationWaitV1,
        standardApplicationTaskCancellationRaceV1,
        standardApplicationTaskFaultProbeV1,
        standardApplicationTaskRecoveryProbeV1,
      ],
    },
    setup: setupTaskQueryCallbackV1,
    workload: runTaskQueryCallbackV1,
    expectedRuntimeExecutions: { mutations: 2, queries: 1 },
  });

function compileTimeTaskDeliveryChecks(
  client: SimulationClient,
  legacyReceipt: StandardApplicationTaskRunCreationReceipt,
): void {
  const reference = standardApplicationTaskCreationV1.reference;
  const mode = { kind: "completion" as const };
  // @ts-expect-error A clean Task reference requires a clean Task run handle.
  client.tasks.deliver(reference, legacyReceipt, mode);
}

void compileTimeTaskDeliveryChecks;

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
  readonly cancellation_count: string;
  readonly delivered_cancellation_count: string;
  readonly rejected_cancellation_count: string;
  readonly transaction_session_count: string;
  readonly committed_transaction_session_count: string;
  readonly child_mutation_effect_count: string;
  readonly confirmed_child_mutation_effect_count: string;
  readonly child_mutation_outcome_count: string;
  readonly ready_run_count: string;
  readonly executing_run_count: string;
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
      (select count(*)::text from fx_system_durable_task_compute_cancellation_v1) as cancellation_count,
      (select count(*)::text from fx_system_durable_task_compute_cancellation_v1 where delivery_state = 'delivered') as delivered_cancellation_count,
      (select count(*)::text from fx_system_durable_task_compute_cancellation_v1 where delivery_state = 'rejected') as rejected_cancellation_count,
      (select count(*)::text from fx_system_tx_session) as transaction_session_count,
      (select count(*)::text from fx_system_tx_session where lifecycle = 'committed') as committed_transaction_session_count,
      (select count(*)::text from fx_system_external_effect_attempt_v1 where effect_kind = 'child_mutation') as child_mutation_effect_count,
      (select count(*)::text from fx_system_external_effect_attempt_v1 where effect_kind = 'child_mutation' and state = 'confirmed') as confirmed_child_mutation_effect_count,
      (select count(*)::text from fx_system_external_effect_attempt_v1 where effect_kind = 'child_mutation' and child_mutation_outcome_sha256 is not null) as child_mutation_outcome_count,
      (select count(*)::text from fx_system_durable_task_run_v1 where phase = 'ready' and due_kind = 'start_attempt') as ready_run_count,
      (select count(*)::text from fx_system_durable_task_run_v1 where phase = 'executing') as executing_run_count,
      (select count(*)::text from fx_system_durable_task_run_v1 where phase = 'terminal') as terminal_run_count
  `);
  return result.rows;
}

function taskApplicationDefinition() {
  return defineApplication({
    schema: defineSchema({
      recipes: defineTable(RECIPE_FIELDS),
      preparations: defineTable(PREPARATION_FIELDS),
    }),
    modules: [
      RECIPE_MUTATION_MODULE,
      PREPARATION_MODULE,
      RECIPE_QUERY_MODULE,
    ],
  });
}

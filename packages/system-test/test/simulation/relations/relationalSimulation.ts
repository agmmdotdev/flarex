import { readFileSync } from "node:fs";

import {
  defineApplication,
  defineModule,
  defineRelation,
  defineSchema,
  defineTable,
  mutation,
  query,
  sourceModule,
  v,
  type Id,
  type RelationDefinitionInput,
} from "@flarex/application-definition";
import type {
  RunMutationError,
  RunQueryError,
  SimulationClient,
  SimulationSetupClient,
} from "@flarex/system-test/environment";
import type { InspectionError } from "@flarex/system-test/inspection";
import { defineSimulation } from "@flarex/system-test/simulation";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect, Result } from "effect";
import { TransactionRequestKeyV1Schema } from
  "flarex-protocol/transaction-session";

const incomingSource = v.object({
  sourceDocumentId: v.string(),
  position: v.union(v.number(), v.null()),
});
const incomingPage = v.object({
  sources: v.array(incomingSource),
  exhausted: v.boolean(),
});
const seedResult = v.object({
  owner: v.id("users"),
  reviewer: v.id("users"),
  watcherA: v.id("users"),
  watcherB: v.id("users"),
  labelA: v.id("labels"),
  labelB: v.id("labels"),
  project: v.id("projects"),
  task: v.id("tasks"),
  membership: v.id("memberships"),
});

const commandModule = defineModule({
  path: "relationalCommands",
  source: sourceModule({
    path: "relationalCommandsSource",
    bytes: readFileSync(new URL(
      "./functions/relationalCommands.js",
      import.meta.url,
    )),
  }),
  functions: {
    seed: mutation({ args: v.object({}), returns: seedResult }),
    createProject: mutation({ args: v.any(), returns: v.id("projects") }),
    createProjects: mutation({
      args: v.object({
        owner: v.id("users"),
        count: v.number(),
        prefix: v.string(),
      }),
      returns: v.array(v.id("projects")),
    }),
    createTask: mutation({ args: v.any(), returns: v.id("tasks") }),
    patchProject: mutation({
      args: v.object({
        id: v.id("projects"),
        patch: v.object({
          owner: v.id("users"),
          reviewer: v.optional(v.id("users")),
          watchers: v.array(v.id("users")),
        }),
      }),
      returns: v.null(),
    }),
    clearProjectReviewerAndWatchers: mutation({
      args: v.object({ id: v.id("projects") }),
      returns: v.null(),
    }),
    remove: mutation({
      args: v.object({ id: v.string() }),
      returns: v.null(),
    }),
  },
});

const queryModule = defineModule({
  path: "relationalQueries",
  source: sourceModule({
    path: "relationalQueriesSource",
    bytes: readFileSync(new URL(
      "./functions/relationalQueries.js",
      import.meta.url,
    )),
  }),
  functions: {
    projectDashboard: query({
      args: v.object({
        owner: v.id("users"),
        reviewer: v.id("users"),
        watcher: v.id("users"),
        project: v.id("projects"),
      }),
      returns: v.object({
        owned: incomingPage,
        reviewed: incomingPage,
        watched: incomingPage,
        tasks: incomingPage,
        memberships: incomingPage,
      }),
    }),
    labelTasks: query({
      args: v.object({ label: v.id("labels") }),
      returns: incomingPage,
    }),
    assignedTasks: query({
      args: v.object({ user: v.id("users") }),
      returns: incomingPage,
    }),
    userMemberships: query({
      args: v.object({ user: v.id("users") }),
      returns: incomingPage,
    }),
    probe: query({
      args: v.object({
        table: v.string(),
        field: v.string(),
        target: v.string(),
        limit: v.number(),
      }),
      returns: incomingPage,
    }),
    syscallBudget: query({
      args: v.object({
        target: v.id("users"),
        calls: v.number(),
        limit: v.number(),
      }),
      returns: incomingPage,
    }),
    occurrenceBudget: query({
      args: v.object({
        target: v.id("users"),
        limits: v.array(v.number()),
      }),
      returns: incomingPage,
    }),
  },
});

const SEED = commandModule.reference("seed");
const CREATE_PROJECT = commandModule.reference("createProject");
const CREATE_PROJECTS = commandModule.reference("createProjects");
const CREATE_TASK = commandModule.reference("createTask");
const PATCH_PROJECT = commandModule.reference("patchProject");
const CLEAR_PROJECT = commandModule.reference(
  "clearProjectReviewerAndWatchers",
);
const REMOVE = commandModule.reference("remove");
const DASHBOARD = queryModule.reference("projectDashboard");
const LABEL_TASKS = queryModule.reference("labelTasks");
const ASSIGNED_TASKS = queryModule.reference("assignedTasks");
const USER_MEMBERSHIPS = queryModule.reference("userMemberships");
const PROBE = queryModule.reference("probe");
const SYSCALL_BUDGET = queryModule.reference("syscallBudget");
const OCCURRENCE_BUDGET = queryModule.reference("occurrenceBudget");

export interface RelationalSimulationSetup {
  readonly owner: Id<"users">;
  readonly reviewer: Id<"users">;
  readonly watcherA: Id<"users">;
  readonly watcherB: Id<"users">;
  readonly labelA: Id<"labels">;
  readonly labelB: Id<"labels">;
  readonly project: Id<"projects">;
  readonly task: Id<"tasks">;
  readonly membership: Id<"memberships">;
}

export interface RelationalSimulationProof {
  readonly sameCommitGraph: true;
  readonly requiredOne: true;
  readonly optionalOne: true;
  readonly orderedMany: true;
  readonly unorderedMany: true;
  readonly associationTable: true;
  readonly duplicateRejected: true;
  readonly unorderedDuplicateRejected: true;
  readonly danglingRejected: true;
  readonly wrongTableRejected: true;
  readonly maximumRejected: true;
  readonly minimumRejected: true;
  readonly minimumAccepted: true;
  readonly requiredMissingRejected: true;
  readonly nullOptionalRejected: true;
  readonly maximumAccepted: true;
  readonly targetDeleteRestricted: true;
  readonly manyTargetDeleteRestricted: true;
  readonly detachedTargetDeleted: true;
  readonly sourceDeleteCleaned: true;
  readonly noOpRelationUpdate: true;
  readonly noOpCommitSeq: bigint;
  readonly optionalCleared: true;
  readonly overLimitExhausted: true;
  readonly exactLimitExhausted: true;
  readonly syscallBudgetExact: true;
  readonly syscallBudgetExceeded: true;
  readonly occurrenceBudgetExact: true;
  readonly occurrenceBudgetExceeded: true;
  readonly invalidLimitsRejected: true;
  readonly invalidRelationRejected: true;
  readonly wrongQueryTargetRejected: true;
  readonly failureClassifications: Readonly<Record<string, string>>;
}

type RelationalSimulationError =
  | RunMutationError
  | RunQueryError
  | InspectionError;

const setup = Effect.fn("RelationalSimulation.setup")(function* (
  client: SimulationSetupClient,
): Effect.fn.Return<RelationalSimulationSetup, RelationalSimulationError> {
  const outcome = yield* client.mutation(
    SEED,
    {},
    requestKey("seed"),
  );
  if (outcome.status !== "committed" || outcome.disposition !== "published") {
    return yield* Effect.die(new Error(
      "Relational simulation did not commit its same-transaction graph.",
    ));
  }
  return outcome.value;
});

const workload = Effect.fn("RelationalSimulation.workload")(function* (
  client: SimulationClient,
  state: RelationalSimulationSetup,
): Effect.fn.Return<RelationalSimulationProof, RelationalSimulationError> {
  const initial = yield* client.query(DASHBOARD, {
    owner: state.owner,
    reviewer: state.reviewer,
    watcher: state.watcherA,
    project: state.project,
  });
  requirePage(initial.owned, [[state.project, null]], true, "required one");
  requirePage(initial.reviewed, [[state.project, null]], true, "optional one");
  requirePage(initial.watched, [[state.project, 1]], true, "ordered many");
  requirePage(initial.tasks, [[state.task, null]], true, "task project");
  requirePage(
    initial.memberships,
    [[state.membership, null]],
    true,
    "association project",
  );
  requirePage(
    yield* client.query(LABEL_TASKS, { label: state.labelA }),
    [[state.task, 1]],
    true,
    "unordered many",
  );
  requirePage(
    yield* client.query(ASSIGNED_TASKS, { user: state.reviewer }),
    [[state.task, null]],
    true,
    "optional task assignee",
  );
  requirePage(
    yield* client.query(USER_MEMBERSHIPS, { user: state.watcherA }),
    [[state.membership, null]],
    true,
    "association user",
  );

  const duplicate = yield* Effect.result(client.mutation(
    CREATE_PROJECT,
    projectInput(state.owner, [state.watcherA, state.watcherA]),
    requestKey("duplicate"),
  ));
  const unorderedDuplicate = yield* Effect.result(client.mutation(
    CREATE_TASK,
    {
      title: "duplicate unordered relation",
      project: state.project,
      labels: [state.labelA, state.labelA],
    },
    requestKey("unordered-duplicate"),
  ));
  const dangling = yield* Effect.result(client.mutation(
    CREATE_PROJECT,
    projectInput(danglingUserId(state.owner), []),
    requestKey("dangling"),
  ));
  const wrongTable = yield* Effect.result(client.mutation(
    CREATE_PROJECT,
    projectInput(state.labelA, []),
    requestKey("wrong-table"),
  ));
  const overMaximum = yield* Effect.result(client.mutation(
    CREATE_PROJECT,
    projectInput(state.owner, [
      state.owner,
      state.reviewer,
      state.watcherA,
      state.watcherB,
      danglingUserId(state.owner),
    ]),
    requestKey("over-maximum"),
  ));
  const underMinimum = yield* Effect.result(client.mutation(
    CREATE_TASK,
    { title: "missing label", project: state.project, labels: [] },
    requestKey("under-minimum"),
  ));
  const missingRequired = yield* Effect.result(client.mutation(
    CREATE_TASK,
    { title: "missing project", labels: [state.labelA] },
    requestKey("missing-required"),
  ));
  const nullOptional = yield* Effect.result(client.mutation(
    CREATE_PROJECT,
    {
      title: "null optional relation",
      owner: state.owner,
      reviewer: null,
      watchers: [],
    },
    requestKey("null-optional"),
  ));
  const exactMinimum = yield* client.mutation(
    CREATE_TASK,
    {
      title: "exact relation minimum",
      project: state.project,
      labels: [state.labelA],
    },
    requestKey("exact-minimum"),
  );
  if (exactMinimum.disposition !== "published") {
    return yield* Effect.die(new Error(
      "Relational simulation rejected the exact many minimum.",
    ));
  }
  yield* client.mutation(
    REMOVE,
    { id: exactMinimum.value },
    requestKey("remove-exact-minimum"),
  );
  const exactMaximum = yield* client.mutation(
    CREATE_PROJECT,
    projectInput(state.owner, [
      state.owner,
      state.reviewer,
      state.watcherA,
      state.watcherB,
    ]),
    requestKey("exact-maximum"),
  );
  if (exactMaximum.disposition !== "published") {
    return yield* Effect.die(new Error(
      "Relational simulation rejected the exact many maximum.",
    ));
  }
  yield* client.mutation(
    REMOVE,
    { id: exactMaximum.value },
    requestKey("remove-exact-maximum"),
  );

  const restrictedDelete = yield* Effect.result(client.mutation(
    REMOVE,
    { id: state.watcherA },
    requestKey("restricted-delete"),
  ));
  requireFailure(restrictedDelete, "target delete restriction");
  const restrictedManyTargetDelete = yield* Effect.result(client.mutation(
    REMOVE,
    { id: state.labelA },
    requestKey("restricted-many-target-delete"),
  ));

  yield* client.mutation(PATCH_PROJECT, {
    id: state.project,
    patch: {
      owner: state.watcherA,
      reviewer: state.owner,
      watchers: [state.watcherA, state.watcherB],
    },
  }, requestKey("retarget-and-reorder"));
  const noOpUpdate = yield* client.mutation(PATCH_PROJECT, {
    id: state.project,
    patch: {
      owner: state.watcherA,
      reviewer: state.owner,
      watchers: [state.watcherA, state.watcherB],
    },
  }, requestKey("relation-no-op"));
  if (noOpUpdate.disposition !== "published") {
    return yield* Effect.die(new Error(
      "Relational simulation rejected a valid relation no-op update.",
    ));
  }
  const retargeted = yield* client.query(DASHBOARD, {
    owner: state.watcherA,
    reviewer: state.owner,
    watcher: state.watcherB,
    project: state.project,
  });
  requirePage(retargeted.owned, [[state.project, null]], true, "retargeted one");
  requirePage(retargeted.reviewed, [[state.project, null]], true, "set optional");
  requirePage(retargeted.watched, [[state.project, 1]], true, "reordered many");

  yield* client.mutation(REMOVE, { id: state.task }, requestKey("remove-task"));
  requirePage(
    yield* client.query(LABEL_TASKS, { label: state.labelA }),
    [],
    true,
    "source deletion cleanup",
  );
  yield* client.mutation(
    REMOVE,
    { id: state.membership },
    requestKey("remove-membership"),
  );
  requirePage(
    yield* client.query(USER_MEMBERSHIPS, { user: state.watcherA }),
    [],
    true,
    "association source deletion cleanup",
  );
  yield* client.mutation(CLEAR_PROJECT, { id: state.project }, requestKey("clear"));
  requirePage(
    yield* client.query(PROBE, {
      table: "projects",
      field: "reviewer",
      target: state.owner,
      limit: 16,
    }),
    [],
    true,
    "optional relation clearing",
  );
  yield* client.mutation(
    REMOVE,
    { id: state.reviewer },
    requestKey("delete-detached-target"),
  );

  const firstFanout = yield* client.mutation(CREATE_PROJECTS, {
    owner: state.watcherA,
    count: 64,
    prefix: "fanout-a",
  }, requestKey("fanout-a"));
  const secondFanout = yield* client.mutation(CREATE_PROJECTS, {
    owner: state.watcherA,
    count: 65,
    prefix: "fanout-b",
  }, requestKey("fanout-b"));
  if (
    firstFanout.value.length !== 64 ||
    secondFanout.value.length !== 65 ||
    firstFanout.value[0] === undefined ||
    firstFanout.value[1] === undefined
  ) {
    return yield* Effect.die(new Error("Relational fanout setup was incomplete."));
  }
  const overLimit = yield* client.query(PROBE, {
    table: "projects",
    field: "owner",
    target: state.watcherA,
    limit: 128,
  });
  if (overLimit.sources.length !== 128 || overLimit.exhausted) {
    return yield* Effect.die(new Error(
      "Relational incoming lookahead did not expose an over-limit set.",
    ));
  }
  yield* client.mutation(
    REMOVE,
    { id: firstFanout.value[0] },
    requestKey("trim-fanout-a"),
  );
  yield* client.mutation(
    REMOVE,
    { id: firstFanout.value[1] },
    requestKey("trim-fanout-b"),
  );
  const exactLimit = yield* client.query(PROBE, {
    table: "projects",
    field: "owner",
    target: state.watcherA,
    limit: 128,
  });
  if (exactLimit.sources.length !== 128 || !exactLimit.exhausted) {
    return yield* Effect.die(new Error(
      "Relational incoming read did not settle at the exact page boundary.",
    ));
  }

  const syscallExact = yield* client.query(SYSCALL_BUDGET, {
    target: state.owner,
    calls: 128,
    limit: 1,
  });
  requirePage(syscallExact, [], true, "exact relation syscall budget");
  const syscallExceeded = yield* Effect.result(client.query(SYSCALL_BUDGET, {
    target: state.owner,
    calls: 129,
    limit: 1,
  }));
  const exactOccurrenceLimits = [...Array<number>(31).fill(128), 96];
  const occurrenceExact = yield* client.query(OCCURRENCE_BUDGET, {
    target: state.owner,
    limits: exactOccurrenceLimits,
  });
  requirePage(
    occurrenceExact,
    [],
    true,
    "exact relation occurrence budget",
  );
  const occurrenceExceeded = yield* Effect.result(client.query(
    OCCURRENCE_BUDGET,
    { target: state.owner, limits: [...exactOccurrenceLimits, 1] },
  ));
  const invalidZero = yield* Effect.result(client.query(PROBE, {
    table: "projects",
    field: "owner",
    target: state.owner,
    limit: 0,
  }));
  const invalidNegative = yield* Effect.result(client.query(PROBE, {
    table: "projects",
    field: "owner",
    target: state.owner,
    limit: -1,
  }));
  const invalidFractional = yield* Effect.result(client.query(PROBE, {
    table: "projects",
    field: "owner",
    target: state.owner,
    limit: 1.5,
  }));
  const invalidHigh = yield* Effect.result(client.query(PROBE, {
    table: "projects",
    field: "owner",
    target: state.owner,
    limit: 129,
  }));
  const invalidRelation = yield* Effect.result(client.query(PROBE, {
    table: "projects",
    field: "missing",
    target: state.owner,
    limit: 1,
  }));
  const wrongQueryTarget = yield* Effect.result(client.query(PROBE, {
    table: "projects",
    field: "owner",
    target: state.labelA,
    limit: 1,
  }));

  const duplicateTag = requireFailure(duplicate, "duplicate target");
  const unorderedDuplicateTag = requireFailure(
    unorderedDuplicate,
    "unordered duplicate target",
  );
  const danglingTag = requireFailure(dangling, "dangling target");
  const wrongTableTag = requireFailure(wrongTable, "wrong target table");
  const maximumTag = requireFailure(overMaximum, "many maximum");
  const minimumTag = requireFailure(underMinimum, "many minimum");
  const requiredMissingTag = requireFailure(
    missingRequired,
    "required relation omission",
  );
  const nullOptionalTag = requireFailure(
    nullOptional,
    "null optional relation",
  );
  const restrictedDeleteTag = requireFailure(
    restrictedDelete,
    "target delete restriction",
  );
  const restrictedManyTargetDeleteTag = requireFailure(
    restrictedManyTargetDelete,
    "many target delete restriction",
  );
  const syscallBudgetTag = requireFailure(
    syscallExceeded,
    "relation syscall budget",
  );
  const occurrenceBudgetTag = requireFailure(
    occurrenceExceeded,
    "relation occurrence budget",
  );
  requireFailure(invalidZero, "zero limit");
  requireFailure(invalidNegative, "negative limit");
  requireFailure(invalidFractional, "fractional limit");
  const invalidLimitTag = requireFailure(invalidHigh, "over-limit input");
  const invalidRelationTag = requireFailure(
    invalidRelation,
    "unknown relation",
  );
  const wrongQueryTargetTag = requireFailure(
    wrongQueryTarget,
    "wrong query target table",
  );

  return Object.freeze({
    sameCommitGraph: true,
    requiredOne: true,
    optionalOne: true,
    orderedMany: true,
    unorderedMany: true,
    associationTable: true,
    duplicateRejected: true,
    unorderedDuplicateRejected: true,
    danglingRejected: true,
    wrongTableRejected: true,
    maximumRejected: true,
    minimumRejected: true,
    minimumAccepted: true,
    requiredMissingRejected: true,
    nullOptionalRejected: true,
    maximumAccepted: true,
    targetDeleteRestricted: true,
    manyTargetDeleteRestricted: true,
    detachedTargetDeleted: true,
    sourceDeleteCleaned: true,
    noOpRelationUpdate: true,
    noOpCommitSeq: noOpUpdate.commitSeq,
    optionalCleared: true,
    overLimitExhausted: true,
    exactLimitExhausted: true,
    syscallBudgetExact: true,
    syscallBudgetExceeded: true,
    occurrenceBudgetExact: true,
    occurrenceBudgetExceeded: true,
    invalidLimitsRejected: true,
    invalidRelationRejected: true,
    wrongQueryTargetRejected: true,
    failureClassifications: Object.freeze({
      duplicate: duplicateTag,
      unorderedDuplicate: unorderedDuplicateTag,
      dangling: danglingTag,
      wrongTable: wrongTableTag,
      maximum: maximumTag,
      minimum: minimumTag,
      requiredMissing: requiredMissingTag,
      nullOptional: nullOptionalTag,
      restrictedDelete: restrictedDeleteTag,
      restrictedManyTargetDelete: restrictedManyTargetDeleteTag,
      syscallBudget: syscallBudgetTag,
      occurrenceBudget: occurrenceBudgetTag,
      invalidLimit: invalidLimitTag,
      invalidRelation: invalidRelationTag,
      wrongQueryTarget: wrongQueryTargetTag,
    }),
  });
});

function defineRelationalApplication() {
  const schema = defineSchema({
    users: defineTable({ name: v.string() }),
    labels: defineTable({ name: v.string() }),
    projects: defineTable({
      title: v.string(),
      owner: v.id("users"),
      reviewer: v.optional(v.id("users")),
      watchers: v.array(v.id("users")),
    }),
    tasks: defineTable({
      title: v.string(),
      project: v.id("projects"),
      assignee: v.optional(v.id("users")),
      labels: v.array(v.id("labels")),
    }),
    memberships: defineTable({
      user: v.id("users"),
      project: v.id("projects"),
      role: v.string(),
    }),
  });
  const relation = (
    input: RelationDefinitionInput<typeof schema>,
  ) => defineRelation(schema, input);
  return defineApplication({
    schema,
    modules: [commandModule, queryModule],
    relations: [
      relation({
        source: { table: "projects", field: "owner" },
        target: { table: "users" },
        value: { cardinality: "one", required: true },
        inverse: { name: "ownedProjects" },
        onTargetDelete: "restrict",
      }),
      relation({
        source: { table: "projects", field: "reviewer" },
        target: { table: "users" },
        value: { cardinality: "one", required: false },
        inverse: { name: "reviewedProjects" },
        onTargetDelete: "restrict",
      }),
      relation({
        source: { table: "projects", field: "watchers" },
        target: { table: "users" },
        value: {
          cardinality: "many",
          minItems: 0,
          maxItems: 4,
          ordered: true,
        },
        inverse: { name: "watchedProjects" },
        onTargetDelete: "restrict",
      }),
      relation({
        source: { table: "tasks", field: "project" },
        target: { table: "projects" },
        value: { cardinality: "one", required: true },
        inverse: { name: "tasks" },
        onTargetDelete: "restrict",
      }),
      relation({
        source: { table: "tasks", field: "assignee" },
        target: { table: "users" },
        value: { cardinality: "one", required: false },
        inverse: { name: "assignedTasks" },
        onTargetDelete: "restrict",
      }),
      relation({
        source: { table: "tasks", field: "labels" },
        target: { table: "labels" },
        value: {
          cardinality: "many",
          minItems: 1,
          maxItems: 4,
          ordered: false,
        },
        inverse: { name: "tasks" },
        onTargetDelete: "restrict",
      }),
      relation({
        source: { table: "memberships", field: "user" },
        target: { table: "users" },
        value: { cardinality: "one", required: true },
        inverse: { name: "memberships" },
        onTargetDelete: "restrict",
      }),
      relation({
        source: { table: "memberships", field: "project" },
        target: { table: "projects" },
        value: { cardinality: "one", required: true },
        inverse: { name: "memberships" },
        onTargetDelete: "restrict",
      }),
    ],
  });
}

function projectInput(owner: string, watchers: ReadonlyArray<string>) {
  return Object.freeze({ title: "probe", owner, watchers });
}

function danglingUserId(existing: string): string {
  return `${existing.slice(0, existing.indexOf(":") + 1)}` +
    "ffffffff-ffff-4fff-8fff-ffffffffffff";
}

function requestKey(suffix: string) {
  return TransactionRequestKeyV1Schema.make(`relations:simulation:${suffix}`);
}

function requirePage(
  page: Readonly<{
    readonly sources: ReadonlyArray<Readonly<{
      readonly sourceDocumentId: string;
      readonly position: number | null;
    }>>;
    readonly exhausted: boolean;
  }>,
  expected: ReadonlyArray<readonly [string, number | null]>,
  exhausted: boolean,
  scenario: string,
): void {
  if (
    page.exhausted !== exhausted ||
    page.sources.length !== expected.length ||
    !expected.every(([sourceDocumentId, position], index) =>
      page.sources[index]?.sourceDocumentId === sourceDocumentId &&
      page.sources[index]?.position === position
    )
  ) {
    throw new Error(
      `Relational simulation failed ${scenario}: ${JSON.stringify(page)}.`,
    );
  }
}

function requireFailure(
  result: Result.Result<unknown, unknown>,
  scenario: string,
): string {
  if (Result.isSuccess(result)) {
    throw new Error(`Relational simulation accepted ${scenario}.`);
  }
  const facets: string[] = [];
  let current: unknown = result.failure;
  for (let depth = 0; depth < 8 && isNonArrayRecord(current); depth += 1) {
    const tag = Reflect.get(current, "_tag");
    const name = Reflect.get(current, "name");
    const reason = Reflect.get(current, "reason");
    if (typeof tag === "string") {
      facets.push(
        typeof reason === "string" ? `${tag}:${reason}` : tag,
      );
    } else if (typeof name === "string") {
      facets.push(name);
    }
    const cause = Reflect.get(current, "cause");
    if (cause === current) break;
    current = cause;
  }
  return facets.length === 0 ? "unclassified-object" : facets.join(">");
}

export const relationalSimulation = defineSimulation({
  simulationId: "relational-admitted-profile-matrix",
  application: {
    applicationId: "relational-system-test",
    revisionName: "relational-system-test",
    define: defineRelationalApplication,
  },
  setup,
  workload,
});

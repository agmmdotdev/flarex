import { Cause, Effect, Exit, Fiber } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  defineApplication,
  defineModule,
  defineSchema,
  defineTable,
  mutation,
  query,
  sourceModule,
  v,
} from "@flarex/application-definition";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from
  "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import {
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  createMigratedSplitPGlitePersistence as createMigratedPGlitePersistence,
} from "../support/databaseFixturesV1";
import {
  type SimulationClient,
  type SimulationSetupClient,
  runSimulation,
  SimulationIntegrationError,
} from "@flarex/system-test/environment";
import {
  InspectionError,
} from "@flarex/system-test/inspection";
import {
  makePGliteDatabaseLane,
} from "@flarex/system-test/lanes";
import {
  defineSimulation,
  type Simulation,
  type SimulationApplication,
  type SimulationRuntimeExpectations,
} from "@flarex/system-test/simulation";
import { makeCreateAndReadFunctionSourcesV1 } from
  "../simulation/support/createAndReadFunctionSourcesV1";
import { cookingSimulationV1 } from
  "../simulation/cooking/cookingSimulationV1";

function makeCookingDefinitionV1(
  mutationSourceBytes?: Uint8Array,
) {
  const fields = {
    title: v.string(),
    servings: v.number(),
  } as const;
  const sources = makeCreateAndReadFunctionSourcesV1("recipes");
  const document = v.object({
    _id: v.id("recipes"),
    _creationTime: v.number(),
    ...fields,
  });
  return defineApplication({
    schema: defineSchema({ recipes: defineTable(fields) }),
    modules: [defineModule({
      path: "recipeCommands",
      source: sourceModule({
        path: "recipeMutation",
        bytes: mutationSourceBytes ?? sources.mutationSourceBytes,
      }),
      functions: {
        create: mutation({
          args: v.object(fields),
          returns: v.id("recipes"),
        }),
      },
    }), defineModule({
      path: "recipes",
      source: sourceModule({
        path: "recipeQuery",
        bytes: sources.querySourceBytes,
      }),
      functions: {
        get: query({
          args: v.object({ id: v.string() }),
          returns: v.nullable(document),
        }),
      },
    })],
  });
}

function makeDiagnosticCookingDefinitionV1() {
  const source = new TextEncoder().encode(
    'throw new Error("injected import-time effect");' +
      'export function create(ctx,a){return ctx.db.insert("recipes",a)}',
  );
  return makeCookingDefinitionV1(source);
}

function testApplication(
  name: string,
): SimulationApplication {
  return {
    applicationId: name,
    revisionName: `system-test-${name}`,
    define: makeCookingDefinitionV1,
  };
}

function defineTestSimulationV1<
  Setup,
  Proof,
  SetupError,
  WorkloadError,
>(
  simulationId: string,
  setup: (
    client: SimulationSetupClient,
  ) => Effect.Effect<Setup, SetupError>,
  workload: (
    client: SimulationClient,
    setup: Setup,
  ) => Effect.Effect<Proof, WorkloadError>,
  expectedRuntimeExecutions?:
    SimulationRuntimeExpectations,
): Simulation<
  Setup,
  Proof,
  SetupError | WorkloadError
> {
  return defineSimulation<
    Setup,
    Proof,
    SetupError | WorkloadError
  >({
    version: 1,
    simulationId,
    application: testApplication(simulationId),
    setup,
    workload,
    ...(expectedRuntimeExecutions === undefined
      ? {}
      : { expectedRuntimeExecutions }),
  });
}

describe("Standard Application system-test environment - PGlite", () => {
  it("keeps rejected analysis outside publication, readiness, and activation", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const failure = await Effect.runPromise(Effect.flip(
      runSimulation({
        lane: makePGliteDatabaseLane(persistence),
        simulation: defineSimulation({
          version: 1,
          simulationId: "diagnostic-registration-refusal",
          application: {
            applicationId: "diagnostic-registration-refusal",
            revisionName: "diagnostic-registration-refusal-v1",
            define: makeDiagnosticCookingDefinitionV1,
          },
          setup: () => Effect.void,
          workload: () => Effect.void,
        }),
      }),
    ));

    expect(failure).toBeInstanceOf(
      SimulationIntegrationError,
    );
    expect(failure).toMatchObject({ phase: "prepareRevision" });
    expect(containsErrorFacet(
      failure,
      "failureCode",
      "module_import_failed",
    )).toBe(
      true,
    );
    const rows = await persistence.target.query<Record<string, unknown>>(`
      select
        (select count(*)::text from fx_system_application_publication_v1) as publication_count,
        (select count(*)::text from fx_system_application_readiness_v1) as readiness_count,
        (select count(*)::text from fx_system_application_activation) as activation_count,
        (select count(*)::text from fx_system_application_active_head) as active_head_count
    `);
    expect(rows.rows).toEqual([{
      publication_count: "0",
      readiness_count: "0",
      activation_count: "0",
      active_head_count: "0",
    }]);
  }, 480_000);

  it("refreshes inspection after workload commits and audits scope predicates", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let scopeAuditCount = 0;
    const firstReceipt = await Effect.runPromise(
      runSimulation({
        lane: makePGliteDatabaseLane({
          control: persistence.control,
          target: makeInspectionScopeAuditPersistence(
            persistence.target,
            () => { scopeAuditCount += 1; },
          ),
        }),
        simulation: defineTestSimulationV1(
          "inspection-evolution-a",
          client => publishRecipeForInspectionV1(
            client,
            "Setup soup",
            "system-test:inspection-evolution-a:setup",
          ),
          (client, setupDocumentId) => Effect.gen(function*() {
            const workloadDocumentId = yield* publishRecipeForInspectionV1(
              client,
              "Workload soup",
              "system-test:inspection-evolution-a:workload",
            );
            const inspection = yield* client.inspectAuthoritativeState();
            return { setupDocumentId, workloadDocumentId, inspection };
          }),
        ),
      }),
    );

    expect(firstReceipt.afterSetupInspection).toMatchObject({
      currentRowCount: 1,
      revisionRowCount: 1,
      commitSeqs: ["1"],
      mutationRuntimeExecutions: 1,
    });
    expect(firstReceipt.workloadProof.inspection).toMatchObject({
      currentRowCount: 2,
      liveRowCount: 2,
      revisionRowCount: 2,
      commitSeqs: ["1", "2"],
      idempotencyOutcomeCommitSeqs: ["1", "2"],
      commitFeedCommitSeqs: ["1", "2"],
      outboxCommitSeqs: ["1", "2"],
      mutationRuntimeExecutions: 2,
    });
    expect(firstReceipt.workloadProof.inspection.currentRows
      .map(row => row.documentId)
      .sort()).toEqual([
      firstReceipt.workloadProof.setupDocumentId,
      firstReceipt.workloadProof.workloadDocumentId,
    ].sort());
    expect(firstReceipt.finalInspection).toEqual(
      firstReceipt.workloadProof.inspection,
    );
    expect(scopeAuditCount).toBe(3);
  }, 480_000);

  it("rejects a valid runtime-execution expectation that the workload violates", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const program = runSimulation({
      lane: makePGliteDatabaseLane(persistence),
      simulation: defineTestSimulationV1(
        "runtime-expectation-mismatch",
        client => publishRecipeForInspectionV1(
          client,
          "Counted soup",
          "system-test:runtime-expectation-mismatch:setup",
        ),
        () => Effect.void,
        { mutations: 0, queries: 0 },
      ),
    });

    await expect(Effect.runPromise(program)).rejects.toThrow(
      "Simulation runtime-expectation-mismatch expected 0 mutation and 0 query and 0 Action runtime executions, but observed 1, 0, and 0.",
    );
  }, 480_000);

  it("routes malformed query calls through the unsafe test operation", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const failure = await Effect.runPromise(Effect.flip(
      runSimulation({
        lane: makePGliteDatabaseLane(persistence),
        simulation: defineTestSimulationV1(
          "unsafe-query-arguments",
          client => publishRecipeForInspectionV1(
            client,
            "Typed soup",
            "system-test:unsafe-query-arguments:setup",
          ),
          (client, documentId) => client.unsafeInvokeQuery(
            TransactionFunctionPathV1Schema.make("recipes:get"),
            { id: documentId, unexpected: true },
          ),
        ),
      }),
    ));

    expect(failure).toMatchObject({
      _tag: "ApplicationExecutionHostError",
      operation: "transaction",
      reason: "invalidRequest",
    });
  }, 480_000);

  it("routes malformed mutations through unsafe test operation without a durable effect", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const failure = await Effect.runPromise(Effect.flip(
      runSimulation({
        lane: makePGliteDatabaseLane(persistence),
        simulation: defineTestSimulationV1(
          "unsafe-mutation-arguments",
          () => Effect.void,
          client => client.unsafeInvokeMutation(
            TransactionFunctionPathV1Schema.make("recipeCommands:create"),
            { title: "Never committed soup" },
            TransactionRequestKeyV1Schema.make(
              "system-test:unsafe-mutation-arguments:create",
            ),
          ),
        ),
      }),
    ));

    expect(containsErrorFacet(failure, "reason", "missingRequiredField"))
      .toBe(true);
    const durableCounts = await persistence.target.query<Record<string, unknown>>(`
      select
        (select count(*)::text from fx_app_row_current) as current_count,
        (select count(*)::text from fx_app_row_rev) as revision_count,
        (select count(*)::text from fx_system_commit) as commit_count,
        (select count(*)::text from fx_system_idempotency) as outcome_count,
        (select count(*)::text from fx_system_commit_app_row_change) as feed_count,
        (select count(*)::text from fx_system_outbox) as outbox_count
    `);
    expect(durableCounts.rows).toEqual([{
      current_count: "0",
      revision_count: "0",
      commit_count: "0",
      outcome_count: "0",
      feed_count: "0",
      outbox_count: "0",
    }]);
  }, 480_000);

  it("revokes the workload client when its owning run completes", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedSetupClient:
      SimulationSetupClient | undefined;
    let escapedClient: SimulationClient | undefined;
    const receipt = await Effect.runPromise(
      runSimulation({
        lane: makePGliteDatabaseLane(persistence),
        simulation: defineTestSimulationV1(
          "client-lifecycle",
          client => Effect.sync(() => {
            escapedSetupClient = client;
          }),
          client => Effect.gen(function*() {
            escapedClient = client;
            if (escapedSetupClient === undefined) {
              return yield* Effect.die(new Error(
                "The setup phase did not receive its test client.",
              ));
            }
            const setupInvocation = yield* Effect.exit(
              escapedSetupClient.unsafeInvokeMutation(
                TransactionFunctionPathV1Schema.make("recipeCommands:create"),
                { title: "Late setup soup", servings: 1 },
                TransactionRequestKeyV1Schema.make("system-test:late-setup:create"),
              ),
            );
            if (Exit.isSuccess(setupInvocation)) {
              return yield* Effect.die(new Error(
                "The setup client remained active during the workload phase.",
              ));
            }
            if (!Cause.hasDies(setupInvocation.cause)) {
              return yield* Effect.die(new Error(
                "The revoked setup client did not fail as a lifecycle defect.",
              ));
            }
            return true as const;
          }),
        ),
      }),
    );
    expect(receipt).toMatchObject({
      workloadProof: true,
      mutationRuntimeExecutions: 0,
      queryRuntimeExecutions: 0,
    });
    if (escapedClient === undefined) {
      throw new Error("The workload did not receive its test client.");
    }
    await expect(Effect.runPromise(escapedClient.unsafeInvokeQuery(
      TransactionFunctionPathV1Schema.make("recipes:get"),
      { id: "unreachable" },
    ))).rejects.toThrow(
      "The Standard Application system-test workload client is no longer active.",
    );
  }, 480_000);

  it("revokes the setup client after synchronous setup construction failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedSetupClient:
      SimulationSetupClient | undefined;
    const program = runSimulation({
      lane: makePGliteDatabaseLane(persistence),
      simulation: defineTestSimulationV1(
        "setup-construction-failure",
        (client): Effect.Effect<never> => {
          escapedSetupClient = client;
          throw new Error("injected synchronous setup construction failure");
        },
        () => Effect.void,
      ),
    });

    await expect(Effect.runPromise(program)).rejects.toThrow(
      "injected synchronous setup construction failure",
    );
    if (escapedSetupClient === undefined) {
      throw new Error("The failing setup did not receive its test client.");
    }
    await expect(Effect.runPromise(escapedSetupClient.unsafeInvokeMutation(
      TransactionFunctionPathV1Schema.make("recipeCommands:create"),
      { title: "Unreachable soup", servings: 1 },
      TransactionRequestKeyV1Schema.make("system-test:unreachable-setup:create"),
    ))).rejects.toThrow(
      "The Standard Application system-test setup client is no longer active.",
    );
  }, 480_000);

  it("revokes the workload client after synchronous workload construction failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedClient: SimulationClient | undefined;
    const program = runSimulation({
      lane: makePGliteDatabaseLane(persistence),
      simulation: defineTestSimulationV1(
        "client-construction-failure",
        () => Effect.void,
        (client): Effect.Effect<never> => {
          escapedClient = client;
          throw new Error("injected synchronous workload construction failure");
        },
      ),
    });

    await expect(Effect.runPromise(program)).rejects.toThrow(
      "injected synchronous workload construction failure",
    );
    if (escapedClient === undefined) {
      throw new Error("The failing workload did not receive its test client.");
    }
    await expect(Effect.runPromise(escapedClient.unsafeInvokeQuery(
      TransactionFunctionPathV1Schema.make("recipes:get"),
      { id: "unreachable" },
    ))).rejects.toThrow(
      "The Standard Application system-test workload client is no longer active.",
    );
  }, 480_000);

  it("interrupts an in-flight detached invocation before returning its receipt", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let detachedInvocationFailed: (() => Promise<boolean>) | undefined;
    const receipt = await Effect.runPromise(
      runSimulation({
        lane: makePGliteDatabaseLane(persistence),
        simulation: defineTestSimulationV1(
          "managed-invocation-lifecycle",
          () => Effect.void,
          client => Effect.gen(function*() {
            const fiber = yield* client.unsafeInvokeMutation(
              TransactionFunctionPathV1Schema.make("recipeCommands:create"),
              { title: "Detached soup", servings: 2 },
              TransactionRequestKeyV1Schema.make("system-test:detached:create"),
            ).pipe(Effect.forkDetach({ startImmediately: true }));
            detachedInvocationFailed = async () => Exit.isFailure(
              await Effect.runPromise(Fiber.await(fiber)),
            );
            return true as const;
          }),
        ),
      }),
    );

    expect(receipt.workloadProof).toBe(true);
    if (detachedInvocationFailed === undefined) {
      throw new Error("The workload did not start its detached invocation.");
    }
    expect(await detachedInvocationFailed()).toBe(true);
  }, 480_000);

  it("cancels an interrupted mutation while its workload remains active", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const receipt = await Effect.runPromise(
      runSimulation({
        lane: makePGliteDatabaseLane(persistence),
        simulation: defineTestSimulationV1(
          "per-call-cancellation",
          () => Effect.void,
          client => Effect.gen(function*() {
            const fiber = yield* client.unsafeInvokeMutation(
              TransactionFunctionPathV1Schema.make("recipeCommands:create"),
              { title: "Cancelled soup", servings: 3 },
              TransactionRequestKeyV1Schema.make("system-test:cancelled:create"),
            ).pipe(Effect.forkChild({ startImmediately: true }));
            yield* Fiber.interrupt(fiber);
            yield* Effect.sleep("250 millis");
            return true as const;
          }),
        ),
      }),
    );
    expect(receipt.workloadProof).toBe(true);
    expect(receipt.finalInspection).toMatchObject({
      currentRowCount: 0,
      revisionRowCount: 0,
      commitSeqs: [],
      idempotencyOutcomeCommitSeqs: [],
      commitFeedCommitSeqs: [],
      outboxCommitSeqs: [],
    });
  }, 480_000);

  it("keeps preparation failures in the typed Test API error channel", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const expectedCause = new Error("injected registration clock failure");
    const lane = makePGliteDatabaseLane(persistence);
    const failure = await Effect.runPromise(Effect.flip(
      runSimulation({
        lane: Object.freeze({
          ...lane,
          createFixture: () => Promise.reject(expectedCause),
        }),
        simulation: cookingSimulationV1,
      }),
    ));

    expect(failure).toBeInstanceOf(
      SimulationIntegrationError,
    );
    expect(failure).toMatchObject({
      _tag: "StandardApplicationSimulationIntegrationV1Error",
      phase: "prepareRevision",
    });
    if (!(failure instanceof SimulationIntegrationError)) {
      throw new Error("The Test API returned an unexpected failure type.");
    }
    expect(failure.cause).toBeInstanceOf(Error);
    expect(failure.cause).toBe(expectedCause);
  }, 480_000);

  it("keeps inspection query failures in a distinct typed error channel", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const expectedCause = new Error("injected inspection query failure");
    const lane = makePGliteDatabaseLane(persistence);
    const failure = await Effect.runPromise(Effect.flip(
      runSimulation({
        lane: Object.freeze({
          ...lane,
          target: makeInspectionFaultPersistence(
            persistence.target,
            { kind: "reject", cause: expectedCause },
          ),
        }),
        simulation: cookingSimulationV1,
      }),
    ));

    expect(failure).toBeInstanceOf(
      InspectionError,
    );
    expect(failure).toMatchObject({
      _tag: "StandardApplicationSystemTestInspectionV1Error",
      reason: "queryFailed",
      applicationId: "cooking",
      cause: expectedCause,
    });
  }, 480_000);

  it("rejects malformed authoritative inspection results", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const lane = makePGliteDatabaseLane(persistence);
    const failure = await Effect.runPromise(Effect.flip(
      runSimulation({
        lane: Object.freeze({
          ...lane,
          target: makeInspectionFaultPersistence(
            persistence.target,
            { kind: "emptyResult" },
          ),
        }),
        simulation: cookingSimulationV1,
      }),
    ));

    expect(failure).toBeInstanceOf(
      InspectionError,
    );
    expect(failure).toMatchObject({
      _tag: "StandardApplicationSystemTestInspectionV1Error",
      reason: "invalidResult",
      applicationId: "cooking",
    });
  }, 480_000);
});

function containsErrorFacet(
  value: unknown,
  key: string,
  expected: unknown,
  seen = new Set<object>(),
): boolean {
  if (!isNonArrayRecord(value) || seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (value[key] === expected) return true;
  return containsErrorFacet(value.cause, key, expected, seen) ||
    containsErrorFacet(value.failure, key, expected, seen) ||
    containsErrorFacet(value.error, key, expected, seen) ||
    containsErrorFacet(value.issue, key, expected, seen);
}

const publishRecipeForInspectionV1 = Effect.fn(
  "StandardApplicationSystemTest.publishRecipeForInspectionV1",
)(function* (
  client: SimulationSetupClient,
  title: string,
  requestKey: string,
): Effect.fn.Return<
  string,
  Effect.Error<ReturnType<SimulationSetupClient["unsafeInvokeMutation"]>>
> {
  const outcome = yield* client.unsafeInvokeMutation(
    TransactionFunctionPathV1Schema.make("recipeCommands:create"),
    { title, servings: 1 },
    TransactionRequestKeyV1Schema.make(requestKey),
  );
  if (
    outcome.status !== "committed" ||
    outcome.disposition !== "published" ||
    typeof outcome.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The inspection proof mutation did not publish a document id.",
    ));
  }
  return outcome.value;
});

function makeInspectionScopeAuditPersistence(
  persistence: PGliteFlarexPersistence,
  onInspection: () => void,
): PGliteFlarexPersistence {
  return new Proxy(persistence, {
    get(target, property) {
      if (property === "query") {
        return (sql: string, params?: readonly unknown[]) => {
          if (sql.includes("as current_pointer_count")) {
            expect(sql.match(/where scope_uuid = \$1/g)).toHaveLength(6);
            expect(sql.match(/where current_row\.scope_uuid = \$1/g))
              .toHaveLength(1);
            expect(sql).toContain(
              "revision.scope_uuid = current_row.scope_uuid",
            );
            expect(sql).toContain("table_metadata.deployment_id = $2");
            expect(params).toHaveLength(2);
            expect(params?.[0]).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            );
            expect(params?.[1]).toBe("deployment_application_native_mutation");
            onInspection();
          }
          return target.query(sql, params);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type InspectionFaultV1 =
  | { readonly kind: "reject"; readonly cause: Error }
  | { readonly kind: "emptyResult" };

function makeInspectionFaultPersistence(
  persistence: PGliteFlarexPersistence,
  fault: InspectionFaultV1,
): PGliteFlarexPersistence {
  return new Proxy(persistence, {
    get(target, property) {
      if (property === "query") {
        return (sql: string, params?: readonly unknown[]) => {
          if (sql.includes("as current_pointer_count")) {
            return fault.kind === "reject"
              ? Promise.reject(fault.cause)
              : Promise.resolve({ rows: [] });
          }
          return target.query(sql, params);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

import { Cause, Effect, Exit, Fiber } from "effect";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from
  "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import type {
  InvokeStandardApplicationPointMutationV1Error,
} from "@flarex/standard-application-invocation/v1";
import {
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import { createMigratedPGlitePersistence } from
  "../support/databaseFixturesV1";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import {
  type StandardApplicationSystemTestClientV1,
  type StandardApplicationSystemTestSetupClientV1,
  runStandardApplicationSimulationV1,
  StandardApplicationSimulationIntegrationV1Error,
} from "@flarex/system-test/environment/v1";
import {
  StandardApplicationSystemTestInspectionV1Error,
} from "@flarex/system-test/inspection/v1";
import {
  makePGliteStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";
import {
  defineStandardApplicationSimulationV1,
  type StandardApplicationSimulationApplicationV1,
  type StandardApplicationSimulationRuntimeExpectationsV1,
  type StandardApplicationSimulationV1,
} from "@flarex/system-test/simulation/v1";
import { makeCreateAndReadDefinitionV1 } from
  "../simulation/support/createAndReadDefinitionV1";
import { makeCreateAndReadFunctionSourcesV1 } from
  "../simulation/support/createAndReadFunctionSourcesV1";
import { cookingSimulationV1 } from
  "../simulation/cooking/cookingSimulationV1";

function makeCookingDefinitionV1() {
  return makeCreateAndReadDefinitionV1({
    tableName: "recipes",
    mutationModulePath: "recipeCommands",
    queryModulePath: "recipes",
    mutationArtifactPath: "recipeMutation",
    queryArtifactPath: "recipeQuery",
    ...makeCreateAndReadFunctionSourcesV1("recipes"),
    fields: {
      title: {
        fieldType: { type: "string" },
        optional: false,
      },
      servings: {
        fieldType: { type: "number" },
        optional: false,
      },
    },
  });
}

function testApplication(
  name: string,
): StandardApplicationSimulationApplicationV1 {
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
    client: StandardApplicationSystemTestSetupClientV1,
  ) => Effect.Effect<Setup, SetupError>,
  workload: (
    client: StandardApplicationSystemTestClientV1,
    setup: Setup,
  ) => Effect.Effect<Proof, WorkloadError>,
  expectedRuntimeExecutions?:
    StandardApplicationSimulationRuntimeExpectationsV1,
): StandardApplicationSimulationV1<
  Setup,
  Proof,
  SetupError | WorkloadError
> {
  return defineStandardApplicationSimulationV1<
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
  it("refreshes inspection after workload commits and audits scope predicates", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let scopeAuditCount = 0;
    const firstReceipt = await Effect.runPromise(
      runStandardApplicationSimulationV1({
        lane: makePGliteStandardApplicationSystemTestLaneV1(makeInspectionScopeAuditPersistence(
          persistence,
          () => { scopeAuditCount += 1; },
        )),
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
    const program = runStandardApplicationSimulationV1({
      lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
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
      "Simulation runtime-expectation-mismatch expected 0 mutation and 0 query runtime executions, but observed 1 and 0.",
    );
  }, 480_000);

  it("revokes the workload client when its owning run completes", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedSetupClient:
      StandardApplicationSystemTestSetupClientV1 | undefined;
    let escapedClient: StandardApplicationSystemTestClientV1 | undefined;
    const receipt = await Effect.runPromise(
      runStandardApplicationSimulationV1({
        lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
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
              escapedSetupClient.invokeMutation(
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
    await expect(Effect.runPromise(escapedClient.invokeQuery(
      TransactionFunctionPathV1Schema.make("recipes:get"),
      { id: "unreachable" },
    ))).rejects.toThrow(
      "The Standard Application system-test workload client is no longer active.",
    );
  }, 480_000);

  it("revokes the setup client after synchronous setup construction failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedSetupClient:
      StandardApplicationSystemTestSetupClientV1 | undefined;
    const program = runStandardApplicationSimulationV1({
      lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
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
    await expect(Effect.runPromise(escapedSetupClient.invokeMutation(
      TransactionFunctionPathV1Schema.make("recipeCommands:create"),
      { title: "Unreachable soup", servings: 1 },
      TransactionRequestKeyV1Schema.make("system-test:unreachable-setup:create"),
    ))).rejects.toThrow(
      "The Standard Application system-test setup client is no longer active.",
    );
  }, 480_000);

  it("revokes the workload client after synchronous workload construction failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedClient: StandardApplicationSystemTestClientV1 | undefined;
    const program = runStandardApplicationSimulationV1({
      lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
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
    await expect(Effect.runPromise(escapedClient.invokeQuery(
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
      runStandardApplicationSimulationV1({
        lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
        simulation: defineTestSimulationV1(
          "managed-invocation-lifecycle",
          () => Effect.void,
          client => Effect.gen(function*() {
            const fiber = yield* client.invokeMutation(
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
      runStandardApplicationSimulationV1({
        lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
        simulation: defineTestSimulationV1(
          "per-call-cancellation",
          () => Effect.void,
          client => Effect.gen(function*() {
            const fiber = yield* client.invokeMutation(
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
    const registrationTarget =
      createPGliteLocatedApplicationRevisionRegistrationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      );
    const failure = await Effect.runPromise(Effect.flip(
      runStandardApplicationSimulationV1({
        lane: makePGliteStandardApplicationSystemTestLaneV1(
          persistence,
          Object.freeze({
            ...registrationTarget,
            getCurrentClock: () => Promise.reject(expectedCause),
          }),
        ),
        simulation: cookingSimulationV1,
      }),
    ));

    expect(failure).toBeInstanceOf(
      StandardApplicationSimulationIntegrationV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "StandardApplicationSimulationIntegrationV1Error",
      phase: "prepareRevision",
    });
    if (!(failure instanceof StandardApplicationSimulationIntegrationV1Error)) {
      throw new Error("The Test API returned an unexpected failure type.");
    }
    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toBe(
      "FSV05 could not prepare revision sac01-cooking-app.",
    );
  }, 480_000);

  it("keeps inspection query failures in a distinct typed error channel", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const expectedCause = new Error("injected inspection query failure");
    const failure = await Effect.runPromise(Effect.flip(
      runStandardApplicationSimulationV1({
        lane: makePGliteStandardApplicationSystemTestLaneV1(
          makeInspectionFaultPersistence(
            persistence,
            { kind: "reject", cause: expectedCause },
          ),
        ),
        simulation: cookingSimulationV1,
      }),
    ));

    expect(failure).toBeInstanceOf(
      StandardApplicationSystemTestInspectionV1Error,
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
    const failure = await Effect.runPromise(Effect.flip(
      runStandardApplicationSimulationV1({
        lane: makePGliteStandardApplicationSystemTestLaneV1(
          makeInspectionFaultPersistence(persistence, { kind: "emptyResult" }),
        ),
        simulation: cookingSimulationV1,
      }),
    ));

    expect(failure).toBeInstanceOf(
      StandardApplicationSystemTestInspectionV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "StandardApplicationSystemTestInspectionV1Error",
      reason: "invalidResult",
      applicationId: "cooking",
    });
  }, 480_000);
});

const publishRecipeForInspectionV1 = Effect.fn(
  "StandardApplicationSystemTest.publishRecipeForInspectionV1",
)(function* (
  client: StandardApplicationSystemTestSetupClientV1,
  title: string,
  requestKey: string,
): Effect.fn.Return<string, InvokeStandardApplicationPointMutationV1Error> {
  const outcome = yield* client.invokeMutation(
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
            expect(params?.[1]).toBe("deployment_fsv03_private");
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

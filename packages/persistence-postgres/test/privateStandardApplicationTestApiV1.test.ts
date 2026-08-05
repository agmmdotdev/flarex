import { Cause, Effect, Exit, Fiber } from "effect";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from
  "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import type {
  InvokeStandardApplicationPointMutationV1Error,
} from "../../standard-application-invocation/src/v1";
import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedScopeAuthorizationEpochTarget,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "./fsv05ApplicationRevisionActivationHarness";
import type { Fsv06StandardPointMutationLaneV1 } from
  "./fsv06StandardPointMutationHarness";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import {
  PrivateStandardApplicationTestIntegrationV1Error,
  runPrivateStandardCookingApplicationV1,
} from
  "./privateStandardApplicationTestApiV1";
import { runPrivateStandardEnglishLearningApplicationV1 } from
  "./privateStandardEnglishLearningApplicationV1";
import { makePrivateStandardCookingDefinitionV1 } from
  "./privateStandardApplicationTestDefinitionsV1";
import {
  type PrivateStandardApplicationTestClientV1,
  type PrivateStandardApplicationTestDefinitionV1,
  type PrivateStandardApplicationTestSetupClientV1,
  runPrivateStandardApplicationTestV1,
} from "./privateStandardApplicationTestHarnessV1";
import {
  PrivateStandardApplicationTestInspectionV1Error,
  type PrivateStandardApplicationAuthoritativeInspectionV1,
} from "./privateStandardApplicationTestInspectionV1";

describe("private Standard Application Test API - PGlite", () => {
  it("creates and reads one cooking-app recipe through the real Standard path", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await Effect.runPromise(
      runPrivateStandardCookingApplicationV1(makePGliteLane(persistence)),
    );

    expect(proof).toMatchObject({
      version: 1,
      scenario: "cooking-recipe-create-and-read-v1",
      lane: "pglite",
      definitionAnalyzedRegisteredReadyActivated: true,
      mutationPath: "recipeCommands:create",
      queryPath: "recipes:get",
      title: "Tomato soup",
      servings: 4,
      mutationReplay: true,
      queryReplay: true,
      controlledSetup: true,
      mutationRuntimeExecutions: 1,
      queryRuntimeExecutions: 2,
      postgresVersion: null,
    });
    expect(proof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
    expectSinglePublicationInspection(
      proof.afterSetupInspection,
      "recipes",
      proof.documentId,
      0,
    );
    expectSinglePublicationInspection(
      proof.workloadInspection,
      "recipes",
      proof.documentId,
      1,
    );
    expectSinglePublicationInspection(
      proof.finalInspection,
      "recipes",
      proof.documentId,
      2,
    );
  }, 480_000);

  it("runs an independent English-learning app through the reusable harness", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await Effect.runPromise(
      runPrivateStandardEnglishLearningApplicationV1(
        makePGliteLane(persistence),
      ),
    );

    expect(proof).toMatchObject({
      version: 1,
      scenario: "english-learning-lesson-create-and-read-v1",
      lane: "pglite",
      definitionAnalyzedRegisteredReadyActivated: true,
      mutationPath: "lessonCommands:create",
      queryPath: "lessons:get",
      term: "apple",
      translation: "a fruit",
      mastery: 0,
      mutationReplay: true,
      queryReplay: true,
      controlledSetup: true,
      mutationRuntimeExecutions: 1,
      queryRuntimeExecutions: 2,
      postgresVersion: null,
    });
    expect(proof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
    expectSinglePublicationInspection(
      proof.afterSetupInspection,
      "lessons",
      proof.documentId,
      0,
    );
    expectSinglePublicationInspection(
      proof.finalInspection,
      "lessons",
      proof.documentId,
      2,
    );
  }, 480_000);

  it("refreshes inspection after workload commits and audits scope predicates", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let scopeAuditCount = 0;
    const firstReceipt = await Effect.runPromise(
      runPrivateStandardApplicationTestV1({
        lane: makePGliteLane(makeInspectionScopeAuditPersistence(
          persistence,
          () => { scopeAuditCount += 1; },
        )),
        definition: {
          applicationId: "inspection-evolution-a",
          revisionName: "sac01-inspection-evolution-a",
          makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
        } satisfies PrivateStandardApplicationTestDefinitionV1,
        prepareState: client => publishRecipeForInspectionV1(
          client,
          "Setup soup",
          "sac01:inspection-evolution-a:setup",
        ),
        runWorkload: (client, setupDocumentId) => Effect.gen(function*() {
          const workloadDocumentId = yield* publishRecipeForInspectionV1(
            client,
            "Workload soup",
            "sac01:inspection-evolution-a:workload",
          );
          const inspection = yield* client.inspectAuthoritativeState();
          return { setupDocumentId, workloadDocumentId, inspection };
        }),
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

  it("revokes the workload client when its owning run completes", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedSetupClient:
      PrivateStandardApplicationTestSetupClientV1 | undefined;
    let escapedClient: PrivateStandardApplicationTestClientV1 | undefined;
    const receipt = await Effect.runPromise(
      runPrivateStandardApplicationTestV1({
        lane: makePGliteLane(persistence),
        definition: {
          applicationId: "client-lifecycle",
          revisionName: "sac01-client-lifecycle",
          makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
        } satisfies PrivateStandardApplicationTestDefinitionV1,
        prepareState: client => Effect.sync(() => {
          escapedSetupClient = client;
        }),
        runWorkload: client => Effect.gen(function*() {
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
              TransactionRequestKeyV1Schema.make("sac01:late-setup:create"),
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
      "The private Standard Application Test workload client is no longer active.",
    );
  }, 480_000);

  it("revokes the setup client after synchronous setup construction failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedSetupClient:
      PrivateStandardApplicationTestSetupClientV1 | undefined;
    const program = runPrivateStandardApplicationTestV1({
      lane: makePGliteLane(persistence),
      definition: {
        applicationId: "setup-construction-failure",
        revisionName: "sac01-setup-construction-failure",
        makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
      } satisfies PrivateStandardApplicationTestDefinitionV1,
      prepareState: (client): Effect.Effect<never> => {
        escapedSetupClient = client;
        throw new Error("injected synchronous setup construction failure");
      },
      runWorkload: () => Effect.void,
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
      TransactionRequestKeyV1Schema.make("sac01:unreachable-setup:create"),
    ))).rejects.toThrow(
      "The private Standard Application Test setup client is no longer active.",
    );
  }, 480_000);

  it("revokes the workload client after synchronous workload construction failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedClient: PrivateStandardApplicationTestClientV1 | undefined;
    const program = runPrivateStandardApplicationTestV1({
      lane: makePGliteLane(persistence),
      definition: {
        applicationId: "client-construction-failure",
        revisionName: "sac01-client-construction-failure",
        makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
      } satisfies PrivateStandardApplicationTestDefinitionV1,
      prepareState: () => Effect.void,
      runWorkload: (client): Effect.Effect<never> => {
        escapedClient = client;
        throw new Error("injected synchronous workload construction failure");
      },
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
      "The private Standard Application Test workload client is no longer active.",
    );
  }, 480_000);

  it("interrupts an in-flight detached invocation before returning its receipt", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let detachedInvocationFailed: (() => Promise<boolean>) | undefined;
    const receipt = await Effect.runPromise(
      runPrivateStandardApplicationTestV1({
        lane: makePGliteLane(persistence),
        definition: {
          applicationId: "managed-invocation-lifecycle",
          revisionName: "sac01-managed-invocation-lifecycle",
          makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
        } satisfies PrivateStandardApplicationTestDefinitionV1,
        prepareState: () => Effect.void,
        runWorkload: client => Effect.gen(function*() {
          const fiber = yield* client.invokeMutation(
            TransactionFunctionPathV1Schema.make("recipeCommands:create"),
            { title: "Detached soup", servings: 2 },
            TransactionRequestKeyV1Schema.make("sac01:detached:create"),
          ).pipe(Effect.forkDetach({ startImmediately: true }));
          detachedInvocationFailed = async () => Exit.isFailure(
            await Effect.runPromise(Fiber.await(fiber)),
          );
          return true as const;
        }),
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
      runPrivateStandardApplicationTestV1({
        lane: makePGliteLane(persistence),
        definition: {
          applicationId: "per-call-cancellation",
          revisionName: "sac01-per-call-cancellation",
          makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
        } satisfies PrivateStandardApplicationTestDefinitionV1,
        prepareState: () => Effect.void,
        runWorkload: client => Effect.gen(function*() {
          const fiber = yield* client.invokeMutation(
            TransactionFunctionPathV1Schema.make("recipeCommands:create"),
            { title: "Cancelled soup", servings: 3 },
            TransactionRequestKeyV1Schema.make("sac01:cancelled:create"),
          ).pipe(Effect.forkChild({ startImmediately: true }));
          yield* Fiber.interrupt(fiber);
          yield* Effect.sleep("250 millis");
          return true as const;
        }),
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
      runPrivateStandardCookingApplicationV1(makePGliteLane(
        persistence,
        Object.freeze({
          ...registrationTarget,
          getCurrentClock: () => Promise.reject(expectedCause),
        }),
      )),
    ));

    expect(failure).toBeInstanceOf(
      PrivateStandardApplicationTestIntegrationV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "PrivateStandardApplicationTestIntegrationV1Error",
      phase: "prepareRevision",
    });
    if (!(failure instanceof PrivateStandardApplicationTestIntegrationV1Error)) {
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
      runPrivateStandardCookingApplicationV1(makePGliteLane(
        makeInspectionFaultPersistence(
          persistence,
          { kind: "reject", cause: expectedCause },
        ),
      )),
    ));

    expect(failure).toBeInstanceOf(
      PrivateStandardApplicationTestInspectionV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "PrivateStandardApplicationTestInspectionV1Error",
      reason: "queryFailed",
      applicationId: "cooking",
      cause: expectedCause,
    });
  }, 480_000);

  it("rejects malformed authoritative inspection results", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const failure = await Effect.runPromise(Effect.flip(
      runPrivateStandardCookingApplicationV1(makePGliteLane(
        makeInspectionFaultPersistence(persistence, { kind: "emptyResult" }),
      )),
    ));

    expect(failure).toBeInstanceOf(
      PrivateStandardApplicationTestInspectionV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "PrivateStandardApplicationTestInspectionV1Error",
      reason: "invalidResult",
      applicationId: "cooking",
    });
  }, 480_000);
});

function makePGliteLane(
  persistence: PGliteFlarexPersistence,
  registrationTarget =
    createPGliteLocatedApplicationRevisionRegistrationTargetV1(
      persistence,
      FSV05_SUPPORTED_LOCATOR,
    ),
): Fsv06StandardPointMutationLaneV1 {
  return {
    name: "pglite",
    persistence,
    registrationTarget,
    makeActivationTarget: () =>
      createPGliteLocatedApplicationRevisionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeDecisionUncertainTarget: () => {
      throw new Error(
        "The Standard Test API does not inject activation uncertainty.",
      );
    },
    makeSessionTarget: () =>
      createPGliteLocatedPointMutationSessionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeEpochTarget: () =>
      createPGliteLocatedScopeAuthorizationEpochTarget(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
  };
}

function expectSinglePublicationInspection(
  inspection: PrivateStandardApplicationAuthoritativeInspectionV1,
  tableName: string,
  documentId: string,
  queryRuntimeExecutions: number,
): void {
  expect(Object.isFrozen(inspection)).toBe(true);
  expect(Object.isFrozen(inspection.currentRows)).toBe(true);
  expect(Object.isFrozen(inspection.currentRows[0])).toBe(true);
  expect(inspection).toEqual({
    version: 1,
    currentRows: [{
      tableName,
      documentId,
      commitSeq: "1",
      valueState: "live",
    }],
    currentRowCount: 1,
    liveRowCount: 1,
    revisionRowCount: 1,
    commitSeqs: ["1"],
    idempotencyOutcomeCommitSeqs: ["1"],
    commitFeedCommitSeqs: ["1"],
    outboxCommitSeqs: ["1"],
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions,
  });
}

const publishRecipeForInspectionV1 = Effect.fn(
  "PrivateStandardApplicationTest.publishRecipeForInspectionV1",
)(function* (
  client: PrivateStandardApplicationTestSetupClientV1,
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

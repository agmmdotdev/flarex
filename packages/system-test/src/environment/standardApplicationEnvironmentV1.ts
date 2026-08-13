import { Data, Effect, Fiber, Layer, Scope } from "effect";
import type {
  TransactionFunctionPathV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import type { Json } from "flarex-protocol/json";
import { TransactionFunctionPathV1Schema } from
  "flarex-protocol/transaction-session";
import {
  validateValidatorValueV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/validator-engine";
import { isNonArrayRecord } from "@flarex/utils/records";

import type {
  AnyStandardFunctionContractV1,
  InferStandardFunctionArgsV1,
  InferStandardFunctionReturnV1,
  StandardFunctionArgsValidatorV1,
  StandardFunctionContractV1,
  StandardFunctionReferenceV1,
  StandardApplicationDefinitionInputV1,
  StandardValidatorV1,
} from "@flarex/standard-application-definition/v1";

import {
  ApplicationPointQuerySystemV1,
  invokeApplicationPointQueryV1,
  makeApplicationPointQuerySystemV1Layer,
  type InvokeApplicationPointQueryV1Error,
} from "@flarex/standard-application-invocation/internal/system-query-v1";
import {
  LegacyApplicationPointMutationSystemV1,
  invokeLegacyApplicationPointMutationV1,
  makeLegacyApplicationPointMutationSystemV1Layer,
  type AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  type InvokeApplicationPointMutationV1Error,
} from "@flarex/standard-application-invocation/internal/system-v1";
import {
  makeStandardApplicationActiveRevisionReaderV1Layer,
  StandardApplicationActiveRevisionReaderV1,
} from "@flarex/standard-application-invocation/v1";
import {
  activateApplicationRevisionV1,
  type ActivateApplicationRevisionV1Error,
  type ReadActiveApplicationRevisionV1Error,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  type Fsv06StandardPointMutationLaneV1 as PersistenceStandardApplicationSystemTestLaneV1,
  makeFsv06StandardPointMutationSystemTestCompositionV1,
} from "../../support/fsv06StandardPointMutationHarness";
import { prepareFsv05ReadyRevisionFixtureEffectV1 } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "../../support/memoryRuntimeArtifactStoreV1";
import { makeSap05StandardPointQuerySystemLiveForTestV1 } from
  "../../support/sap05StandardPointQueryHarness";
import {
  makeStandardApplicationSystemTestInspectorV1,
  type StandardApplicationAuthoritativeInspectionV1,
  type StandardApplicationSystemTestInspectionV1Error,
} from "../inspection/authoritativeStateV1";
import type {
  StandardApplicationSimulationV1,
} from "../simulation/standardApplicationSimulationV1";

type ApplicationTestRequirementsV1 =
  | LegacyApplicationPointMutationSystemV1
  | ApplicationPointQuerySystemV1
  | StandardApplicationActiveRevisionReaderV1
  | Scope.Scope;

export type InvokeLegacyStandardApplicationPointMutationV1Error =
  | ReadActiveApplicationRevisionV1Error
  | InvokeApplicationPointMutationV1Error;

const invokeLegacyStandardApplicationPointMutationV1 = Effect.fn(
  "LegacyStandardApplicationSimulation.invokePointMutationV1",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
) {
  const reader = yield* StandardApplicationActiveRevisionReaderV1;
  const active = yield* reader.read;
  return yield* invokeLegacyApplicationPointMutationV1(
    active.selection,
    functionRef,
    args,
    requestKey,
  );
});

export type StandardApplicationLegacySimulationQueryErrorV1 =
  | ReadActiveApplicationRevisionV1Error
  | InvokeApplicationPointQueryV1Error;

/**
 * This Application Revision V1 simulation remains legacy coverage until the
 * AA-R7 Application system proof replaces it. Keep its displaced query
 * authority local instead of routing through the migrated Standard consumer.
 */
const invokeLegacySimulationPointQueryV1 = Effect.fn(
  "StandardApplicationSimulation.invokeLegacyPointQueryV1",
)(function* (functionPath: TransactionFunctionPathV1, args: unknown) {
  const reader = yield* StandardApplicationActiveRevisionReaderV1;
  const active = yield* reader.read;
  return yield* invokeApplicationPointQueryV1(
    active.selection,
    functionPath,
    args,
  );
});

export interface StandardApplicationSystemTestSetupClientV1 {
  readonly mutation: <
    Path extends string,
    Contract extends StandardFunctionContractV1<
      "mutation" | "workflowMutation",
      "public" | "internal",
      StandardFunctionArgsValidatorV1,
      StandardValidatorV1<Json, "required">
    >,
  >(
    reference: StandardFunctionReferenceV1<Path, Contract>,
    args: InferStandardFunctionArgsV1<Contract>,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    StandardApplicationTypedMutationOutcomeV1<
      InferStandardFunctionReturnV1<Contract>
    >,
    | InvokeLegacyStandardApplicationPointMutationV1Error
    | StandardApplicationTypedReferenceV1Error
  >;
  readonly unsafeInvokeMutation: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationPointMutationOutcomeV1,
    InvokeLegacyStandardApplicationPointMutationV1Error
  >;
}

export interface StandardApplicationSystemTestClientV1
  extends StandardApplicationSystemTestSetupClientV1 {
  readonly query: <
    Path extends string,
    Contract extends StandardFunctionContractV1<
      "query",
      "public" | "internal",
      StandardFunctionArgsValidatorV1,
      StandardValidatorV1<unknown, "required">
    >,
  >(
    reference: StandardFunctionReferenceV1<Path, Contract>,
    args: InferStandardFunctionArgsV1<Contract>,
  ) => Effect.Effect<
    InferStandardFunctionReturnV1<Contract>,
    | StandardApplicationLegacySimulationQueryErrorV1
    | StandardApplicationTypedReferenceV1Error
  >;
  readonly unsafeInvokeQuery: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    StandardApplicationLegacySimulationQueryErrorV1
  >;
  readonly inspectAuthoritativeState: () => Effect.Effect<
    StandardApplicationAuthoritativeInspectionV1,
    StandardApplicationSystemTestInspectionV1Error
  >;
  /**
   * Test-only deterministic OCC interleaving. The scheduled operation runs
   * once after the next mutation runtime attempt and before that attempt can
   * commit. The existing mutation owner remains the sole retry authority.
   */
  readonly scheduleAfterNextMutationRuntime: (
    operation: () => Effect.Effect<void, never>,
  ) => Effect.Effect<void, never>;
}

export type StandardApplicationTypedMutationOutcomeV1<Value> = Omit<
  AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  "value"
> & Readonly<{ readonly value: Value }>;

export class StandardApplicationTypedReferenceV1Error extends Data.TaggedError(
  "StandardApplicationTypedReferenceV1Error",
)<{
  readonly phase:
    | "mutationContract"
    | "queryContract"
    | "mutationReturn"
    | "queryReturn";
  readonly functionPath: string;
  readonly detail:
    | Readonly<{
        readonly reason: "contractMismatch";
        readonly facet: "missing" | "kind" | "visibility" | "args" | "returns";
      }>
    | Readonly<{
        readonly reason: "returnValueMismatch";
        readonly issue: ValidatorValueIssueV1;
      }>;
}> {}

export interface StandardApplicationSimulationRunReceiptV1<Setup, A> {
  readonly version: 1;
  readonly applicationId: string;
  readonly simulationId: string;
  readonly lane: "pglite" | "postgres";
  readonly definitionAnalyzedRegisteredReadyActivated: true;
  readonly setupProof: Setup;
  readonly afterSetupInspection:
    StandardApplicationAuthoritativeInspectionV1;
  readonly workloadProof: A;
  readonly finalInspection: StandardApplicationAuthoritativeInspectionV1;
  readonly mutationRuntimeExecutions: number;
  readonly queryRuntimeExecutions: number;
  readonly postgresVersion: string | null;
}

export interface RunStandardApplicationSimulationV1Input<Setup, A, E> {
  readonly lane: StandardApplicationSystemTestLaneV1;
  readonly simulation: StandardApplicationSimulationV1<Setup, A, E>;
}

export type StandardApplicationSystemTestLaneV1 =
  PersistenceStandardApplicationSystemTestLaneV1;

export class StandardApplicationSimulationIntegrationV1Error
  extends Data.TaggedError(
    "StandardApplicationSimulationIntegrationV1Error",
  )<{
    readonly phase: "prepareRevision" | "inspectPostgresVersion";
    readonly applicationId: string;
    readonly cause: unknown;
  }> {}

export type RunStandardApplicationSimulationV1Error<E> =
  | E
  | ActivateApplicationRevisionV1Error
  | StandardApplicationSimulationIntegrationV1Error
  | StandardApplicationSystemTestInspectionV1Error;

/**
 * Private, test-owned composition root for one relation-free Standard
 * application revision. Definitions and workload policy remain caller-owned;
 * the operation only composes the existing lifecycle and invocation owners.
 */
export const runStandardApplicationSimulationV1 = Effect.fn(
  "StandardApplicationSimulation.runV1",
)(function* <Setup, A, E>(
  input: RunStandardApplicationSimulationV1Input<Setup, A, E>,
): Effect.fn.Return<
  StandardApplicationSimulationRunReceiptV1<Setup, A>,
  RunStandardApplicationSimulationV1Error<E>
> {
  const { simulation } = input;
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const standardDefinitionInput = simulation.application.define();
  const registeredFunctionContracts = indexRegisteredFunctionContractsV1(
    standardDefinitionInput,
  );
  const ready = yield* prepareFsv05ReadyRevisionFixtureEffectV1(
      input.lane,
      artifacts,
      simulation.application.revisionName,
      true,
      standardDefinitionInput,
    ).pipe(
      Effect.uninterruptible,
      Effect.mapError(cause =>
        new StandardApplicationSimulationIntegrationV1Error({
          phase: "prepareRevision",
          applicationId: simulation.application.applicationId,
          cause,
        })
      ),
    );
  yield* Effect.scoped(
    activateApplicationRevisionV1(ready.revisionId, null, ready.context),
  );

  let mutationRuntimeExecutions = 0;
  let queryRuntimeExecutions = 0;
  let queryExecutionSequence = 0;
  const mutationComposition =
    makeFsv06StandardPointMutationSystemTestCompositionV1(
    input.lane,
    ready.deploymentId,
    artifacts,
    () => { mutationRuntimeExecutions += 1; },
  );
  const mutationSystem = mutationComposition.system;
  const querySystem = makeSap05StandardPointQuerySystemLiveForTestV1(
    ready,
    artifacts,
    () => { queryRuntimeExecutions += 1; },
    () => {
      queryExecutionSequence += 1;
      return {
        executionId:
          `${simulation.application.applicationId}-query-${queryExecutionSequence}`,
        randomSeed: makeQueryRandomSeedV1(queryExecutionSequence),
        executionTime: 1_780_100_000_000 + queryExecutionSequence,
      };
    },
  );
  const applicationLayer = Layer.mergeAll(
    makeLegacyApplicationPointMutationSystemV1Layer(mutationSystem),
    makeApplicationPointQuerySystemV1Layer(querySystem),
    makeStandardApplicationActiveRevisionReaderV1Layer(ready.context),
  );
  const inspector = yield* makeStandardApplicationSystemTestInspectorV1({
    applicationId: simulation.application.applicationId,
    deploymentId: ready.deploymentId,
    persistence: input.lane.persistence,
    getMutationRuntimeExecutions: () => mutationRuntimeExecutions,
    getQueryRuntimeExecutions: () => queryRuntimeExecutions,
  });
  const runOwned = <Success, Failure>(
    invocationScope: Scope.Closeable,
    effect: Effect.Effect<Success, Failure>,
  ): Effect.Effect<Success, Failure> => Effect.forkIn(
    effect,
    invocationScope,
    { startImmediately: true },
  ).pipe(Effect.flatMap(fiber =>
    Fiber.join(fiber).pipe(Effect.ensuring(Fiber.interrupt(fiber)))
  ));
  const invokeApplication = <Success, Failure>(
    invocationScope: Scope.Closeable,
    effect: Effect.Effect<
      Success,
      Failure,
      ApplicationTestRequirementsV1
    >,
  ): Effect.Effect<Success, Failure> => runOwned(
    invocationScope,
    Effect.scoped(effect.pipe(Effect.provide(applicationLayer))),
  );

  const setupProof = yield* Effect.acquireUseRelease(
    Scope.make(),
    invocationScope => {
      let setupActive = true;
      const invokeWhileSetupActive = <Success, Failure>(
        effect: () => Effect.Effect<Success, Failure>,
      ): Effect.Effect<Success, Failure> => Effect.suspend(() =>
        setupActive
          ? effect()
          : Effect.die(new Error(
              "The Standard Application system-test setup client is no longer active.",
            ))
      );
      const setupClient = Object.freeze({
        mutation: <
          Path extends string,
          Contract extends StandardFunctionContractV1<
            "mutation" | "workflowMutation",
            "public" | "internal",
            StandardFunctionArgsValidatorV1,
            StandardValidatorV1<Json, "required">
          >,
        >(
          reference: StandardFunctionReferenceV1<Path, Contract>,
          args: InferStandardFunctionArgsV1<Contract>,
          requestKey: TransactionRequestKeyV1,
        ) => invokeWhileSetupActive(() =>
          requireTypedReferenceBindingV1(
            "mutationContract",
            registeredFunctionContracts,
            reference,
          ).pipe(Effect.flatMap(() => invokeApplication(
              invocationScope,
              invokeLegacyStandardApplicationPointMutationV1(
                TransactionFunctionPathV1Schema.make(reference.path),
                args,
                requestKey,
              ).pipe(Effect.flatMap(outcome =>
                projectTypedMutationOutcomeV1(reference, outcome)
              )),
            )))
        ).pipe(Effect.withSpan(
          "StandardApplicationSystemTest.setupMutationV1",
        )),
        unsafeInvokeMutation: Effect.fn(
          "StandardApplicationSystemTest.unsafeSetupMutationV1",
        )((functionPath, args, requestKey) => invokeWhileSetupActive(() =>
          invokeApplication(
            invocationScope,
            invokeLegacyStandardApplicationPointMutationV1(
              functionPath,
              args,
              requestKey,
            ),
          )
        )),
      } satisfies StandardApplicationSystemTestSetupClientV1);
      return Effect.suspend(() => simulation.setup(setupClient)).pipe(
        Effect.ensuring(Effect.sync(() => { setupActive = false; })),
      );
    },
    (invocationScope, exit) => Scope.close(invocationScope, exit),
  );
  const afterSetupInspection = yield* inspector.inspectAuthoritativeState();

  const workloadProof = yield* Effect.acquireUseRelease(
    Scope.make(),
    invocationScope => {
      let clientActive = true;
      const invokeWhileActive = <Success, Failure>(
        effect: () => Effect.Effect<Success, Failure>,
      ): Effect.Effect<Success, Failure> => Effect.suspend(() =>
        clientActive
          ? effect()
          : Effect.die(new Error(
              "The Standard Application system-test workload client is no longer active.",
            ))
      );
      const client = Object.freeze({
        mutation: <
          Path extends string,
          Contract extends StandardFunctionContractV1<
            "mutation" | "workflowMutation",
            "public" | "internal",
            StandardFunctionArgsValidatorV1,
            StandardValidatorV1<Json, "required">
          >,
        >(
          reference: StandardFunctionReferenceV1<Path, Contract>,
          args: InferStandardFunctionArgsV1<Contract>,
          requestKey: TransactionRequestKeyV1,
        ) => invokeWhileActive(() =>
          requireTypedReferenceBindingV1(
            "mutationContract",
            registeredFunctionContracts,
            reference,
          ).pipe(Effect.flatMap(() => invokeApplication(
              invocationScope,
              invokeLegacyStandardApplicationPointMutationV1(
                TransactionFunctionPathV1Schema.make(reference.path),
                args,
                requestKey,
              ).pipe(Effect.flatMap(outcome =>
                projectTypedMutationOutcomeV1(reference, outcome)
              )),
            )))
        ).pipe(Effect.withSpan(
          "StandardApplicationSystemTest.invokeMutationV1",
        )),
        query: <
          Path extends string,
          Contract extends StandardFunctionContractV1<
            "query",
            "public" | "internal",
            StandardFunctionArgsValidatorV1,
            StandardValidatorV1<unknown, "required">
          >,
        >(
          reference: StandardFunctionReferenceV1<Path, Contract>,
          args: InferStandardFunctionArgsV1<Contract>,
        ) => invokeWhileActive(() =>
          requireTypedReferenceBindingV1(
            "queryContract",
            registeredFunctionContracts,
            reference,
          ).pipe(Effect.flatMap(() => invokeApplication(
              invocationScope,
              invokeLegacySimulationPointQueryV1(
                TransactionFunctionPathV1Schema.make(reference.path),
                args,
              ).pipe(Effect.flatMap(value =>
                projectTypedQueryValueV1(reference, value)
              )),
            )))
        ).pipe(Effect.withSpan(
          "StandardApplicationSystemTest.invokeQueryV1",
        )),
        unsafeInvokeMutation: Effect.fn(
          "StandardApplicationSystemTest.unsafeMutationV1",
        )((functionPath, args, requestKey) => invokeWhileActive(() =>
          invokeApplication(
            invocationScope,
            invokeLegacyStandardApplicationPointMutationV1(
              functionPath,
              args,
              requestKey,
            ),
          )
        )),
        unsafeInvokeQuery: Effect.fn(
          "StandardApplicationSystemTest.unsafeQueryV1",
        )((functionPath, args) => invokeWhileActive(() =>
          invokeApplication(
            invocationScope,
            invokeLegacySimulationPointQueryV1(functionPath, args),
          )
        )),
        inspectAuthoritativeState: Effect.fn(
          "StandardApplicationSystemTest.inspectWorkloadStateV1",
        )(() => invokeWhileActive(() => runOwned(
          invocationScope,
          inspector.inspectAuthoritativeState(),
        ))),
        scheduleAfterNextMutationRuntime: Effect.fn(
          "StandardApplicationSystemTest.scheduleAfterNextMutationRuntimeV1",
        )(operation => invokeWhileActive(() => Effect.sync(() => {
          mutationComposition.armAfterNextRuntime(operation());
        }))),
      } satisfies StandardApplicationSystemTestClientV1);
      return Effect.suspend(() => simulation.workload(client, setupProof)).pipe(
        Effect.tap(() => Effect.sync(
          mutationComposition.requireNoPendingInterleaving,
        )),
        Effect.ensuring(Effect.sync(() => {
          mutationComposition.clearPendingInterleaving();
          clientActive = false;
        })),
      );
    },
    (invocationScope, exit) => Scope.close(invocationScope, exit),
  );
  const finalInspection = yield* inspector.inspectAuthoritativeState();
  const expectedRuntimeExecutions = simulation.expectedRuntimeExecutions;
  if (
    expectedRuntimeExecutions !== undefined &&
    (
      mutationRuntimeExecutions !== expectedRuntimeExecutions.mutations ||
      queryRuntimeExecutions !== expectedRuntimeExecutions.queries
    )
  ) {
    return yield* Effect.die(new Error(
      `Simulation ${simulation.simulationId} expected ` +
      `${expectedRuntimeExecutions.mutations} mutation and ` +
      `${expectedRuntimeExecutions.queries} query runtime executions, but ` +
      `observed ${mutationRuntimeExecutions} and ${queryRuntimeExecutions}.`,
    ));
  }
  const postgresVersion = input.lane.name === "postgres"
    ? (yield* runUninterruptibleIntegrationPromiseV1(
        "inspectPostgresVersion",
        simulation.application.applicationId,
        () => input.lane.persistence.query<{ version: string }>(
          "select version() as version",
        ),
      )).rows[0]?.version ?? null
    : null;

  return {
    version: 1,
    applicationId: simulation.application.applicationId,
    simulationId: simulation.simulationId,
    lane: input.lane.name,
    definitionAnalyzedRegisteredReadyActivated: true,
    setupProof,
    afterSetupInspection,
    workloadProof,
    finalInspection,
    mutationRuntimeExecutions,
    queryRuntimeExecutions,
    postgresVersion,
  };
});

function makeQueryRandomSeedV1(sequence: number): Uint8Array {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 0xffff_ffff) {
    throw new Error("The Standard Application system-test query sequence overflowed.");
  }
  const seed = new Uint8Array(32);
  new DataView(seed.buffer).setUint32(28, sequence);
  return seed;
}

type RegisteredFunctionContractV1 = Readonly<{
  readonly kind: string;
  readonly visibility: string;
  readonly argsValidator: unknown;
  readonly returnsValidator: unknown;
}>;

function indexRegisteredFunctionContractsV1(
  definition: StandardApplicationDefinitionInputV1,
): ReadonlyMap<string, RegisteredFunctionContractV1> {
  const contracts = new Map<string, RegisteredFunctionContractV1>();
  for (const module of definition.programInput.modules) {
    for (const fn of module.functions) {
      contracts.set(`${module.modulePath}:${fn.exportName}`, Object.freeze({
        kind: fn.kind,
        visibility: fn.visibility,
        argsValidator: fn.argsValidator,
        returnsValidator: fn.returnsValidator,
      }));
    }
  }
  return contracts;
}

function requireTypedReferenceBindingV1(
  phase: "mutationContract" | "queryContract",
  contracts: ReadonlyMap<string, RegisteredFunctionContractV1>,
  reference: StandardFunctionReferenceV1<string, AnyStandardFunctionContractV1>,
): Effect.Effect<void, StandardApplicationTypedReferenceV1Error> {
  const registered = contracts.get(reference.path);
  const facet = registered === undefined
    ? "missing"
    : registered.kind !== reference.contract.kind
    ? "kind"
    : registered.visibility !== reference.contract.visibility
    ? "visibility"
    : !sameValidatorJsonV1(
        registered.argsValidator,
        reference.contract.args.json,
      )
    ? "args"
    : !sameValidatorJsonV1(
        registered.returnsValidator,
        reference.contract.returns.json,
      )
    ? "returns"
    : undefined;
  return facet === undefined
    ? Effect.void
    : Effect.fail(new StandardApplicationTypedReferenceV1Error({
        phase,
        functionPath: reference.path,
        detail: { reason: "contractMismatch", facet },
      }));
}

function sameValidatorJsonV1(
  candidate: unknown,
  expected: AnyStandardFunctionContractV1["returns"]["json"],
): boolean {
  if (candidate === expected) return true;
  if (!isNonArrayRecord(candidate) || candidate.type !== expected.type) {
    return false;
  }
  switch (expected.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return true;
    case "id":
      return candidate.tableName === expected.tableName;
    case "literal":
      return Object.is(candidate.value, expected.value);
    case "array":
      return sameValidatorJsonV1(candidate.value, expected.value);
    case "record":
      return sameValidatorJsonV1(candidate.keys, expected.keys) &&
        sameValidatorJsonV1(candidate.values, expected.values);
    case "union": {
      if (!Array.isArray(candidate.value) ||
        candidate.value.length !== expected.value.length) {
        return false;
      }
      const candidateMembers = candidate.value;
      return expected.value.every((member, index) =>
        sameValidatorJsonV1(candidateMembers[index], member)
      );
    }
    case "object": {
      if (!isNonArrayRecord(candidate.value)) return false;
      const candidateFieldRecord = candidate.value;
      const expectedFields = Object.keys(expected.value);
      const candidateFields = Object.keys(candidateFieldRecord);
      if (candidateFields.length !== expectedFields.length) return false;
      return expectedFields.every(fieldName => {
        const candidateField = candidateFieldRecord[fieldName];
        const expectedField = expected.value[fieldName];
        return expectedField !== undefined &&
          isNonArrayRecord(candidateField) &&
          candidateField.optional === expectedField.optional &&
          sameValidatorJsonV1(
            candidateField.fieldType,
            expectedField.fieldType,
          );
      });
    }
  }
}

function projectTypedMutationOutcomeV1<
  Contract extends StandardFunctionContractV1<
    "mutation" | "workflowMutation",
    "public" | "internal",
    StandardFunctionArgsValidatorV1,
    StandardValidatorV1<Json, "required">
  >,
>(
  reference: StandardFunctionReferenceV1<string, Contract>,
  outcome: AuthoritativeCommittedApplicationPointMutationOutcomeV1,
): Effect.Effect<
  StandardApplicationTypedMutationOutcomeV1<
    InferStandardFunctionReturnV1<Contract>
  >,
  StandardApplicationTypedReferenceV1Error
> {
  return validateTypedReferenceReturnV1(
    "mutationReturn",
    reference,
    outcome.value,
  ).pipe(Effect.as(outcome as StandardApplicationTypedMutationOutcomeV1<
    InferStandardFunctionReturnV1<Contract>
  >));
}

function projectTypedQueryValueV1<
  Contract extends StandardFunctionContractV1<
    "query",
    "public" | "internal",
    StandardFunctionArgsValidatorV1,
    StandardValidatorV1<unknown, "required">
  >,
>(
  reference: StandardFunctionReferenceV1<string, Contract>,
  value: CanonicalFlarexRuntimeValueV1,
): Effect.Effect<
  InferStandardFunctionReturnV1<Contract>,
  StandardApplicationTypedReferenceV1Error
> {
  return validateTypedReferenceReturnV1(
    "queryReturn",
    reference,
    value,
  ).pipe(Effect.as(value as InferStandardFunctionReturnV1<Contract>));
}

function validateTypedReferenceReturnV1(
  phase: StandardApplicationTypedReferenceV1Error["phase"],
  reference: StandardFunctionReferenceV1<string, AnyStandardFunctionContractV1>,
  value: CanonicalFlarexRuntimeValueV1,
): Effect.Effect<void, StandardApplicationTypedReferenceV1Error> {
  return Effect.fromResult(validateValidatorValueV1(
    reference.contract.returns.json,
    value,
    { idPolicy: { mode: "shapeOnly" } },
  )).pipe(Effect.mapError(error =>
    new StandardApplicationTypedReferenceV1Error({
      phase,
      functionPath: reference.path,
      detail: { reason: "returnValueMismatch", issue: error.issue },
    })
  ));
}

function runUninterruptibleIntegrationPromiseV1<A>(
  phase: StandardApplicationSimulationIntegrationV1Error["phase"],
  applicationId: string,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, StandardApplicationSimulationIntegrationV1Error> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: evaluate,
    catch: cause => new StandardApplicationSimulationIntegrationV1Error({
      phase,
      applicationId,
      cause,
    }),
  }));
}

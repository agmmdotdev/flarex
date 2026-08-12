import { Miniflare } from "miniflare";
import { Cause, Effect, Exit, Layer, Option, Result, Scope } from "effect";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
} from "flarex-backend/internal/point-query-internal-call-exact-runtime-host-v1";
import {
  claimCandidateBoundPointQueryInternalCallRuntimeTargetV1,
  readCandidateBoundPointQueryInternalCallDocumentV1,
  revalidateCandidateBoundPointQueryInternalCallRuntimeTargetV1,
} from
  "flarex-backend/internal/candidate-bound-point-query-internal-call-runtime-target-v1";
import {
  TransactionFunctionPathV1Schema,
} from "flarex-protocol/transaction-session";
import {
  activateApplicationRevisionV1,
  readActiveApplicationRevisionV1,
} from "@flarex/persistence-postgres/internal/system-test/applicationRevisionActivationV1";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/postgres";
import {
  ApplicationPointQueryRouteIndependentDispatcherV1Error,
  ApplicationPointQuerySystemV1,
  invokeApplicationPointQueryV1,
  makeApplicationPointQuerySystemV1Layer,
  type ApplicationPointQueryRouteIndependentDispatchV1Error,
  type ApplicationPointQuerySystemLiveV1,
} from "@flarex/standard-application-invocation/internal/system-query-v1";
import {
  makeStandardApplicationActiveRevisionReaderV1Layer,
  StandardApplicationActiveRevisionReaderV1,
} from "@flarex/standard-application-invocation/v1";
import {
  FSV05_SUPPORTED_LOCATOR,
  prepareFsv05ReadyRevisionFixtureV1,
  type Fsv05ApplicationRevisionActivationLaneV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import {
  appendPqvA1DocumentCommitV1,
  pqvA1TableIdForRevision,
} from "./pqvA1ApplicationPointQuerySnapshotHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "./memoryRuntimeArtifactStoreV1";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export interface Sap05StandardPointQueryLaneV1
  extends Fsv05ApplicationRevisionActivationLaneV1 {
  readonly persistence: Persistence;
}

export interface Sap05StandardPointQueryProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly presentStatus: "pending";
  readonly missing: true;
  readonly deterministicReplay: true;
  readonly coldRuntimeReconstructed: true;
  readonly invalidArgumentsRejected: true;
  readonly invalidResultRejected: true;
  readonly readDefectPreserved: true;
  readonly unknownWorkerDefectPreserved: true;
  readonly interruptionPreserved: true;
  readonly cleanupUncertaintyTyped: true;
  readonly unknownFunctionRejected: true;
  readonly closedSelectionRejected: true;
  readonly corruptArtifactRejected: true;
  readonly realWorkerdExecutions: number;
  readonly noMutationPublication: true;
  readonly postgresVersion: string | null;
}

const FUNCTION_PATH = TransactionFunctionPathV1Schema.make("orders:get");
const ROW_ID = decodeAppRowIdHexV1("91".repeat(16));
const MISSING_ROW_ID = decodeAppRowIdHexV1("92".repeat(16));
const SNAPSHOT_BUDGET = Object.freeze({
  maximumPointReads: 16,
  maximumDocumentBytes: 1_048_576,
});
const TARGET_BUDGET = Object.freeze({
  maximumModules: 64,
  maximumObjects: 128,
  maximumObjectBytes: 16 * 1_048_576,
  maximumRawBytes: 8 * 1_048_576,
  maximumHashBytes: 64 * 1_048_576,
  maximumResultBytes: 1_048_576,
});

/**
 * SAP05 is retained coverage for the displaced Application Revision V1 query
 * runtime. Keep that legacy authority inside this test harness; the migrated
 * Standard consumer must never fall back to it.
 */
const invokeLegacySap05PointQueryV1 = Effect.fn(
  "Sap05LegacyPointQuery.invokeV1",
)(function* (functionPath: string, args: unknown) {
  const reader = yield* StandardApplicationActiveRevisionReaderV1;
  const active = yield* reader.read;
  return yield* invokeApplicationPointQueryV1(
    active.selection,
    TransactionFunctionPathV1Schema.make(functionPath),
    args,
  );
});

interface Sap05DispatcherControlsV1 {
  overrideNextResult: boolean;
  nextResult: unknown;
  nextReadCause: Cause.Cause<ApplicationPointQueryRouteIndependentDispatchV1Error> |
    undefined;
  beforeNextRead: (() => Promise<void>) | undefined;
  failNextCleanup: boolean;
  failNextWorkerWithTerminalError: boolean;
  failNextWorkerWithUnknownError: boolean;
}

export async function proveSap05StandardPointQueryV1(
  lane: Sap05StandardPointQueryLaneV1,
  revisionVariant: "sap05-query" | "sap06-a1-query-internal" = "sap05-query",
): Promise<Sap05StandardPointQueryProofV1> {
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const ready = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    revisionVariant,
    true,
  );
  await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(ready.revisionId, null, ready.context),
  ));
  const active = await Effect.runPromise(Effect.scoped(
    readActiveApplicationRevisionV1(ready.context),
  ));
  const tableId = await pqvA1TableIdForRevision(
    lane.persistence,
    ready.revisionId,
  );
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId: ROW_ID });
  const missingDocumentId = appDocumentIdV1FromRowIdentity({
    tableId,
    rowId: MISSING_ROW_ID,
  });
  await appendPqvA1DocumentCommitV1(lane.persistence, {
    deploymentId: ready.deploymentId,
    tableId,
    rowId: ROW_ID,
    schemaVersionId: active.metadata.schemaVersionId,
    previousCommitSeq: null,
    status: "pending",
  });
  const before = await mutationPublicationCounts(lane.persistence);
  let realWorkerdExecutions = 0;
  let executionSequence = 0;
  const dispatcherControls = makeSap05DispatcherControlsV1();
  const system = makeSystemLive(
    ready,
    artifacts,
    () => { realWorkerdExecutions += 1; },
    () => {
      executionSequence += 1;
      return Object.freeze({
        executionId: `sap05-${lane.name}-${executionSequence}`,
        randomSeed: new Uint8Array(32).fill(executionSequence),
        executionTime: 1_780_000_000_000 + executionSequence,
      });
    },
    dispatcherControls,
  );
  const layer = Layer.merge(
    makeApplicationPointQuerySystemV1Layer(system),
    makeStandardApplicationActiveRevisionReaderV1Layer(ready.context),
  );
  const invoke = <A, E>(effect: Effect.Effect<
    A,
    E,
    | ApplicationPointQuerySystemV1
    | StandardApplicationActiveRevisionReaderV1
    | Scope.Scope
  >) => Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(layer))));

  const present = await invoke(invokeLegacySap05PointQueryV1(
    FUNCTION_PATH,
    { id: documentId },
  ));
  if (!isRecord(present) || present.status !== "pending") {
    throw new Error("SAP05 did not return the authoritative document.");
  }
  const missing = await invoke(invokeLegacySap05PointQueryV1(
    FUNCTION_PATH,
    { id: missingDocumentId },
  ));
  if (missing !== null) throw new Error("SAP05 missing document was not null.");
  const replay = await invoke(invokeLegacySap05PointQueryV1(
    FUNCTION_PATH,
    { id: documentId },
  ));
  const invalidArgumentsRejected = await failsWithTag(
    invokeLegacySap05PointQueryV1(FUNCTION_PATH, { id: 123 }).pipe(
      Effect.provide(layer),
      Effect.scoped,
    ),
    "ApplicationPointQueryRouteIndependentDispatcherV1Error",
  );
  dispatcherControls.overrideNextResult = true;
  dispatcherControls.nextResult = 42;
  const invalidResultRejected = await failsWithTag(
    invokeLegacySap05PointQueryV1(FUNCTION_PATH, { id: documentId }).pipe(
      Effect.provide(layer),
      Effect.scoped,
    ),
    "CandidateBoundQueryInternalCallRuntimeDispatchV1Error",
  );
  dispatcherControls.nextReadCause = Cause.die(new Error("sap05-read-defect"));
  const defectExit = await Effect.runPromiseExit(
    invokeLegacySap05PointQueryV1(FUNCTION_PATH, { id: documentId }).pipe(
      Effect.provide(layer),
      Effect.scoped,
    ),
  );
  const readDefectPreserved = Exit.isFailure(defectExit) &&
    Cause.hasDies(defectExit.cause);
  if (!readDefectPreserved) {
    throw new Error("SAP05 flattened a point-read defect into its typed channel.");
  }
  dispatcherControls.failNextWorkerWithUnknownError = true;
  const unknownWorkerExit = await Effect.runPromiseExit(
    invokeLegacySap05PointQueryV1(FUNCTION_PATH, { id: documentId }).pipe(
      Effect.provide(layer),
      Effect.scoped,
    ),
  );
  const unknownWorkerDefectPreserved = Exit.isFailure(unknownWorkerExit) &&
    Cause.hasDies(unknownWorkerExit.cause);
  if (!unknownWorkerDefectPreserved) {
    throw new Error("SAP05 flattened an unknown Worker defect into its typed channel.");
  }
  dispatcherControls.failNextWorkerWithTerminalError = true;
  const terminalFailureTyped = await failsWithReason(
    invokeLegacySap05PointQueryV1(FUNCTION_PATH, { id: documentId }).pipe(
      Effect.provide(layer),
      Effect.scoped,
    ),
    "ApplicationPointQueryRouteIndependentDispatcherV1Error",
    "targetRejected",
  );
  if (!terminalFailureTyped) {
    throw new Error("SAP05 lost the exact terminal nested-call classification.");
  }
  const gate = makeAsyncGate();
  dispatcherControls.beforeNextRead = gate.wait;
  const interruptedController = new AbortController();
  const interruptedPromise = Effect.runPromiseExit(
    invokeLegacySap05PointQueryV1(FUNCTION_PATH, { id: documentId }).pipe(
      Effect.provide(layer),
      Effect.scoped,
    ),
    { signal: interruptedController.signal },
  );
  await gate.started;
  interruptedController.abort();
  gate.release();
  const interruptedExit = await interruptedPromise;
  const interruptionPreserved = Exit.isFailure(interruptedExit) &&
    Cause.hasInterrupts(interruptedExit.cause);
  if (!interruptionPreserved) {
    throw new Error("SAP05 detached point-read work from invocation cancellation.");
  }
  dispatcherControls.failNextCleanup = true;
  const cleanupUncertaintyTyped = await failsWithReason(
    invokeLegacySap05PointQueryV1(FUNCTION_PATH, { id: documentId }).pipe(
      Effect.provide(layer),
      Effect.scoped,
    ),
    "ApplicationPointQueryRouteIndependentDispatcherV1Error",
    "cleanupUncertain",
  );
  const unknownFunctionRejected = await failsWithTag(
    invokeLegacySap05PointQueryV1(
      TransactionFunctionPathV1Schema.make("orders:missing"),
      { id: documentId },
    ).pipe(Effect.provide(layer), Effect.scoped),
    "ApplicationPointQuerySnapshotFunctionV1Error",
  );

  let closedSelection: unknown;
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    closedSelection = (yield* readActiveApplicationRevisionV1(
      ready.context,
    )).selection;
  })));
  const closedSelectionRejected = await failsWithTag(
    invokeApplicationPointQueryV1(
      closedSelection as Parameters<typeof invokeApplicationPointQueryV1>[0],
      FUNCTION_PATH,
      { id: documentId },
    ).pipe(
      Effect.provide(makeApplicationPointQuerySystemV1Layer(system)),
      Effect.scoped,
    ),
    "InvalidActiveApplicationRevisionSelectionV1Error",
  );

  const capturedObjects = [...artifacts.bodies.entries()].map(
    ([key, body]) => [key, new Uint8Array(body)] as const,
  );
  if (capturedObjects.length === 0) throw new Error("SAP05 R2 fixture is empty.");
  for (const [key] of capturedObjects) {
    artifacts.replaceBodyForTest(key, new Uint8Array([1, 2, 3]));
  }
  const corruptArtifactRejected = await failsWithTag(
    invokeLegacySap05PointQueryV1(
      FUNCTION_PATH,
      { id: documentId },
    ).pipe(Effect.provide(layer), Effect.scoped),
    "CandidateBoundQueryInternalCallRuntimeDispatchV1Error",
  );
  for (const [key, body] of capturedObjects) {
    artifacts.replaceBodyForTest(key, body);
  }

  const after = await mutationPublicationCounts(lane.persistence);
  const postgresVersion = lane.name === "postgres"
    ? (await lane.persistence.query<{ version: string }>(
        "select version() as version",
      )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    lane: lane.name,
    presentStatus: "pending",
    missing: true,
    deterministicReplay: requireTrue(
      JSON.stringify(present) === JSON.stringify(replay),
      "deterministic replay",
    ),
    coldRuntimeReconstructed: requireTrue(
      realWorkerdExecutions >= 3,
      "cold Workerd reconstruction",
    ),
    invalidArgumentsRejected: requireTrue(
      invalidArgumentsRejected,
      "invalid arguments",
    ),
    invalidResultRejected: requireTrue(
      invalidResultRejected,
      "foreign Worker result validator",
    ),
    readDefectPreserved: requireTrue(readDefectPreserved, "read defect Cause"),
    unknownWorkerDefectPreserved: requireTrue(
      unknownWorkerDefectPreserved,
      "unknown Worker defect Cause",
    ),
    interruptionPreserved: requireTrue(
      interruptionPreserved,
      "invocation interruption",
    ),
    cleanupUncertaintyTyped: requireTrue(
      cleanupUncertaintyTyped,
      "runtime cleanup uncertainty",
    ),
    unknownFunctionRejected: requireTrue(
      unknownFunctionRejected,
      "unknown function",
    ),
    closedSelectionRejected: requireTrue(
      closedSelectionRejected,
      "closed selection",
    ),
    corruptArtifactRejected: requireTrue(
      corruptArtifactRejected,
      "corrupt artifact",
    ),
    realWorkerdExecutions,
    noMutationPublication: requireTrue(
      JSON.stringify(before) === JSON.stringify(after),
      "zero mutation publication",
    ),
    postgresVersion,
  });
}

export async function proveSap06A1InternalPointQueryV1(
  lane: Sap05StandardPointQueryLaneV1,
): Promise<Sap05StandardPointQueryProofV1 & Readonly<{
  readonly inlineInternalQuery: true;
}>> {
  const proof = await proveSap05StandardPointQueryV1(
    lane,
    "sap06-a1-query-internal",
  );
  return Object.freeze({ ...proof, inlineInternalQuery: true as const });
}

/** Test-only default composition used by representative multi-function apps. */
export function makeSap05StandardPointQuerySystemLiveForTestV1(
  ready: Awaited<ReturnType<typeof prepareFsv05ReadyRevisionFixtureV1>>,
  artifacts: ReturnType<typeof makeMemoryRuntimeArtifactStoreV1>,
  onExecution: () => void,
  executionContextFactory: ApplicationPointQuerySystemLiveV1[
    "executionContextFactory"
  ],
): ApplicationPointQuerySystemLiveV1 {
  return makeSystemLive(
    ready,
    artifacts,
    onExecution,
    executionContextFactory,
    makeSap05DispatcherControlsV1(),
  );
}

function makeSap05DispatcherControlsV1(): Sap05DispatcherControlsV1 {
  return {
    overrideNextResult: false,
    nextResult: undefined,
    nextReadCause: undefined,
    beforeNextRead: undefined,
    failNextCleanup: false,
    failNextWorkerWithTerminalError: false,
    failNextWorkerWithUnknownError: false,
  };
}

function makeSystemLive(
  ready: Awaited<ReturnType<typeof prepareFsv05ReadyRevisionFixtureV1>>,
  artifacts: ReturnType<typeof makeMemoryRuntimeArtifactStoreV1>,
  onExecution: () => void,
  executionContextFactory: ApplicationPointQuerySystemLiveV1[
    "executionContextFactory"
  ],
  dispatcherControls: Sap05DispatcherControlsV1,
): ApplicationPointQuerySystemLiveV1 {
  return Object.freeze({
    deploymentId: ready.deploymentId,
    activationContext: ready.context,
    snapshotBudget: SNAPSHOT_BUDGET,
    runtimeArtifacts: artifacts.store,
    runtimeBudget: TARGET_BUDGET,
    compatibilityDate: "2026-06-11",
    dispatcher: workerdDispatcher(onExecution, dispatcherControls),
    executionContextFactory,
  });
}

function workerdDispatcher(
  onExecution: () => void,
  controls: Sap05DispatcherControlsV1,
) {
  return Object.freeze({
    dispatch: (target: Parameters<
      ApplicationPointQuerySystemLiveV1["dispatcher"]["dispatch"]
    >[0], request: Parameters<
      ApplicationPointQuerySystemLiveV1["dispatcher"]["dispatch"]
    >[1]) => Effect.gen(function* () {
      let readBoundaryCause:
        | Cause.Cause<ApplicationPointQueryRouteIndependentDispatchV1Error>
        | undefined;
      let dispatchSignal: AbortSignal | undefined;
      const claimed = yield* Effect.fromResult(
        claimCandidateBoundPointQueryInternalCallRuntimeTargetV1(target),
      ).pipe(Effect.mapError(cause => dispatcherFailure("targetRejected", cause)));
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => new Miniflare({
          compatibilityDate: claimed.definition.compatibilityDate,
          modules: [
            {
              type: "ESModule" as const,
              path: "sap05-dispatch.js",
              contents: workerdDispatchModuleSource(),
            },
            ...Object.entries(claimed.definition.modules).map(([path, contents]) => ({
              type: "ESModule" as const,
              path,
              contents,
            })),
          ],
          serviceBindings: {
            SNAPSHOT: async (input: Request) => {
              const url = new URL(input.url);
              try {
                const beforeRead = controls.beforeNextRead;
                controls.beforeNextRead = undefined;
                if (beforeRead !== undefined) await beforeRead();
                const operation: Effect.Effect<
                  unknown,
                  ApplicationPointQueryRouteIndependentDispatchV1Error
                > = url.pathname === "/revalidate"
                  ? revalidateCandidateBoundPointQueryInternalCallRuntimeTargetV1<
                      ApplicationPointQueryRouteIndependentDispatchV1Error
                    >(target)
                    .pipe(Effect.as(null))
                  : readCandidateBoundPointQueryInternalCallDocumentV1<
                      Readonly<{ readonly tableName: string; readonly documentId: string }>,
                      unknown,
                      ApplicationPointQueryRouteIndependentDispatchV1Error
                    >(
                      target,
                      await input.json() as Readonly<{
                        tableName: string;
                        documentId: string;
                      }>,
                    );
                const injectedCause = controls.nextReadCause;
                controls.nextReadCause = undefined;
                const exit = injectedCause === undefined
                  ? await Effect.runPromiseExit(
                      operation,
                      dispatchSignal === undefined
                        ? undefined
                        : { signal: dispatchSignal },
                    )
                  : Exit.failCause(injectedCause);
                if (Exit.isSuccess(exit)) {
                  return Response.json({ ok: true, result: exit.value });
                }
                readBoundaryCause ??= exit.cause;
                const cause = Cause.squash(exit.cause);
                return Response.json({
                  ok: false,
                  name: "PointQueryInternalCallExactRuntimeReadBoundaryV1Error",
                  message: errorMessage(cause),
                });
              } catch (cause) {
                readBoundaryCause ??= Cause.die(cause);
                return Response.json({
                  ok: false,
                  name: "PointQueryInternalCallExactRuntimeReadBoundaryV1Error",
                  message: errorMessage(cause),
                });
              }
            },
          },
        })),
        runtime => Effect.gen(function* () {
          onExecution();
          const response = yield* Effect.tryPromise({
            try: signal => {
              dispatchSignal = signal;
              return runtime.dispatchFetch("https://sap05.test/", {
                method: "POST",
                body: JSON.stringify(serializeRequest(request)),
                signal,
              });
            },
            catch: cause => dispatcherFailure("unavailable", cause),
          });
          const envelope = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: cause => dispatcherFailure("unavailable", cause),
          });
          let observedEnvelope = envelope;
          if (controls.failNextWorkerWithTerminalError) {
            controls.failNextWorkerWithTerminalError = false;
            observedEnvelope = Object.freeze({
              ok: false,
              name: "PointQueryInternalCallExactRuntimeTerminalV1Error",
              message: "internal-call-target-rejected",
            });
          }
          if (controls.failNextWorkerWithUnknownError) {
            controls.failNextWorkerWithUnknownError = false;
            observedEnvelope = Object.freeze({
              ok: false,
              name: "Sap05UnknownWorkerDefect",
              message: "sap05-unknown-worker-defect",
            });
          }
          if (!isRecord(observedEnvelope) || observedEnvelope.ok !== true) {
            const name = isRecord(observedEnvelope) &&
                typeof observedEnvelope.name === "string"
              ? observedEnvelope.name
              : "";
            if (
              name === "PointQueryInternalCallExactRuntimeReadBoundaryV1Error" &&
              readBoundaryCause !== undefined
            ) {
              return yield* Effect.failCause(readBoundaryCause);
            }
            const reason = dispatcherReason(name);
            if (reason === undefined) {
              return yield* Effect.die(new Error(
                `SAP05 observed an unknown Worker failure envelope: ${name}.`,
                { cause: observedEnvelope },
              ));
            }
            return yield* dispatcherFailure(reason, observedEnvelope);
          }
          if (controls.overrideNextResult) {
            controls.overrideNextResult = false;
            return isRecord(observedEnvelope.result)
              ? { ...observedEnvelope.result, value: controls.nextResult }
              : controls.nextResult;
          }
          return observedEnvelope.result;
        }),
        runtime => Effect.tryPromise({
          try: async () => {
            await runtime.dispose();
            if (controls.failNextCleanup) {
              controls.failNextCleanup = false;
              throw new Error("sap05-cleanup-uncertain");
            }
          },
          catch: cause => dispatcherFailure("cleanupUncertain", cause),
        }),
      );
    }),
  });
}

function workerdDispatchModuleSource(): string {
  return `import { FlarexPointQueryInternalCallExactRuntimeV1 } from "./${POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1}";
export default {
  async fetch(request, env) {
    const input = await request.json();
    input.runtimeTargetSha256 = new Uint8Array(input.runtimeTargetSha256);
    input.context.randomSeed = new Uint8Array(input.context.randomSeed);
    input.context.snapshotCommitSeq = BigInt(input.context.snapshotCommitSeq);
    const capability = {
      revalidate: async () => {
        const response = await env.SNAPSHOT.fetch("https://snapshot/revalidate", { method: "POST" });
        const value = await response.json();
        if (!value.ok) throw Object.assign(new Error(value.message), { name: value.name });
      },
      readPointDocument: async (tableName, documentId) => {
        const response = await env.SNAPSHOT.fetch("https://snapshot/read", {
          method: "POST",
          body: JSON.stringify({ tableName, documentId }),
        });
        const value = await response.json();
        if (!value.ok) throw Object.assign(new Error(value.message), { name: value.name });
        return value.result;
      },
    };
    try {
      const result = await Reflect.apply(
        FlarexPointQueryInternalCallExactRuntimeV1.prototype.run,
        {},
        [input, capability],
      );
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({ ok: false, name: error?.name, message: error?.message });
    }
  },
};`;
}

function serializeRequest(request: Parameters<
  ApplicationPointQuerySystemLiveV1["dispatcher"]["dispatch"]
>[1]) {
  return {
    ...request,
    runtimeTargetSha256: Array.from(request.runtimeTargetSha256),
    context: {
      ...request.context,
      randomSeed: Array.from(request.context.randomSeed),
      snapshotCommitSeq: request.context.snapshotCommitSeq.toString(),
    },
  };
}

function dispatcherReason(name: string):
  ApplicationPointQueryRouteIndependentDispatcherV1Error["reason"] | undefined {
  if (name === "PointQueryInternalCallExactRuntimeInvalidRequestV1Error") {
    return "invalidRequest";
  }
  if (name === "PointQueryInternalCallExactRuntimeReadBoundaryV1Error") {
    return "readBoundary";
  }
  if (name === "PointQueryInternalCallExactRuntimeUserCodeV1Error") return "userCode";
  if (name === "PointQueryInternalCallExactRuntimeTerminalV1Error") {
    return "targetRejected";
  }
  if (name === "PointQueryInternalCallExactRuntimeWorkerDefinitionV1Error") {
    return "workerDefinition";
  }
  return undefined;
}

function dispatcherFailure(
  reason: ApplicationPointQueryRouteIndependentDispatcherV1Error["reason"],
  cause?: unknown,
) {
  return new ApplicationPointQueryRouteIndependentDispatcherV1Error({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

async function failsWithTag(
  effect: Effect.Effect<unknown, unknown>,
  tag: string,
): Promise<boolean> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return false;
  const failure = Cause.findErrorOption(exit.cause);
  const actual = Option.isSome(failure) && isRecord(failure.value) &&
      typeof failure.value._tag === "string"
    ? failure.value._tag
    : "<none>";
  if (actual !== tag) {
    throw new Error(`SAP05 expected ${tag}, observed ${actual}.`);
  }
  return true;
}

async function failsWithReason(
  effect: Effect.Effect<unknown, unknown>,
  tag: string,
  reason: string,
): Promise<boolean> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return false;
  const failure = Cause.findErrorOption(exit.cause);
  const value = Option.isSome(failure) ? failure.value : undefined;
  const actualTag = isRecord(value) && typeof value._tag === "string"
    ? value._tag
    : "<none>";
  const actualReason = isRecord(value) && typeof value.reason === "string"
    ? value.reason
    : "<none>";
  if (actualTag !== tag || actualReason !== reason) {
    throw new Error(
      `SAP05 expected ${tag}/${reason}, observed ${actualTag}/${actualReason}.`,
    );
  }
  return true;
}

function makeAsyncGate(): Readonly<{
  readonly started: Promise<void>;
  readonly wait: () => Promise<void>;
  readonly release: () => void;
}> {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return Object.freeze({
    started,
    wait: async () => {
      markStarted();
      await released;
    },
    release,
  });
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireTrue(value: boolean, label: string): true {
  if (!value) throw new Error(`SAP05 did not prove ${label}.`);
  return true;
}

async function mutationPublicationCounts(persistence: Persistence) {
  const result = await persistence.query<{
    app_rows: string;
    journals: string;
    journal_points: string;
    outcomes: string;
    commits: string;
    changes: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_app_row_rev) as app_rows,
    (select count(*)::text from fx_system_tx_journal) as journals,
    (select count(*)::text from fx_system_tx_journal_point) as journal_points,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_commit_app_row_change) as changes,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = result.rows[0];
  if (row === undefined) throw new Error("SAP05 publication counts are missing.");
  return row;
}

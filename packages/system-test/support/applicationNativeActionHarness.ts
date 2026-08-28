import { createHash } from "node:crypto";

import {
  createLocatedApplicationActionAuthorityTargetV1,
  admitApplicationAuthorityActionInvocation,
  claimApplicationAuthorityActionExecution,
  requestApplicationAuthorityActionCancellation,
} from "@flarex/persistence-postgres/internal/application-action-authority-v1";
import { selectApplicationActionAdmission } from
  "@flarex/persistence-postgres/internal/application-action-admission";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  ApplicationActionSystem,
  invokeApplicationAction,
  makeApplicationActionSystemLayer,
  type ApplicationActionSystemLive,
} from
  "@flarex/standard-application-invocation/internal/application-action-system";
import {
  makeExecutionEvidenceBodyStoreV1,
  type ExecutionEvidenceBodyR2BucketV1,
} from "flarex-backend/internal/execution-evidence-body-r2-v1";
import {
  APPLICATION_RUNTIME_HOST_IDENTITY,
} from "flarex-backend/artifact-runtime";
import { makeApplicationActionRunner } from
  "flarex-backend/internal/application-action-runner";
import { makeApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";
import { ApplicationExecutionHostError } from
  "flarex-backend/internal/application-execution-host";
import { ApplicationAnalysisSourceReadError } from
  "flarex-backend/internal/application-analysis-source-reader";
import { Effect, Fiber, Result, Scope } from "effect";
import {
  ExecutionEvidenceProtocolV1Error,
  EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1,
  encodeApplicationActionInvocationRequestV2,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  APPLICATION_WORKER_RESULT_FORMAT_V1,
  APPLICATION_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/application-worker-v1";
import {
  EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
  EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
  EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
  EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
  EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
  encodeEdgeActionHostPolicyV1,
} from "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  decodeCanonicalFlarexValueEvidenceV1,
  canonicalizeFlarexValueV1,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";
import { bytesEqualFullScan } from "@flarex/utils/bytes";

const COMPATIBILITY_DATE = "2026-06-14";
const ACTION_PATH = TransactionFunctionPathV1Schema.make("users:notify");

export interface ApplicationNativeActionProof {
  readonly completed: true;
  readonly exactReplay: true;
  readonly conflictingReuseRejected: true;
  readonly headMovementBeforeAdmissionRejected: true;
  readonly exactReplayAfterHeadMovement: true;
  readonly admittedHeadStayedPinned: true;
  readonly staleAdmittedResumeFailedClosed: true;
  readonly cancelledReplay: true;
  readonly expiredExecutionRecovered: true;
  readonly interruptionWaitedForCleanup: true;
  readonly legacyAccesses: 0;
  readonly freshDistinctDispatches: true;
  readonly childMutationConfirmed: true;
  readonly outboundConfirmed: true;
  readonly outboundUncertain: true;
  readonly structuredApplicationError: true;
  readonly terminalFailure: true;
  readonly dispatches: number;
}

export type ApplicationNativeActionFixtureFactory = () => Promise<
  ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
>;

export interface ApplicationNativeActionTestLayerOptions {
  readonly callbackSystem: ApplicationActionSystemLive["host"]["callbackSystem"];
  readonly outboundHost: ApplicationActionSystemLive["host"]["outboundHost"];
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly onExecution?: () => void;
}

/**
 * Test-owned composition for the current Application Action System. The
 * caller supplies only callback and controlled-outbound ports; admission,
 * durable lifecycle, evidence, Source Artifact loading, and Worker execution
 * remain with their existing owners.
 */
export function makeApplicationNativeActionTestLayer(
  fixture: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
  loader: WorkerLoader,
  options: ApplicationNativeActionTestLayerOptions,
) {
  const bodyStore = makeExecutionEvidenceBodyStoreV1(
    new MemoryEvidenceBucket(),
    { hash: bytes => Effect.sync(() => sha256(bytes)) },
    {
      verify: (kind, bytes) =>
        kind === "outbound_http_request" ||
            kind === "outbound_http_response"
          ? Effect.void
          : verifyCanonicalValue(bytes),
    },
  );
  const hostPolicy = applicationHostPolicy(options.allowedOrigins);
  const hostPolicySha256 = sha256(policyBytes(hostPolicy));
  const runner = makeApplicationActionRunner({
    source: Object.freeze({
      read: (rootSha256: string) =>
        rootSha256 === fixture.source.sourceArtifact.rootSha256
          ? Effect.succeed(fixture.source)
          : Effect.fail(new ApplicationAnalysisSourceReadError({
              operation: "read",
              reason: "invalidRoot",
            })),
    }),
    host: makeApplicationExecutionHost(loader),
    hostPolicy,
    hostPolicySha256,
    sha256: bytes => Effect.sync(() => sha256(bytes)),
  });
  const actionAuthority = Object.freeze({
    target: createLocatedApplicationActionAuthorityTargetV1(
      fixture.target.drizzle,
      fixture.active.basis.authority.physicalLocator,
    ),
    authority: fixture.active.basis.authority,
    sha256: Object.freeze({
      hash: (bytes: Uint8Array) => Effect.sync(() => sha256(bytes)),
    }),
  });
  let invocationSequence = 0;
  return makeApplicationActionSystemLayer({
    activation: fixture.activation,
    admission: Object.freeze({
      deploymentId: fixture.deploymentId,
      controlDb: fixture.control.drizzle,
      schema: fixture.schema,
      authority: fixture.authorityPorts,
    }),
    host: Object.freeze({
      evidence: Object.freeze({
        bodyStore,
        bodyBudget: Object.freeze({
          maximumBodyBytes: 1_048_576,
          maximumHashBytes: 1_048_576,
        }),
        authority: actionAuthority,
      }),
      effectRunner: Object.freeze({ runPromise: Effect.runPromise }),
      callbackSystem: options.callbackSystem,
      outboundHost: options.outboundHost,
      hostPolicy,
      runner: Object.freeze({
        run: (input: Parameters<typeof runner.run>[0]) =>
          Effect.sync(() => options.onExecution?.()).pipe(
            Effect.andThen(runner.run(input)),
        ),
      }),
    }),
    hostPolicyEncodingBudget: Object.freeze({
      maximumOrigins: 1_024,
      maximumOriginBytes: 8_192,
      maximumCanonicalBytes: 1_048_576,
    }),
    executionContextFactory: () => {
      invocationSequence += 1;
      return Object.freeze({
        invocationId:
          `36000000-0000-4000-8000-${invocationSequence.toString().padStart(12, "0")}`,
        executionDurationMilliseconds: 60_000,
        randomSeed: new Uint8Array(32).fill(invocationSequence),
        auth: Object.freeze({ kind: "anonymous" as const }),
      });
    },
  } satisfies ApplicationActionSystemLive);
}

export async function proveApplicationNativeAction(
  createFixture: ApplicationNativeActionFixtureFactory = () =>
    createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
    }),
): Promise<
  ApplicationNativeActionProof
> {
  const fixture = await createFixture();
  const bodyStore = makeExecutionEvidenceBodyStoreV1(
    new MemoryEvidenceBucket(),
    { hash: bytes => Effect.sync(() => sha256(bytes)) },
    {
      verify: (kind, bytes) =>
        kind === "outbound_http_request" ||
            kind === "outbound_http_response"
          ? Effect.void
          : verifyCanonicalValue(bytes),
    },
  );
  const hostPolicy = applicationHostPolicy();
  const hostPolicyCanonicalBytes = policyBytes(hostPolicy);
  const worker = new ConnectedActionWorkerLoader();
  let invocationSequence = 0;
  let authorityHashGate: DeferredGate | undefined;
  let callbackGate: DeferredGate | undefined;
  const actionAuthority = Object.freeze({
    target: createLocatedApplicationActionAuthorityTargetV1(
      fixture.target.drizzle,
      fixture.active.basis.authority.physicalLocator,
    ),
    authority: fixture.active.basis.authority,
    sha256: Object.freeze({
      hash: (bytes: Uint8Array) => Effect.promise(async () => {
        const gate = authorityHashGate;
        if (
          gate !== undefined &&
          !bytesEqualFullScan(bytes, hostPolicyCanonicalBytes)
        ) {
          authorityHashGate = undefined;
          gate.started.resolve(undefined);
          await gate.release.promise;
        }
        return sha256(bytes);
      }),
    }),
  });
  const live = Object.freeze({
    activation: fixture.activation,
    admission: Object.freeze({
      deploymentId: fixture.deploymentId,
      controlDb: fixture.control.drizzle,
      schema: fixture.schema,
      authority: fixture.authorityPorts,
    }),
    host: Object.freeze({
      evidence: Object.freeze({
        bodyStore,
        bodyBudget: Object.freeze({
          maximumBodyBytes: 1_048_576,
          maximumHashBytes: 1_048_576,
        }),
        authority: actionAuthority,
      }),
      effectRunner: Object.freeze({ runPromise: Effect.runPromise }),
      callbackSystem: Object.freeze({
        runQuery: async () => ({ queried: true }),
        runMutation: async () => {
          const gate = callbackGate;
          if (gate !== undefined) {
            callbackGate = undefined;
            gate.started.resolve(undefined);
            await gate.release.promise;
          }
          return { childMutation: true };
        },
      }),
      outboundHost: Object.freeze({
        fetch: async (_request: Request) => {
          worker.outboundCalls += 1;
          if (worker.outboundFailure) {
            worker.outboundFailures += 1;
            throw new Error("injected outbound uncertainty");
          }
          return new Response(JSON.stringify({ accepted: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      }),
      hostPolicy,
      runner: makeApplicationActionRunner({
        source: Object.freeze({
          read: (rootSha256: string) => rootSha256 === fixture.source.sourceArtifact.rootSha256
            ? Effect.succeed(fixture.source)
            : Effect.die("Application action requested the wrong source root."),
        }),
        host: makeApplicationExecutionHost(worker),
        hostPolicy,
        hostPolicySha256: sha256(hostPolicyCanonicalBytes),
        sha256: bytes => Effect.sync(() => sha256(bytes)),
      }),
    }),
    hostPolicyEncodingBudget: Object.freeze({
      maximumOrigins: 1_024,
      maximumOriginBytes: 8_192,
      maximumCanonicalBytes: 1_048_576,
    }),
    executionContextFactory: () => {
      invocationSequence += 1;
      return Object.freeze({
        invocationId: `36000000-0000-4000-8000-${invocationSequence.toString().padStart(12, "0")}`,
        executionDurationMilliseconds: 60_000,
        randomSeed: new Uint8Array(32).fill(invocationSequence),
        auth: Object.freeze({ kind: "anonymous" as const }),
      });
    },
  }) satisfies ApplicationActionSystemLive;
  const layer = makeApplicationActionSystemLayer(live);
  const invoke = <A, E>(effect: Effect.Effect<
    A,
    E,
    ApplicationActionSystem | Scope.Scope
  >) => Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(layer))));

  const policy = Result.getOrThrow(encodeEdgeActionHostPolicyV1(
    hostPolicy,
    live.hostPolicyEncodingBudget,
  ));
  const auth = await canonicalizeFlarexValueV1({ kind: "anonymous" });
  const prepareManualAdmission = async (
    requestKey: ReturnType<typeof TransactionRequestKeyV1Schema.make>,
    message: string,
  ) => {
    const active = await Effect.runPromise(fixture.activation.readActive());
    const admission = await Effect.runPromise(
      selectApplicationActionAdmission(
        active.selection,
        ACTION_PATH,
        live.admission,
      ),
    );
    const args = await canonicalizeFlarexValueV1({ message });
    const argumentsReference = await Effect.runPromise(
      bodyStore.putImmutable(
        "action_arguments",
        args.canonicalBytes,
        live.host.evidence.bodyBudget,
      ),
    );
    const request = Result.getOrThrow(
      encodeApplicationActionInvocationRequestV2({
        scopeId: admission.basis.authority.scopeId,
        requestKey,
        executionAuthoritySha256: admission.executionAuthority.sha256,
        actionFunctionPath: ACTION_PATH,
        executionIdentitySha256: auth.sha256,
        compatibilityDate: admission.basis.compatibilityDate,
        hostPolicySha256: sha256(policy.canonicalBytes),
        arguments: argumentsReference,
      }),
    );
    return Object.freeze({ admission, request });
  };

  const beforeAdmissionLoads = worker.loads;
  const headRaceGate = deferredGate();
  authorityHashGate = headRaceGate;
  const headRace = invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "head-before-admission" },
    TransactionRequestKeyV1Schema.make(
      "application-native-action:head-before-admission",
    ),
  ));
  await headRaceGate.started.promise;
  await fixture.moveHead();
  headRaceGate.release.resolve(undefined);
  let headMovementBeforeAdmissionRejected = false;
  try {
    await headRace;
  } catch (cause) {
    headMovementBeforeAdmissionRejected = failureTag(cause) ===
      "ApplicationActionAuthorityStaleV1Error";
  }
  if (
    !headMovementBeforeAdmissionRejected || worker.loads !== beforeAdmissionLoads
  ) {
    throw new Error(
      "Application action admitted a selection after its head moved.",
    );
  }

  const staleResumeKey = TransactionRequestKeyV1Schema.make(
    "application-native-action:stale-resume",
  );
  const stalePrepared = await prepareManualAdmission(staleResumeKey, "stale");
  await Effect.runPromise(admitApplicationAuthorityActionInvocation({
    selection: stalePrepared.admission.selection,
    request: stalePrepared.request,
    executionAuthority: stalePrepared.admission.executionAuthority,
    invocationId: "36000000-0000-4000-8000-000000000900",
  }, actionAuthority));

  worker.mode = "child";
  const firstKey = TransactionRequestKeyV1Schema.make(
    "application-native-action:first",
  );
  const first = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "hello" },
    firstKey,
  ));
  if (first.status !== "completed" || first.disposition !== "published") {
    throw new Error("Application-native action did not complete.");
  }
  const loadsAfterFirst = worker.loads;
  const replay = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "hello" },
    firstKey,
  ));
  const exactReplay = replay.status === "completed" &&
    replay.disposition === "replayed" &&
    worker.loads === loadsAfterFirst;
  if (!exactReplay) {
    throw new Error("Application-native action replay loaded another runner.");
  }
  let conflictingReuseRejected = false;
  try {
    await invoke(invokeApplicationAction(
      ACTION_PATH,
      { message: "different" },
      firstKey,
    ));
  } catch (cause) {
    conflictingReuseRejected = failureTag(cause) ===
      "ApplicationActionRequestKeyConflictV1Error";
  }
  if (!conflictingReuseRejected) {
    throw new Error("Application-native action accepted conflicting key reuse.");
  }

  const cancelledKey = TransactionRequestKeyV1Schema.make(
    "application-native-action:cancelled",
  );
  const cancelledPrepared = await prepareManualAdmission(
    cancelledKey,
    "cancelled",
  );
  await Effect.runPromise(admitApplicationAuthorityActionInvocation({
    selection: cancelledPrepared.admission.selection,
    request: cancelledPrepared.request,
    executionAuthority: cancelledPrepared.admission.executionAuthority,
    invocationId: "36000000-0000-4000-8000-000000000901",
  }, actionAuthority));
  await Effect.runPromise(requestApplicationAuthorityActionCancellation(
    cancelledKey,
    actionAuthority,
  ));
  const loadsBeforeCancelledReplay = worker.loads;
  const cancelled = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "cancelled" },
    cancelledKey,
  ));
  const cancelledReplay = cancelled.status === "notCompleted" &&
    cancelled.lifecycle === "cancelled" &&
    cancelled.disposition === "replayed" &&
    worker.loads === loadsBeforeCancelledReplay;
  if (!cancelledReplay) {
    throw new Error("Cancelled Application action did not replay terminally.");
  }

  const expiredKey = TransactionRequestKeyV1Schema.make(
    "application-native-action:expired",
  );
  const expiredPrepared = await prepareManualAdmission(expiredKey, "expired");
  await Effect.runPromise(admitApplicationAuthorityActionInvocation({
    selection: expiredPrepared.admission.selection,
    request: expiredPrepared.request,
    executionAuthority: expiredPrepared.admission.executionAuthority,
    invocationId: "36000000-0000-4000-8000-000000000902",
  }, actionAuthority));
  await Effect.runPromise(claimApplicationAuthorityActionExecution(
    expiredKey,
    60_000,
    sha256(new Uint8Array([1])),
    actionAuthority,
  ));
  await fixture.target.query(
    `update fx_system_application_action_invocation_v1
        set invocation_time = current_timestamp - interval '2 seconds',
            execution_deadline = current_timestamp - interval '1 second'
      where scope_id = $1 and request_key = $2`,
    [fixture.active.basis.authority.scopeId, expiredKey],
  );
  worker.mode = "success";
  const loadsBeforeExpiredRecovery = worker.loads;
  const expired = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "expired" },
    expiredKey,
  ));
  const expiredExecutionRecovered = expired.status === "completed" &&
    worker.loads === loadsBeforeExpiredRecovery + 1;
  if (!expiredExecutionRecovered) {
    throw new Error("Expired Application action did not recover and dispatch.");
  }

  worker.mode = "outbound";
  const outbound = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "outbound" },
    TransactionRequestKeyV1Schema.make("application-native-action:outbound"),
  ));
  if (outbound.status !== "completed") {
    throw new Error("Application-native confirmed outbound action failed.");
  }
  worker.outboundFailure = true;
  const uncertain = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "uncertain" },
    TransactionRequestKeyV1Schema.make("application-native-action:uncertain"),
  ));
  worker.outboundFailure = false;
  if (uncertain.status !== "notCompleted" || uncertain.lifecycle !== "uncertain") {
    throw new Error(
      `Application-native outbound uncertainty was not durable: ${JSON.stringify(uncertain)}; mode=${worker.lastMode}; calls=${worker.outboundCalls}; failures=${worker.outboundFailures}.`,
    );
  }

  worker.mode = "success";
  const headKey = TransactionRequestKeyV1Schema.make(
    "application-native-action:head-move",
  );
  worker.blockNext = true;
  const blocked = invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "head" },
    headKey,
  ));
  await worker.started.promise;
  await fixture.moveHead();
  worker.release.resolve(undefined);
  const pinned = await blocked;
  if (pinned.status !== "completed") {
    throw new Error("Admitted Application action did not retain its target.");
  }
  const replayedAfterHeadMove = await Effect.runPromise(
    admitApplicationAuthorityActionInvocation({
      selection: stalePrepared.admission.selection,
      request: stalePrepared.request,
      executionAuthority: stalePrepared.admission.executionAuthority,
      invocationId: "36000000-0000-4000-8000-000000000903",
    }, actionAuthority),
  );
  const exactReplayAfterHeadMovement = replayedAfterHeadMove.disposition ===
    "replayed";
  if (!exactReplayAfterHeadMovement) {
    throw new Error("Exact Application action replay depended on current head.");
  }
  const loadsBeforeStaleResume = worker.loads;
  const staleResume = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "stale" },
    staleResumeKey,
  ));
  const staleAdmittedResumeFailedClosed = staleResume.status ===
      "notCompleted" && staleResume.lifecycle === "admitted" &&
    staleResume.disposition === "replayed" &&
    worker.loads === loadsBeforeStaleResume;
  if (!staleAdmittedResumeFailedClosed) {
    throw new Error("Stale admitted Application action did not fail closed.");
  }
  const distinctKey = TransactionRequestKeyV1Schema.make(
    "application-native-action:distinct",
  );
  const distinct = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "fresh" },
    distinctKey,
  ));
  const freshDistinctDispatches = distinct.status === "completed" &&
    worker.loads === loadsBeforeStaleResume + 1;
  if (!freshDistinctDispatches) {
    throw new Error("Distinct Application action did not dispatch freshly.");
  }

  worker.mode = "child";
  const cleanupGate = deferredGate();
  callbackGate = cleanupGate;
  let interruptionCompleted = false;
  const interruptionWaitedForCleanup = await Effect.runPromise(Effect.scoped(
    Effect.gen(function* () {
      const invocationFiber = yield* Effect.forkScoped(
        invokeApplicationAction(
          ACTION_PATH,
          { message: "interrupt" },
          TransactionRequestKeyV1Schema.make(
            "application-native-action:interrupt",
          ),
        ).pipe(Effect.provide(layer)),
      );
      yield* Effect.promise(() => cleanupGate.started.promise);
      const interruptionFiber = yield* Effect.forkChild(
        Fiber.interrupt(invocationFiber).pipe(Effect.tap(() =>
          Effect.sync(() => { interruptionCompleted = true; })
        )),
      );
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      if (interruptionCompleted) {
        return yield* Effect.die(
          "Application action interruption escaped before callback cleanup.",
        );
      }
      cleanupGate.release.resolve(undefined);
      yield* Fiber.join(interruptionFiber);
      return interruptionCompleted;
    }),
  ));
  if (!interruptionWaitedForCleanup) {
    throw new Error("Application action interruption did not finish cleanup.");
  }

  const effects = await fixture.target.query<{
    effect_kind: string;
    state: string;
  }>(`select effect_kind, state
        from fx_system_external_effect_attempt_v1
       order by effect_ordinal`);
  const childMutationConfirmed = effects.rows.some(row =>
    row.effect_kind === "child_mutation" && row.state === "confirmed"
  );
  const outboundConfirmed = effects.rows.some(row =>
    row.effect_kind === "outbound_http" && row.state === "confirmed"
  );
  const outboundUncertain = effects.rows.some(row =>
    row.effect_kind === "outbound_http" && row.state === "uncertain"
  );
  if (!childMutationConfirmed || !outboundConfirmed || !outboundUncertain) {
    throw new Error("Application-native action effects were not durable.");
  }
  worker.mode = "applicationError";
  const applicationError = await Effect.runPromise(Effect.scoped(Effect.flip(
    invokeApplicationAction(
      ACTION_PATH,
      { message: "application-error" },
      TransactionRequestKeyV1Schema.make(
        "application-native-action:application-error",
      ),
    ).pipe(Effect.provide(layer)),
  )));
  const structuredApplicationError = applicationError instanceof
      ApplicationExecutionHostError &&
    applicationError.reason === "applicationError" &&
    applicationError.applicationError?.code === "CLOSED";
  if (!structuredApplicationError) {
    throw new Error("Structured Application action error was not preserved.");
  }
  worker.mode = "terminalFailure";
  const terminal = await invoke(invokeApplicationAction(
    ACTION_PATH,
    { message: "terminal" },
    TransactionRequestKeyV1Schema.make("application-native-action:terminal"),
  ));
  const terminalFailure = terminal.status === "notCompleted" &&
    terminal.lifecycle === "failed" && terminal.disposition === "settled";
  if (!terminalFailure) {
    throw new Error("Application-native action terminal failure was not durable.");
  }
  return Object.freeze({
    completed: true,
    exactReplay: true,
    conflictingReuseRejected: true,
    headMovementBeforeAdmissionRejected: true,
    exactReplayAfterHeadMovement: true,
    admittedHeadStayedPinned: true,
    staleAdmittedResumeFailedClosed: true,
    cancelledReplay: true,
    expiredExecutionRecovered: true,
    interruptionWaitedForCleanup: true,
    legacyAccesses: 0,
    freshDistinctDispatches: true,
    childMutationConfirmed: true,
    outboundConfirmed: true,
    outboundUncertain: true,
    structuredApplicationError: true,
    terminalFailure: true,
    dispatches: worker.loads,
  });
}

class ConnectedActionWorkerLoader implements WorkerLoader {
  mode:
    | "success"
    | "child"
    | "outbound"
    | "applicationError"
    | "terminalFailure" = "success";
  outboundFailure = false;
  outboundCalls = 0;
  outboundFailures = 0;
  blockNext = false;
  loads = 0;
  started = deferred<void>();
  release = deferred<void>();
  lastMode: ConnectedActionWorkerLoader["mode"] = "success";

  get(): WorkerStub {
    throw new Error("Application-native action forbids cached Worker loading.");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new ConnectedActionWorkerStub(this, code);
  }
}

class ConnectedActionWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: ConnectedActionWorkerLoader,
    private readonly code: WorkerLoaderWorkerCode,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(): Fetcher<T> {
    const owner = this.owner;
    return {
      run: async (_request: unknown, callback: unknown) => {
        owner.lastMode = owner.mode;
        if (owner.blockNext) {
          owner.blockNext = false;
          owner.started.resolve(undefined);
          await owner.release.promise;
        }
        if (owner.mode === "child") {
          const args = { name: "child" };
          await Reflect.apply(
            Reflect.get(callback as object, "invoke") as Function,
            callback,
            [{
              kind: "runMutation",
              ordinal: 1n,
              functionPath: "users:create",
              arguments: args,
              argumentSemanticBytes:
                normalizeFlarexValueV1(args).semanticSizeBytes,
            }],
          );
        }
        if (owner.mode === "outbound") {
          const outbound = this.code.globalOutbound;
          if (outbound === null || outbound === undefined) {
            throw new Error("Application action Worker received no outbound gateway.");
          }
          await outbound.fetch("https://api.example.com/action").catch(() => {});
        }
        if (owner.mode === "applicationError") {
          return disposableRpcEnvelope({
            kind: "applicationError",
            error: Object.freeze({
              code: "CLOSED",
              message: "closed",
              data: Object.freeze({ request: "application-native" }),
            }),
          });
        }
        if (owner.mode === "terminalFailure") {
          throw Object.assign(new Error("application terminal failure"), {
            name: "ApplicationWorkerUserCodeV1Error",
          });
        }
        return disposableRpcResult({ delivered: true });
      },
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application-native action does not load Durable Objects.");
  }
}

class MemoryEvidenceBucket implements ExecutionEvidenceBodyR2BucketV1 {
  readonly bodies = new Map<string, Uint8Array>();

  async put(key: string, value: ArrayBuffer): Promise<unknown> {
    if (this.bodies.has(key)) throw new Error("precondition");
    this.bodies.set(key, new Uint8Array(value.slice(0)));
    return {};
  }

  async get(key: string): Promise<unknown> {
    const bytes = this.bodies.get(key);
    if (bytes === undefined) return null;
    const copy = bytes.slice();
    return Object.freeze({
      size: copy.byteLength,
      arrayBuffer: async () => copy.buffer.slice(0),
    });
  }
}

function verifyCanonicalValue(bytes: Uint8Array) {
  return Effect.tryPromise({
    try: async () => {
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({
        canonicalBytes: bytes,
        sha256: sha256(bytes),
      });
      if (!bytesEqualFullScan(decoded.canonicalBytes, bytes)) {
        throw new Error("noncanonical Application action body");
      }
    },
    catch: () => new ExecutionEvidenceProtocolV1Error({
      identity: EXECUTION_EVIDENCE_BODY_STORE_IDENTITY_V1,
      operation: "decode",
      reason: "nonCanonical",
      path: "$body",
    }),
  });
}

function applicationHostPolicy(
  allowedOrigins: ReadonlyArray<string> = ["https://api.example.com"],
) {
  return Object.freeze({
    identity: EDGE_ACTION_HOST_POLICY_IDENTITY_V1,
    exactRuntimeProfile: EDGE_ACTION_EXACT_RUNTIME_PROFILE_V1,
    syscallAbiIdentity: EDGE_ACTION_EXACT_RUNTIME_SYSCALL_ABI_V1,
    outboundGatewayIdentity: EDGE_ACTION_OUTBOUND_GATEWAY_IDENTITY_V1,
    callbackBridgeIdentity: EDGE_ACTION_CALLBACK_BRIDGE_IDENTITY_V1,
    allowedOrigins: Object.freeze([...allowedOrigins]),
    cpuMilliseconds: 1_000,
    wallMilliseconds: 60_000,
    maximumSyscalls: 64,
    maximumOutboundRequests: 16,
    maximumConcurrentOutboundRequests: 4,
    maximumWorkerSubrequests: 64,
    maximumArgumentBytes: 1_048_576,
    maximumResultBytes: 1_048_576,
    maximumCallbackArgumentBytes: 1_048_576,
    maximumCallbackResultBytes: 1_048_576,
    maximumUrlBytes: 8_192,
    maximumMethodBytes: 32,
    maximumHeaderCount: 128,
    maximumHeaderBytes: 65_536,
    maximumStatusTextBytes: 1_024,
    maximumOutboundRequestBodyBytes: 1_048_576,
    maximumOutboundResponseBodyBytes: 8_388_608,
    maximumCumulativeOutboundBodyBytes: 16_777_216,
    cleanupDrainMilliseconds: 5_000,
    allowRunQuery: true,
    allowRunMutation: true,
    allowRunAction: false,
    allowRedirects: false,
    allowStreaming: false,
    allowAmbientCredentials: false,
    fixedInvocationTime: true,
    deterministicRandom: true,
    allowNondeterministicCrypto: false,
  });
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function policyBytes(
  policy: ReturnType<typeof applicationHostPolicy>,
): Uint8Array {
  return Result.getOrThrow(encodeEdgeActionHostPolicyV1(policy, {
    maximumOrigins: 1_024,
    maximumOriginBytes: 8_192,
    maximumCanonicalBytes: 1_048_576,
  })).canonicalBytes;
}

function disposableRpcResult(value: unknown): object {
  return disposableRpcEnvelope({ value });
}

function disposableRpcEnvelope(
  fields: Readonly<Record<string, unknown>>,
): object {
  const result = {
    format: APPLICATION_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_WORKER_RESULT_VERSION_V1,
    ...fields,
  };
  Object.defineProperty(result, Symbol.dispose, {
    value: () => undefined,
  });
  return result;
}

function failureTag(cause: unknown): string | undefined {
  return cause !== null && typeof cause === "object" &&
      typeof Reflect.get(cause, "_tag") === "string"
    ? Reflect.get(cause, "_tag") as string
    : undefined;
}

interface Deferred<A> {
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
}

interface DeferredGate {
  readonly started: Deferred<void>;
  readonly release: Deferred<void>;
}

function deferred<A>(): Deferred<A> {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>(accept => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

function deferredGate(): DeferredGate {
  return Object.freeze({ started: deferred<void>(), release: deferred<void>() });
}

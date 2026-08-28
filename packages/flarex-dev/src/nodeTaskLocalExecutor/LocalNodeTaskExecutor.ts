import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";

import type { TaskInputStore } from "flarex-backend/internal/task-input-store";
import {
  NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1,
  NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
  NODE_TASK_CALLBACK_REQUEST_FORMAT_V1,
  NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1,
  NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1,
  NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
  NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
  NODE_TASK_EXECUTOR_START_FORMAT_V1,
  authenticateNodeTaskExecutorStartRequestV1,
  decodeNodeTaskCallbackAttachmentV1,
  decodeNodeTaskExecutorInterruptionRequestV1,
  decodeNodeTaskExecutorRecoveryRequestV1,
  makeNodeTaskCallbackRequestIdV1,
  makeNodeTaskExecutorSettlementV1,
  nodeTaskExecutorStartRequestEquivalencePreimageV1,
  nodeTaskExecutorStartRequestsEquivalentV1,
  NodeTaskExecutorClientError,
  type NodeTaskCallbackAttachmentV1,
  type NodeTaskCallbackResponseV1,
  type NodeTaskExecutorAcceptanceV1,
  type NodeTaskExecutorCallbackChannel,
  type NodeTaskExecutorClientApi,
  type NodeTaskExecutorRecoveryResult,
  type NodeTaskExecutorRecoveryRequestV1,
  type NodeTaskExecutorSession,
  type NodeTaskExecutorSettlementV1,
  type NodeTaskExecutorStartRequestV1,
  type NodeTaskExecutorStartResult,
} from "flarex-backend/internal/node-task-executor";
import {
  decodeNodeTaskRuntimeArtifactPreimageV1,
  type NodeTaskRuntimeArtifactObjectReferenceV1,
  type NodeTaskRuntimeArtifactV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  Data,
  Effect,
  Layer,
  ManagedRuntime,
  Result,
  Scope,
  Semaphore,
} from "effect";
import {
  APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
  APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
  normalizeApplicationTaskMutationCallbackValueV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import {
  APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
  APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
  normalizeApplicationTaskQueryCallbackValueV1,
} from "flarex-protocol/internal/application-task-query-callback-v1";
import { normalizeApplicationTaskWorkerValueV1 } from
  "flarex-protocol/internal/application-task-worker-v1";

import { LOCAL_NODE_TASK_BOOTSTRAP } from "./bootstrap.js";

export interface LocalNodeTaskArtifactStore {
  readonly readBundle: (
    reference: NodeTaskRuntimeArtifactObjectReferenceV1,
  ) => Effect.Effect<Uint8Array, unknown>;
}

export interface LocalNodeTaskExecutorOptions {
  readonly artifactStore: LocalNodeTaskArtifactStore;
  readonly inputStore: Pick<TaskInputStore, "read">;
  readonly nodeExecutable?: string;
}

export interface LocalNodeTaskExecutorSnapshot {
  readonly activeProcessCount: number;
  readonly liveExecutionCount: number;
  readonly processIds: ReadonlyArray<number>;
  readonly retiredExecutionCount: number;
  readonly startKeys: ReadonlyArray<string>;
}

export interface LocalNodeTaskExecutorControl {
  readonly loseNextStartResponse: Effect.Effect<void>;
  readonly dropNextCallbackResponse: Effect.Effect<void>;
  readonly terminate: (startKey: string) => Effect.Effect<boolean>;
  readonly snapshot: Effect.Effect<LocalNodeTaskExecutorSnapshot>;
}

export interface LocalNodeTaskExecutorBundle {
  /**
   * Returns a fresh stateless Task-host client view over the provider-owned
   * execution lookup. Recreating the provider itself is provider loss.
   */
  readonly makeClient: () => NodeTaskExecutorClientApi;
  readonly control: LocalNodeTaskExecutorControl;
}

export class LocalNodeTaskExecutorHostError extends Data.TaggedError(
  "LocalNodeTaskExecutorHostError",
)<{
  readonly operation: "artifact" | "input" | "spawn" | "protocol";
  readonly cause?: unknown;
}> {}

export interface LocalNodeTaskBundleModule {
  readonly path: string;
  readonly source: string;
}

interface LocalBundle {
  readonly modules: ReadonlyArray<LocalNodeTaskBundleModule>;
}

interface ProviderState {
  readonly executions: Map<string, LocalExecution | RetiredExecution>;
  nextSessionOrdinal: number;
  loseNextStartResponse: boolean;
  dropNextCallbackResponse: boolean;
  closed: boolean;
}

type LocalInterruptionDecision =
  | "interruption_requested"
  | "stale_generation"
  | "conflict"
  | "session_lost";

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const localAbi = `nodejs-${process.versions.node.split(".")[0]}-${process.platform}-${process.arch}`;

/**
 * Scoped development/system-test provider. This is process separation for
 * trusted fixtures, not a hardened hostile-code sandbox or production host.
 */
export const makeLocalNodeTaskExecutor = Effect.fn(
  "LocalNodeTaskExecutor.make",
)(function* (
  options: LocalNodeTaskExecutorOptions,
): Effect.fn.Return<LocalNodeTaskExecutorBundle, never, Scope.Scope> {
  const state: ProviderState = {
    executions: new Map(),
    nextSessionOrdinal: 1,
    loseNextStartResponse: false,
    dropNextCallbackResponse: false,
    closed: false,
  };
  const sha256 = (bytes: Uint8Array) => Effect.sync(() =>
    new Uint8Array(createHash("sha256").update(bytes).digest())
  );
  const startGate = Semaphore.makeUnsafe(1);
  const callbackRuntime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(Layer.empty)),
    runtime => Effect.promise(() => runtime.dispose()),
  );

  const startUngated: NodeTaskExecutorClientApi["start"] = Effect.fn(
    "LocalNodeTaskExecutor.start",
  )(requestInput => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    if (state.closed) return yield* clientError("start", "clientClosed", false);
    const request = yield* restore(authenticateNodeTaskExecutorStartRequestV1(
      requestInput,
      sha256,
    )).pipe(Effect.mapError(cause => clientError(
      "start", "invalidRequest", false, cause,
    )));
    pruneExpiredRetiredExecutions(state, Date.now());
    const existing = state.executions.get(request.startKey);
    if (existing !== undefined) {
      const matches = existing.kind === "live"
        ? nodeTaskExecutorStartRequestsEquivalentV1(existing.request, request)
        : existing.requestFingerprint === startRequestFingerprint(request);
      if (!matches) {
        return yield* clientError("start", "idempotencyConflict", false);
      }
      return existing.kind === "live"
        ? yield* acquireAccepted(existing)
        : yield* acquireRetiredAccepted(existing);
    }
    if (Date.now() >= Math.min(
      request.absoluteDeadlineEpochMilliseconds,
      request.launchCapability.expiresAtEpochMilliseconds,
    )) {
      return rejected(request, "deadline_expired", false);
    }
    if (state.executions.size >= MAX_TRACKED_EXECUTIONS) {
      return rejected(request, "capacity_unavailable", true);
    }
    const artifactResult = decodeNodeTaskRuntimeArtifactPreimageV1(
      request.nodeArtifactCanonicalBytes,
    );
    if (Result.isFailure(artifactResult)) {
      return rejected(request, "artifact_incompatible", false);
    }
    const artifact = artifactResult.success;
    if (!isLocallyCompatible(artifact)) {
      return rejected(request, "artifact_incompatible", false);
    }
    const bundleBytes = yield* restore(options.artifactStore.readBundle(
      artifact.bundle,
    )).pipe(
      Effect.mapError(cause => new LocalNodeTaskExecutorHostError({
        operation: "artifact", cause,
      })),
      Effect.result,
    );
    if (Result.isFailure(bundleBytes)) {
      return rejected(request, "artifact_unavailable", true);
    }
    const localBundle = yield* Effect.fromResult(decodeAndVerifyBundle(
      bundleBytes.success,
      artifact,
    )).pipe(Effect.result);
    if (Result.isFailure(localBundle)) {
      return rejected(request, "artifact_incompatible", false);
    }
    const storedInput = yield* restore(options.inputStore.read(request.input))
      .pipe(Effect.result);
    const input = Result.isSuccess(storedInput)
      ? storedInput.success.value
      : undefined;
    const inputFailure = Result.isFailure(storedInput);
    const acceptance = makeAcceptance(request, state.nextSessionOrdinal);
    state.nextSessionOrdinal += 1;
    const execution = yield* spawnExecution({
      executable: options.nodeExecutable ?? process.execPath,
      request,
      acceptance,
      bundle: localBundle.success,
      executionPath: artifact.executionModule,
      entryPath: artifact.handler.artifactModulePath,
      exportName: artifact.handler.exportName,
      expectedNodeRuntimeAbiIdentity: artifact.nodeRuntimeAbiIdentity,
      input,
      inputFailure,
      runCallback: effect => callbackRuntime.runPromise(Effect.result(effect)),
      consumeDroppedCallbackResponse: () => {
        if (!state.dropNextCallbackResponse) return false;
        state.dropNextCallbackResponse = false;
        return true;
      },
      retire: (retiring, status, settlement) =>
        retireExecution(state, retiring, status, settlement),
    }).pipe(Effect.mapError(cause => clientError(
      "start", "transportBeforeAcceptance", true, cause,
    )));
    state.executions.set(request.startKey, execution);
    const abandonBeforeAcceptance = Effect.sync(() => {
      state.executions.delete(request.startKey);
    }).pipe(Effect.andThen(Effect.tryPromise({
      try: () => execution.abortBeforeAcceptance(),
      catch: cause => new LocalNodeTaskExecutorHostError({
        operation: "spawn",
        cause,
      }),
    })));
    const readiness = yield* restore(awaitExecutionReady(execution)).pipe(
      Effect.onInterrupt(() => abandonBeforeAcceptance),
      Effect.result,
    );
    if (Result.isFailure(readiness)) {
      const abandoned = yield* abandonBeforeAcceptance.pipe(Effect.result);
      return yield* clientError(
        "start",
        "transportBeforeAcceptance",
        true,
        Result.isFailure(abandoned) ? abandoned.failure : readiness.failure,
      );
    }
    if (state.loseNextStartResponse) {
      state.loseNextStartResponse = false;
      return yield* clientError(
        "start", "acceptanceUnknown", true, undefined, request.recoveryKey,
      );
    }
    return yield* acquireAccepted(execution);
  })));

  const recoverUngated: NodeTaskExecutorClientApi["recover"] = Effect.fn(
    "LocalNodeTaskExecutor.recover",
  )(requestInput => Effect.gen(function* () {
    if (state.closed) return yield* clientError(
      "recover", "clientClosed", false,
    );
    const decoded = decodeNodeTaskExecutorRecoveryRequestV1(requestInput);
    if (Result.isFailure(decoded)) {
      return yield* clientError("recover", "invalidRequest", false, decoded.failure);
    }
    const request = decoded.success;
    pruneExpiredRetiredExecutions(state, Date.now());
    const execution = state.executions.get(request.startKey);
    if (execution === undefined) return recoveryMissing(request);
    const correlates = execution.kind === "live"
      ? execution.correlatesRecovery(request)
      : retiredCorrelatesRecovery(execution, request);
    if (!correlates) {
      return yield* clientError("recover", "idempotencyConflict", false);
    }
    if (execution.kind === "retired") {
      if (execution.status !== "settled") return recoveryLost(request);
      const session = makeRetiredSession(execution);
      return Object.freeze({
        kind: "accepted" as const,
        response: Object.freeze({
          format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
          version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
          kind: "accepted" as const,
          acceptance: execution.acceptance,
        }),
        session,
      });
    }
    if (execution.isLost()) return recoveryLost(request);
    const accepted = yield* acquireSession(execution);
    return Object.freeze({
      kind: "accepted" as const,
      response: Object.freeze({
        format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
        version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
        kind: "accepted" as const,
        acceptance: execution.acceptance,
      }),
      session: accepted,
    });
  }));
  const start: NodeTaskExecutorClientApi["start"] = request =>
    startGate.withPermit(startUngated(request));
  const recover: NodeTaskExecutorClientApi["recover"] = request =>
    startGate.withPermit(recoverUngated(request));

  const makeClient = (): NodeTaskExecutorClientApi => Object.freeze({
    start,
    recover,
  });
  const control: LocalNodeTaskExecutorControl = Object.freeze({
    loseNextStartResponse: Effect.sync(() => {
      state.loseNextStartResponse = true;
    }),
    dropNextCallbackResponse: Effect.sync(() => {
      state.dropNextCallbackResponse = true;
    }),
    terminate: (startKey: string) => Effect.sync(() => {
      const execution = state.executions.get(startKey);
      if (execution === undefined || execution.kind === "retired") return false;
      execution.terminateUnexpectedly();
      return true;
    }),
    snapshot: Effect.sync(() => Object.freeze({
      activeProcessCount: [...state.executions.values()].filter(
        execution => execution.kind === "live" && execution.isProcessAlive(),
      ).length,
      liveExecutionCount: [...state.executions.values()].filter(
        execution => execution.kind === "live",
      ).length,
      processIds: Object.freeze([...state.executions.values()].flatMap(
        execution => execution.kind === "live" &&
          execution.isProcessAlive() && execution.pid !== undefined
          ? [execution.pid]
          : [],
      )),
      retiredExecutionCount: [...state.executions.values()].filter(
        execution => execution.kind === "retired",
      ).length,
      startKeys: Object.freeze([...state.executions.keys()]),
    })),
  });
  yield* Effect.addFinalizer(() => Effect.promise(async () => {
    state.closed = true;
    await Promise.all([...state.executions.values()].map(
      execution => execution.kind === "live"
        ? execution.shutdown()
        : Promise.resolve(),
    ));
  }));
  return Object.freeze({ makeClient, control });
});

interface SpawnOptions {
  readonly executable: string;
  readonly request: NodeTaskExecutorStartRequestV1;
  readonly acceptance: NodeTaskExecutorAcceptanceV1;
  readonly bundle: LocalBundle;
  readonly executionPath: string;
  readonly entryPath: string;
  readonly exportName: string;
  readonly expectedNodeRuntimeAbiIdentity: string;
  readonly input: unknown;
  readonly inputFailure: boolean;
  readonly runCallback: (
    effect: Effect.Effect<NodeTaskCallbackResponseV1, unknown>,
  ) => Promise<Result.Result<NodeTaskCallbackResponseV1, unknown>>;
  readonly consumeDroppedCallbackResponse: () => boolean;
  readonly retire: (
    execution: LocalExecution,
    status: RetiredExecution["status"],
    settlement?: NodeTaskExecutorSettlementV1,
  ) => void;
}

interface RetiredExecution {
  readonly kind: "retired";
  readonly requestFingerprint: string;
  readonly acceptance: NodeTaskExecutorAcceptanceV1;
  readonly expiresAtEpochMilliseconds: number;
  readonly status: "settled" | "lost" | "closed";
  readonly settlement?: NodeTaskExecutorSettlementV1;
}

const MAX_TRACKED_EXECUTIONS = 16;

class LocalExecution {
  readonly kind = "live" as const;
  readonly request: NodeTaskExecutorStartRequestV1;
  readonly acceptance: NodeTaskExecutorAcceptanceV1;
  readonly pid: number | undefined;
  readonly ready: Promise<void>;
  readonly settlement: Promise<NodeTaskExecutorSettlementV1>;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly consumeDroppedCallbackResponse: () => boolean;
  private readonly expectedNodeRuntimeAbiIdentity: string;
  private readonly inputFailure: boolean;
  private readonly initializationFrame: unknown;
  private readonly retire: SpawnOptions["retire"];
  private readonly runCallback: SpawnOptions["runCallback"];
  private callbackAttachment: NodeTaskCallbackAttachmentV1 | undefined;
  private callbackChannel: NodeTaskExecutorCallbackChannel | undefined;
  private resolveReady!: () => void;
  private rejectReady!: (cause: unknown) => void;
  private resolveSettlement!: (value: NodeTaskExecutorSettlementV1) => void;
  private rejectSettlement!: (cause: unknown) => void;
  private resolveAttached: (() => void) | undefined;
  private rejectAttached: ((cause: unknown) => void) | undefined;
  private attachmentCompletion: Promise<void> | undefined;
  private readonly exited: Promise<void>;
  private resolveExited!: () => void;
  private deadlineTimer: NodeJS.Timeout | undefined;
  private outputBytes = 0;
  private logBytes = 0;
  private leases = 0;
  private status: "starting" | "running" | "settled" | "lost" | "closed" =
    "starting";
  private interruption:
    | Readonly<{ readonly generation: bigint; readonly reason: "cancellation_requested" | "maximum_duration" | "host_shutdown" }>
    | undefined;
  private heartbeat = 0n;
  private buffer = "";
  private childAttested = false;

  constructor(options: SpawnOptions) {
    this.request = options.request;
    this.acceptance = options.acceptance;
    this.consumeDroppedCallbackResponse = options.consumeDroppedCallbackResponse;
    this.expectedNodeRuntimeAbiIdentity = options.expectedNodeRuntimeAbiIdentity;
    this.inputFailure = options.inputFailure;
    this.retire = options.retire;
    this.runCallback = options.runCallback;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.settlement = new Promise((resolve, reject) => {
      this.resolveSettlement = resolve;
      this.rejectSettlement = reject;
    });
    void this.settlement.catch(() => undefined);
    this.exited = new Promise(resolve => {
      this.resolveExited = resolve;
    });
    this.child = spawn(options.executable, [
      "--permission",
      "--no-warnings",
      `--max-old-space-size=${Math.max(
        16,
        Math.floor(options.request.resourcePolicy.maximumMemoryBytes / 1_048_576),
      )}`,
      "--experimental-vm-modules",
      "--input-type=module",
      "--eval",
      LOCAL_NODE_TASK_BOOTSTRAP,
    ], {
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.pid = this.child.pid;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.receive(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.logBytes += chunk.byteLength;
      if (this.logBytes > this.request.resourcePolicy.maximumLogBytes) {
        this.terminateUnexpectedly();
      }
    });
    this.child.once("error", cause => this.lose(cause));
    this.child.stdin.on("error", cause => this.lose(cause));
    this.child.stdout.on("error", cause => this.lose(cause));
    this.child.stderr.on("error", cause => this.lose(cause));
    this.child.once("close", () => {
      this.resolveExited();
      this.handleExit();
    });
    const remaining = Math.max(1, Math.min(
      this.request.absoluteDeadlineEpochMilliseconds - Date.now(),
      this.request.launchCapability.expiresAtEpochMilliseconds - Date.now(),
      this.request.resourcePolicy.maximumDurationMilliseconds,
    ));
    this.deadlineTimer = setTimeout(() => {
      const generation = this.acceptance.cancellationGeneration > 0n
        ? this.acceptance.cancellationGeneration
        : 1n;
      if (this.status === "starting") {
        this.lose(new Error(
          "Local Node Task process did not become ready before its deadline.",
        ));
        this.child.kill();
        return;
      }
      if (this.status === "running") {
        this.interrupt(generation, "maximum_duration");
      }
    }, remaining);
    this.initializationFrame = {
      type: "init",
      modules: options.bundle.modules,
      executionPath: options.executionPath,
      entryPath: options.entryPath,
      exportName: options.exportName,
      input: options.input,
    };
  }

  correlatesRecovery(request: NodeTaskExecutorRecoveryRequestV1): boolean {
    return request.recoveryKey === this.request.recoveryKey &&
      request.executionId === this.request.executionId &&
      identitiesEqual(request.identity, this.request.dispatch.identity);
  }

  isRunning(): boolean {
    return this.status === "starting" || this.status === "running";
  }

  isLost(): boolean {
    return this.status === "lost" || this.status === "closed";
  }

  settlementFailureReason(): "clientClosed" | "sessionLost" {
    return this.status === "closed" ? "clientClosed" : "sessionLost";
  }

  isProcessAlive(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  acquire(): void {
    this.leases += 1;
  }

  async release(): Promise<"cleaned" | "already_clean" | "session_lost"> {
    if (this.leases === 0) return "already_clean";
    this.leases -= 1;
    if (this.leases > 0) {
      return this.status === "lost" ? "session_lost" : "cleaned";
    }
    if (this.status === "lost") {
      await this.terminateAndJoin();
      this.retire(this, "lost");
      return "session_lost";
    }
    if (this.leases === 0) {
      if (this.isRunning()) {
        this.status = "closed";
        this.clearDeadline();
        const cause = new Error("Local Node Task session closed.");
        this.rejectAttached?.(cause);
        this.rejectSettlement(cause);
      }
      await this.terminateAndJoin();
      this.retire(this, this.status === "settled" ? "settled" : "closed");
    }
    return "cleaned";
  }

  async attach(
    attachmentInput: unknown,
    channel: NodeTaskExecutorCallbackChannel,
  ): Promise<void> {
    const decoded = decodeNodeTaskCallbackAttachmentV1(attachmentInput);
    if (Result.isFailure(decoded)) throw decoded.failure;
    const attachment = decoded.success;
    if (attachment.startKey !== this.acceptance.startKey ||
      attachment.sessionId !== this.acceptance.sessionId ||
      attachment.executionId !== this.acceptance.executionId ||
      attachment.capabilityId !== this.request.launchCapability.capabilityId ||
      attachment.expiresAtEpochMilliseconds !==
        this.request.launchCapability.expiresAtEpochMilliseconds) {
      throw new Error("Callback attachment does not correlate.");
    }
    if (this.callbackAttachment !== undefined &&
      !attachmentsEqual(this.callbackAttachment, attachment)) {
      throw new Error("Conflicting callback attachment.");
    }
    if (this.status !== "running") throw new Error("Execution is not running.");
    this.callbackAttachment = attachment;
    this.callbackChannel = channel;
    if (this.attachmentCompletion === undefined) {
      this.attachmentCompletion = new Promise<void>((resolve, reject) => {
        this.resolveAttached = resolve;
        this.rejectAttached = reject;
        this.send({ type: "attach", attachmentId: attachment.capabilityId });
      });
    }
    await this.attachmentCompletion;
  }

  interrupt(
    generation: bigint,
    reason: NonNullable<LocalExecution["interruption"]>["reason"],
  ): LocalInterruptionDecision {
    if (this.status !== "running") return "session_lost";
    if (this.interruption !== undefined) {
      if (generation < this.interruption.generation) return "stale_generation";
      if (generation === this.interruption.generation) {
        return reason === this.interruption.reason
          ? "interruption_requested"
          : "conflict";
      }
    }
    this.interruption = Object.freeze({ generation, reason });
    if (!this.child.kill()) {
      this.interruption = undefined;
      return "session_lost";
    }
    return "interruption_requested";
  }

  terminateUnexpectedly(): void {
    if (!this.isRunning()) return;
    this.interruption = undefined;
    this.child.kill();
  }

  async abortBeforeAcceptance(): Promise<void> {
    if (this.status === "starting") {
      this.lose(new Error("Local Node Task start was abandoned."));
    } else if (this.status === "running") {
      this.status = "closed";
      this.rejectSettlement(new Error("Local Node Task start was abandoned."));
    }
    await this.terminateAndJoin();
  }

  async shutdown(): Promise<void> {
    if (!this.isProcessAlive()) return;
    if (this.status === "running") {
      this.interruption = Object.freeze({
        generation: this.acceptance.cancellationGeneration > 0n
          ? this.acceptance.cancellationGeneration
          : 1n,
        reason: "host_shutdown",
      });
    } else if (this.status === "starting") {
      this.lose(new Error("Local Node Task provider closed during startup."));
    }
    await this.terminateAndJoin();
  }

  health() {
    this.heartbeat += 1n;
    return Object.freeze({
      format: NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "healthy" as const,
      sessionId: this.acceptance.sessionId,
      recoveryKey: this.acceptance.recoveryKey,
      heartbeatSequence: this.heartbeat,
      observedAtEpochMilliseconds: Date.now(),
      state: this.interruption === undefined
        ? "running" as const
        : "interruption_requested" as const,
    });
  }

  private receive(chunk: string): void {
    this.outputBytes += Buffer.byteLength(chunk, "utf8");
    if (this.outputBytes > this.request.resourcePolicy.maximumOutputBytes) {
      this.terminateUnexpectedly();
      return;
    }
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) {
        try {
          void this.handleMessage(decodeWire(line));
        } catch (cause) {
          this.lose(cause);
          this.child.kill();
          return;
        }
      }
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isNonArrayRecord(message) || typeof message.type !== "string") {
      this.lose(new Error("Invalid child protocol frame."));
      return;
    }
    if (message.type === "hello") {
      if (this.status !== "starting" || this.childAttested) return;
      if (message.nodeRuntimeAbiIdentity !==
        this.expectedNodeRuntimeAbiIdentity) {
        this.lose(new Error(
          "Local Node Task child runtime ABI does not match the artifact.",
        ));
        this.child.kill();
        return;
      }
      this.childAttested = true;
      this.send(this.initializationFrame);
      return;
    }
    if (message.type === "ready") {
      if (this.status !== "starting") return;
      if (!this.childAttested) {
        this.lose(new Error(
          "Local Node Task child became ready before ABI attestation.",
        ));
        this.child.kill();
        return;
      }
      this.status = "running";
      this.resolveReady();
      return;
    }
    if (message.type === "attached") {
      this.resolveAttached?.();
      if (this.inputFailure) {
        this.resolveTerminal(failedSettlement(
          this.acceptance,
          "runtime_input_unavailable",
        ));
      }
      return;
    }
    if (message.type === "completed") {
      const normalized = normalizeApplicationTaskWorkerValueV1(
        message.value,
        "result",
      );
      this.resolveTerminal(Result.isSuccess(normalized)
        ? makeNodeTaskExecutorSettlementV1(this.acceptance, Object.freeze({
            kind: "completed" as const,
            result: Object.freeze({
              value: normalized.success.value,
              valueSemanticBytes: normalized.success.semanticSizeBytes,
            }),
          }))
        : failedSettlement(this.acceptance, "output_validation_failed"));
      return;
    }
    if (message.type === "invalidOutput") {
      this.resolveTerminal(failedSettlement(
        this.acceptance,
        "output_validation_failed",
      ));
      return;
    }
    if (message.type === "failed") {
      this.resolveTerminal(failedSettlement(this.acceptance, "handler_failed"));
      return;
    }
    if (message.type === "callback") await this.handleCallback(message);
  }

  private async handleCallback(message: Readonly<Record<string, unknown>>): Promise<void> {
    const attachment = this.callbackAttachment;
    const channel = this.callbackChannel;
    if (attachment === undefined || channel === undefined ||
      typeof message.id !== "number" || !Number.isSafeInteger(message.id) ||
      message.id < 1 || typeof message.functionPath !== "string" ||
      (message.operation !== "runQuery" &&
        message.operation !== "runMutation") ||
      (message.operation === "runMutation" &&
        typeof message.ordinal !== "bigint")) {
      this.send({ type: "callbackResult", id: message.id, result: { kind: "failure" } });
      return;
    }
    const sequence = BigInt(message.id) as Parameters<
      typeof makeNodeTaskCallbackRequestIdV1
    >[1];
    let normalizedValue;
    let argumentSemanticBytes: number;
    if (message.operation === "runMutation") {
      const normalized = normalizeApplicationTaskMutationCallbackValueV1(
        message.argumentsValue,
        "request",
      );
      if (Result.isFailure(normalized)) {
        this.send({ type: "callbackResult", id: message.id, result: { kind: "failure" } });
        return;
      }
      normalizedValue = normalized.success.value;
      argumentSemanticBytes = normalized.success.semanticSizeBytes;
    } else {
      const normalized = normalizeApplicationTaskQueryCallbackValueV1(
        message.argumentsValue,
        "request",
      );
      if (Result.isFailure(normalized)) {
        this.send({ type: "callbackResult", id: message.id, result: { kind: "failure" } });
        return;
      }
      normalizedValue = normalized.success.value;
      argumentSemanticBytes = normalized.success.semanticSizeBytes;
    }
    const common = {
      format: NODE_TASK_CALLBACK_REQUEST_FORMAT_V1,
      version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
      capabilityId: attachment.capabilityId,
      credential: attachment.credential,
      startKey: attachment.startKey,
      sessionId: attachment.sessionId,
      executionId: attachment.executionId,
      sequence,
      requestId: makeNodeTaskCallbackRequestIdV1(
        attachment.capabilityId,
        sequence,
      ),
    } as const;
    const request = message.operation === "runMutation" &&
        typeof message.ordinal === "bigint"
      ? Object.freeze({
          ...common,
          operation: "runMutation" as const,
          payload: Object.freeze({
            format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
            version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
            operation: "runMutation" as const,
            ordinal: message.ordinal,
            functionPath: message.functionPath,
            arguments: normalizedValue,
            argumentSemanticBytes,
          }),
        })
      : Object.freeze({
          ...common,
          operation: "runQuery" as const,
          payload: Object.freeze({
            format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
            version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
            operation: "runQuery" as const,
            functionPath: message.functionPath,
            arguments: normalizedValue,
            argumentSemanticBytes,
          }),
        });
    try {
      const response = await this.runCallback(channel(request));
      if (Result.isFailure(response)) {
        this.send({
          type: "callbackResult",
          id: message.id,
          result: { kind: "failure" },
        });
        return;
      }
      if (this.consumeDroppedCallbackResponse()) return;
      this.send({
        type: "callbackResult",
        id: message.id,
        result: response.success.result,
      });
    } catch (cause) {
      this.lose(cause);
      this.child.kill();
    }
  }

  private send(message: unknown): void {
    this.child.stdin.write(`${encodeWire(message)}\n`);
  }

  private resolveTerminal(settlement: NodeTaskExecutorSettlementV1): void {
    if (this.status === "settled" || this.status === "lost" ||
      this.status === "closed") return;
    this.status = "settled";
    this.clearDeadline();
    this.rejectAttached?.(new Error(
      "Local Node Task settled before callback attachment completed.",
    ));
    this.resolveSettlement(settlement);
    this.child.kill();
    void this.exited.then(() => this.retire(this, "settled", settlement));
  }

  private lose(cause: unknown): void {
    if (this.status === "settled" || this.status === "lost" ||
      this.status === "closed") return;
    const starting = this.status === "starting";
    this.status = "lost";
    this.clearDeadline();
    this.rejectAttached?.(cause);
    if (starting) this.rejectReady(cause);
    this.rejectSettlement(cause);
    if (!starting) {
      this.child.kill();
      void this.exited.then(() => this.retire(this, "lost"));
    }
  }

  private handleExit(): void {
    if (this.status === "settled" || this.status === "closed" ||
      this.status === "lost") return;
    if (this.interruption !== undefined) {
      this.resolveTerminal(makeNodeTaskExecutorSettlementV1(
        this.acceptance,
        Object.freeze({
          kind: "interrupted" as const,
          interruption: Object.freeze({
            cancellationGeneration: this.interruption.generation as
              NodeTaskExecutorAcceptanceV1["cancellationGeneration"],
            reason: this.interruption.reason,
          }),
        }),
      ));
      return;
    }
    this.lose(new Error("Local Node Task process exited before settlement."));
  }

  private clearDeadline(): void {
    if (this.deadlineTimer === undefined) return;
    clearTimeout(this.deadlineTimer);
    this.deadlineTimer = undefined;
  }

  private async terminateAndJoin(): Promise<void> {
    this.clearDeadline();
    if (!this.isProcessAlive()) return;
    this.child.kill();
    if (await settlesWithin(this.exited, 1_000)) return;
    this.child.kill("SIGKILL");
    if (!await settlesWithin(this.exited, 1_000)) {
      throw new Error("Local Node Task process did not exit after termination.");
    }
  }
}

function spawnExecution(options: SpawnOptions): Effect.Effect<
  LocalExecution,
  LocalNodeTaskExecutorHostError
> {
  return Effect.try({
    try: () => new LocalExecution(options),
    catch: cause => new LocalNodeTaskExecutorHostError({
      operation: "spawn",
      cause,
    }),
  });
}

function awaitExecutionReady(
  execution: LocalExecution,
): Effect.Effect<void, LocalNodeTaskExecutorHostError> {
  return Effect.tryPromise({
    try: () => execution.ready,
    catch: cause => new LocalNodeTaskExecutorHostError({
      operation: "spawn",
      cause,
    }),
  });
}

function acquireAccepted(
  execution: LocalExecution,
): Effect.Effect<NodeTaskExecutorStartResult, never, Scope.Scope> {
  return acquireSession(execution).pipe(Effect.map(session => Object.freeze({
    kind: "accepted" as const,
    response: execution.acceptance,
    session,
  })));
}

function acquireRetiredAccepted(
  execution: RetiredExecution,
): Effect.Effect<NodeTaskExecutorStartResult> {
  return Effect.succeed(Object.freeze({
    kind: "accepted" as const,
    response: execution.acceptance,
    session: makeRetiredSession(execution),
  }));
}

function makeRetiredSession(
  execution: RetiredExecution,
): NodeTaskExecutorSession {
  const lost = <Operation extends NodeTaskExecutorClientError["operation"]>(
    operation: Operation,
  ) => Effect.fail(clientError(operation, "sessionLost", true));
  return Object.freeze({
    acceptance: execution.acceptance,
    attachCallbackCapability: () => lost("attachCallbackCapability"),
    health: lost("health"),
    requestInterruption: () => lost("requestInterruption"),
    settlement: execution.status === "settled" &&
        execution.settlement !== undefined
      ? Effect.succeed(execution.settlement)
      : Effect.fail(clientError(
          "settlement",
          execution.status === "closed" ? "clientClosed" : "sessionLost",
          execution.status !== "closed",
        )),
    close: Effect.succeed(cleanup(
      execution,
      execution.status === "lost" ? "session_lost" : "already_clean",
    )),
  });
}

function acquireSession(
  execution: LocalExecution,
): Effect.Effect<NodeTaskExecutorSession, never, Scope.Scope> {
  return Effect.gen(function* () {
    execution.acquire();
    const session = makeSession(execution);
    yield* Effect.addFinalizer(() => session.close.pipe(
      Effect.catchCause(() => Effect.void),
      Effect.asVoid,
    ));
    return session;
  });
}

function retireExecution(
  state: ProviderState,
  execution: LocalExecution,
  status: RetiredExecution["status"],
  settlement?: NodeTaskExecutorSettlementV1,
): void {
  const startKey = execution.acceptance.startKey;
  if (state.executions.get(startKey) !== execution) return;
  const retired = Object.freeze({
    kind: "retired" as const,
    requestFingerprint: startRequestFingerprint(execution.request),
    acceptance: execution.acceptance,
    expiresAtEpochMilliseconds: Math.min(
      execution.request.absoluteDeadlineEpochMilliseconds,
      execution.request.launchCapability.expiresAtEpochMilliseconds,
    ),
    status,
    ...(settlement === undefined ? {} : { settlement }),
  });
  state.executions.set(startKey, retired);
}

function pruneExpiredRetiredExecutions(
  state: ProviderState,
  nowEpochMilliseconds: number,
): void {
  for (const [startKey, execution] of state.executions) {
    if (execution.kind === "retired" &&
      execution.expiresAtEpochMilliseconds <= nowEpochMilliseconds) {
      state.executions.delete(startKey);
    }
  }
}

function retiredCorrelatesRecovery(
  execution: RetiredExecution,
  request: NodeTaskExecutorRecoveryRequestV1,
): boolean {
  return request.startKey === execution.acceptance.startKey &&
    request.recoveryKey === execution.acceptance.recoveryKey &&
    request.executionId === execution.acceptance.executionId &&
    identitiesEqual(request.identity, execution.acceptance.identity);
}

function startRequestFingerprint(request: NodeTaskExecutorStartRequestV1): string {
  return createHash("sha256").update(
    nodeTaskExecutorStartRequestEquivalencePreimageV1(request),
  ).digest("hex");
}

function makeSession(execution: LocalExecution): NodeTaskExecutorSession {
  let closed = false;
  const attachCallbackCapability:
    NodeTaskExecutorSession["attachCallbackCapability"] =
    Effect.fn("LocalNodeTaskExecutorSession.attachCallbackCapability")(
      (attachment, channel) => closed
        ? Effect.fail(clientError(
            "attachCallbackCapability", "clientClosed", false,
          ))
        : Effect.tryPromise({
            try: () => execution.attach(attachment, channel),
            catch: cause => clientError(
              "attachCallbackCapability",
              execution.isLost() ? "sessionLost" : "invalidRequest",
              execution.isLost(),
              cause,
            ),
          }).pipe(Effect.as(Object.freeze({
            format: NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1,
            version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
            kind: "attached" as const,
            capabilityId: attachment.capabilityId,
            startKey: attachment.startKey,
            sessionId: attachment.sessionId,
            executionId: attachment.executionId,
            expiresAtEpochMilliseconds: attachment.expiresAtEpochMilliseconds,
          })))
    );
  const requestInterruption: NodeTaskExecutorSession["requestInterruption"] =
    Effect.fn("LocalNodeTaskExecutorSession.requestInterruption")(
      requestInput => Effect.suspend(() => {
      if (closed) return Effect.fail(clientError(
        "requestInterruption", "clientClosed", false,
      ));
      const decoded = decodeNodeTaskExecutorInterruptionRequestV1(requestInput);
      if (Result.isFailure(decoded)) return Effect.fail(clientError(
        "requestInterruption", "invalidRequest", false, decoded.failure,
      ));
      const request = decoded.success;
      if (request.sessionId !== execution.acceptance.sessionId ||
        request.recoveryKey !== execution.acceptance.recoveryKey ||
        request.executionId !== execution.acceptance.executionId) {
        return Effect.fail(clientError(
          "requestInterruption", "idempotencyConflict", false,
        ));
      }
      const kind = execution.interrupt(
        request.cancellationGeneration,
        request.reason,
      );
      if (kind === "conflict") {
        return Effect.fail(clientError(
          "requestInterruption", "idempotencyConflict", false,
        ));
      }
      return Effect.succeed(Object.freeze({
        format: request.format,
        version: request.version,
        kind,
        interruptionKey: request.interruptionKey,
        sessionId: request.sessionId,
        cancellationGeneration: request.cancellationGeneration,
        reason: request.reason,
      }));
    }));
  return Object.freeze({
    acceptance: execution.acceptance,
    attachCallbackCapability,
    health: Effect.suspend(() => closed || !execution.isRunning()
      ? Effect.fail(clientError("health", "sessionLost", true))
      : Effect.succeed(execution.health())),
    requestInterruption,
    settlement: Effect.tryPromise({
      try: () => execution.settlement,
      catch: cause => clientError(
        "settlement",
        execution.settlementFailureReason(),
        execution.settlementFailureReason() === "sessionLost",
        cause,
      ),
    }),
    close: Effect.tryPromise({
      try: async () => {
        if (closed) return cleanup(execution, "already_clean");
        closed = true;
        return cleanup(execution, await execution.release());
      },
      catch: cause => clientError("close", "cleanupFailed", false, cause),
    }),
  });
}

function makeAcceptance(
  request: NodeTaskExecutorStartRequestV1,
  ordinal: number,
): NodeTaskExecutorAcceptanceV1 {
  return Object.freeze({
    format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind: "accepted",
    generation: "application_v1",
    startKey: request.startKey,
    recoveryKey: request.recoveryKey,
    identity: request.dispatch.identity,
    executionId: request.executionId,
    sessionId: `local-node-${ordinal}` as NodeTaskExecutorAcceptanceV1["sessionId"],
    cancellationGeneration: request.dispatch.cancellation.generation,
  });
}

function decodeAndVerifyBundle(
  bytes: Uint8Array,
  artifact: NodeTaskRuntimeArtifactV1,
): Result.Result<LocalBundle, LocalNodeTaskExecutorHostError> {
  try {
    if (BigInt(bytes.byteLength) !== artifact.bundle.byteLength ||
      !bytesEqualFullScan(sha256Sync(bytes), artifact.bundle.sha256)) {
      return Result.fail(new LocalNodeTaskExecutorHostError({
        operation: "artifact",
      }));
    }
    const parsed: unknown = JSON.parse(textDecoder.decode(bytes));
    if (!isNonArrayRecord(parsed) ||
      parsed.format !== "flarex.local-node-task-bundle" ||
      parsed.version !== 1 || !Array.isArray(parsed.modules) ||
      Reflect.ownKeys(parsed).length !== 3) {
      return Result.fail(new LocalNodeTaskExecutorHostError({
        operation: "artifact",
      }));
    }
    const modules: Array<LocalNodeTaskBundleModule> = [];
    for (const member of parsed.modules) {
      if (!isNonArrayRecord(member) || Reflect.ownKeys(member).length !== 2 ||
        typeof member.path !== "string" || typeof member.source !== "string") {
        return Result.fail(new LocalNodeTaskExecutorHostError({
          operation: "artifact",
        }));
      }
      modules.push(Object.freeze({ path: member.path, source: member.source }));
    }
    if (modules.length !== artifact.modules.length ||
      artifact.modules.some(module => {
        const bundled = modules.find(member =>
          member.path === module.artifactModulePath
        );
        if (bundled === undefined) return true;
        const sourceBytes = new TextEncoder().encode(bundled.source);
        return BigInt(sourceBytes.byteLength) !== module.rawByteLength ||
          !bytesEqualFullScan(sha256Sync(sourceBytes), module.sourceSha256);
      })) {
      return Result.fail(new LocalNodeTaskExecutorHostError({
        operation: "artifact",
      }));
    }
    return Result.succeed(Object.freeze({ modules: Object.freeze(modules) }));
  } catch (cause) {
    return Result.fail(new LocalNodeTaskExecutorHostError({
      operation: "artifact",
      cause,
    }));
  }
}

function isLocallyCompatible(artifact: NodeTaskRuntimeArtifactV1): boolean {
  return artifact.nodeRuntimeAbiIdentity === localAbi &&
    artifact.dependencies === null && artifact.nativeModules === "denied";
}

function rejected(
  request: NodeTaskExecutorStartRequestV1,
  reason: Extract<NodeTaskExecutorStartResult, { readonly kind: "rejected" }>[
    "response"
  ]["reason"],
  retryable: boolean,
): NodeTaskExecutorStartResult {
  return Object.freeze({
    kind: "rejected" as const,
    response: Object.freeze({
      format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "rejected" as const,
      startKey: request.startKey,
      recoveryKey: request.recoveryKey,
      reason,
      retryable,
    }),
  });
}

function recoveryMissing(
  request: NodeTaskExecutorRecoveryRequestV1,
): NodeTaskExecutorRecoveryResult {
  return Object.freeze({
    kind: "not_found" as const,
    response: Object.freeze({
      format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "not_found" as const,
      startKey: request.startKey,
      recoveryKey: request.recoveryKey,
    }),
  });
}

function recoveryLost(
  request: NodeTaskExecutorRecoveryRequestV1,
): NodeTaskExecutorRecoveryResult {
  return Object.freeze({
    kind: "session_lost" as const,
    response: Object.freeze({
      format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "session_lost" as const,
      startKey: request.startKey,
      recoveryKey: request.recoveryKey,
    }),
  });
}

function cleanup(
  execution: Pick<LocalExecution, "acceptance">,
  kind: "cleaned" | "already_clean" | "session_lost",
) {
  return Object.freeze({
    format: NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind,
    sessionId: execution.acceptance.sessionId,
    recoveryKey: execution.acceptance.recoveryKey,
  });
}

function failedSettlement(
  acceptance: NodeTaskExecutorAcceptanceV1,
  code: Extract<NodeTaskExecutorSettlementV1["outcome"], {
    readonly kind: "failed";
  }>["failure"]["code"],
): NodeTaskExecutorSettlementV1 {
  return makeNodeTaskExecutorSettlementV1(acceptance, Object.freeze({
    kind: "failed" as const,
    failure: Object.freeze({ code, message: null }),
  }));
}

function attachmentsEqual(
  left: NodeTaskCallbackAttachmentV1,
  right: NodeTaskCallbackAttachmentV1,
): boolean {
  return left.capabilityId === right.capabilityId &&
    left.startKey === right.startKey && left.sessionId === right.sessionId &&
    left.executionId === right.executionId &&
    left.expiresAtEpochMilliseconds === right.expiresAtEpochMilliseconds &&
    bytesEqualFullScan(left.credential, right.credential);
}

function identitiesEqual(
  left: NodeTaskExecutorAcceptanceV1["identity"],
  right: NodeTaskExecutorAcceptanceV1["identity"],
): boolean {
  return left.version === right.version && left.scopeId === right.scopeId &&
    left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId &&
    left.executionFence === right.executionFence;
}

function settlesWithin(promise: Promise<void>, milliseconds: number) {
  return new Promise<boolean>(resolve => {
    const timeout = setTimeout(() => resolve(false), milliseconds);
    void promise.then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function sha256Sync(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function encodeWire(input: unknown): string {
  return serialize(input).toString("base64");
}

function decodeWire(input: string): unknown {
  const bytes = Buffer.from(input, "base64");
  if (bytes.toString("base64") !== input) {
    throw new Error("Invalid Local Node Task wire frame encoding.");
  }
  return deserialize(bytes);
}

function clientError(
  operation: NodeTaskExecutorClientError["operation"],
  reason: NodeTaskExecutorClientError["reason"],
  retryable: boolean,
  cause?: unknown,
  recoveryKey?: NodeTaskExecutorClientError["recoveryKey"],
): NodeTaskExecutorClientError {
  return new NodeTaskExecutorClientError({
    operation,
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
    ...(recoveryKey === undefined ? {} : { recoveryKey }),
  });
}

/** Canonical bytes for a trusted local bundle fixture. */
export function encodeLocalNodeTaskBundle(
  modules: ReadonlyArray<LocalNodeTaskBundleModule>,
): Uint8Array {
  const value = {
    format: "flarex.local-node-task-bundle",
    version: 1,
    modules: modules.map(module => ({
      path: module.path,
      source: module.source,
    })),
  };
  return new TextEncoder().encode(JSON.stringify(value));
}

export function localNodeRuntimeAbiIdentity(): string {
  return localAbi;
}

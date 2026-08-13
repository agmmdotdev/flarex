import { bytesEqualFullScan } from "@flarex/utils/bytes";
import {
  encodeTaskDefinitionRuntimeBindingPreimageV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Result } from "effect";
import {
  decodeCanonicalFlarexValueEvidenceV1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import { validateValidatorValueIssueV1 } from
  "flarex-protocol/internal/validator-engine-core";

import {
  decodeTaskRuntimeCancellationRequestV1,
  decodeTaskRuntimeStartRequestV1,
  TASK_RUNTIME_CANCELLATION_ACCEPTANCE_VERSION_V1,
  TASK_RUNTIME_START_ACCEPTANCE_VERSION_V1,
  type TaskRuntimeCancellationAcceptanceV1,
  type TaskRuntimeCancellationRequestV1,
  type TaskRuntimeStartAcceptanceV1,
  type TaskRuntimeStartRequestV1,
} from "./Abi.js";

export type TaskRuntimeCoreFailureReason =
  | "invalid_request"
  | "execution_conflict"
  | "input_capability_invalid"
  | "input_read_failed"
  | "input_invalid"
  | "module_load_failed"
  | "handler_missing"
  | "wait_until_failed"
  | "unknown_execution"
  | "identity_mismatch"
  | "stale_cancellation_generation";

export class TaskRuntimeCoreError extends Error {
  readonly name = "TaskRuntimeCoreError";

  constructor(
    readonly operation: "start" | "cancel",
    readonly reason: TaskRuntimeCoreFailureReason,
    options?: ErrorOptions,
  ) {
    super(`Task runtime ${operation} failed: ${reason}.`, options);
  }
}

export class TaskRuntimeCapabilityUnavailableError extends Error {
  readonly name = "TaskRuntimeCapabilityUnavailableError";

  constructor(readonly capability: "heartbeat" | "complete" | "publishResult") {
    super(`Task runtime capability is unavailable: ${capability}.`);
  }
}

export interface TaskRuntimeInputReadCapability {
  readonly read: () => PromiseLike<unknown>;
}

export interface TaskRuntimeExecutionContext {
  readonly waitUntil: (execution: Promise<unknown>) => void;
}

export interface TaskRuntimeHandlerContext {
  readonly cancellationSignal: AbortSignal;
  readonly heartbeat: () => never;
  readonly complete: () => never;
  readonly publishResult: () => never;
}

export type TaskRuntimeHandler = (
  input: CanonicalFlarexRuntimeValueV1,
  context: TaskRuntimeHandlerContext,
) => unknown | PromiseLike<unknown>;

export interface TaskRuntimeCoreOptions {
  readonly loadExecution: (
    artifactExecutionModule: string,
  ) => PromiseLike<unknown>;
  readonly executionContext: TaskRuntimeExecutionContext;
}

export interface TaskRuntimeCore {
  readonly start: (
    request: unknown,
    input: unknown,
  ) => Promise<TaskRuntimeStartAcceptanceV1>;
  readonly cancel: (
    request: unknown,
  ) => Promise<TaskRuntimeCancellationAcceptanceV1>;
}

interface AdmittedExecution {
  readonly request: TaskRuntimeStartRequestV1;
  readonly requestBindingCanonicalBytes: Uint8Array;
  readonly acceptance: TaskRuntimeStartAcceptanceV1;
  readonly cancellationController: AbortController;
  cancellationGeneration: bigint;
  settled: boolean;
}

interface StartSlot {
  readonly request: TaskRuntimeStartRequestV1;
  readonly requestBindingCanonicalBytes: Uint8Array;
  readonly outcome: Promise<TaskRuntimeStartAcceptanceV1>;
  active: AdmittedExecution | undefined;
}

/**
 * Invocation-local runtime core. One Worker instance admits one exact execution
 * identity and may replay that identity; it never becomes durable attempt
 * authority and exposes no completion or result callback.
 */
export function makeTaskRuntimeCore(options: TaskRuntimeCoreOptions): TaskRuntimeCore {
  const captured = captureOptions(options);
  let slot: StartSlot | undefined;

  const start = async (
    suppliedRequest: unknown,
    suppliedInput: unknown,
  ): Promise<TaskRuntimeStartAcceptanceV1> => {
    const request = Result.match(
      decodeTaskRuntimeStartRequestV1(suppliedRequest),
      {
        onFailure: (cause) => {
          throw coreError("start", "invalid_request", cause);
        },
        onSuccess: (value) => value,
      },
    );
    const bindingCanonicalBytes = Result.match(
      encodeTaskDefinitionRuntimeBindingPreimageV1(request.runtimeBinding),
      {
        onFailure: (cause) => {
          throw coreError("start", "invalid_request", cause);
        },
        onSuccess: (value) => value,
      },
    );
    if (slot !== undefined) {
      if (startRequestsEqual(
        slot,
        request,
        bindingCanonicalBytes,
      )) return slot.outcome;
      throw coreError("start", "execution_conflict");
    }
    const outcome = prepareStart(
      captured,
      request,
      suppliedInput,
      bindingCanonicalBytes,
      (active) => {
        if (slot !== undefined) slot.active = active;
      },
    );
    slot = {
      request,
      requestBindingCanonicalBytes: new Uint8Array(bindingCanonicalBytes),
      outcome,
      active: undefined,
    };
    return outcome;
  };

  const cancel = async (
    suppliedRequest: unknown,
  ): Promise<TaskRuntimeCancellationAcceptanceV1> => {
    const request = Result.match(
      decodeTaskRuntimeCancellationRequestV1(suppliedRequest),
      {
        onFailure: (cause) => {
          throw coreError("cancel", "invalid_request", cause);
        },
        onSuccess: (value) => value,
      },
    );
    const current = slot?.active;
    if (current === undefined || current.settled) {
      throw coreError("cancel", "unknown_execution");
    }
    if (!cancellationTargetsExecution(request, current)) {
      throw coreError("cancel", "identity_mismatch");
    }
    if (request.cancellationGeneration < current.cancellationGeneration) {
      throw coreError("cancel", "stale_cancellation_generation");
    }
    if (request.cancellationGeneration > current.cancellationGeneration) {
      current.cancellationGeneration = request.cancellationGeneration;
      current.cancellationController.abort();
    }
    return Object.freeze({
      version: TASK_RUNTIME_CANCELLATION_ACCEPTANCE_VERSION_V1,
      bridgeAbiIdentity: request.bridgeAbiIdentity,
      kind: "interruption_requested" as const,
      identity: request.identity,
      executionId: request.executionId,
      cancellationGeneration: request.cancellationGeneration,
      correlationToken: request.correlationToken,
    });
  };

  return Object.freeze({ start, cancel });
}

async function prepareStart(
  captured: ReturnType<typeof captureOptions>,
  request: TaskRuntimeStartRequestV1,
  suppliedInput: unknown,
  bindingCanonicalBytes: Uint8Array,
  admit: (active: AdmittedExecution) => void,
): Promise<TaskRuntimeStartAcceptanceV1> {
  const inputRead = captureInputRead(suppliedInput);
  const entry = request.runtimeBinding.taskRuntimeEntry;
  const executionModule = await loadExecution(
    captured.loadExecution,
    entry.artifactExecutionModule,
  );
  const handler = resolveHandler(executionModule, entry.exportName);
  const input = await readInput(request, inputRead);
  const validationIssue = validateValidatorValueIssueV1(
    request.runtimeBinding.manifest.payloadValidator,
    input,
    { path: "$input", idPolicy: { mode: "shapeOnly" } },
  );
  if (validationIssue !== undefined) {
    throw coreError("start", "input_invalid", validationIssue);
  }

  const cancellationController = new AbortController();
  const acceptance = Object.freeze({
    version: TASK_RUNTIME_START_ACCEPTANCE_VERSION_V1,
    bridgeAbiIdentity: request.bridgeAbiIdentity,
    kind: "accepted" as const,
    identity: request.dispatch.identity,
    executionId: request.executionId,
    correlationToken: request.correlationToken,
  });
  const admitted: AdmittedExecution = {
    request,
    requestBindingCanonicalBytes: new Uint8Array(bindingCanonicalBytes),
    acceptance,
    cancellationController,
    cancellationGeneration: request.dispatch.cancellation.generation,
    settled: false,
  };
  if (request.dispatch.cancellation.kind === "requested") {
    cancellationController.abort();
  }

  let beginExecution: (() => void) | undefined;
  let rejectExecution: ((cause: unknown) => void) | undefined;
  const admissionGate = new Promise<void>((resolve, reject) => {
    beginExecution = resolve;
    rejectExecution = reject;
  });
  const trackedExecution = admissionGate.then(() =>
    Reflect.apply(handler, undefined, [
      input,
      taskHandlerContext(cancellationController.signal),
    ])
  ).then(
    (value) => {
      admitted.settled = true;
      return value;
    },
    (cause) => {
      admitted.settled = true;
      throw cause;
    },
  );
  try {
    Reflect.apply(captured.waitUntil, captured.executionContextOwner, [
      trackedExecution,
    ]);
  } catch (cause) {
    const failure = coreError("start", "wait_until_failed", cause);
    cancellationController.abort();
    trackedExecution.catch(() => undefined);
    rejectExecution?.(failure);
    throw failure;
  }
  admit(admitted);
  beginExecution?.();
  return acceptance;
}

function captureOptions(options: TaskRuntimeCoreOptions): Readonly<{
  readonly loadExecution: TaskRuntimeCoreOptions["loadExecution"];
  readonly waitUntil: TaskRuntimeExecutionContext["waitUntil"];
  readonly executionContextOwner: TaskRuntimeExecutionContext;
}> {
  try {
    const loadExecutionOperation = options.loadExecution;
    const executionContextOwner = options.executionContext;
    const waitUntil = executionContextOwner.waitUntil;
    if (
      typeof loadExecutionOperation !== "function" ||
      typeof waitUntil !== "function"
    ) {
      throw new TypeError("invalid_options");
    }
    return Object.freeze({
      loadExecution: loadExecutionOperation,
      waitUntil,
      executionContextOwner,
    });
  } catch (cause) {
    throw coreError("start", "invalid_request", cause);
  }
}

function captureInputRead(input: unknown): TaskRuntimeInputReadCapability["read"] {
  try {
    if (typeof input !== "object" || input === null) {
      throw new TypeError("invalid_input_capability");
    }
    const read = Reflect.get(input, "read");
    if (typeof read !== "function") throw new TypeError("invalid_input_read");
    return () => Promise.resolve(Reflect.apply(read, input, []));
  } catch (cause) {
    throw coreError("start", "input_capability_invalid", cause);
  }
}

async function readInput(
  request: TaskRuntimeStartRequestV1,
  read: TaskRuntimeInputReadCapability["read"],
): Promise<CanonicalFlarexRuntimeValueV1> {
  let suppliedBytes: unknown;
  try {
    suppliedBytes = await read();
  } catch (cause) {
    throw coreError("start", "input_read_failed", cause);
  }
  try {
    const decoded = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes: suppliedBytes,
      sha256: request.inputReference.sha256,
    });
    if (decoded.canonicalBytes.byteLength !== request.inputReference.byteLength) {
      throw coreError(
        "start",
        "input_invalid",
        new TypeError("input_length_mismatch"),
      );
    }
    return decoded.value;
  } catch (cause) {
    if (
      cause instanceof FlarexValueEvidenceV1Error ||
      cause instanceof FlarexValueCodecV1Error
    ) throw coreError("start", "input_invalid", cause);
    throw cause;
  }
}

async function loadExecution(
  load: TaskRuntimeCoreOptions["loadExecution"],
  artifactExecutionModule: string,
): Promise<unknown> {
  try {
    return await load(artifactExecutionModule);
  } catch (cause) {
    throw coreError("start", "module_load_failed", cause);
  }
}

function resolveHandler(module: unknown, exportName: string): TaskRuntimeHandler {
  try {
    if (typeof module !== "object" || module === null) {
      throw new TypeError("module_invalid");
    }
    const descriptor = Object.getOwnPropertyDescriptor(module, exportName);
    if (descriptor === undefined || !("value" in descriptor) ||
      typeof descriptor.value !== "function") {
      throw new TypeError("handler_missing");
    }
    const handler = descriptor.value;
    return (input, context) => Reflect.apply(handler, undefined, [
      input,
      context,
    ]);
  } catch (cause) {
    throw coreError("start", "handler_missing", cause);
  }
}

function taskHandlerContext(signal: AbortSignal): TaskRuntimeHandlerContext {
  return Object.freeze({
    cancellationSignal: signal,
    heartbeat: unavailable("heartbeat"),
    complete: unavailable("complete"),
    publishResult: unavailable("publishResult"),
  });
}

function unavailable(
  capability: TaskRuntimeCapabilityUnavailableError["capability"],
): () => never {
  return () => {
    throw new TaskRuntimeCapabilityUnavailableError(capability);
  };
}

function startRequestsEqual(
  current: Pick<StartSlot, "request" | "requestBindingCanonicalBytes">,
  request: TaskRuntimeStartRequestV1,
  bindingCanonicalBytes: Uint8Array,
): boolean {
  return dispatchesEqual(current.request.dispatch, request.dispatch) &&
    current.request.executionId === request.executionId &&
    current.request.correlationToken === request.correlationToken &&
    inputReferencesEqual(
      current.request.inputReference,
      request.inputReference,
    ) && bytesEqualFullScan(
      current.requestBindingCanonicalBytes,
      bindingCanonicalBytes,
    );
}

function cancellationTargetsExecution(
  request: TaskRuntimeCancellationRequestV1,
  active: AdmittedExecution,
): boolean {
  return identitiesEqual(request.identity, active.request.dispatch.identity) &&
    request.executionId === active.request.executionId &&
    request.correlationToken === active.request.correlationToken;
}

function dispatchesEqual(
  left: TaskRuntimeStartRequestV1["dispatch"],
  right: TaskRuntimeStartRequestV1["dispatch"],
): boolean {
  return identitiesEqual(left.identity, right.identity) &&
    left.taskDefinitionRevisionId === right.taskDefinitionRevisionId &&
    left.attemptNumber === right.attemptNumber &&
    left.leaseVersion === right.leaseVersion &&
    left.computeProfile === right.computeProfile &&
    left.maximumDurationMs === right.maximumDurationMs &&
    left.cancellation.kind === right.cancellation.kind &&
    left.cancellation.generation === right.cancellation.generation;
}

function identitiesEqual(
  left: TaskRuntimeStartRequestV1["dispatch"]["identity"],
  right: TaskRuntimeStartRequestV1["dispatch"]["identity"],
): boolean {
  return left.version === right.version && left.scopeId === right.scopeId &&
    left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId &&
    left.executionFence === right.executionFence;
}

function inputReferencesEqual(
  left: TaskRuntimeStartRequestV1["inputReference"],
  right: TaskRuntimeStartRequestV1["inputReference"],
): boolean {
  return left.codec === right.codec && left.store === right.store &&
    left.valueCodec === right.valueCodec && left.objectKey === right.objectKey &&
    left.byteLength === right.byteLength &&
    left.retention.kind === right.retention.kind &&
    bytesEqualFullScan(left.sha256, right.sha256);
}

function coreError(
  operation: TaskRuntimeCoreError["operation"],
  reason: TaskRuntimeCoreFailureReason,
  cause?: unknown,
): TaskRuntimeCoreError {
  return new TaskRuntimeCoreError(operation, reason, { cause });
}

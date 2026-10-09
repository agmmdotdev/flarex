import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from "@flarex/persistence-postgres/internal/application-syscall-errors";
import {
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
} from "flarex-protocol/internal/application-revision-syscall-validation-v1";
import { Miniflare } from "miniflare";
import type {
  MixedMutationExecutionHost,
} from "../../../executor/test/performance/support/mixedMutationInProcessRuntime";
import {
  POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
  pointMutationExactRuntimeWorkerConfigurationSource,
  pointMutationExactRuntimeWorkerExecutionBridgeSource,
} from "../../src/artifactRuntime";
import { POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../../src/artifactRuntime/PointMutationExactRuntimeWorkerCore.generated";
import { POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1 } from
  "../../src/artifactRuntime/PointMutationRuntimeKernel.generated";
import { FUNCTION_API_CORE_MODULE_V1, FUNCTION_API_CORE_SOURCE_V1 } from
  "../../src/artifactRuntime/FunctionApiCore.generated";
import {
  APPLICATION_ERROR_PLATFORM_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
  applicationErrorPlatformSourceV1,
} from "../../src/artifactRuntime/ApplicationErrorExactRuntimeWorkerSource";


export const runMixedMutationWorkerd: MixedMutationExecutionHost = async input => {
  const applicationSource = input.source;
    const workerPhase = <T>(name: string, run: () => Promise<T>): Promise<T> =>
      input.trace === undefined ? run() : input.trace.withPhase(name, run);
    const workerStarted = globalThis.performance.now();
    let dispatchBridge = input.bridge;
    const serviceBinding = async (request: Request) => {
      try { return Response.json({ ok: true, value: await dispatchBridge(await request.json()) }); }
      catch (cause) { return Response.json({ ok: false,
        error: cause instanceof ApplicationRevisionSyscallDocumentValidationV1Error
          ? APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1
          : cause instanceof Error ? cause.message : String(cause),
        documentValidation: cause instanceof ApplicationRevisionSyscallDocumentValidationV1Error }, { status: 500 }); }
    };
    const platformSource = applicationErrorPlatformSourceV1({
      runtimeKernelModulePath: `../${POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1}`,
      captureExportName: "capturePointMutationCoreApplicationErrorDataV1",
      captureProjectionExportName: "captureCoreApplicationErrorV1",
      invalid: { kind: "nativeError" },
    });
    const worker = await workerPhase("Worker construction and ready", async () => {
      const created = new Miniflare({ compatibilityDate: "2026-06-18",
      serviceBindings: { MIXED_JOURNAL: serviceBinding }, modules: [
        { type: "ESModule", path: "worker.js", contents: `${POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default { async fetch(_request, env) {
  const invoke = async (kind, payload) => {
    const response = await env.MIXED_JOURNAL.fetch("https://mixed-journal.test/", {
      method: "POST", body: JSON.stringify({ kind, ...payload }),
    });
    const answer = await response.json();
    if (!answer.ok) {
      const failure = new Error(answer.error);
      if (answer.documentValidation === true) Object.defineProperty(failure, "name", {
        value: ${JSON.stringify(APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1)} });
      throw failure;
    }
    return answer.value;
  };
  const journal = {
    resolvePointTable(tableName) { return {
      runPointOperation: operation => invoke("point", { tableName,
        operation: { ...operation, syscallSequence: String(operation.syscallSequence) } }),
    }; },
    runAdmittedFrameworkOperation: (sequence, frame) =>
      invoke("admitted", { sequence: String(sequence), frame }),
  };
  const input = ${input.request};
  input.context.randomSeed = new Uint8Array(input.context.randomSeed);
  try {
    const result = await Reflect.apply(FlarexPointMutationExactRuntimeV1.prototype.runPrivateMixed,
      {}, [input, journal]);
    return Response.json({ kind: "result", result });
  } catch (cause) {
    return Response.json({ kind: "error", name: cause?.name, message: cause?.message,
      cause: cause?.cause?.message });
  }
} };` },
        { type: "ESModule", path: POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
          contents: pointMutationExactRuntimeWorkerConfigurationSource({
            executionModule: input.executionModule, moduleTime: input.executionTime,
            moduleRandomSeedHex: "a".repeat(64) }) },
        { type: "ESModule", path: POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
          contents: pointMutationExactRuntimeWorkerExecutionBridgeSource(input.executionModule) },
        { type: "ESModule", path: POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
          contents: POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1 },
        { type: "ESModule", path: FUNCTION_API_CORE_MODULE_V1,
          contents: FUNCTION_API_CORE_SOURCE_V1 },
        { type: "ESModule", path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
          contents: platformSource },
        { type: "ESModule", path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
          contents: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1 },
        { type: "ESModule", path: input.executionModule, contents: applicationSource },
      ] });
      try {
        if (input.onReady !== undefined) await created.ready;
        return created;
      } catch (cause) {
        await created.dispose();
        throw cause;
      }
    });
    input.onReady?.(globalThis.performance.now() - workerStarted);
    let workerd: unknown;
    try {
      const response = await workerPhase("Worker dispatch", () => {
        dispatchBridge = input.trace === undefined ? input.bridge : input.trace.bindCurrent(input.bridge);
        return worker.dispatchFetch("https://mixed-product.test/");
      });
      workerd = await response.json();
    } finally { await workerPhase("Worker disposal", () => worker.dispose()); }

  return workerd;
};

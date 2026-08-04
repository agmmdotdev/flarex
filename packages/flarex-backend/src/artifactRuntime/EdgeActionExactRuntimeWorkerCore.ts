import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  executeEdgeActionV1,
  inspectEdgeActionRuntimeFailureV1,
} from "@flarex/function-runtime/edge-action";
import type {
  EdgeActionExactRuntimeRequestV1,
  EdgeActionExactRuntimeResultV1,
} from
  "flarex-protocol/edge-action-exact-runtime";

import { exactEdgeActionRuntimeConfigurationV1 } from
  "./edgeActionExactRuntimeWorker/flarex-edge-action-exact-runtime-config-v1.js";

const CONFIG = exactEdgeActionRuntimeConfigurationV1;
const executionModulePromise = import(
  "./edgeActionExactRuntimeWorker/flarex-edge-action-exact-runtime-execution-v1.js"
);
const kernelModulePath =
  "./edgeActionExactRuntimeWorker/flarex-edge-action-runtime-kernel-v1.js";
const kernelPromise = import(kernelModulePath) as Promise<Readonly<{
  readonly executeEdgeActionV1: typeof executeEdgeActionV1;
  readonly inspectEdgeActionRuntimeFailureV1:
    typeof inspectEdgeActionRuntimeFailureV1;
}>>;

const nativeDate = globalThis.Date;
const nativeMath = globalThis.Math;
const defineProperty = Object.defineProperty;
const reflectConstruct = Reflect.construct;
let deterministicTime = CONFIG.moduleEvaluationTime;
let deterministicRandom = () => 0.5;
let runAdmitted = false;

type UnknownRecord = Readonly<Record<string, unknown>>;

interface CallbackCapabilityV1 {
  readonly invoke: (request: unknown) => unknown | PromiseLike<unknown>;
  readonly [Symbol.dispose]?: () => void;
}

installExactGlobals();

export class FlarexEdgeActionExactRuntimeV1 extends WorkerEntrypoint {
  async run(
    input: unknown,
    receivedCapability: unknown,
  ): Promise<EdgeActionExactRuntimeResultV1> {
    if (runAdmitted) throw namedError(
      "EdgeActionExactRuntimeInvalidRequestV1Error",
      new Error("Exact edge-action runtime admits one invocation."),
    );
    runAdmitted = true;
    const request = decodeRequest(input);
    const callback = decodeCallback(receivedCapability);
    try {
      deterministicTime = request.context.executionTime;
      deterministicRandom = randomFromSeed(request.context.randomSeed);
      const kernel = await kernelPromise;
      let value: EdgeActionExactRuntimeResultV1["value"];
      try {
        value = await kernel.executeEdgeActionV1(
          Object.freeze({
            function: request.function,
            arguments: request.arguments,
            auth: request.auth.kind === "anonymous" ? null : request.auth.user,
          }),
          Object.freeze({ resolve: resolveFunction }),
          Object.freeze({ invoke: (operation: unknown) => callback.invoke(operation) }),
          Object.freeze({
            maximumSyscalls: CONFIG.maximumSyscalls,
            maximumArgumentBytes: CONFIG.maximumArgumentBytes,
            maximumResultBytes: CONFIG.maximumResultBytes,
            maximumCallbackArgumentBytes: CONFIG.maximumCallbackArgumentBytes,
            maximumCallbackResultBytes: CONFIG.maximumCallbackResultBytes,
          }),
        );
      } catch (cause) {
        const failure = kernel.inspectEdgeActionRuntimeFailureV1(cause);
        if (failure?.kind === "contract") {
          throw namedError("EdgeActionExactRuntimeInvalidRequestV1Error", cause);
        }
        if (failure?.kind === "callbackBoundary") {
          throw namedError(
            "EdgeActionExactRuntimeCallbackBoundaryV1Error",
            failure.cause,
          );
        }
        if (failure?.kind === "userCode") {
          throw namedError("EdgeActionExactRuntimeUserCodeV1Error", failure.cause);
        }
        throw cause;
      }
      return Object.freeze({
        format: CONFIG.resultFormat,
        version: CONFIG.resultVersion,
        value,
      });
    } finally {
      callback[Symbol.dispose]?.();
    }
  }
}

async function resolveFunction(path: string): Promise<unknown> {
  const registry = await executionModulePromise;
  const separator = path.indexOf(":");
  if (separator <= 0 || separator !== path.lastIndexOf(":")) return undefined;
  return Reflect.get(
    Reflect.get(registry.default, path.slice(0, separator)) ?? {},
    path.slice(separator + 1),
  );
}

function decodeRequest(input: unknown) {
  if (
    !hasExactKeys(input, [
      "format", "version", "exactRuntimeProfile", "syscallAbiIdentity",
      "artifact", "function", "auth", "arguments", "argumentSemanticBytes",
      "context",
    ]) ||
    input.format !== CONFIG.requestFormat || input.version !== CONFIG.requestVersion ||
    !plainDataEqual(input.artifact, CONFIG.artifact) ||
    !plainDataEqual(input.function, CONFIG.function) ||
    !isRecord(input.context) ||
    !isBytes(input.context.runtimeTargetSha256, 32) ||
    hex(input.context.runtimeTargetSha256) !== CONFIG.runtimeTargetSha256Hex ||
    !isBytes(input.context.hostPolicySha256, 32) ||
    hex(input.context.hostPolicySha256) !== CONFIG.hostPolicySha256Hex ||
    !isBytes(input.context.randomSeed, 32) ||
    typeof input.context.executionTime !== "number" ||
    !Number.isFinite(input.context.executionTime) ||
    typeof input.context.executionDeadline !== "number" ||
    !Number.isFinite(input.context.executionDeadline) ||
    input.context.executionDeadline < input.context.executionTime ||
    !isRecord(input.arguments) ||
    typeof input.argumentSemanticBytes !== "number" ||
    !Number.isSafeInteger(input.argumentSemanticBytes) ||
    input.argumentSemanticBytes < 1 ||
    input.argumentSemanticBytes > CONFIG.maximumArgumentBytes ||
    !isRecord(input.auth) ||
    (input.auth.kind !== "anonymous" && input.auth.kind !== "user")
  ) throw namedError("EdgeActionExactRuntimeInvalidRequestV1Error", input);
  return input as unknown as EdgeActionExactRuntimeRequestV1;
}

function decodeCallback(input: unknown): CallbackCapabilityV1 {
  if (!isRecord(input) || typeof input.invoke !== "function") {
    throw namedError("EdgeActionExactRuntimeCallbackBoundaryV1Error", input);
  }
  return input as unknown as CallbackCapabilityV1;
}

function installExactGlobals(): void {
  function ExactRuntimeDate(...args: ReadonlyArray<unknown>): string | Date {
    if (new.target === undefined) return new nativeDate(deterministicTime).toString();
    return args.length === 0
      ? reflectConstruct(nativeDate, [deterministicTime], new.target)
      : reflectConstruct(nativeDate, args, new.target);
  }
  ExactRuntimeDate.prototype = nativeDate.prototype;
  defineProperty(ExactRuntimeDate, "now", { value: () => deterministicTime });
  defineProperty(globalThis, "Date", { value: ExactRuntimeDate });
  defineProperty(globalThis, "Math", {
    value: Object.freeze(Object.assign(Object.create(nativeMath), {
      random: () => deterministicRandom(),
    })),
  });
  defineProperty(globalThis, "crypto", {
    value: Object.freeze({
      getRandomValues: unavailable,
      randomUUID: unavailable,
      subtle: Object.freeze({ digest: unavailable }),
    }),
  });
  for (const name of ["setTimeout", "setInterval", "WebSocketPair"] as const) {
    if (Reflect.get(globalThis, name) !== undefined) {
      defineProperty(globalThis, name, { value: unavailable });
    }
  }
}

function unavailable(): never {
  throw new Error("Capability is unavailable in exact edge-action runtime.");
}

function randomFromSeed(seed: Uint8Array): () => number {
  let state = 0x9e3779b9;
  for (const byte of seed) state = Math.imul(state ^ byte, 0x85ebca6b) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function plainDataEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    left === null || right === null || typeof left !== "object" ||
    typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)
  ) return false;
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some(key => typeof key !== "string") ||
    rightKeys.some(key => typeof key !== "string")
  ) return false;
  const rightSet = new Set(rightKeys);
  return leftKeys.every(key => rightSet.has(key) &&
    plainDataEqual(Reflect.get(left, key), Reflect.get(right, key)));
}

function hasExactKeys(
  value: unknown,
  keys: ReadonlyArray<string>,
): value is UnknownRecord {
  if (!isRecord(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBytes(value: unknown, length: number): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === length;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function namedError(name: string, cause: unknown): Error {
  const error = new Error(name);
  defineProperty(error, "name", { value: name });
  defineProperty(error, "cause", { value: cause });
  return error;
}

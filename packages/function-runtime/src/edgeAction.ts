import type { UserIdentity } from "flarex-protocol/auth";
import { validateValidatorValueIssueV1 } from
  "flarex-protocol/internal/validator-engine-core";
import {
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import {
  validatorJsonAdmissionIssueV1,
  type ValidatorJsonV1,
} from "flarex-protocol/validator-json";

const ARRAY_FROM = Array.from;
const ARRAY_IS_ARRAY = Array.isArray;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTORS = Object.getOwnPropertyDescriptors;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_HAS_OWN = Object.hasOwn;
const OBJECT_PROTOTYPE = Object.prototype;
const PROMISE = Promise;
const SET = Set;
const WEAK_MAP = WeakMap;

export interface EdgeActionRuntimeFunctionV1 {
  readonly path: string;
  readonly kind: "action";
  readonly visibility: "public";
  readonly argsValidator: ValidatorJsonV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

export interface EdgeActionRuntimeInputV1 {
  readonly function: EdgeActionRuntimeFunctionV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly auth: UserIdentity | null;
}

export interface EdgeActionRuntimeCallbackRequestV1 {
  readonly kind: "runQuery" | "runMutation";
  readonly ordinal: bigint;
  readonly functionPath: string;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly argumentSemanticBytes: number;
}

export interface EdgeActionRuntimeCallbackBridgeV1 {
  readonly invoke: (
    request: EdgeActionRuntimeCallbackRequestV1,
  ) => unknown | PromiseLike<unknown>;
}

export interface EdgeActionRuntimeLimitsV1 {
  readonly maximumSyscalls: number;
  readonly maximumArgumentBytes: number;
  readonly maximumResultBytes: number;
  readonly maximumCallbackArgumentBytes: number;
  readonly maximumCallbackResultBytes: number;
}

export interface EdgeActionRuntimeContextV1 {
  readonly auth: Readonly<{
    readonly getUserIdentity: () => Promise<UserIdentity | null>;
  }>;
  readonly runQuery: (
    functionPath: string,
    argumentsValue?: unknown,
  ) => Promise<CanonicalFlarexRuntimeValueV1>;
  readonly runMutation: (
    functionPath: string,
    argumentsValue?: unknown,
  ) => Promise<CanonicalFlarexRuntimeValueV1>;
}

export interface EdgeActionRuntimeBoundaryV1 {
  readonly context: EdgeActionRuntimeContextV1;
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export type EdgeActionRuntimeFailureReasonV1 =
  | "functionMissing"
  | "functionMetadataInvalid"
  | "argumentsInvalid"
  | "validatorProjectionInvalid"
  | "callbackClosed"
  | "callbackInvalid"
  | "resourceExceeded";

export class EdgeActionRuntimeContractV1Error extends Error {
  readonly reason: EdgeActionRuntimeFailureReasonV1;
  override readonly cause?: unknown;

  constructor(reason: EdgeActionRuntimeFailureReasonV1, cause?: unknown) {
    super(messageForReason(reason));
    defineErrorName(this, "EdgeActionRuntimeContractV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    inspections.set(this, OBJECT_FREEZE({ kind: "contract", reason, cause }));
  }
}

export class EdgeActionRuntimeUserCodeV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact edge-action user code failed.");
    defineErrorName(this, "EdgeActionRuntimeUserCodeV1Error");
    this.cause = cause;
    inspections.set(this, OBJECT_FREEZE({ kind: "userCode", cause }));
  }
}

export class EdgeActionRuntimeCallbackBoundaryV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact edge-action callback boundary failed.");
    defineErrorName(this, "EdgeActionRuntimeCallbackBoundaryV1Error");
    this.cause = cause;
    inspections.set(this, OBJECT_FREEZE({ kind: "callbackBoundary", cause }));
  }
}

export type EdgeActionRuntimeFailureInspectionV1 =
  | Readonly<{
      readonly kind: "contract";
      readonly reason: EdgeActionRuntimeFailureReasonV1;
      readonly cause: unknown;
    }>
  | Readonly<{ readonly kind: "userCode"; readonly cause: unknown }>
  | Readonly<{ readonly kind: "callbackBoundary"; readonly cause: unknown }>;

const inspections = new WEAK_MAP<object, EdgeActionRuntimeFailureInspectionV1>();
const NO_FAILURE = Symbol("FlarexEdgeActionNoFailure");

export function inspectEdgeActionRuntimeFailureV1(
  value: unknown,
): EdgeActionRuntimeFailureInspectionV1 | undefined {
  return value !== null &&
      (typeof value === "object" || typeof value === "function")
    ? inspections.get(value)
    : undefined;
}

export interface EdgeActionFunctionRegistryV1 {
  readonly resolve: (path: string) => unknown | PromiseLike<unknown>;
}

type ActionHandlerV1 = (
  context: EdgeActionRuntimeContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

export async function executeEdgeActionV1(
  input: EdgeActionRuntimeInputV1,
  registry: EdgeActionFunctionRegistryV1,
  callbackBridge: EdgeActionRuntimeCallbackBridgeV1,
  limits: EdgeActionRuntimeLimitsV1,
): Promise<CanonicalFlarexRuntimeValueV1> {
  requireLimits(limits);
  requireValidator(input.function.argsValidator);
  if (input.function.returnsValidator !== null) {
    requireValidator(input.function.returnsValidator);
  }
  let registered: unknown;
  try {
    registered = await registry.resolve(input.function.path);
  } catch (cause) {
    throw new EdgeActionRuntimeUserCodeV1Error(cause);
  }
  if (registered === undefined) {
    throw new EdgeActionRuntimeContractV1Error("functionMissing");
  }
  const handler = exactPublicActionHandler(registered);
  const argumentIssue = validateValidatorValueIssueV1(
    input.function.argsValidator,
    input.arguments,
    { path: "$arguments", idPolicy: { mode: "shapeOnly" } },
  );
  if (argumentIssue !== undefined) {
    throw new EdgeActionRuntimeContractV1Error(
      "argumentsInvalid",
      argumentIssue,
    );
  }
  const capturedArguments = normalizeFlarexValueV1(input.arguments);
  if (capturedArguments.semanticSizeBytes > limits.maximumArgumentBytes) {
    throw new EdgeActionRuntimeContractV1Error("resourceExceeded");
  }

  const boundary = openCallbackBoundary(input.auth, callbackBridge, limits);
  let result: unknown;
  let handlerFailure: unknown | typeof NO_FAILURE = NO_FAILURE;
  try {
    result = await handler(boundary.context, input.arguments);
  } catch (cause) {
    handlerFailure = cause;
  }
  boundary.close();
  try {
    await boundary.drain();
  } catch (cause) {
    throw cause instanceof EdgeActionRuntimeCallbackBoundaryV1Error
      ? cause
      : new EdgeActionRuntimeCallbackBoundaryV1Error(cause);
  }
  if (handlerFailure !== NO_FAILURE) {
    if (inspectEdgeActionRuntimeFailureV1(handlerFailure)?.kind ===
      "callbackBoundary") throw handlerFailure;
    throw new EdgeActionRuntimeUserCodeV1Error(handlerFailure);
  }
  let normalized: ReturnType<typeof normalizeFlarexValueV1>;
  try {
    normalized = normalizeFlarexValueV1(result === undefined ? null : result);
  } catch (cause) {
    throw new EdgeActionRuntimeUserCodeV1Error(cause);
  }
  if (
    input.function.returnsValidator !== null &&
    validateValidatorValueIssueV1(
        input.function.returnsValidator,
        normalized.value,
        { path: "$result", idPolicy: { mode: "shapeOnly" } },
      ) !== undefined
  ) {
    throw new EdgeActionRuntimeUserCodeV1Error(
      new EdgeActionRuntimeContractV1Error("argumentsInvalid"),
    );
  }
  if (normalized.semanticSizeBytes > limits.maximumResultBytes) {
    throw new EdgeActionRuntimeContractV1Error("resourceExceeded");
  }
  return normalized.value;
}

export function openCallbackBoundary(
  auth: UserIdentity | null,
  bridge: EdgeActionRuntimeCallbackBridgeV1,
  limits: EdgeActionRuntimeLimitsV1,
): EdgeActionRuntimeBoundaryV1 {
  requireLimits(limits);
  let open = true;
  let ordinal = 0n;
  let firstFailure: unknown | typeof NO_FAILURE = NO_FAILURE;
  const pending = new SET<Promise<unknown>>();

  const invokeOpen = (
    kind: EdgeActionRuntimeCallbackRequestV1["kind"],
    functionPath: string,
    argumentsValue: unknown = {},
  ): Promise<CanonicalFlarexRuntimeValueV1> => {
    if (!open) throw new EdgeActionRuntimeContractV1Error("callbackClosed");
    if (typeof functionPath !== "string" || functionPath.trim().length === 0) {
      throw new EdgeActionRuntimeContractV1Error("callbackInvalid");
    }
    ordinal += 1n;
    if (ordinal > BigInt(limits.maximumSyscalls)) {
      throw new EdgeActionRuntimeContractV1Error("resourceExceeded");
    }
    let normalizedArguments: ReturnType<typeof normalizeFlarexValueV1>;
    try {
      normalizedArguments = normalizeFlarexValueV1(argumentsValue);
    } catch (cause) {
      throw new EdgeActionRuntimeContractV1Error("callbackInvalid", cause);
    }
    if (
      !isCanonicalFlarexRuntimeObjectV1(normalizedArguments.value) ||
      normalizedArguments.semanticSizeBytes >
        limits.maximumCallbackArgumentBytes
    ) throw new EdgeActionRuntimeContractV1Error("resourceExceeded");
    const request = OBJECT_FREEZE({
      kind,
      ordinal,
      functionPath,
      arguments: normalizedArguments.value,
      argumentSemanticBytes: normalizedArguments.semanticSizeBytes,
    });
    const operation = PROMISE.resolve().then(() => bridge.invoke(request))
      .then(value => {
      const normalized = normalizeFlarexValueV1(value);
      if (normalized.semanticSizeBytes > limits.maximumCallbackResultBytes) {
        throw new EdgeActionRuntimeContractV1Error("resourceExceeded");
      }
      return normalized.value;
    }).catch(cause => {
      const failure = cause instanceof EdgeActionRuntimeContractV1Error
        ? cause
        : new EdgeActionRuntimeCallbackBoundaryV1Error(cause);
      if (firstFailure === NO_FAILURE) firstFailure = failure;
      throw failure;
    });
    pending.add(operation);
    void operation.finally(() => pending.delete(operation)).catch(() => {});
    return operation;
  };

  const invoke = (
    kind: EdgeActionRuntimeCallbackRequestV1["kind"],
    functionPath: string,
    argumentsValue: unknown = {},
  ): Promise<CanonicalFlarexRuntimeValueV1> => {
    try {
      return invokeOpen(kind, functionPath, argumentsValue);
    } catch (cause) {
      if (
        cause instanceof EdgeActionRuntimeContractV1Error &&
        firstFailure === NO_FAILURE
      ) firstFailure = cause;
      const rejected = PROMISE.reject(cause);
      void rejected.catch(() => undefined);
      return rejected;
    }
  };

  return OBJECT_FREEZE({
    context: OBJECT_FREEZE({
      auth: OBJECT_FREEZE({
        getUserIdentity: () => PROMISE.resolve(auth),
      }),
      runQuery: (path: string, args?: unknown) => invoke("runQuery", path, args),
      runMutation: (path: string, args?: unknown) =>
        invoke("runMutation", path, args),
    }),
    close: () => { open = false; },
    drain: async () => {
      const outcomes = await PROMISE.allSettled(ARRAY_FROM(pending));
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );
      if (rejected !== undefined) {
        throw new EdgeActionRuntimeCallbackBoundaryV1Error(rejected.reason);
      }
      if (firstFailure !== NO_FAILURE) throw firstFailure;
    },
  });
}

function exactPublicActionHandler(value: unknown): ActionHandlerV1 {
  if (!isPlainRecord(value)) {
    throw new EdgeActionRuntimeContractV1Error("functionMetadataInvalid");
  }
  const descriptors = OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
  const kinds = ["isQuery", "isMutation", "isWorkflowMutation", "isAction"]
    .filter(marker => OBJECT_HAS_OWN(descriptors, marker));
  const visibilities = ["isPublic", "isInternal"]
    .filter(marker => OBJECT_HAS_OWN(descriptors, marker));
  const handler = descriptors._handler;
  if (
    kinds.length !== 1 || kinds[0] !== "isAction" ||
    visibilities.length !== 1 || visibilities[0] !== "isPublic" ||
    handler === undefined || !("value" in handler) ||
    typeof handler.value !== "function"
  ) throw new EdgeActionRuntimeContractV1Error("functionMetadataInvalid");
  return handler.value as ActionHandlerV1;
}

function requireValidator(value: ValidatorJsonV1): void {
  const issue = validatorJsonAdmissionIssueV1(value);
  if (issue !== undefined) {
    throw new EdgeActionRuntimeContractV1Error(
      "validatorProjectionInvalid",
      issue,
    );
  }
}

function requireLimits(value: EdgeActionRuntimeLimitsV1): void {
  if (
    !NUMBER_IS_SAFE_INTEGER(value.maximumSyscalls) ||
    value.maximumSyscalls < 1 ||
    !NUMBER_IS_SAFE_INTEGER(value.maximumArgumentBytes) ||
    value.maximumArgumentBytes < 1 ||
    !NUMBER_IS_SAFE_INTEGER(value.maximumResultBytes) ||
    value.maximumResultBytes < 1 ||
    !NUMBER_IS_SAFE_INTEGER(value.maximumCallbackArgumentBytes) ||
    value.maximumCallbackArgumentBytes < 1 ||
    !NUMBER_IS_SAFE_INTEGER(value.maximumCallbackResultBytes) ||
    value.maximumCallbackResultBytes < 1
  ) throw new EdgeActionRuntimeContractV1Error("resourceExceeded");
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<PropertyKey, unknown>> {
  if (value === null || typeof value !== "object" || ARRAY_IS_ARRAY(value)) {
    return false;
  }
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  return prototype === OBJECT_PROTOTYPE || prototype === null;
}

function defineErrorName(error: Error, name: string): void {
  OBJECT_DEFINE_PROPERTY(error, "name", {
    value: name,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function messageForReason(reason: EdgeActionRuntimeFailureReasonV1): string {
  switch (reason) {
    case "functionMissing": return "Unknown Flarex action.";
    case "functionMetadataInvalid":
      return "Exact-runtime target must be exactly one public action.";
    case "argumentsInvalid":
      return "Exact-runtime value does not match its pinned validator.";
    case "validatorProjectionInvalid":
      return "Exact-runtime validator projection exceeds its limits.";
    case "callbackClosed": return "Exact-runtime callback bridge is closed.";
    case "callbackInvalid": return "Exact-runtime callback is invalid.";
    case "resourceExceeded": return "Exact-runtime resource budget exceeded.";
  }
}

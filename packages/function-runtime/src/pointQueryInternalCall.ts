import type { UserIdentity } from "flarex-protocol/auth";
import type {
  CanonicalFlarexRuntimeObjectV1,
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import {
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";
import {
  validatorJsonAdmissionIssueV1,
  type ObjectValidatorJsonV1,
  type ValidatorJsonV1,
} from "flarex-protocol/validator-json";
import { validateValidatorValueIssueV1 } from
  "flarex-protocol/internal/validator-engine-core";

export type PointQueryInternalCallRuntimeArgsValidatorV1 =
  | ObjectValidatorJsonV1
  | Readonly<{ readonly type: "any" }>;

export interface PointQueryInternalCallRuntimeFunctionV1 {
  readonly ordinal: number;
  readonly path: string;
  readonly kind: "query";
  readonly visibility: "public" | "internal";
  readonly argsValidator: PointQueryInternalCallRuntimeArgsValidatorV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

export interface PointQueryInternalCallRuntimeTableV1 {
  readonly tableId: number;
  readonly logicalName: string;
}

export interface PointQueryInternalCallRuntimeInputV1 {
  readonly executionId: string;
  readonly function: PointQueryInternalCallRuntimeFunctionV1;
  readonly internalQueryCatalog: ReadonlyArray<
    PointQueryInternalCallRuntimeFunctionV1 & {
      readonly visibility: "internal";
    }
  >;
  readonly callBudget: Readonly<{
    readonly maximumCalls: number;
    readonly maximumDepth: number;
    readonly maximumArgumentBytes: number;
    readonly maximumResultBytes: number;
  }>;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly tables: ReadonlyArray<PointQueryInternalCallRuntimeTableV1>;
}

export interface PointQueryInternalCallFrameV1 {
  readonly rootExecutionId: string;
  readonly parentOrdinal: number;
  readonly calleeOrdinal: number;
  readonly sequence: number;
  readonly depth: number;
}

export interface CapturedPointQueryInternalCallRuntimeArgumentsV1 {
  readonly value: CanonicalFlarexRuntimeObjectV1;
  readonly semanticSizeBytes: number;
}

export interface PointQueryInternalCallRuntimeDatabaseV1 {
  readonly get: (
    documentId: string,
  ) => Promise<CanonicalFlarexRuntimeObjectV1 | null>;
  readonly insert: (...args: ReadonlyArray<unknown>) => never;
  readonly patch: (...args: ReadonlyArray<unknown>) => never;
  readonly replace: (...args: ReadonlyArray<unknown>) => never;
  readonly delete: (...args: ReadonlyArray<unknown>) => never;
  readonly query: (...args: ReadonlyArray<unknown>) => never;
  readonly normalizeId: (...args: ReadonlyArray<unknown>) => never;
  readonly system: Readonly<Record<string, never>>;
}

export interface PointQueryInternalCallRuntimeContextV1 {
  readonly auth: Readonly<{
    readonly getUserIdentity: () => Promise<UserIdentity | null>;
  }>;
  readonly db: PointQueryInternalCallRuntimeDatabaseV1;
  readonly runQuery: (
    reference: unknown,
    args?: unknown,
  ) => Promise<CanonicalFlarexRuntimeValueV1>;
}

export interface PointQueryInternalCallRuntimeReadBoundaryV1 {
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export interface PointQueryInternalCallRuntimeInvocationV1 {
  readonly context: Omit<PointQueryInternalCallRuntimeContextV1, "runQuery">;
  readonly invokeWithContext: <A>(
    context: PointQueryInternalCallRuntimeContextV1,
    operation: () => A | PromiseLike<A>,
  ) => Promise<Awaited<A>>;
  readonly readBoundary: PointQueryInternalCallRuntimeReadBoundaryV1;
  readonly recordCallFrame: (frame: PointQueryInternalCallFrameV1) => void;
  readonly recordTerminalFailure: (cause: unknown) => void;
}

export interface PointQueryInternalCallRuntimeInvocationFactoryV1 {
  readonly open: () => PointQueryInternalCallRuntimeInvocationV1;
}

export interface PointQueryFunctionRegistryV1 {
  readonly resolve: (path: string) => unknown | PromiseLike<unknown>;
}

export type PointQueryInternalCallRuntimeContractFailureReasonV1 =
  | "functionMissing"
  | "functionMetadataInvalid"
  | "argumentsInvalid"
  | "validatorProjectionInvalid"
  | "internalTargetInvalid"
  | "callBudgetExceeded"
  | "callCycle";

export class PointQueryInternalCallApplicationV1Error extends Error {
  readonly reason: "argumentsInvalid" | "resultInvalid";
  override readonly cause?: unknown;

  constructor(reason: "argumentsInvalid" | "resultInvalid", cause?: unknown) {
    super(reason === "argumentsInvalid"
      ? "Internal query arguments do not match the registered validator."
      : "Internal query result does not match the registered validator.");
    defineErrorName(this, "PointQueryInternalCallApplicationV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
  }
}

export class PointQueryInternalCallTerminalV1Error extends Error {
  readonly reason: "internalTargetInvalid" | "callBudgetExceeded" | "callCycle";
  override readonly cause?: unknown;

  constructor(
    reason: "internalTargetInvalid" | "callBudgetExceeded" | "callCycle",
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "PointQueryInternalCallTerminalV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "terminal", reason, cause }),
    );
  }
}

export class PointQueryInternalCallRuntimeContractV1Error extends Error {
  readonly reason: PointQueryInternalCallRuntimeContractFailureReasonV1;
  override readonly cause?: unknown;

  constructor(
    reason: PointQueryInternalCallRuntimeContractFailureReasonV1,
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "PointQueryInternalCallRuntimeContractV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "contract", reason, cause }),
    );
  }
}

export class PointQueryInternalCallRuntimeUserCodeV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-query user code failed.");
    defineErrorName(this, "PointQueryInternalCallRuntimeUserCodeV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "userCode", cause }),
    );
  }
}

export class PointQueryInternalCallRuntimeReadBoundaryV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-query read boundary failed.");
    defineErrorName(this, "PointQueryInternalCallRuntimeReadBoundaryV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "readBoundary", cause }),
    );
  }
}

export type PointQueryInternalCallRuntimeFailureInspectionV1 =
  | Readonly<{
      readonly kind: "contract";
      readonly reason: PointQueryInternalCallRuntimeContractFailureReasonV1;
      readonly cause: unknown;
    }>
  | Readonly<{ readonly kind: "userCode"; readonly cause: unknown }>
  | Readonly<{ readonly kind: "readBoundary"; readonly cause: unknown }>
  | Readonly<{
      readonly kind: "terminal";
      readonly reason: PointQueryInternalCallTerminalV1Error["reason"];
      readonly cause: unknown;
    }>;

const runtimeFailureInspections = new WeakMap<
  object,
  PointQueryInternalCallRuntimeFailureInspectionV1
>();

export function inspectPointQueryInternalCallRuntimeFailureV1(
  value: unknown,
): PointQueryInternalCallRuntimeFailureInspectionV1 | undefined {
  return (
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    )
    ? runtimeFailureInspections.get(value)
    : undefined;
}

type QueryHandler = (
  context: PointQueryInternalCallRuntimeContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

export function capturePointQueryInternalCallRuntimeArgumentsV1(
  input: unknown,
): CapturedPointQueryInternalCallRuntimeArgumentsV1 {
  let normalized: ReturnType<typeof normalizeFlarexValueV1>;
  try {
    normalized = normalizeFlarexValueV1(input);
  } catch (cause) {
    throw new PointQueryInternalCallRuntimeContractV1Error("argumentsInvalid", cause);
  }
  if (!isCanonicalFlarexRuntimeObjectV1(normalized.value)) {
    throw new PointQueryInternalCallRuntimeContractV1Error("argumentsInvalid");
  }
  return Object.freeze({
    value: normalized.value,
    semanticSizeBytes: normalized.semanticSizeBytes,
  });
}

export async function executePointQueryInternalCallV1(
  input: PointQueryInternalCallRuntimeInputV1,
  registry: PointQueryFunctionRegistryV1,
  invocations: PointQueryInternalCallRuntimeInvocationFactoryV1,
): Promise<CanonicalFlarexRuntimeValueV1> {
  const tableIdsByName = tableIdsByLogicalName(input.tables);
  const argsAdmission = validatorJsonAdmissionIssueV1(
    input.function.argsValidator,
  );
  const returnsAdmission = input.function.returnsValidator === null
    ? undefined
    : validatorJsonAdmissionIssueV1(input.function.returnsValidator);
  if (argsAdmission !== undefined || returnsAdmission !== undefined ||
    input.function.visibility !== "public" ||
    typeof input.executionId !== "string" || input.executionId.length === 0 ||
    input.executionId.length > 512 || !validCallBudget(input.callBudget)) {
    throw new PointQueryInternalCallRuntimeContractV1Error(
      "validatorProjectionInvalid",
      argsAdmission ?? returnsAdmission,
    );
  }
  const catalog = new Map<string, typeof input.internalQueryCatalog[number]>();
  const ordinals = new Set<number>();
  let previousOrdinal = -1;
  let previousPath = "";
  for (const candidate of input.internalQueryCatalog) {
    const candidateArgs = validatorJsonAdmissionIssueV1(candidate.argsValidator);
    const candidateReturns = candidate.returnsValidator === null
      ? undefined
      : validatorJsonAdmissionIssueV1(candidate.returnsValidator);
    if (candidate.kind !== "query" || candidate.visibility !== "internal" ||
      !Number.isSafeInteger(candidate.ordinal) || candidate.ordinal < 0 ||
      candidate.path.length === 0 || catalog.has(candidate.path) ||
      ordinals.has(candidate.ordinal) || candidate.ordinal < previousOrdinal ||
      (candidate.ordinal === previousOrdinal && candidate.path <= previousPath) ||
      candidateArgs !== undefined || candidateReturns !== undefined) {
      throw new PointQueryInternalCallRuntimeContractV1Error(
        "functionMetadataInvalid",
        candidateArgs ?? candidateReturns,
      );
    }
    previousOrdinal = candidate.ordinal;
    previousPath = candidate.path;
    ordinals.add(candidate.ordinal);
    catalog.set(candidate.path, candidate);
  }
  let runtimeFunction: unknown;
  try {
    runtimeFunction = await registry.resolve(input.function.path);
  } catch (cause) {
    throw new PointQueryInternalCallRuntimeUserCodeV1Error(cause);
  }
  if (runtimeFunction === undefined) {
    throw new PointQueryInternalCallRuntimeContractV1Error("functionMissing");
  }
  const handler = exactQueryHandler(runtimeFunction, "public");
  const argumentValidation = validatorIssue(
    input.function.argsValidator,
    input.arguments,
    "$arguments",
    tableIdsByName,
  );
  if (argumentValidation !== undefined) {
    throw new PointQueryInternalCallRuntimeContractV1Error(
      "argumentsInvalid",
      argumentValidation,
    );
  }

  const invocation = invocations.open();
  let attemptedCalls = 0;
  let argumentBytes = 0;
  let resultBytes = 0;
  const activeOrdinals = [input.function.ordinal];
  const pendingCalls = new Set<Promise<
    | Readonly<{ readonly kind: "success" }>
    | Readonly<{ readonly kind: "failure"; readonly failure: unknown }>
  >>();
  const terminal = (
    reason: PointQueryInternalCallTerminalV1Error["reason"],
    cause?: unknown,
  ): never => {
    const failure = new PointQueryInternalCallTerminalV1Error(reason, cause);
    invocation.recordTerminalFailure(failure);
    throw failure;
  };
  const contextFor = (parentOrdinal: number):
    PointQueryInternalCallRuntimeContextV1 => Object.freeze({
      ...invocation.context,
      runQuery: (reference: unknown, args?: unknown) =>
        runInternal(parentOrdinal, reference, args),
    });
  const executeInternal = async (
    parentOrdinal: number,
    reference: unknown,
    args: unknown = {},
  ): Promise<CanonicalFlarexRuntimeValueV1> => {
    attemptedCalls += 1;
    if (attemptedCalls > input.callBudget.maximumCalls) {
      return terminal("callBudgetExceeded");
    }
    const path = staticFunctionPath(reference);
    const callee = path === undefined ? undefined : catalog.get(path);
    if (callee === undefined) return terminal("internalTargetInvalid");
    if (activeOrdinals.includes(callee.ordinal)) return terminal("callCycle");
    if (activeOrdinals.length >= input.callBudget.maximumDepth) {
      return terminal("callBudgetExceeded");
    }
    invocation.recordCallFrame(Object.freeze({
      rootExecutionId: input.executionId,
      parentOrdinal,
      calleeOrdinal: callee.ordinal,
      sequence: attemptedCalls,
      depth: activeOrdinals.length,
    }));
    let captured: CapturedPointQueryInternalCallRuntimeArgumentsV1;
    try { captured = capturePointQueryInternalCallRuntimeArgumentsV1(args); }
    catch (cause) {
      throw new PointQueryInternalCallApplicationV1Error(
        "argumentsInvalid",
        cause,
      );
    }
    argumentBytes += captured.semanticSizeBytes;
    if (!Number.isSafeInteger(argumentBytes) ||
      argumentBytes > input.callBudget.maximumArgumentBytes) {
      return terminal("callBudgetExceeded");
    }
    const argumentIssue = validatorIssue(
      callee.argsValidator,
      captured.value,
      "$internal.arguments",
      tableIdsByName,
    );
    if (argumentIssue !== undefined) {
      throw new PointQueryInternalCallApplicationV1Error(
        "argumentsInvalid",
        argumentIssue,
      );
    }
    let candidate: unknown;
    try { candidate = await registry.resolve(callee.path); }
    catch (cause) { return terminal("internalTargetInvalid", cause); }
    if (candidate === undefined) return terminal("internalTargetInvalid");
    let child: QueryHandler;
    try { child = exactQueryHandler(candidate, "internal"); }
    catch (cause) { return terminal("internalTargetInvalid", cause); }
    activeOrdinals.push(callee.ordinal);
    try {
      const childContext = contextFor(callee.ordinal);
      const childResult = await invocation.invokeWithContext(
        childContext,
        () => child(childContext, captured.value),
      );
      let normalizedChild: ReturnType<typeof normalizeFlarexValueV1>;
      try {
        normalizedChild = normalizeFlarexValueV1(
          childResult === undefined ? null : childResult,
        );
      } catch (cause) {
        throw new PointQueryInternalCallApplicationV1Error(
          "resultInvalid",
          cause,
        );
      }
      resultBytes += normalizedChild.semanticSizeBytes;
      if (!Number.isSafeInteger(resultBytes) ||
        resultBytes > input.callBudget.maximumResultBytes) {
        return terminal("callBudgetExceeded");
      }
      if (callee.returnsValidator !== null) {
        const resultIssue = validatorIssue(
          callee.returnsValidator,
          normalizedChild.value,
          "$internal.result",
          tableIdsByName,
        );
        if (resultIssue !== undefined) {
          throw new PointQueryInternalCallApplicationV1Error(
            "resultInvalid",
            resultIssue,
          );
        }
      }
      return normalizedChild.value;
    } finally {
      activeOrdinals.pop();
    }
  };
  const runInternal = (
    parentOrdinal: number,
    reference: unknown,
    args: unknown = {},
  ): Promise<CanonicalFlarexRuntimeValueV1> => {
    const call = executeInternal(parentOrdinal, reference, args);
    const settlement = call.then(
      () => Object.freeze({ kind: "success" as const }),
      failure => Object.freeze({ kind: "failure" as const, failure }),
    );
    pendingCalls.add(settlement);
    void settlement.then(() => { pendingCalls.delete(settlement); });
    return call;
  };
  let handlerResult: unknown;
  let handlerFailure: Readonly<{ readonly cause: unknown }> | undefined;
  try {
    const rootContext = contextFor(input.function.ordinal);
    handlerResult = await invocation.invokeWithContext(
      rootContext,
      () => handler(rootContext, input.arguments),
    );
  } catch (cause) {
    handlerFailure = { cause };
  }
  const droppedCalls = [...pendingCalls];
  if (droppedCalls.length > 0) {
    const settlements = await Promise.all(droppedCalls);
    const droppedFailure = settlements.find(settlement =>
      settlement.kind === "failure"
    );
    if (handlerFailure === undefined && droppedFailure?.kind === "failure") {
      handlerFailure = { cause: droppedFailure.failure };
    }
  }
  let boundaryFailure: unknown;
  try {
    invocation.readBoundary.close();
  } catch (cause) {
    boundaryFailure = readBoundaryError(cause);
  }
  try {
    await invocation.readBoundary.drain();
  } catch (cause) {
    const inspected = inspectPointQueryInternalCallRuntimeFailureV1(cause);
    boundaryFailure ??= inspected?.kind === "terminal"
      ? cause
      : readBoundaryError(cause);
  }
  if (boundaryFailure !== undefined) throw boundaryFailure;
  if (handlerFailure !== undefined) {
    const inspected = inspectPointQueryInternalCallRuntimeFailureV1(handlerFailure.cause);
    if (inspected?.kind === "readBoundary" || inspected?.kind === "terminal") {
      throw handlerFailure.cause;
    }
    throw new PointQueryInternalCallRuntimeUserCodeV1Error(handlerFailure.cause);
  }

  let normalized: CanonicalFlarexRuntimeValueV1;
  try {
    normalized = normalizeFlarexValueV1(
      handlerResult === undefined ? null : handlerResult,
    ).value;
  } catch (cause) {
    throw new PointQueryInternalCallRuntimeUserCodeV1Error(cause);
  }
  if (input.function.returnsValidator !== null) {
    const resultValidation = validatorIssue(
      input.function.returnsValidator,
      normalized,
      "$result",
      tableIdsByName,
    );
    if (resultValidation !== undefined) {
      throw new PointQueryInternalCallRuntimeUserCodeV1Error(resultValidation);
    }
  }
  return normalized;
}

function validatorIssue(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  path: string,
  tableIdsByName: ReadonlyMap<string, number>,
) {
  return validateValidatorValueIssueV1(validator, value, {
    path,
    idPolicy: {
      mode: "tableAware",
      check: (tableName, documentId) => {
        const tableId = tableIdsByName.get(tableName);
        if (tableId === undefined) return "unavailable";
        const separator = documentId.indexOf(":");
        return separator > 0 && separator === documentId.lastIndexOf(":") &&
            documentId.slice(0, separator) === String(tableId) &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
              .test(documentId.slice(separator + 1))
          ? "valid"
          : "invalid";
      },
    },
  });
}

function exactQueryHandler(
  value: unknown,
  visibility: "public" | "internal",
): QueryHandler {
  if (!isPlainRecord(value)) {
    throw new PointQueryInternalCallRuntimeContractV1Error("functionMetadataInvalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const kinds = ["isQuery", "isMutation", "isWorkflowMutation", "isAction"]
    .filter(marker => Object.hasOwn(descriptors, marker));
  const visibilities = ["isPublic", "isInternal"]
    .filter(marker => Object.hasOwn(descriptors, marker));
  const handler = descriptors._handler;
  if (
    kinds.length !== 1 || kinds[0] !== "isQuery" ||
    visibilities.length !== 1 ||
    visibilities[0] !== (visibility === "public" ? "isPublic" : "isInternal") ||
    handler === undefined || !("value" in handler) ||
    typeof handler.value !== "function"
  ) {
    throw new PointQueryInternalCallRuntimeContractV1Error("functionMetadataInvalid");
  }
  return handler.value as QueryHandler;
}

function staticFunctionPath(reference: unknown): string | undefined {
  if (typeof reference === "string" && reference.length > 0) return reference;
  if (!isPlainRecord(reference)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(reference, "_path");
  return descriptor !== undefined && "value" in descriptor &&
      typeof descriptor.value === "string" && descriptor.value.length > 0
    ? descriptor.value
    : undefined;
}

function validCallBudget(
  value: PointQueryInternalCallRuntimeInputV1["callBudget"],
): boolean {
  return Number.isSafeInteger(value.maximumCalls) && value.maximumCalls > 0 &&
    Number.isSafeInteger(value.maximumDepth) && value.maximumDepth > 0 &&
    Number.isSafeInteger(value.maximumArgumentBytes) &&
    value.maximumArgumentBytes > 0 &&
    Number.isSafeInteger(value.maximumResultBytes) &&
    value.maximumResultBytes > 0;
}

function readBoundaryError(cause: unknown): PointQueryInternalCallRuntimeReadBoundaryV1Error {
  return cause instanceof PointQueryInternalCallRuntimeReadBoundaryV1Error
    ? cause
    : new PointQueryInternalCallRuntimeReadBoundaryV1Error(cause);
}

function tableIdsByLogicalName(
  tables: ReadonlyArray<PointQueryInternalCallRuntimeTableV1>,
): ReadonlyMap<string, number> {
  const output = new Map<string, number>();
  for (const table of tables) output.set(table.logicalName, table.tableId);
  return output;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function defineErrorName(error: Error, name: string): void {
  Object.defineProperty(error, "name", {
    value: name,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function contractFailureMessage(
  reason: PointQueryInternalCallRuntimeContractFailureReasonV1,
): string {
  switch (reason) {
    case "functionMissing":
      return "Unknown Flarex query function.";
    case "functionMetadataInvalid":
      return "Exact query-runtime target must be exactly one public query.";
    case "argumentsInvalid":
      return "Exact query-runtime arguments do not match the pinned validator.";
    case "validatorProjectionInvalid":
      return "Exact query-runtime validator projection exceeds its limits.";
    case "internalTargetInvalid":
      return "Exact internal-query target is unavailable or inconsistent.";
    case "callBudgetExceeded":
      return "Exact internal-query call budget is exhausted.";
    case "callCycle":
      return "Recursive internal-query calls are unavailable.";
  }
}

import type {
  CanonicalFlarexRuntimeObjectV1,
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";
import {
  isRuntimeObject,
  normalizeRuntimeValue,
  requireValidatorAdmission,
  validateValue,
} from "./pointMutationInternalQueryPrimitives";
import type {
  FunctionRuntimeMutationContextV1,
  FunctionRuntimePointDatabaseWriterV1,
  FunctionRuntimePointReaderV1,
  FunctionRuntimeQueryContextV1,
} from "./functionApiCore";

export type PointMutationInternalCallRuntimeArgsValidatorV1 =
  | ObjectValidatorJsonV1
  | Readonly<{ readonly type: "any" }>;

export interface PointMutationInternalCallRuntimeFunctionV1 {
  readonly ordinal: number;
  readonly path: string;
  readonly kind: "mutation" | "query";
  readonly visibility: "public" | "internal";
  readonly argsValidator: PointMutationInternalCallRuntimeArgsValidatorV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

export interface PointMutationInternalCallRuntimeTableV1 {
  readonly tableId: number;
  readonly logicalName: string;
}

export interface PointMutationInternalCallRuntimeInputV1 {
  readonly executionId: string;
  readonly function: PointMutationInternalCallRuntimeFunctionV1 & {
    readonly kind: "mutation";
    readonly visibility: "public";
  };
  readonly internalFunctionCatalog: ReadonlyArray<
    PointMutationInternalCallRuntimeFunctionV1 & {
      readonly kind: "query" | "mutation";
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
  readonly tables: ReadonlyArray<PointMutationInternalCallRuntimeTableV1>;
}

export interface PointMutationInternalCallFrameV1 {
  readonly rootExecutionId: string;
  readonly parentOrdinal: number;
  readonly calleeOrdinal: number;
  readonly sequence: number;
  readonly depth: number;
}

export interface CapturedPointMutationInternalCallRuntimeArgumentsV1 {
  readonly value: CanonicalFlarexRuntimeObjectV1;
  readonly semanticSizeBytes: number;
}

export interface PointMutationInternalCallRuntimeDatabaseV1
  extends FunctionRuntimePointDatabaseWriterV1<
    string,
    CanonicalFlarexRuntimeObjectV1,
    string,
    unknown,
    unknown,
    unknown
  > {}

export interface PointMutationInternalCallRuntimeQueryDatabaseV1
  extends FunctionRuntimePointReaderV1<
    string,
    CanonicalFlarexRuntimeObjectV1
  > {}

export type PointMutationInternalCallRuntimeRunQueryV1 = (
  reference: unknown,
  args?: unknown,
) => Promise<CanonicalFlarexRuntimeValueV1>;

export type PointMutationInternalCallRuntimeRunMutationV1 = (
  reference: unknown,
  args?: unknown,
) => Promise<CanonicalFlarexRuntimeValueV1>;

export interface PointMutationInternalCallRuntimeQueryContextV1
  extends FunctionRuntimeQueryContextV1<
    PointMutationInternalCallRuntimeQueryDatabaseV1,
    PointMutationInternalCallRuntimeRunQueryV1
  > {}

export interface PointMutationInternalCallRuntimeContextV1
  extends FunctionRuntimeMutationContextV1<
    PointMutationInternalCallRuntimeDatabaseV1,
    PointMutationInternalCallRuntimeRunQueryV1,
    PointMutationInternalCallRuntimeRunMutationV1
  > {}

export interface PointMutationInternalCallRuntimeJournalBoundaryV1 {
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export interface PointMutationInternalCallRuntimeInvocationV1 {
  readonly database: PointMutationInternalCallRuntimeDatabaseV1;
  readonly createQueryContext: (
    runQuery: PointMutationInternalCallRuntimeRunQueryV1,
  ) => PointMutationInternalCallRuntimeQueryContextV1;
  readonly createMutationContext: (
    runQuery: PointMutationInternalCallRuntimeRunQueryV1,
    runMutation: PointMutationInternalCallRuntimeRunMutationV1,
  ) => PointMutationInternalCallRuntimeContextV1;
  readonly journal: PointMutationInternalCallRuntimeJournalBoundaryV1;
  readonly recordCallFrame: (frame: PointMutationInternalCallFrameV1) => void;
  readonly isApplicationCatchableError: (cause: unknown) => boolean;
  readonly isCoreApplicationError: (cause: unknown) => boolean;
  readonly recordTerminalFailure: (cause: unknown) => void;
}

export function capturePointMutationInternalCallCoreApplicationErrorDataV1(
  data: unknown,
): CanonicalFlarexRuntimeValueV1 {
  return normalizeRuntimeValue(
    data,
    "$applicationError.data",
    0,
    new WeakSet(),
  ).value;
}

export interface PointMutationInternalCallRuntimeInvocationFactoryV1 {
  readonly open: () => PointMutationInternalCallRuntimeInvocationV1;
}

export interface PointMutationInternalCallFunctionRegistryV1 {
  readonly resolve: (path: string) => unknown | PromiseLike<unknown>;
}

export type PointMutationInternalCallRuntimeContractFailureReasonV1 =
  | "functionMissing"
  | "functionMetadataInvalid"
  | "argumentsInvalid"
  | "validatorProjectionInvalid"
  | "internalTargetInvalid"
  | "callBudgetExceeded"
  | "callCycle";

export class PointMutationInternalCallApplicationV1Error extends Error {
  readonly reason: "argumentsInvalid" | "resultInvalid";
  override readonly cause?: unknown;

  constructor(reason: "argumentsInvalid" | "resultInvalid", cause?: unknown) {
    super(reason === "argumentsInvalid"
      ? "Internal function arguments do not match the registered validator."
      : "Internal function result does not match the registered validator.");
    defineErrorName(this, "PointMutationInternalCallApplicationV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
  }
}

export class PointMutationInternalCallTerminalV1Error extends Error {
  readonly reason: "internalTargetInvalid" | "callBudgetExceeded" | "callCycle";
  override readonly cause?: unknown;

  constructor(
    reason: "internalTargetInvalid" | "callBudgetExceeded" | "callCycle",
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "PointMutationInternalCallTerminalV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "terminal", reason, cause }),
    );
  }
}

export class PointMutationInternalCallRuntimeContractV1Error extends Error {
  readonly reason: PointMutationInternalCallRuntimeContractFailureReasonV1;
  override readonly cause?: unknown;

  constructor(
    reason: PointMutationInternalCallRuntimeContractFailureReasonV1,
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "PointMutationInternalCallRuntimeContractV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "contract", reason, cause }),
    );
  }
}

export class PointMutationInternalCallRuntimeUserCodeV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-mutation user code failed.");
    defineErrorName(this, "PointMutationInternalCallRuntimeUserCodeV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "userCode", cause }),
    );
  }
}

export class PointMutationInternalCallRuntimeJournalBoundaryV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-mutation journal boundary failed.");
    defineErrorName(this, "PointMutationInternalCallRuntimeJournalBoundaryV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "journalBoundary", cause }),
    );
  }
}

export type PointMutationInternalCallRuntimeFailureInspectionV1 =
  | Readonly<{
      readonly kind: "contract";
      readonly reason: PointMutationInternalCallRuntimeContractFailureReasonV1;
      readonly cause: unknown;
    }>
  | Readonly<{ readonly kind: "userCode"; readonly cause: unknown }>
  | Readonly<{ readonly kind: "journalBoundary"; readonly cause: unknown }>
  | Readonly<{
      readonly kind: "terminal";
      readonly reason: PointMutationInternalCallTerminalV1Error["reason"];
      readonly cause: unknown;
    }>;

const runtimeFailureInspections = new WeakMap<
  object,
  PointMutationInternalCallRuntimeFailureInspectionV1
>();

export function inspectPointMutationInternalCallRuntimeFailureV1(
  value: unknown,
): PointMutationInternalCallRuntimeFailureInspectionV1 | undefined {
  return (
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    )
    ? runtimeFailureInspections.get(value)
    : undefined;
}

type RuntimeQueryHandler = (
  context: PointMutationInternalCallRuntimeQueryContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

type RuntimeMutationHandler = (
  context: PointMutationInternalCallRuntimeContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

type RuntimeInternalHandler =
  | Readonly<{ readonly kind: "query"; readonly handler: RuntimeQueryHandler }>
  | Readonly<{
      readonly kind: "mutation";
      readonly handler: RuntimeMutationHandler;
    }>;

export function capturePointMutationInternalCallRuntimeArgumentsV1(
  input: unknown,
): CapturedPointMutationInternalCallRuntimeArgumentsV1 {
  let normalized: ReturnType<typeof normalizeRuntimeValue>;
  try {
    normalized = normalizeRuntimeValue(input, "$arguments", 0, new WeakSet());
  } catch (cause) {
    throw new PointMutationInternalCallRuntimeContractV1Error("argumentsInvalid", cause);
  }
  if (!isRuntimeObject(normalized.value)) {
    throw new PointMutationInternalCallRuntimeContractV1Error("argumentsInvalid");
  }
  return Object.freeze({
    value: normalized.value,
    semanticSizeBytes: normalized.semanticBytes,
  });
}

export async function executePointMutationInternalCallV1(
  input: PointMutationInternalCallRuntimeInputV1,
  registry: PointMutationInternalCallFunctionRegistryV1,
  invocations: PointMutationInternalCallRuntimeInvocationFactoryV1,
): Promise<CanonicalFlarexRuntimeValueV1> {
  const tableIdsByName = tableIdsByLogicalName(input.tables);
  let validatorAdmissionFailure: unknown;
  try {
    requireValidatorAdmission(input.function.argsValidator);
    if (input.function.returnsValidator !== null) {
      requireValidatorAdmission(input.function.returnsValidator);
    }
  } catch (cause) {
    validatorAdmissionFailure = cause;
  }
  if (validatorAdmissionFailure !== undefined || input.function.kind !== "mutation" ||
    input.function.visibility !== "public" || typeof input.executionId !== "string" ||
    input.executionId.length === 0 || input.executionId.length > 512 ||
    !validCallBudget(input.callBudget)) {
    throw new PointMutationInternalCallRuntimeContractV1Error(
      "validatorProjectionInvalid",
      validatorAdmissionFailure,
    );
  }
  const catalog = new Map<string, typeof input.internalFunctionCatalog[number]>();
  const ordinals = new Set<number>();
  let previousOrdinal = -1;
  let previousPath = "";
  for (const candidate of input.internalFunctionCatalog) {
    let candidateAdmissionFailure: unknown;
    try {
      requireValidatorAdmission(candidate.argsValidator);
      if (candidate.returnsValidator !== null) {
        requireValidatorAdmission(candidate.returnsValidator);
      }
    } catch (cause) {
      candidateAdmissionFailure = cause;
    }
    if ((candidate.kind !== "query" && candidate.kind !== "mutation") ||
      candidate.visibility !== "internal" ||
      !Number.isSafeInteger(candidate.ordinal) || candidate.ordinal < 0 ||
      candidate.path.length === 0 || catalog.has(candidate.path) ||
      ordinals.has(candidate.ordinal) || candidate.ordinal < previousOrdinal ||
      (candidate.ordinal === previousOrdinal && candidate.path <= previousPath) ||
      candidateAdmissionFailure !== undefined) {
      throw new PointMutationInternalCallRuntimeContractV1Error(
        "functionMetadataInvalid",
        candidateAdmissionFailure,
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
    throw new PointMutationInternalCallRuntimeUserCodeV1Error(cause);
  }
  if (runtimeFunction === undefined) {
    throw new PointMutationInternalCallRuntimeContractV1Error("functionMissing");
  }
  const handler = exactRuntimeHandler(runtimeFunction, "mutation", "public");
  const argumentValidation = validatorIssue(
    input.function.argsValidator,
    input.arguments,
    "$arguments",
    tableIdsByName,
  );
  if (argumentValidation !== undefined) {
    throw new PointMutationInternalCallRuntimeContractV1Error(
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
    reason: PointMutationInternalCallTerminalV1Error["reason"],
    cause?: unknown,
  ): never => {
    const failure = new PointMutationInternalCallTerminalV1Error(reason, cause);
    invocation.recordTerminalFailure(failure);
    throw failure;
  };
  const queryContextsFor = (
    parentOrdinal: number,
  ): PointMutationInternalCallRuntimeQueryContextV1 => {
    const runQuery: PointMutationInternalCallRuntimeRunQueryV1 =
      (reference: unknown, args?: unknown) =>
        runInternal(parentOrdinal, "query", reference, args);
    return invocation.createQueryContext(runQuery);
  };
  const mutationContextsFor = (
    parentOrdinal: number,
  ): PointMutationInternalCallRuntimeContextV1 =>
    invocation.createMutationContext(
      (reference: unknown, args?: unknown) =>
        runInternal(parentOrdinal, "query", reference, args),
      (reference: unknown, args?: unknown) =>
        runInternal(parentOrdinal, "mutation", reference, args),
    );
  const executeInternal = async (
    parentOrdinal: number,
    expectedKind: "query" | "mutation",
    reference: unknown,
    args: unknown = {},
  ): Promise<CanonicalFlarexRuntimeValueV1> => {
    attemptedCalls += 1;
    if (attemptedCalls > input.callBudget.maximumCalls) {
      return terminal("callBudgetExceeded");
    }
    const path = staticFunctionPath(reference);
    const callee = path === undefined ? undefined : catalog.get(path);
    if (callee === undefined || callee.kind !== expectedKind) {
      return terminal("internalTargetInvalid");
    }
    if (activeOrdinals.includes(callee.ordinal)) return terminal("callCycle");
    if (activeOrdinals.length > input.callBudget.maximumDepth) {
      return terminal("callBudgetExceeded");
    }
    invocation.recordCallFrame(Object.freeze({
      rootExecutionId: input.executionId,
      parentOrdinal,
      calleeOrdinal: callee.ordinal,
      sequence: attemptedCalls,
      depth: activeOrdinals.length,
    }));
    let captured: CapturedPointMutationInternalCallRuntimeArgumentsV1;
    try { captured = capturePointMutationInternalCallRuntimeArgumentsV1(args); }
    catch (cause) {
      throw new PointMutationInternalCallApplicationV1Error(
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
      throw new PointMutationInternalCallApplicationV1Error(
        "argumentsInvalid",
        argumentIssue,
      );
    }
    let candidate: unknown;
    try { candidate = await registry.resolve(callee.path); }
    catch (cause) { return terminal("internalTargetInvalid", cause); }
    if (candidate === undefined) return terminal("internalTargetInvalid");
    let child: RuntimeInternalHandler;
    try {
      child = callee.kind === "query"
        ? Object.freeze({
            kind: "query",
            handler: exactRuntimeHandler(candidate, "query", "internal"),
          })
        : Object.freeze({
            kind: "mutation",
            handler: exactRuntimeHandler(candidate, "mutation", "internal"),
          });
    }
    catch (cause) { return terminal("internalTargetInvalid", cause); }
    activeOrdinals.push(callee.ordinal);
    try {
      let childResult: unknown;
      try {
        if (child.kind === "query") {
          const childContext = queryContextsFor(callee.ordinal);
          childResult = await child.handler(childContext, captured.value);
        } else {
          const childContext = mutationContextsFor(callee.ordinal);
          childResult = await child.handler(childContext, captured.value);
        }
      } catch (cause) {
        if (
          cause instanceof PointMutationInternalCallApplicationV1Error ||
          invocation.isApplicationCatchableError(cause)
        ) {
          throw cause;
        }
        return terminal("internalTargetInvalid", cause);
      }
      let normalizedChild: ReturnType<typeof normalizeRuntimeValue>;
      try {
        normalizedChild = normalizeRuntimeValue(
          childResult === undefined ? null : childResult,
          "$internal.result",
          0,
          new WeakSet(),
        );
      } catch (cause) {
        throw new PointMutationInternalCallApplicationV1Error(
          "resultInvalid",
          cause,
        );
      }
      resultBytes += normalizedChild.semanticBytes;
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
          throw new PointMutationInternalCallApplicationV1Error(
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
    expectedKind: "query" | "mutation",
    reference: unknown,
    args: unknown = {},
  ): Promise<CanonicalFlarexRuntimeValueV1> => {
    const call = executeInternal(parentOrdinal, expectedKind, reference, args);
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
    const rootContext = mutationContextsFor(input.function.ordinal);
    handlerResult = await handler(rootContext, input.arguments);
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
    invocation.journal.close();
  } catch (cause) {
    boundaryFailure = journalError(cause);
  }
  try {
    await invocation.journal.drain();
  } catch (cause) {
    const inspected = inspectPointMutationInternalCallRuntimeFailureV1(cause);
    boundaryFailure ??= inspected?.kind === "terminal"
      ? cause
      : journalError(cause);
  }
  if (boundaryFailure !== undefined) throw boundaryFailure;
  if (handlerFailure !== undefined) {
    const inspected = inspectPointMutationInternalCallRuntimeFailureV1(handlerFailure.cause);
    if (inspected?.kind === "journalBoundary" || inspected?.kind === "terminal") {
      throw handlerFailure.cause;
    }
    if (invocation.isCoreApplicationError(handlerFailure.cause)) {
      throw handlerFailure.cause;
    }
    throw new PointMutationInternalCallRuntimeUserCodeV1Error(handlerFailure.cause);
  }

  let normalized: CanonicalFlarexRuntimeValueV1;
  try {
    normalized = normalizeRuntimeValue(
      handlerResult === undefined ? null : handlerResult,
      "$result",
      0,
      new WeakSet(),
    ).value;
  } catch (cause) {
    throw new PointMutationInternalCallRuntimeUserCodeV1Error(cause);
  }
  if (input.function.returnsValidator !== null) {
    const resultValidation = validatorIssue(
      input.function.returnsValidator,
      normalized,
      "$result",
      tableIdsByName,
    );
    if (resultValidation !== undefined) {
      throw new PointMutationInternalCallRuntimeUserCodeV1Error(resultValidation);
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
  return validateValue(validator, value, path, tableIdsByName);
}

function exactRuntimeHandler(
  value: unknown,
  kind: "query",
  visibility: "public" | "internal",
): RuntimeQueryHandler;
function exactRuntimeHandler(
  value: unknown,
  kind: "mutation",
  visibility: "public" | "internal",
): RuntimeMutationHandler;
function exactRuntimeHandler(
  value: unknown,
  kind: "mutation" | "query",
  visibility: "public" | "internal",
): RuntimeQueryHandler | RuntimeMutationHandler {
  if (!isPlainRecord(value)) {
    throw new PointMutationInternalCallRuntimeContractV1Error("functionMetadataInvalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const kinds = ["isQuery", "isMutation", "isWorkflowMutation", "isAction"]
    .filter(marker => Object.hasOwn(descriptors, marker));
  const visibilities = ["isPublic", "isInternal"]
    .filter(marker => Object.hasOwn(descriptors, marker));
  const handler = descriptors._handler;
  if (
    kinds.length !== 1 ||
    kinds[0] !== (kind === "mutation" ? "isMutation" : "isQuery") ||
    visibilities.length !== 1 ||
    visibilities[0] !== (visibility === "public" ? "isPublic" : "isInternal") ||
    handler === undefined || !("value" in handler) ||
    typeof handler.value !== "function"
  ) {
    throw new PointMutationInternalCallRuntimeContractV1Error("functionMetadataInvalid");
  }
  return handler.value as RuntimeQueryHandler | RuntimeMutationHandler;
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
  value: PointMutationInternalCallRuntimeInputV1["callBudget"],
): boolean {
  return Number.isSafeInteger(value.maximumCalls) && value.maximumCalls > 0 &&
    Number.isSafeInteger(value.maximumDepth) && value.maximumDepth > 0 &&
    Number.isSafeInteger(value.maximumArgumentBytes) &&
    value.maximumArgumentBytes > 0 &&
    Number.isSafeInteger(value.maximumResultBytes) &&
    value.maximumResultBytes > 0;
}

function journalError(cause: unknown): PointMutationInternalCallRuntimeJournalBoundaryV1Error {
  return cause instanceof PointMutationInternalCallRuntimeJournalBoundaryV1Error
    ? cause
    : new PointMutationInternalCallRuntimeJournalBoundaryV1Error(cause);
}

function tableIdsByLogicalName(
  tables: ReadonlyArray<PointMutationInternalCallRuntimeTableV1>,
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
  reason: PointMutationInternalCallRuntimeContractFailureReasonV1,
): string {
  switch (reason) {
    case "functionMissing":
      return "Unknown Flarex point-mutation function.";
    case "functionMetadataInvalid":
      return "Exact mutation/internal-call runtime target must be exactly one public mutation.";
    case "argumentsInvalid":
      return "Exact point-mutation runtime arguments do not match the pinned validator.";
    case "validatorProjectionInvalid":
      return "Exact mutation/internal-call runtime validator projection exceeds its limits.";
    case "internalTargetInvalid":
      return "Exact internal-call target is unavailable or inconsistent.";
    case "callBudgetExceeded":
      return "Exact internal-call budget is exhausted.";
    case "callCycle":
      return "Recursive internal calls are unavailable.";
  }
}

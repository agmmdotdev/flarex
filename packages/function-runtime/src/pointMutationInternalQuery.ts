import type { UserIdentity } from "flarex-protocol/auth";
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

export type PointMutationInternalQueryRuntimeArgsValidatorV1 =
  | ObjectValidatorJsonV1
  | Readonly<{ readonly type: "any" }>;

export interface PointMutationInternalQueryRuntimeFunctionV1 {
  readonly ordinal: number;
  readonly path: string;
  readonly kind: "mutation" | "query";
  readonly visibility: "public" | "internal";
  readonly argsValidator: PointMutationInternalQueryRuntimeArgsValidatorV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

export interface PointMutationInternalQueryRuntimeTableV1 {
  readonly tableId: number;
  readonly logicalName: string;
}

export interface PointMutationInternalQueryRuntimeInputV1 {
  readonly executionId: string;
  readonly function: PointMutationInternalQueryRuntimeFunctionV1 & {
    readonly kind: "mutation";
    readonly visibility: "public";
  };
  readonly internalQueryCatalog: ReadonlyArray<
    PointMutationInternalQueryRuntimeFunctionV1 & {
      readonly kind: "query";
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
  readonly tables: ReadonlyArray<PointMutationInternalQueryRuntimeTableV1>;
}

export interface PointMutationInternalQueryFrameV1 {
  readonly rootExecutionId: string;
  readonly parentOrdinal: number;
  readonly calleeOrdinal: number;
  readonly sequence: number;
  readonly depth: number;
}

export interface CapturedPointMutationInternalQueryRuntimeArgumentsV1 {
  readonly value: CanonicalFlarexRuntimeObjectV1;
  readonly semanticSizeBytes: number;
}

export interface PointMutationInternalQueryRuntimeDatabaseV1 {
  readonly get: (
    documentId: string,
  ) => Promise<CanonicalFlarexRuntimeObjectV1 | null>;
  readonly insert: (tableName: string, fields: unknown) => Promise<string>;
  readonly patch: (documentId: string, patch: unknown) => Promise<void>;
  readonly replace: (documentId: string, fields: unknown) => Promise<void>;
  readonly delete: (documentId: string) => Promise<void>;
  readonly query: (...args: ReadonlyArray<unknown>) => never;
  readonly normalizeId: (...args: ReadonlyArray<unknown>) => never;
  readonly system: Readonly<Record<string, never>>;
}

export interface PointMutationInternalQueryRuntimeContextV1 {
  readonly auth: Readonly<{
    readonly getUserIdentity: () => Promise<UserIdentity | null>;
  }>;
  readonly db: PointMutationInternalQueryRuntimeDatabaseV1;
  readonly runQuery: (
    reference: unknown,
    args?: unknown,
  ) => Promise<CanonicalFlarexRuntimeValueV1>;
}

export interface PointMutationInternalQueryRuntimeJournalBoundaryV1 {
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export interface PointMutationInternalQueryRuntimeInvocationV1 {
  readonly context: Omit<PointMutationInternalQueryRuntimeContextV1, "runQuery">;
  readonly invokeWithContext: <A>(
    context: PointMutationInternalQueryRuntimeContextV1,
    operation: () => A | PromiseLike<A>,
  ) => Promise<Awaited<A>>;
  readonly journal: PointMutationInternalQueryRuntimeJournalBoundaryV1;
  readonly recordCallFrame: (frame: PointMutationInternalQueryFrameV1) => void;
  readonly isCoreApplicationError: (cause: unknown) => boolean;
  readonly recordTerminalFailure: (cause: unknown) => void;
}

export function capturePointMutationInternalQueryCoreApplicationErrorDataV1(
  data: unknown,
): CanonicalFlarexRuntimeValueV1 {
  return normalizeRuntimeValue(
    data,
    "$applicationError.data",
    0,
    new WeakSet(),
  ).value;
}

export interface PointMutationInternalQueryRuntimeInvocationFactoryV1 {
  readonly open: () => PointMutationInternalQueryRuntimeInvocationV1;
}

export interface PointMutationInternalQueryFunctionRegistryV1 {
  readonly resolve: (path: string) => unknown | PromiseLike<unknown>;
}

export type PointMutationInternalQueryRuntimeContractFailureReasonV1 =
  | "functionMissing"
  | "functionMetadataInvalid"
  | "argumentsInvalid"
  | "validatorProjectionInvalid"
  | "internalTargetInvalid"
  | "callBudgetExceeded"
  | "callCycle";

export class PointMutationInternalQueryApplicationV1Error extends Error {
  readonly reason: "argumentsInvalid" | "resultInvalid";
  override readonly cause?: unknown;

  constructor(reason: "argumentsInvalid" | "resultInvalid", cause?: unknown) {
    super(reason === "argumentsInvalid"
      ? "Internal query arguments do not match the registered validator."
      : "Internal query result does not match the registered validator.");
    defineErrorName(this, "PointMutationInternalQueryApplicationV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
  }
}

export class PointMutationInternalQueryTerminalV1Error extends Error {
  readonly reason: "internalTargetInvalid" | "callBudgetExceeded" | "callCycle";
  override readonly cause?: unknown;

  constructor(
    reason: "internalTargetInvalid" | "callBudgetExceeded" | "callCycle",
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "PointMutationInternalQueryTerminalV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "terminal", reason, cause }),
    );
  }
}

export class PointMutationInternalQueryRuntimeContractV1Error extends Error {
  readonly reason: PointMutationInternalQueryRuntimeContractFailureReasonV1;
  override readonly cause?: unknown;

  constructor(
    reason: PointMutationInternalQueryRuntimeContractFailureReasonV1,
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "PointMutationInternalQueryRuntimeContractV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "contract", reason, cause }),
    );
  }
}

export class PointMutationInternalQueryRuntimeUserCodeV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-mutation user code failed.");
    defineErrorName(this, "PointMutationInternalQueryRuntimeUserCodeV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "userCode", cause }),
    );
  }
}

export class PointMutationInternalQueryRuntimeJournalBoundaryV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-mutation journal boundary failed.");
    defineErrorName(this, "PointMutationInternalQueryRuntimeJournalBoundaryV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "journalBoundary", cause }),
    );
  }
}

export type PointMutationInternalQueryRuntimeFailureInspectionV1 =
  | Readonly<{
      readonly kind: "contract";
      readonly reason: PointMutationInternalQueryRuntimeContractFailureReasonV1;
      readonly cause: unknown;
    }>
  | Readonly<{ readonly kind: "userCode"; readonly cause: unknown }>
  | Readonly<{ readonly kind: "journalBoundary"; readonly cause: unknown }>
  | Readonly<{
      readonly kind: "terminal";
      readonly reason: PointMutationInternalQueryTerminalV1Error["reason"];
      readonly cause: unknown;
    }>;

const runtimeFailureInspections = new WeakMap<
  object,
  PointMutationInternalQueryRuntimeFailureInspectionV1
>();

export function inspectPointMutationInternalQueryRuntimeFailureV1(
  value: unknown,
): PointMutationInternalQueryRuntimeFailureInspectionV1 | undefined {
  return (
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    )
    ? runtimeFailureInspections.get(value)
    : undefined;
}

type RuntimeHandler = (
  context: PointMutationInternalQueryRuntimeContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

export function capturePointMutationInternalQueryRuntimeArgumentsV1(
  input: unknown,
): CapturedPointMutationInternalQueryRuntimeArgumentsV1 {
  let normalized: ReturnType<typeof normalizeRuntimeValue>;
  try {
    normalized = normalizeRuntimeValue(input, "$arguments", 0, new WeakSet());
  } catch (cause) {
    throw new PointMutationInternalQueryRuntimeContractV1Error("argumentsInvalid", cause);
  }
  if (!isRuntimeObject(normalized.value)) {
    throw new PointMutationInternalQueryRuntimeContractV1Error("argumentsInvalid");
  }
  return Object.freeze({
    value: normalized.value,
    semanticSizeBytes: normalized.semanticBytes,
  });
}

export async function executePointMutationInternalQueryV1(
  input: PointMutationInternalQueryRuntimeInputV1,
  registry: PointMutationInternalQueryFunctionRegistryV1,
  invocations: PointMutationInternalQueryRuntimeInvocationFactoryV1,
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
    throw new PointMutationInternalQueryRuntimeContractV1Error(
      "validatorProjectionInvalid",
      validatorAdmissionFailure,
    );
  }
  const catalog = new Map<string, typeof input.internalQueryCatalog[number]>();
  const ordinals = new Set<number>();
  let previousOrdinal = -1;
  let previousPath = "";
  for (const candidate of input.internalQueryCatalog) {
    let candidateAdmissionFailure: unknown;
    try {
      requireValidatorAdmission(candidate.argsValidator);
      if (candidate.returnsValidator !== null) {
        requireValidatorAdmission(candidate.returnsValidator);
      }
    } catch (cause) {
      candidateAdmissionFailure = cause;
    }
    if (candidate.kind !== "query" || candidate.visibility !== "internal" ||
      !Number.isSafeInteger(candidate.ordinal) || candidate.ordinal < 0 ||
      candidate.path.length === 0 || catalog.has(candidate.path) ||
      ordinals.has(candidate.ordinal) || candidate.ordinal < previousOrdinal ||
      (candidate.ordinal === previousOrdinal && candidate.path <= previousPath) ||
      candidateAdmissionFailure !== undefined) {
      throw new PointMutationInternalQueryRuntimeContractV1Error(
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
    throw new PointMutationInternalQueryRuntimeUserCodeV1Error(cause);
  }
  if (runtimeFunction === undefined) {
    throw new PointMutationInternalQueryRuntimeContractV1Error("functionMissing");
  }
  const handler = exactRuntimeHandler(runtimeFunction, "mutation", "public");
  const argumentValidation = validatorIssue(
    input.function.argsValidator,
    input.arguments,
    "$arguments",
    tableIdsByName,
  );
  if (argumentValidation !== undefined) {
    throw new PointMutationInternalQueryRuntimeContractV1Error(
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
    reason: PointMutationInternalQueryTerminalV1Error["reason"],
    cause?: unknown,
  ): never => {
    const failure = new PointMutationInternalQueryTerminalV1Error(reason, cause);
    invocation.recordTerminalFailure(failure);
    throw failure;
  };
  const readOnlyDatabase = makeReadOnlyDatabase(
    invocation.context.db,
    () => terminal("internalTargetInvalid", "Internal query context is read-only."),
  );
  const contextFor = (
    parentOrdinal: number,
    database: PointMutationInternalQueryRuntimeDatabaseV1,
  ):
    PointMutationInternalQueryRuntimeContextV1 => Object.freeze({
      ...invocation.context,
      db: database,
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
    let captured: CapturedPointMutationInternalQueryRuntimeArgumentsV1;
    try { captured = capturePointMutationInternalQueryRuntimeArgumentsV1(args); }
    catch (cause) {
      throw new PointMutationInternalQueryApplicationV1Error(
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
      throw new PointMutationInternalQueryApplicationV1Error(
        "argumentsInvalid",
        argumentIssue,
      );
    }
    let candidate: unknown;
    try { candidate = await registry.resolve(callee.path); }
    catch (cause) { return terminal("internalTargetInvalid", cause); }
    if (candidate === undefined) return terminal("internalTargetInvalid");
    let child: RuntimeHandler;
    try { child = exactRuntimeHandler(candidate, "query", "internal"); }
    catch (cause) { return terminal("internalTargetInvalid", cause); }
    activeOrdinals.push(callee.ordinal);
    try {
      const childContext = contextFor(callee.ordinal, readOnlyDatabase);
      let childResult: unknown;
      try {
        childResult = await invocation.invokeWithContext(
          childContext,
          () => child(childContext, captured.value),
        );
      } catch (cause) {
        if (
          cause instanceof PointMutationInternalQueryApplicationV1Error ||
          invocation.isCoreApplicationError(cause)
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
        throw new PointMutationInternalQueryApplicationV1Error(
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
          throw new PointMutationInternalQueryApplicationV1Error(
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
    const rootContext = contextFor(input.function.ordinal, invocation.context.db);
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
    invocation.journal.close();
  } catch (cause) {
    boundaryFailure = journalError(cause);
  }
  try {
    await invocation.journal.drain();
  } catch (cause) {
    const inspected = inspectPointMutationInternalQueryRuntimeFailureV1(cause);
    boundaryFailure ??= inspected?.kind === "terminal"
      ? cause
      : journalError(cause);
  }
  if (boundaryFailure !== undefined) throw boundaryFailure;
  if (handlerFailure !== undefined) {
    const inspected = inspectPointMutationInternalQueryRuntimeFailureV1(handlerFailure.cause);
    if (inspected?.kind === "journalBoundary" || inspected?.kind === "terminal") {
      throw handlerFailure.cause;
    }
    throw new PointMutationInternalQueryRuntimeUserCodeV1Error(handlerFailure.cause);
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
    throw new PointMutationInternalQueryRuntimeUserCodeV1Error(cause);
  }
  if (input.function.returnsValidator !== null) {
    const resultValidation = validatorIssue(
      input.function.returnsValidator,
      normalized,
      "$result",
      tableIdsByName,
    );
    if (resultValidation !== undefined) {
      throw new PointMutationInternalQueryRuntimeUserCodeV1Error(resultValidation);
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
  kind: "mutation" | "query",
  visibility: "public" | "internal",
): RuntimeHandler {
  if (!isPlainRecord(value)) {
    throw new PointMutationInternalQueryRuntimeContractV1Error("functionMetadataInvalid");
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
    throw new PointMutationInternalQueryRuntimeContractV1Error("functionMetadataInvalid");
  }
  return handler.value as RuntimeHandler;
}

function makeReadOnlyDatabase(
  database: PointMutationInternalQueryRuntimeDatabaseV1,
  forbidden: () => never,
): PointMutationInternalQueryRuntimeDatabaseV1 {
  return Object.freeze({
    get: database.get,
    insert: forbidden,
    patch: forbidden,
    replace: forbidden,
    delete: forbidden,
    query: forbidden,
    normalizeId: forbidden,
    system: Object.freeze({}),
  });
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
  value: PointMutationInternalQueryRuntimeInputV1["callBudget"],
): boolean {
  return Number.isSafeInteger(value.maximumCalls) && value.maximumCalls > 0 &&
    Number.isSafeInteger(value.maximumDepth) && value.maximumDepth > 0 &&
    Number.isSafeInteger(value.maximumArgumentBytes) &&
    value.maximumArgumentBytes > 0 &&
    Number.isSafeInteger(value.maximumResultBytes) &&
    value.maximumResultBytes > 0;
}

function journalError(cause: unknown): PointMutationInternalQueryRuntimeJournalBoundaryV1Error {
  return cause instanceof PointMutationInternalQueryRuntimeJournalBoundaryV1Error
    ? cause
    : new PointMutationInternalQueryRuntimeJournalBoundaryV1Error(cause);
}

function tableIdsByLogicalName(
  tables: ReadonlyArray<PointMutationInternalQueryRuntimeTableV1>,
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
  reason: PointMutationInternalQueryRuntimeContractFailureReasonV1,
): string {
  switch (reason) {
    case "functionMissing":
      return "Unknown Flarex point-mutation function.";
    case "functionMetadataInvalid":
      return "Exact mutation/internal-query runtime target must be exactly one public mutation.";
    case "argumentsInvalid":
      return "Exact point-mutation runtime arguments do not match the pinned validator.";
    case "validatorProjectionInvalid":
      return "Exact mutation/internal-query runtime validator projection exceeds its limits.";
    case "internalTargetInvalid":
      return "Exact internal-query target is unavailable or inconsistent.";
    case "callBudgetExceeded":
      return "Exact internal-query call budget is exhausted.";
    case "callCycle":
      return "Recursive internal-query calls are unavailable.";
  }
}

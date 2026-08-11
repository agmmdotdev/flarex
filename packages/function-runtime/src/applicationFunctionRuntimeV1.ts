import type { ApplicationRuntimeFunctionV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import { validateValidatorValueIssueV1 } from
  "flarex-protocol/internal/validator-engine-core";
import type { UserIdentity } from "flarex-protocol/auth";
import type {
  CanonicalFlarexRuntimeObjectV1,
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

import {
  inspectEdgeActionRuntimeFailureV1,
  openCallbackBoundary,
  type EdgeActionRuntimeCallbackBridgeV1,
  type EdgeActionRuntimeContextV1,
  type EdgeActionRuntimeLimitsV1,
} from "./edgeAction";
import type {
  FunctionRuntimeIndexRangeReaderV1,
  FunctionRuntimeMutationContextV1,
  FunctionRuntimePointDatabaseWriterV1,
  FunctionRuntimePointReaderV1,
  FunctionRuntimeRunQueryContextV1,
} from "./functionApiCore";
import {
  isPointRuntimeObjectV1,
  normalizePointRuntimeValueV1,
  requirePointRuntimeValidatorAdmissionV1,
  validatePointRuntimeValueIssueV1,
} from "./pointRuntimeCore";

export interface ApplicationFunctionRuntimeFunctionV1
  extends ApplicationRuntimeFunctionV1 {
  readonly ordinal: number;
}

export interface ApplicationFunctionRuntimeTableV1 {
  readonly tableId: number;
  readonly logicalName: string;
}

export interface ApplicationFunctionRuntimeCallBudgetV1 {
  readonly maximumCalls: number;
  readonly maximumDepth: number;
  readonly maximumArgumentBytes: number;
  readonly maximumResultBytes: number;
}

export interface ApplicationFunctionTransactionRuntimeInputV1 {
  readonly executionId: string;
  readonly function: ApplicationFunctionRuntimeFunctionV1;
  readonly internalFunctionCatalog: ReadonlyArray<
    ApplicationFunctionRuntimeFunctionV1
  >;
  readonly callBudget: ApplicationFunctionRuntimeCallBudgetV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly tables: ReadonlyArray<ApplicationFunctionRuntimeTableV1>;
}

export interface ApplicationFunctionActionRuntimeInputV1 {
  readonly function: ApplicationFunctionRuntimeFunctionV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly auth: UserIdentity | null;
}

export interface ApplicationFunctionRuntimeFrameV1 {
  readonly rootExecutionId: string;
  readonly parentOrdinal: number;
  readonly calleeOrdinal: number;
  readonly sequence: number;
  readonly depth: number;
}

export interface ApplicationFunctionRuntimeQueryDatabaseV1
  extends FunctionRuntimePointReaderV1<
      string,
      CanonicalFlarexRuntimeObjectV1
    >,
    FunctionRuntimeIndexRangeReaderV1<
      string,
      unknown,
      unknown,
      CanonicalFlarexRuntimeObjectV1
    > {}

export interface ApplicationFunctionRuntimeMutationDatabaseV1
  extends FunctionRuntimePointDatabaseWriterV1<
      string,
      CanonicalFlarexRuntimeObjectV1,
      string,
      unknown,
      unknown,
      unknown
    >,
    FunctionRuntimeIndexRangeReaderV1<
      string,
      unknown,
      unknown,
      CanonicalFlarexRuntimeObjectV1
    > {}

export type ApplicationFunctionRuntimeRunQueryV1 = (
  reference: unknown,
  argumentsValue?: unknown,
) => Promise<CanonicalFlarexRuntimeValueV1>;

export type ApplicationFunctionRuntimeRunMutationV1 = (
  reference: unknown,
  argumentsValue?: unknown,
) => Promise<CanonicalFlarexRuntimeValueV1>;

export interface ApplicationFunctionRuntimeQueryContextV1
  extends FunctionRuntimeRunQueryContextV1<
    ApplicationFunctionRuntimeQueryDatabaseV1,
    ApplicationFunctionRuntimeRunQueryV1
  > {}

export interface ApplicationFunctionRuntimeMutationContextV1
  extends FunctionRuntimeMutationContextV1<
    ApplicationFunctionRuntimeMutationDatabaseV1,
    ApplicationFunctionRuntimeRunQueryV1,
    ApplicationFunctionRuntimeRunMutationV1
  > {}

export interface ApplicationFunctionRuntimeBoundaryV1 {
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export interface ApplicationFunctionRuntimeInvocationV1 {
  readonly boundary: ApplicationFunctionRuntimeBoundaryV1;
  readonly createQueryContext: (
    runQuery: ApplicationFunctionRuntimeRunQueryV1,
  ) => ApplicationFunctionRuntimeQueryContextV1;
  readonly createMutationContext: (
    runQuery: ApplicationFunctionRuntimeRunQueryV1,
    runMutation: ApplicationFunctionRuntimeRunMutationV1,
  ) => ApplicationFunctionRuntimeMutationContextV1;
  readonly recordCallFrame: (frame: ApplicationFunctionRuntimeFrameV1) => void;
  readonly isApplicationError: (cause: unknown) => boolean;
  readonly isCoreApplicationError: (cause: unknown) => boolean;
  readonly recordTerminalFailure: (cause: unknown) => void;
}

export interface ApplicationFunctionRuntimeInvocationFactoryV1 {
  readonly open: (
    kind: "query" | "mutation",
  ) => ApplicationFunctionRuntimeInvocationV1;
}

export interface ApplicationFunctionRuntimeRegistryV1 {
  readonly resolve: (path: string) => unknown | PromiseLike<unknown>;
}

export interface ApplicationFunctionActionRuntimeCapabilitiesV1 {
  readonly callbackBridge: EdgeActionRuntimeCallbackBridgeV1;
  readonly limits: EdgeActionRuntimeLimitsV1;
  readonly isCoreApplicationError: (cause: unknown) => boolean;
}

export type ApplicationFunctionRuntimeContractFailureReasonV1 =
  | "functionMissing"
  | "functionMetadataInvalid"
  | "argumentsInvalid"
  | "validatorProjectionInvalid"
  | "internalTargetInvalid"
  | "callBudgetExceeded"
  | "callCycle"
  | "workflowMutationUnsupported"
  | "resourceExceeded";

export class ApplicationFunctionRuntimeContractV1Error extends Error {
  readonly reason: ApplicationFunctionRuntimeContractFailureReasonV1;
  override readonly cause?: unknown;

  constructor(
    reason: ApplicationFunctionRuntimeContractFailureReasonV1,
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "ApplicationFunctionRuntimeContractV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    inspections.set(this, Object.freeze({ kind: "contract", reason, cause }));
  }
}

export class ApplicationFunctionRuntimeUserCodeV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Application function user code failed.");
    defineErrorName(this, "ApplicationFunctionRuntimeUserCodeV1Error");
    this.cause = cause;
    inspections.set(this, Object.freeze({ kind: "userCode", cause }));
  }
}

export class ApplicationFunctionRuntimeBoundaryV1Error extends Error {
  readonly boundary: "read" | "journal" | "callback";
  override readonly cause: unknown;

  constructor(
    boundary: ApplicationFunctionRuntimeBoundaryV1Error["boundary"],
    cause: unknown,
  ) {
    super(`Application function ${boundary} boundary failed.`);
    defineErrorName(this, "ApplicationFunctionRuntimeBoundaryV1Error");
    this.boundary = boundary;
    this.cause = cause;
    inspections.set(
      this,
      Object.freeze({ kind: "boundary", boundary, cause }),
    );
  }
}

export class ApplicationFunctionRuntimeApplicationV1Error extends Error {
  readonly reason: "argumentsInvalid" | "resultInvalid" | "applicationError";
  override readonly cause?: unknown;

  constructor(
    reason: ApplicationFunctionRuntimeApplicationV1Error["reason"],
    cause?: unknown,
  ) {
    super(applicationFailureMessage(reason));
    defineErrorName(this, "ApplicationFunctionRuntimeApplicationV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    inspections.set(
      this,
      Object.freeze({ kind: "applicationError", reason, cause }),
    );
  }
}

export class ApplicationFunctionRuntimeTerminalV1Error extends Error {
  readonly reason:
    | "internalTargetInvalid"
    | "internalFunctionFailed"
    | "callBudgetExceeded"
    | "callCycle";
  override readonly cause?: unknown;

  constructor(
    reason: ApplicationFunctionRuntimeTerminalV1Error["reason"],
    cause?: unknown,
  ) {
    super(terminalFailureMessage(reason));
    defineErrorName(this, "ApplicationFunctionRuntimeTerminalV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    inspections.set(this, Object.freeze({ kind: "terminal", reason, cause }));
  }
}

export type ApplicationFunctionRuntimeFailureInspectionV1 =
  | Readonly<{
      readonly kind: "contract";
      readonly reason: ApplicationFunctionRuntimeContractFailureReasonV1;
      readonly cause: unknown;
    }>
  | Readonly<{ readonly kind: "userCode"; readonly cause: unknown }>
  | Readonly<{
      readonly kind: "boundary";
      readonly boundary: "read" | "journal" | "callback";
      readonly cause: unknown;
    }>
  | Readonly<{
      readonly kind: "applicationError";
      readonly reason: ApplicationFunctionRuntimeApplicationV1Error["reason"];
      readonly cause: unknown;
    }>
  | Readonly<{
      readonly kind: "terminal";
      readonly reason: ApplicationFunctionRuntimeTerminalV1Error["reason"];
      readonly cause: unknown;
    }>;

const inspections = new WeakMap<object, ApplicationFunctionRuntimeFailureInspectionV1>();
const NO_FAILURE = Symbol("applicationFunctionRuntimeNoFailure");

export function inspectApplicationFunctionRuntimeFailureV1(
  value: unknown,
): ApplicationFunctionRuntimeFailureInspectionV1 | undefined {
  return value !== null &&
      (typeof value === "object" || typeof value === "function")
    ? inspections.get(value)
    : undefined;
}

type QueryHandler = (
  context: ApplicationFunctionRuntimeQueryContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

type MutationHandler = (
  context: ApplicationFunctionRuntimeMutationContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

type ActionHandler = (
  context: EdgeActionRuntimeContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

export async function executeApplicationFunctionTransactionRuntimeV1(
  input: ApplicationFunctionTransactionRuntimeInputV1,
  registry: ApplicationFunctionRuntimeRegistryV1,
  invocations: ApplicationFunctionRuntimeInvocationFactoryV1,
): Promise<CanonicalFlarexRuntimeValueV1> {
  if (input.function.kind === "workflowMutation") {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "workflowMutationUnsupported",
    );
  }
  if (input.function.kind === "action") {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "functionMetadataInvalid",
    );
  }
  requireFunctionContract(input.function);
  requireCallBudget(input.callBudget);
  const tableIdsByName = tableIdsByLogicalName(input.tables);
  const catalog = requireInternalCatalog(
    input.internalFunctionCatalog,
    input.function,
  );
  const rootHandler = await resolveRootHandler(
    input.function,
    registry,
  );
  const argumentIssue = validatorIssue(
    input.function.args,
    input.arguments,
    "$arguments",
    tableIdsByName,
  );
  if (argumentIssue !== undefined) {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "argumentsInvalid",
      argumentIssue,
    );
  }

  let invocation: ApplicationFunctionRuntimeInvocationV1;
  try {
    invocation = invocations.open(input.function.kind);
  } catch (cause) {
    throw boundaryError(input.function.kind, cause);
  }
  let attemptedCalls = 0;
  let argumentBytes = 0;
  let resultBytes = 0;
  let firstTerminalFailure:
    | ApplicationFunctionRuntimeTerminalV1Error
    | undefined;
  const calls: Array<Promise<Readonly<{
      readonly kind: "success";
    }> | Readonly<{
      readonly kind: "failure";
      readonly failure: unknown;
    }>>> = [];
  let callAdmissionOpen = true;

  const trackCall = <Value>(
    source: Promise<Value>,
  ): Promise<Value> => {
    calls.push(source.then(
      () => Object.freeze({ kind: "success" as const }),
      failure => Object.freeze({ kind: "failure" as const, failure }),
    ));
    return source;
  };

  const terminal = (
    reason: ApplicationFunctionRuntimeTerminalV1Error["reason"],
    cause?: unknown,
  ): never => {
    const failure = new ApplicationFunctionRuntimeTerminalV1Error(reason, cause);
    firstTerminalFailure ??= failure;
    invocation.recordTerminalFailure(failure);
    throw failure;
  };

  const queryContextFor = (
    parentOrdinal: number,
    ancestry: ReadonlyArray<number>,
  ): ApplicationFunctionRuntimeQueryContextV1 =>
    invocation.createQueryContext((reference, argumentsValue) =>
      runInternal(parentOrdinal, ancestry, "query", reference, argumentsValue)
    );

  const mutationContextFor = (
    parentOrdinal: number,
    ancestry: ReadonlyArray<number>,
  ): ApplicationFunctionRuntimeMutationContextV1 =>
    invocation.createMutationContext(
      (reference, argumentsValue) =>
        runInternal(parentOrdinal, ancestry, "query", reference, argumentsValue),
      (reference, argumentsValue) =>
        runInternal(
          parentOrdinal,
          ancestry,
          "mutation",
          reference,
          argumentsValue,
        ),
    );

  const executeInternal = async (
    parentOrdinal: number,
    ancestry: ReadonlyArray<number>,
    expectedKind: "query" | "mutation",
    reference: unknown,
    argumentsValue: unknown = {},
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
    if (ancestry.includes(callee.ordinal)) return terminal("callCycle");
    if (ancestry.length >= input.callBudget.maximumDepth) {
      return terminal("callBudgetExceeded");
    }
    try {
      invocation.recordCallFrame(Object.freeze({
        rootExecutionId: input.executionId,
        parentOrdinal,
        calleeOrdinal: callee.ordinal,
        sequence: attemptedCalls,
        depth: ancestry.length,
      }));
    } catch (cause) {
      return terminal("internalTargetInvalid", cause);
    }
    const capturedArguments = captureInternalArguments(argumentsValue);
    argumentBytes = addWithinBudget(
      argumentBytes,
      capturedArguments.semanticSizeBytes,
      input.callBudget.maximumArgumentBytes,
      () => terminal("callBudgetExceeded"),
    );
    const childArgumentIssue = validatorIssue(
      callee.args,
      capturedArguments.value,
      "$internal.arguments",
      tableIdsByName,
    );
    if (childArgumentIssue !== undefined) {
      throw new ApplicationFunctionRuntimeApplicationV1Error(
        "argumentsInvalid",
        childArgumentIssue,
      );
    }
    let candidate: unknown;
    try {
      candidate = await registry.resolve(callee.path);
    } catch (cause) {
      return terminal("internalTargetInvalid", cause);
    }
    if (candidate === undefined) return terminal("internalTargetInvalid");
    let childHandler: QueryHandler | MutationHandler;
    try {
      childHandler = exactHandler(candidate, callee.kind, "internal");
    } catch (cause) {
      return terminal("internalTargetInvalid", cause);
    }
    const childAncestry = Object.freeze([...ancestry, callee.ordinal]);
    let childResult: unknown;
    try {
      childResult = callee.kind === "query"
        ? await (childHandler as QueryHandler)(
            queryContextFor(callee.ordinal, childAncestry),
            capturedArguments.value,
          )
        : await (childHandler as MutationHandler)(
            mutationContextFor(callee.ordinal, childAncestry),
            capturedArguments.value,
          );
    } catch (cause) {
      if (inspectApplicationFunctionRuntimeFailureV1(cause)?.kind === "boundary") {
        throw cause;
      }
      if (
        cause instanceof ApplicationFunctionRuntimeApplicationV1Error ||
        invocation.isApplicationError(cause) ||
        invocation.isCoreApplicationError(cause)
      ) throw cause;
      return terminal("internalFunctionFailed", cause);
    }
    let normalizedChild: ReturnType<typeof normalizePointRuntimeValueV1>;
    try {
      normalizedChild = normalizePointRuntimeValueV1(
        childResult === undefined ? null : childResult,
        "$internal.result",
      );
    } catch (cause) {
      throw new ApplicationFunctionRuntimeApplicationV1Error(
        "resultInvalid",
        cause,
      );
    }
    resultBytes = addWithinBudget(
      resultBytes,
      normalizedChild.semanticSizeBytes,
      input.callBudget.maximumResultBytes,
      () => terminal("callBudgetExceeded"),
    );
    if (callee.returns !== null) {
      const childResultIssue = validatorIssue(
        callee.returns,
        normalizedChild.value,
        "$internal.result",
        tableIdsByName,
      );
      if (childResultIssue !== undefined) {
        throw new ApplicationFunctionRuntimeApplicationV1Error(
          "resultInvalid",
          childResultIssue,
        );
      }
    }
    return normalizedChild.value;
  };

  const runInternal = (
    parentOrdinal: number,
    ancestry: ReadonlyArray<number>,
    expectedKind: "query" | "mutation",
    reference: unknown,
    argumentsValue: unknown = {},
  ): Promise<CanonicalFlarexRuntimeValueV1> => {
    if (!callAdmissionOpen) {
      let failure: unknown;
      try {
        terminal("internalTargetInvalid");
      } catch (cause) {
        failure = cause;
      }
      const rejected = Promise.reject(failure);
      void rejected.catch(() => undefined);
      return rejected;
    }
    const call = executeInternal(
      parentOrdinal,
      ancestry,
      expectedKind,
      reference,
      argumentsValue,
    );
    return trackCall(call);
  };

  let handlerResult: unknown;
  let handlerFailure: unknown | typeof NO_FAILURE = NO_FAILURE;
  const rootAncestry = Object.freeze([input.function.ordinal]);
  try {
    handlerResult = input.function.kind === "query"
      ? await (rootHandler as QueryHandler)(
          queryContextFor(input.function.ordinal, rootAncestry),
          input.arguments,
        )
      : await (rootHandler as MutationHandler)(
          mutationContextFor(input.function.ordinal, rootAncestry),
          input.arguments,
        );
  } catch (cause) {
    handlerFailure = cause;
  }

  let inspectedCallCount = 0;
  while (inspectedCallCount < calls.length) {
    const currentCalls = calls.slice(inspectedCallCount);
    await Promise.all(currentCalls);
    inspectedCallCount += currentCalls.length;
  }
  callAdmissionOpen = false;
  const finalCalls = calls.slice();
  const finalSettlements = await Promise.all(finalCalls);
  let droppedFailure: unknown | typeof NO_FAILURE = NO_FAILURE;
  for (const settlement of finalSettlements) {
    if (
      droppedFailure === NO_FAILURE &&
      settlement.kind === "failure"
    ) droppedFailure = settlement.failure;
  }
  if (handlerFailure === NO_FAILURE && droppedFailure !== NO_FAILURE) {
    handlerFailure = droppedFailure;
  }

  let closeFailure: unknown | typeof NO_FAILURE = NO_FAILURE;
  try {
    invocation.boundary.close();
  } catch (cause) {
    closeFailure = cause;
  }
  try {
    await invocation.boundary.drain();
  } catch (cause) {
    if (closeFailure === NO_FAILURE) closeFailure = cause;
  }
  if (closeFailure !== NO_FAILURE) {
    throw boundaryError(input.function.kind, closeFailure);
  }
  if (firstTerminalFailure !== undefined) throw firstTerminalFailure;
  if (handlerFailure !== NO_FAILURE) {
    const inspection = inspectApplicationFunctionRuntimeFailureV1(handlerFailure);
    if (inspection?.kind === "terminal" || inspection?.kind === "boundary") {
      throw handlerFailure;
    }
    if (inspection?.kind === "applicationError") throw handlerFailure;
    if (
      invocation.isCoreApplicationError(handlerFailure) ||
      invocation.isApplicationError(handlerFailure)
    ) {
      throw new ApplicationFunctionRuntimeApplicationV1Error(
        "applicationError",
        handlerFailure,
      );
    }
    throw new ApplicationFunctionRuntimeUserCodeV1Error(handlerFailure);
  }

  let normalizedRoot: ReturnType<typeof normalizePointRuntimeValueV1>;
  try {
    normalizedRoot = normalizePointRuntimeValueV1(
      handlerResult === undefined ? null : handlerResult,
      "$result",
    );
  } catch (cause) {
    throw new ApplicationFunctionRuntimeUserCodeV1Error(cause);
  }
  if (input.function.returns !== null) {
    const rootResultIssue = validatorIssue(
      input.function.returns,
      normalizedRoot.value,
      "$result",
      tableIdsByName,
    );
    if (rootResultIssue !== undefined) {
      throw new ApplicationFunctionRuntimeUserCodeV1Error(rootResultIssue);
    }
  }
  return normalizedRoot.value;
}

export async function executeApplicationFunctionActionRuntimeV1(
  input: ApplicationFunctionActionRuntimeInputV1,
  registry: ApplicationFunctionRuntimeRegistryV1,
  capabilities: ApplicationFunctionActionRuntimeCapabilitiesV1,
): Promise<CanonicalFlarexRuntimeValueV1> {
  if (input.function.kind !== "action") {
    throw new ApplicationFunctionRuntimeContractV1Error(
      input.function.kind === "workflowMutation"
        ? "workflowMutationUnsupported"
        : "functionMetadataInvalid",
    );
  }
  requireFunctionContract(input.function);
  const handler = await resolveRootHandler(input.function, registry) as ActionHandler;
  const argumentIssue = validateValidatorValueIssueV1(
    input.function.args,
    input.arguments,
    { path: "$arguments", idPolicy: { mode: "shapeOnly" } },
  );
  if (argumentIssue !== undefined) {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "argumentsInvalid",
      argumentIssue,
    );
  }
  let normalizedArguments: ReturnType<typeof normalizePointRuntimeValueV1>;
  try {
    normalizedArguments = normalizePointRuntimeValueV1(
      input.arguments,
      "$arguments",
    );
  } catch (cause) {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "argumentsInvalid",
      cause,
    );
  }
  if (normalizedArguments.semanticSizeBytes > capabilities.limits.maximumArgumentBytes) {
    throw new ApplicationFunctionRuntimeContractV1Error("resourceExceeded");
  }
  if (!isPointRuntimeObjectV1(normalizedArguments.value)) {
    throw new ApplicationFunctionRuntimeContractV1Error("argumentsInvalid");
  }
  let callbackBoundary: ReturnType<typeof openCallbackBoundary>;
  try {
    callbackBoundary = openCallbackBoundary(
      input.auth,
      capabilities.callbackBridge,
      capabilities.limits,
    );
  } catch (cause) {
    if (inspectEdgeActionRuntimeFailureV1(cause)?.kind === "contract") {
      throw new ApplicationFunctionRuntimeContractV1Error(
        "resourceExceeded",
        cause,
      );
    }
    throw cause;
  }
  let result: unknown;
  let handlerFailure: unknown | typeof NO_FAILURE = NO_FAILURE;
  try {
    result = await handler(
      callbackBoundary.context,
      normalizedArguments.value,
    );
  } catch (cause) {
    handlerFailure = cause;
  }
  callbackBoundary.close();
  try {
    await callbackBoundary.drain();
  } catch (cause) {
    throw new ApplicationFunctionRuntimeBoundaryV1Error("callback", cause);
  }
  if (handlerFailure !== NO_FAILURE) {
    if (inspectEdgeActionRuntimeFailureV1(handlerFailure) !== undefined) {
      throw new ApplicationFunctionRuntimeBoundaryV1Error(
        "callback",
        handlerFailure,
      );
    }
    if (capabilities.isCoreApplicationError(handlerFailure)) {
      throw new ApplicationFunctionRuntimeApplicationV1Error(
        "applicationError",
        handlerFailure,
      );
    }
    throw new ApplicationFunctionRuntimeUserCodeV1Error(handlerFailure);
  }
  let normalizedResult: ReturnType<typeof normalizePointRuntimeValueV1>;
  try {
    normalizedResult = normalizePointRuntimeValueV1(
      result === undefined ? null : result,
      "$result",
    );
  } catch (cause) {
    throw new ApplicationFunctionRuntimeUserCodeV1Error(cause);
  }
  if (normalizedResult.semanticSizeBytes > capabilities.limits.maximumResultBytes) {
    throw new ApplicationFunctionRuntimeContractV1Error("resourceExceeded");
  }
  const resultIssue = input.function.returns === null
    ? undefined
    : validateValidatorValueIssueV1(
      input.function.returns,
      normalizedResult.value,
      { path: "$result", idPolicy: { mode: "shapeOnly" } },
    );
  if (resultIssue !== undefined) {
    throw new ApplicationFunctionRuntimeUserCodeV1Error(
      new ApplicationFunctionRuntimeApplicationV1Error(
        "resultInvalid",
        resultIssue,
      ),
    );
  }
  return normalizedResult.value;
}

async function resolveRootHandler(
  definition: ApplicationFunctionRuntimeFunctionV1,
  registry: ApplicationFunctionRuntimeRegistryV1,
): Promise<QueryHandler | MutationHandler | ActionHandler> {
  let registered: unknown;
  try {
    registered = await registry.resolve(definition.path);
  } catch (cause) {
    throw new ApplicationFunctionRuntimeUserCodeV1Error(cause);
  }
  if (registered === undefined) {
    throw new ApplicationFunctionRuntimeContractV1Error("functionMissing");
  }
  return exactHandler(registered, definition.kind, definition.visibility);
}

function requireFunctionContract(
  definition: ApplicationFunctionRuntimeFunctionV1,
): void {
  let admissionFailure: unknown;
  try {
    requirePointRuntimeValidatorAdmissionV1(definition.args);
    if (definition.returns !== null) {
      requirePointRuntimeValidatorAdmissionV1(definition.returns);
    }
  } catch (cause) {
    admissionFailure = cause;
  }
  if (
    admissionFailure !== undefined ||
    !Number.isSafeInteger(definition.ordinal) ||
    definition.ordinal < 0 ||
    typeof definition.path !== "string" ||
    definition.path.length === 0 ||
    (definition.visibility !== "public" && definition.visibility !== "internal")
  ) {
    throw new ApplicationFunctionRuntimeContractV1Error(
      admissionFailure === undefined
        ? "functionMetadataInvalid"
        : "validatorProjectionInvalid",
      admissionFailure,
    );
  }
}

function requireInternalCatalog(
  definitions: ReadonlyArray<ApplicationFunctionRuntimeFunctionV1>,
  root: ApplicationFunctionRuntimeFunctionV1,
): ReadonlyMap<string, ApplicationFunctionRuntimeFunctionV1> {
  const catalog = new Map<string, ApplicationFunctionRuntimeFunctionV1>();
  const ordinals = new Set<number>();
  let previousOrdinal = -1;
  let previousPath = "";
  for (const definition of definitions) {
    requireFunctionContract(definition);
    if (
      definition.visibility !== "internal" ||
      (definition.kind !== "query" && definition.kind !== "mutation") ||
      catalog.has(definition.path) ||
      ordinals.has(definition.ordinal) ||
      definition.ordinal < previousOrdinal ||
      (definition.ordinal === previousOrdinal && definition.path <= previousPath)
    ) {
      throw new ApplicationFunctionRuntimeContractV1Error(
        "functionMetadataInvalid",
      );
    }
    previousOrdinal = definition.ordinal;
    previousPath = definition.path;
    catalog.set(definition.path, definition);
    ordinals.add(definition.ordinal);
  }
  const matchingRoot = catalog.get(root.path);
  if (
    root.visibility === "internal" &&
    (matchingRoot === undefined || matchingRoot.ordinal !== root.ordinal ||
      matchingRoot.kind !== root.kind)
  ) {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "functionMetadataInvalid",
    );
  }
  if (root.visibility === "public" && matchingRoot !== undefined) {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "functionMetadataInvalid",
    );
  }
  if (root.visibility === "public" && ordinals.has(root.ordinal)) {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "functionMetadataInvalid",
    );
  }
  return catalog;
}

function captureInternalArguments(
  input: unknown,
): Readonly<{
  readonly value: CanonicalFlarexRuntimeObjectV1;
  readonly semanticSizeBytes: number;
}> {
  let normalized: ReturnType<typeof normalizePointRuntimeValueV1>;
  try {
    normalized = normalizePointRuntimeValueV1(input, "$internal.arguments");
  } catch (cause) {
    throw new ApplicationFunctionRuntimeApplicationV1Error(
      "argumentsInvalid",
      cause,
    );
  }
  if (!isPointRuntimeObjectV1(normalized.value)) {
    throw new ApplicationFunctionRuntimeApplicationV1Error(
      "argumentsInvalid",
    );
  }
  return Object.freeze({
    value: normalized.value,
    semanticSizeBytes: normalized.semanticSizeBytes,
  });
}

function exactHandler(
  value: unknown,
  kind: ApplicationRuntimeFunctionV1["kind"],
  visibility: ApplicationRuntimeFunctionV1["visibility"],
): QueryHandler | MutationHandler | ActionHandler {
  try {
    if (!isPlainRecord(value)) {
      throw new ApplicationFunctionRuntimeContractV1Error(
        "functionMetadataInvalid",
      );
    }
    const expectedKind = kindMarker(kind);
    const expectedVisibility = visibility === "public"
      ? "isPublic"
      : "isInternal";
    const kinds = ["isQuery", "isMutation", "isWorkflowMutation", "isAction"]
      .filter(marker =>
        Object.getOwnPropertyDescriptor(value, marker) !== undefined
      );
    const visibilities = ["isPublic", "isInternal"]
      .filter(marker =>
        Object.getOwnPropertyDescriptor(value, marker) !== undefined
      );
    const handler = Object.getOwnPropertyDescriptor(value, "_handler");
    if (
      kinds.length !== 1 || kinds[0] !== expectedKind ||
      visibilities.length !== 1 || visibilities[0] !== expectedVisibility ||
      handler === undefined || !("value" in handler) ||
      typeof handler.value !== "function"
    ) {
      throw new ApplicationFunctionRuntimeContractV1Error(
        "functionMetadataInvalid",
      );
    }
    return handler.value as QueryHandler | MutationHandler | ActionHandler;
  } catch (cause) {
    if (cause instanceof ApplicationFunctionRuntimeContractV1Error) throw cause;
    throw new ApplicationFunctionRuntimeContractV1Error(
      "functionMetadataInvalid",
      cause,
    );
  }
}

function kindMarker(kind: ApplicationRuntimeFunctionV1["kind"]): string {
  switch (kind) {
    case "query": return "isQuery";
    case "mutation": return "isMutation";
    case "workflowMutation": return "isWorkflowMutation";
    case "action": return "isAction";
  }
}

function staticFunctionPath(reference: unknown): string | undefined {
  if (typeof reference === "string" && reference.length > 0) return reference;
  try {
    if (!isPlainRecord(reference)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(reference, "_path");
    return descriptor !== undefined && "value" in descriptor &&
        typeof descriptor.value === "string" && descriptor.value.length > 0
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function validatorIssue(
  validator: ValidatorJsonV1,
  value: CanonicalFlarexRuntimeValueV1,
  path: string,
  tableIdsByName: ReadonlyMap<string, number>,
) {
  return validatePointRuntimeValueIssueV1(
    validator,
    value,
    path,
    tableIdsByName,
  );
}

function tableIdsByLogicalName(
  tables: ReadonlyArray<ApplicationFunctionRuntimeTableV1>,
): ReadonlyMap<string, number> {
  const output = new Map<string, number>();
  for (const table of tables) output.set(table.logicalName, table.tableId);
  return output;
}

function requireCallBudget(value: ApplicationFunctionRuntimeCallBudgetV1): void {
  if (
    !Number.isSafeInteger(value.maximumCalls) || value.maximumCalls < 1 ||
    !Number.isSafeInteger(value.maximumDepth) || value.maximumDepth < 1 ||
    !Number.isSafeInteger(value.maximumArgumentBytes) ||
    value.maximumArgumentBytes < 1 ||
    !Number.isSafeInteger(value.maximumResultBytes) ||
    value.maximumResultBytes < 1
  ) {
    throw new ApplicationFunctionRuntimeContractV1Error(
      "functionMetadataInvalid",
    );
  }
}

function addWithinBudget(
  current: number,
  increment: number,
  maximum: number,
  exceeded: () => never,
): number {
  const next = current + increment;
  return Number.isSafeInteger(next) && next <= maximum ? next : exceeded();
}

function boundaryError(
  kind: "query" | "mutation",
  cause: unknown,
): ApplicationFunctionRuntimeBoundaryV1Error {
  return cause instanceof ApplicationFunctionRuntimeBoundaryV1Error
    ? cause
    : new ApplicationFunctionRuntimeBoundaryV1Error(
        kind === "query" ? "read" : "journal",
        cause,
      );
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<PropertyKey, unknown>> {
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
  reason: ApplicationFunctionRuntimeContractFailureReasonV1,
): string {
  switch (reason) {
    case "functionMissing": return "Application function is unavailable.";
    case "functionMetadataInvalid":
      return "Application function metadata is inconsistent.";
    case "argumentsInvalid":
      return "Application function arguments do not match the validator.";
    case "validatorProjectionInvalid":
      return "Application function validator projection exceeds its limits.";
    case "internalTargetInvalid":
      return "Application internal target is unavailable or inconsistent.";
    case "callBudgetExceeded":
      return "Application internal-call budget is exhausted.";
    case "callCycle": return "Recursive Application internal calls are unavailable.";
    case "workflowMutationUnsupported":
      return "Application workflow mutation execution is unavailable.";
    case "resourceExceeded":
      return "Application function resource budget is exhausted.";
  }
}

function applicationFailureMessage(
  reason: ApplicationFunctionRuntimeApplicationV1Error["reason"],
): string {
  switch (reason) {
    case "argumentsInvalid":
      return "Internal function arguments do not match the validator.";
    case "resultInvalid":
      return "Internal function result does not match the validator.";
    case "applicationError": return "Application function raised FlarexError.";
  }
}

function terminalFailureMessage(
  reason: ApplicationFunctionRuntimeTerminalV1Error["reason"],
): string {
  switch (reason) {
    case "internalTargetInvalid":
      return "Application internal target is unavailable or inconsistent.";
    case "internalFunctionFailed":
      return "Application internal function failed terminally.";
    case "callBudgetExceeded":
      return "Application internal-call budget is exhausted.";
    case "callCycle": return "Recursive Application internal calls are unavailable.";
  }
}

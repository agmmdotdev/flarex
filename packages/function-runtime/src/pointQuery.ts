import type { UserIdentity } from "flarex-protocol/auth";
import type {
  CanonicalFlarexRuntimeObjectV1,
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import {
  type ObjectValidatorJsonV1,
  type ValidatorJsonV1,
} from "flarex-protocol/validator-json";
import {
  isPointRuntimeObjectV1,
  normalizePointRuntimeValueV1,
  pointRuntimeValidatorAdmissionIssueV1,
  validatePointRuntimeValueIssueV1,
} from "./pointRuntimeCore";

export type PointQueryRuntimeArgsValidatorV1 =
  | ObjectValidatorJsonV1
  | Readonly<{ readonly type: "any" }>;

export interface PointQueryRuntimeFunctionV1 {
  readonly path: string;
  readonly kind: "query";
  readonly visibility: "public";
  readonly argsValidator: PointQueryRuntimeArgsValidatorV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

export interface PointQueryRuntimeTableV1 {
  readonly tableId: number;
  readonly logicalName: string;
}

export interface PointQueryRuntimeInputV1 {
  readonly function: PointQueryRuntimeFunctionV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly tables: ReadonlyArray<PointQueryRuntimeTableV1>;
}

export interface CapturedPointQueryRuntimeArgumentsV1 {
  readonly value: CanonicalFlarexRuntimeObjectV1;
  readonly semanticSizeBytes: number;
}

export interface PointQueryRuntimeDatabaseV1 {
  readonly get: (
    documentId: string,
  ) => Promise<CanonicalFlarexRuntimeObjectV1 | null>;
}

export interface PointQueryRuntimeContextV1 {
  readonly auth: Readonly<{
    readonly getUserIdentity: () => Promise<UserIdentity | null>;
  }>;
  readonly db: PointQueryRuntimeDatabaseV1;
}

export interface PointQueryRuntimeReadBoundaryV1 {
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export interface PointQueryRuntimeInvocationV1 {
  readonly context: PointQueryRuntimeContextV1;
  readonly readBoundary: PointQueryRuntimeReadBoundaryV1;
  readonly isCoreApplicationError: (cause: unknown) => boolean;
}

export interface PointQueryRuntimeInvocationFactoryV1 {
  readonly open: () => PointQueryRuntimeInvocationV1;
}

export interface PointQueryFunctionRegistryV1 {
  readonly resolve: (path: string) => unknown | PromiseLike<unknown>;
}

export type PointQueryRuntimeContractFailureReasonV1 =
  | "functionMissing"
  | "functionMetadataInvalid"
  | "argumentsInvalid"
  | "validatorProjectionInvalid";

export class PointQueryRuntimeContractV1Error extends Error {
  readonly reason: PointQueryRuntimeContractFailureReasonV1;
  override readonly cause?: unknown;

  constructor(
    reason: PointQueryRuntimeContractFailureReasonV1,
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "PointQueryRuntimeContractV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "contract", reason, cause }),
    );
  }
}

export class PointQueryRuntimeUserCodeV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-query user code failed.");
    defineErrorName(this, "PointQueryRuntimeUserCodeV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "userCode", cause }),
    );
  }
}

export class PointQueryRuntimeReadBoundaryV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-query read boundary failed.");
    defineErrorName(this, "PointQueryRuntimeReadBoundaryV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "readBoundary", cause }),
    );
  }
}

export type PointQueryRuntimeFailureInspectionV1 =
  | Readonly<{
      readonly kind: "contract";
      readonly reason: PointQueryRuntimeContractFailureReasonV1;
      readonly cause: unknown;
    }>
  | Readonly<{ readonly kind: "userCode"; readonly cause: unknown }>
  | Readonly<{ readonly kind: "readBoundary"; readonly cause: unknown }>;

const runtimeFailureInspections = new WeakMap<
  object,
  PointQueryRuntimeFailureInspectionV1
>();

export function inspectPointQueryRuntimeFailureV1(
  value: unknown,
): PointQueryRuntimeFailureInspectionV1 | undefined {
  return (
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    )
    ? runtimeFailureInspections.get(value)
    : undefined;
}

type QueryHandler = (
  context: PointQueryRuntimeContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

export function capturePointQueryRuntimeArgumentsV1(
  input: unknown,
): CapturedPointQueryRuntimeArgumentsV1 {
  let normalized: ReturnType<typeof normalizePointRuntimeValueV1>;
  try {
    normalized = normalizePointRuntimeValueV1(input);
  } catch (cause) {
    throw new PointQueryRuntimeContractV1Error("argumentsInvalid", cause);
  }
  if (!isPointRuntimeObjectV1(normalized.value)) {
    throw new PointQueryRuntimeContractV1Error("argumentsInvalid");
  }
  return Object.freeze({
    value: normalized.value,
    semanticSizeBytes: normalized.semanticSizeBytes,
  });
}

export function capturePointQueryCoreApplicationErrorDataV1(
  data: unknown,
): CanonicalFlarexRuntimeValueV1 {
  return normalizePointRuntimeValueV1(data).value;
}

export async function executePointQueryV1(
  input: PointQueryRuntimeInputV1,
  registry: PointQueryFunctionRegistryV1,
  invocations: PointQueryRuntimeInvocationFactoryV1,
): Promise<CanonicalFlarexRuntimeValueV1> {
  const tableIdsByName = tableIdsByLogicalName(input.tables);
  const argsAdmission = pointRuntimeValidatorAdmissionIssueV1(
    input.function.argsValidator,
  );
  const returnsAdmission = input.function.returnsValidator === null
    ? undefined
    : pointRuntimeValidatorAdmissionIssueV1(input.function.returnsValidator);
  if (argsAdmission !== undefined || returnsAdmission !== undefined) {
    throw new PointQueryRuntimeContractV1Error(
      "validatorProjectionInvalid",
      argsAdmission ?? returnsAdmission,
    );
  }
  let runtimeFunction: unknown;
  try {
    runtimeFunction = await registry.resolve(input.function.path);
  } catch (cause) {
    throw new PointQueryRuntimeUserCodeV1Error(cause);
  }
  if (runtimeFunction === undefined) {
    throw new PointQueryRuntimeContractV1Error("functionMissing");
  }
  const handler = exactPublicQueryHandler(runtimeFunction);
  const argumentValidation = validatorIssue(
    input.function.argsValidator,
    input.arguments,
    "$arguments",
    tableIdsByName,
  );
  if (argumentValidation !== undefined) {
    throw new PointQueryRuntimeContractV1Error(
      "argumentsInvalid",
      argumentValidation,
    );
  }

  const invocation = invocations.open();
  let handlerResult: unknown;
  let handlerFailure: Readonly<{ readonly cause: unknown }> | undefined;
  try {
    handlerResult = await handler(invocation.context, input.arguments);
  } catch (cause) {
    handlerFailure = { cause };
  }
  let boundaryFailure: PointQueryRuntimeReadBoundaryV1Error | undefined;
  try {
    invocation.readBoundary.close();
  } catch (cause) {
    boundaryFailure = readBoundaryError(cause);
  }
  try {
    await invocation.readBoundary.drain();
  } catch (cause) {
    boundaryFailure ??= readBoundaryError(cause);
  }
  if (boundaryFailure !== undefined) throw boundaryFailure;
  if (handlerFailure !== undefined) {
    const inspected = inspectPointQueryRuntimeFailureV1(handlerFailure.cause);
    if (inspected?.kind === "readBoundary") throw handlerFailure.cause;
    if (invocation.isCoreApplicationError(handlerFailure.cause)) {
      throw handlerFailure.cause;
    }
    throw new PointQueryRuntimeUserCodeV1Error(handlerFailure.cause);
  }

  let normalized: CanonicalFlarexRuntimeValueV1;
  try {
    normalized = normalizePointRuntimeValueV1(
      handlerResult === undefined ? null : handlerResult,
    ).value;
  } catch (cause) {
    throw new PointQueryRuntimeUserCodeV1Error(cause);
  }
  if (input.function.returnsValidator !== null) {
    const resultValidation = validatorIssue(
      input.function.returnsValidator,
      normalized,
      "$result",
      tableIdsByName,
    );
    if (resultValidation !== undefined) {
      throw new PointQueryRuntimeUserCodeV1Error(resultValidation);
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
  return validatePointRuntimeValueIssueV1(
    validator,
    value,
    path,
    tableIdsByName,
  );
}

function exactPublicQueryHandler(value: unknown): QueryHandler {
  if (!isPlainRecord(value)) {
    throw new PointQueryRuntimeContractV1Error("functionMetadataInvalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const kinds = ["isQuery", "isMutation", "isWorkflowMutation", "isAction"]
    .filter(marker => Object.hasOwn(descriptors, marker));
  const visibilities = ["isPublic", "isInternal"]
    .filter(marker => Object.hasOwn(descriptors, marker));
  const handler = descriptors._handler;
  if (
    kinds.length !== 1 || kinds[0] !== "isQuery" ||
    visibilities.length !== 1 || visibilities[0] !== "isPublic" ||
    handler === undefined || !("value" in handler) ||
    typeof handler.value !== "function"
  ) {
    throw new PointQueryRuntimeContractV1Error("functionMetadataInvalid");
  }
  return handler.value as QueryHandler;
}

function readBoundaryError(cause: unknown): PointQueryRuntimeReadBoundaryV1Error {
  return cause instanceof PointQueryRuntimeReadBoundaryV1Error
    ? cause
    : new PointQueryRuntimeReadBoundaryV1Error(cause);
}

function tableIdsByLogicalName(
  tables: ReadonlyArray<PointQueryRuntimeTableV1>,
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
  reason: PointQueryRuntimeContractFailureReasonV1,
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
  }
}

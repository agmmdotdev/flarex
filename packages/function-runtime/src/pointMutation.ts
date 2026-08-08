import type { UserIdentity } from "flarex-protocol/auth";
import {
  CanonicalFlarexRuntimeObjectV1,
  CanonicalFlarexRuntimeValueV1,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";
import {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
  validatorJsonAdmissionIssueV1,
} from "flarex-protocol/validator-json";
import { validateValidatorValueIssueV1 } from
  "flarex-protocol/internal/validator-engine-core";

export type PointMutationRuntimeArgsValidatorV1 =
  | ObjectValidatorJsonV1
  | Readonly<{ readonly type: "any" }>;

export interface PointMutationRuntimeFunctionV1 {
  readonly path: string;
  readonly kind: "mutation";
  readonly visibility: "public";
  readonly argsValidator: PointMutationRuntimeArgsValidatorV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}

export interface PointMutationRuntimeTableV1 {
  readonly tableId: number;
  readonly logicalName: string;
}

export interface PointMutationRuntimeInputV1 {
  readonly function: PointMutationRuntimeFunctionV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly tables: ReadonlyArray<PointMutationRuntimeTableV1>;
}

export interface PointMutationRuntimeDatabaseV1 {
  readonly get: (documentId: string) => Promise<CanonicalFlarexRuntimeObjectV1 | null>;
  readonly insert: (
    tableName: string,
    fields: unknown,
  ) => Promise<string>;
  readonly patch: (documentId: string, patch: unknown) => Promise<void>;
  readonly replace: (documentId: string, fields: unknown) => Promise<void>;
  readonly delete: (documentId: string) => Promise<void>;
}

export interface PointMutationRuntimeContextV1 {
  readonly auth: Readonly<{
    readonly getUserIdentity: () => Promise<UserIdentity | null>;
  }>;
  readonly db: PointMutationRuntimeDatabaseV1;
}

export interface PointMutationRuntimeJournalV1 {
  readonly close: () => void;
  readonly drain: () => Promise<void>;
}

export interface PointMutationRuntimeInvocationV1 {
  readonly context: PointMutationRuntimeContextV1;
  readonly journal: PointMutationRuntimeJournalV1;
  readonly isCoreApplicationError: (cause: unknown) => boolean;
}

export interface PointMutationRuntimeInvocationFactoryV1 {
  readonly open: () => PointMutationRuntimeInvocationV1;
}

export interface PointMutationFunctionRegistryV1 {
  readonly resolve: (path: string) => unknown | PromiseLike<unknown>;
}

export type PointMutationRuntimeContractFailureReasonV1 =
  | "functionMissing"
  | "functionMetadataInvalid"
  | "argumentsInvalid"
  | "validatorProjectionInvalid";

export class PointMutationRuntimeContractV1Error extends Error {
  readonly reason: PointMutationRuntimeContractFailureReasonV1;
  override readonly cause?: unknown;

  constructor(
    reason: PointMutationRuntimeContractFailureReasonV1,
    cause?: unknown,
  ) {
    super(contractFailureMessage(reason));
    defineErrorName(this, "PointMutationRuntimeContractV1Error");
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "contract", reason, cause }),
    );
  }
}

function contractFailureMessage(
  reason: PointMutationRuntimeContractFailureReasonV1,
): string {
  switch (reason) {
    case "functionMissing":
      return "Unknown Flarex function.";
    case "functionMetadataInvalid":
      return "Exact-runtime target must be exactly one public mutation.";
    case "argumentsInvalid":
      return "Exact-runtime arguments do not match the pinned validator.";
    case "validatorProjectionInvalid":
      return "Exact-runtime validator projection exceeds its limits.";
  }
}

export class PointMutationRuntimeUserCodeV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-mutation user code failed.");
    defineErrorName(this, "PointMutationRuntimeUserCodeV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "userCode", cause }),
    );
  }
}

export class PointMutationRuntimeJournalBoundaryV1Error extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Exact point-mutation journal boundary failed.");
    defineErrorName(this, "PointMutationRuntimeJournalBoundaryV1Error");
    this.cause = cause;
    runtimeFailureInspections.set(
      this,
      Object.freeze({ kind: "journalBoundary", cause }),
    );
  }
}

export type PointMutationRuntimeFailureInspectionV1 =
  | Readonly<{
      readonly kind: "contract";
      readonly reason: PointMutationRuntimeContractFailureReasonV1;
      readonly cause: unknown;
    }>
  | Readonly<{
      readonly kind: "userCode";
      readonly cause: unknown;
    }>
  | Readonly<{
      readonly kind: "journalBoundary";
      readonly cause: unknown;
    }>;

const runtimeFailureInspections = new WeakMap<
  object,
  PointMutationRuntimeFailureInspectionV1
>();

export function inspectPointMutationRuntimeFailureV1(
  value: unknown,
): PointMutationRuntimeFailureInspectionV1 | undefined {
  return (
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    )
    ? runtimeFailureInspections.get(value)
    : undefined;
}

function defineErrorName(error: Error, name: string): void {
  Object.defineProperty(error, "name", {
    value: name,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

type MutationHandler = (
  context: PointMutationRuntimeContextV1,
  argumentsValue: CanonicalFlarexRuntimeObjectV1,
) => unknown | PromiseLike<unknown>;

type UnknownRecord = Readonly<Record<string, unknown>>;

export async function executePointMutationV1(
  input: PointMutationRuntimeInputV1,
  registry: PointMutationFunctionRegistryV1,
  invocations: PointMutationRuntimeInvocationFactoryV1,
): Promise<CanonicalFlarexRuntimeValueV1> {
  const tableIdsByName = tableIdsByLogicalName(input.tables);
  const admissionIssue = validatorJsonAdmissionIssueV1(
    input.function.argsValidator,
  ) ?? (input.function.returnsValidator === null
    ? undefined
    : validatorJsonAdmissionIssueV1(input.function.returnsValidator));
  if (admissionIssue !== undefined) {
    throw new PointMutationRuntimeContractV1Error(
      "validatorProjectionInvalid",
      admissionIssue,
    );
  }
  let runtimeFunction: unknown;
  try {
    runtimeFunction = await registry.resolve(input.function.path);
  } catch (cause) {
    throw new PointMutationRuntimeUserCodeV1Error(cause);
  }
  if (runtimeFunction === undefined) {
    throw new PointMutationRuntimeContractV1Error("functionMissing");
  }
  let handler: MutationHandler;
  try {
    handler = exactPublicMutationHandler(runtimeFunction);
  } catch (cause) {
    if (cause instanceof PointMutationRuntimeContractV1Error) throw cause;
    throw new PointMutationRuntimeUserCodeV1Error(cause);
  }
  const argumentIssue = validatorIssue(
    input.function.argsValidator,
    input.arguments,
    "$arguments",
    tableIdsByName,
  );
  if (argumentIssue !== undefined) {
    throw new PointMutationRuntimeContractV1Error(
      "argumentsInvalid",
      argumentIssue,
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
  let journalFailure: PointMutationRuntimeJournalBoundaryV1Error | undefined;
  try {
    invocation.journal.close();
  } catch (cause) {
    journalFailure = journalBoundaryError(cause);
  }
  try {
    await invocation.journal.drain();
  } catch (cause) {
    journalFailure ??= journalBoundaryError(cause);
  }
  if (journalFailure !== undefined) throw journalFailure;
  if (handlerFailure !== undefined) {
    if (invocation.isCoreApplicationError(handlerFailure.cause)) {
      throw handlerFailure.cause;
    }
    throw new PointMutationRuntimeUserCodeV1Error(handlerFailure.cause);
  }

  let normalized: CanonicalFlarexRuntimeValueV1;
  try {
    normalized = normalizeFlarexValueV1(
      handlerResult === undefined ? null : handlerResult,
    ).value;
  } catch (cause) {
    throw new PointMutationRuntimeUserCodeV1Error(cause);
  }
  if (input.function.returnsValidator !== null) {
    const returnIssue = validatorIssue(
      input.function.returnsValidator,
      normalized,
      "$result",
      tableIdsByName,
    );
    if (returnIssue !== undefined) {
      throw new PointMutationRuntimeUserCodeV1Error(returnIssue);
    }
  }
  return normalized;
}

export function capturePointMutationCoreApplicationErrorDataV1(
  data: unknown,
): CanonicalFlarexRuntimeValueV1 {
  return normalizeFlarexValueV1(data).value;
}

function exactPublicMutationHandler(value: unknown): MutationHandler {
  if (!isPlainRecord(value)) {
    throw new PointMutationRuntimeContractV1Error("functionMetadataInvalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const kinds = ["isQuery", "isMutation", "isWorkflowMutation", "isAction"]
    .filter((marker) => Object.hasOwn(descriptors, marker));
  const visibilities = ["isPublic", "isInternal"]
    .filter((marker) => Object.hasOwn(descriptors, marker));
  const handler = descriptors._handler;
  if (
    kinds.length !== 1 ||
    kinds[0] !== "isMutation" ||
    visibilities.length !== 1 ||
    visibilities[0] !== "isPublic" ||
    handler === undefined ||
    !("value" in handler) ||
    typeof handler.value !== "function"
  ) {
    throw new PointMutationRuntimeContractV1Error("functionMetadataInvalid");
  }
  return handler.value as MutationHandler;
}

function journalBoundaryError(
  cause: unknown,
): PointMutationRuntimeJournalBoundaryV1Error {
  return cause instanceof PointMutationRuntimeJournalBoundaryV1Error
    ? cause
    : new PointMutationRuntimeJournalBoundaryV1Error(cause);
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

function tableIdsByLogicalName(
  tables: ReadonlyArray<PointMutationRuntimeTableV1>,
): ReadonlyMap<string, number> {
  const tableIds = new Map<string, number>();
  for (const table of tables) {
    const logicalName = table.logicalName;
    if (!tableIds.has(logicalName)) {
      tableIds.set(logicalName, table.tableId);
    }
  }
  return tableIds;
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

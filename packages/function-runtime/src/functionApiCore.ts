import type { UserIdentity } from "flarex-protocol/auth";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

const freeze = Object.freeze;

export type FunctionRuntimeAuthProjectionV1 =
  | Readonly<{ readonly kind: "anonymous" }>
  | Readonly<{ readonly kind: "user"; readonly user: UserIdentity }>;

export type FunctionRuntimeIdentityCloneV1 = (
  identity: UserIdentity,
) => UserIdentity;

export interface FunctionRuntimeAuthV1 {
  readonly getUserIdentity: () => Promise<UserIdentity | null>;
}

export type FunctionRuntimeCallableV1 = (...args: never[]) => unknown;

export interface FunctionRuntimeDatabaseContextV1<Database extends object> {
  readonly auth: Readonly<FunctionRuntimeAuthV1>;
  readonly db: Database;
}

export interface FunctionRuntimeRunQueryContextV1<
  Database extends object,
  RunQuery extends FunctionRuntimeCallableV1,
> extends FunctionRuntimeDatabaseContextV1<Database> {
  readonly runQuery: RunQuery;
}

export interface FunctionRuntimeMutationContextV1<
  Database extends object,
  RunQuery extends FunctionRuntimeCallableV1,
  RunMutation extends FunctionRuntimeCallableV1,
> extends FunctionRuntimeRunQueryContextV1<Database, RunQuery> {
  readonly runMutation: RunMutation;
}

export interface CapturedFunctionRuntimeApplicationErrorV1 {
  readonly code: string;
  readonly message: string;
  readonly data?: CanonicalFlarexRuntimeValueV1;
}

export type FunctionRuntimeApplicationErrorDataCaptureV1 = (
  data: unknown,
) => CanonicalFlarexRuntimeValueV1;

export type FunctionRuntimeApplicationErrorInvalidV1 = (
  detail?: string,
) => never;

export interface FunctionRuntimeApplicationErrorRegistryV1 {
  readonly FlarexError: FunctionRuntimeFlarexErrorConstructorV1;
  readonly create: (
    code: unknown,
    message: unknown,
    data?: unknown,
  ) => Error;
  readonly inspect: (value: unknown) => boolean;
  readonly code: (error: unknown) => string;
  readonly message: (error: unknown) => string;
  readonly data: (
    error: unknown,
  ) => CanonicalFlarexRuntimeValueV1 | undefined;
}

export interface FunctionRuntimeFlarexErrorV1 extends Error {
  readonly code: string;
  readonly data?: CanonicalFlarexRuntimeValueV1;
}

export interface FunctionRuntimeFlarexErrorConstructorV1 {
  new (
    code: unknown,
    message: unknown,
    data?: unknown,
  ): FunctionRuntimeFlarexErrorV1;
}

export type FunctionRuntimePointReadV1<DocumentId, Document> = (
  documentId: DocumentId,
) => Promise<Document | null>;

export interface FunctionRuntimePointReaderV1<DocumentId, Document> {
  readonly get: FunctionRuntimePointReadV1<DocumentId, Document>;
}

export type FunctionRuntimePointInsertV1<
  TableName,
  InsertValue,
  DocumentId,
> = (tableName: TableName, value: InsertValue) => Promise<DocumentId>;

export type FunctionRuntimePointPatchV1<DocumentId, PatchValue> = (
  documentId: DocumentId,
  value: PatchValue,
) => Promise<void>;

export type FunctionRuntimePointReplaceV1<DocumentId, ReplacementValue> = (
  documentId: DocumentId,
  value: ReplacementValue,
) => Promise<void>;

export type FunctionRuntimePointDeleteV1<DocumentId> = (
  documentId: DocumentId,
) => Promise<void>;

export interface FunctionRuntimePointWriterV1<
  DocumentId,
  TableName,
  InsertValue,
  PatchValue,
  ReplacementValue,
> {
  readonly insert: FunctionRuntimePointInsertV1<
    TableName,
    InsertValue,
    DocumentId
  >;
  readonly patch: FunctionRuntimePointPatchV1<DocumentId, PatchValue>;
  readonly replace: FunctionRuntimePointReplaceV1<
    DocumentId,
    ReplacementValue
  >;
  readonly delete: FunctionRuntimePointDeleteV1<DocumentId>;
}

export interface FunctionRuntimePointWriterPortV1<
  DocumentId,
  TableName,
  InsertValue,
  PatchValue,
  ReplacementValue,
> {
  readonly insertPointDocument: FunctionRuntimePointInsertV1<
    TableName,
    InsertValue,
    DocumentId
  >;
  readonly patchPointDocument: FunctionRuntimePointPatchV1<
    DocumentId,
    PatchValue
  >;
  readonly replacePointDocument: FunctionRuntimePointReplaceV1<
    DocumentId,
    ReplacementValue
  >;
  readonly deletePointDocument: FunctionRuntimePointDeleteV1<DocumentId>;
}

export interface FunctionRuntimePointDatabaseWriterV1<
  DocumentId,
  Document,
  TableName,
  InsertValue,
  PatchValue,
  ReplacementValue,
> extends FunctionRuntimePointReaderV1<DocumentId, Document>,
    FunctionRuntimePointWriterV1<
      DocumentId,
      TableName,
      InsertValue,
      PatchValue,
      ReplacementValue
    > {}

export function createFunctionRuntimeAuthV1(
  projection: FunctionRuntimeAuthProjectionV1,
  cloneIdentity: FunctionRuntimeIdentityCloneV1,
): Readonly<FunctionRuntimeAuthV1> {
  return freeze({
    getUserIdentity: async (): Promise<UserIdentity | null> =>
      projection.kind === "anonymous"
        ? null
        : cloneIdentity(projection.user),
  });
}

export function createFunctionRuntimePointReaderV1<DocumentId, Document>(
  readPointDocument: FunctionRuntimePointReadV1<DocumentId, Document>,
): Readonly<FunctionRuntimePointReaderV1<DocumentId, Document>> {
  return freeze({
    get: (documentId: DocumentId): Promise<Document | null> =>
      readPointDocument(documentId),
  });
}

export function createFunctionRuntimePointDatabaseWriterV1<
  DocumentId,
  Document,
  TableName,
  InsertValue,
  PatchValue,
  ReplacementValue,
>(
  reader: Readonly<FunctionRuntimePointReaderV1<DocumentId, Document>>,
  writer: Readonly<FunctionRuntimePointWriterPortV1<
    DocumentId,
    TableName,
    InsertValue,
    PatchValue,
    ReplacementValue
  >>,
): Readonly<FunctionRuntimePointDatabaseWriterV1<
  DocumentId,
  Document,
  TableName,
  InsertValue,
  PatchValue,
  ReplacementValue
>> {
  const {
    insertPointDocument,
    patchPointDocument,
    replacePointDocument,
    deletePointDocument,
  } = writer;
  return freeze({
    get: reader.get,
    insert: (tableName: TableName, value: InsertValue): Promise<DocumentId> =>
      insertPointDocument(tableName, value),
    patch: (documentId: DocumentId, value: PatchValue): Promise<void> =>
      patchPointDocument(documentId, value),
    replace: (
      documentId: DocumentId,
      value: ReplacementValue,
    ): Promise<void> => replacePointDocument(documentId, value),
    delete: (documentId: DocumentId): Promise<void> =>
      deletePointDocument(documentId),
  });
}

export function createFunctionRuntimeDatabaseContextV1<
  Database extends object,
>(
  auth: Readonly<FunctionRuntimeAuthV1>,
  db: Database,
): Readonly<FunctionRuntimeDatabaseContextV1<Database>> {
  return freeze({ auth, db });
}

export function createFunctionRuntimeRunQueryContextV1<
  Database extends object,
  RunQuery extends FunctionRuntimeCallableV1,
>(
  auth: Readonly<FunctionRuntimeAuthV1>,
  db: Database,
  runQuery: RunQuery,
): Readonly<FunctionRuntimeRunQueryContextV1<Database, RunQuery>> {
  return freeze({ auth, db, runQuery });
}

export function createMutationFunctionRuntimeContextV1<
  Database extends object,
  RunQuery extends FunctionRuntimeCallableV1,
  RunMutation extends FunctionRuntimeCallableV1,
>(
  auth: Readonly<FunctionRuntimeAuthV1>,
  db: Database,
  runQuery: RunQuery,
  runMutation: RunMutation,
): Readonly<
  FunctionRuntimeMutationContextV1<Database, RunQuery, RunMutation>
> {
  return freeze({ auth, db, runQuery, runMutation });
}

export function createFunctionRuntimeApplicationErrorRegistryV1(
  captureData: FunctionRuntimeApplicationErrorDataCaptureV1,
  invalid: FunctionRuntimeApplicationErrorInvalidV1,
): Readonly<FunctionRuntimeApplicationErrorRegistryV1> {
  const capturedByError = new WeakMap<
    object,
    CapturedFunctionRuntimeApplicationErrorV1
  >();
  const inspect = (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    capturedByError.has(value);
  const requireCaptured = (
    value: unknown,
  ): CapturedFunctionRuntimeApplicationErrorV1 => {
    if (typeof value !== "object" || value === null) return invalid();
    const captured = capturedByError.get(value);
    return captured ?? invalid();
  };
  const capture = (
    code: unknown,
    message: unknown,
    data?: unknown,
  ): CapturedFunctionRuntimeApplicationErrorV1 => {
    const capturedCode = captureFunctionRuntimeApplicationErrorTextV1(
      code,
      "code",
      invalid,
    );
    const capturedMessage = captureFunctionRuntimeApplicationErrorTextV1(
      message,
      "message",
      invalid,
    );
    return data === undefined
      ? freeze({ code: capturedCode, message: capturedMessage })
      : freeze({
          code: capturedCode,
          message: capturedMessage,
          data: captureData(data),
        });
  };
  class FlarexError extends Error implements FunctionRuntimeFlarexErrorV1 {
    readonly code: string;
    declare readonly data?: CanonicalFlarexRuntimeValueV1;

    constructor(code: unknown, message: unknown, data?: unknown) {
      const captured = capture(code, message, data);
      super(captured.message);
      Object.defineProperty(this, "name", { value: "FlarexError" });
      this.code = captured.code;
      if (captured.data !== undefined) this.data = captured.data;
      capturedByError.set(this, captured);
    }
  }
  return freeze({
    FlarexError,
    create: (code: unknown, message: unknown, data?: unknown): Error => {
      const captured = capture(code, message, data);
      const error = new Error(captured.message);
      Object.defineProperty(error, "name", { value: "CoreApplicationErrorV1" });
      capturedByError.set(error, captured);
      return error;
    },
    inspect,
    code: (error: unknown): string => requireCaptured(error).code,
    message: (error: unknown): string => requireCaptured(error).message,
    data: (error: unknown): CanonicalFlarexRuntimeValueV1 | undefined =>
      requireCaptured(error).data,
  });
}

function captureFunctionRuntimeApplicationErrorTextV1(
  value: unknown,
  field: "code" | "message",
  invalid: FunctionRuntimeApplicationErrorInvalidV1,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > 1_024
  ) {
    return invalid(
      `Core application error ${field} must be a nonempty string no greater than 1024 UTF-8 bytes.`,
    );
  }
  return value;
}

import type { UserIdentity } from "flarex-protocol/auth";

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

export interface FunctionRuntimeQueryContextV1<
  Database extends object,
  RunQuery extends FunctionRuntimeCallableV1,
> {
  readonly auth: Readonly<FunctionRuntimeAuthV1>;
  readonly db: Database;
  readonly runQuery: RunQuery;
}

export interface FunctionRuntimeMutationContextV1<
  Database extends object,
  RunQuery extends FunctionRuntimeCallableV1,
  RunMutation extends FunctionRuntimeCallableV1,
> extends FunctionRuntimeQueryContextV1<Database, RunQuery> {
  readonly runMutation: RunMutation;
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

export function createQueryFunctionRuntimeContextV1<
  Database extends object,
  RunQuery extends FunctionRuntimeCallableV1,
>(
  auth: Readonly<FunctionRuntimeAuthV1>,
  db: Database,
  runQuery: RunQuery,
): Readonly<FunctionRuntimeQueryContextV1<Database, RunQuery>> {
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

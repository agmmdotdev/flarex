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

export interface FunctionRuntimeBaseContextV1<Database extends object> {
  readonly auth: Readonly<FunctionRuntimeAuthV1>;
  readonly db: Database;
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

export function createQueryFunctionRuntimeBaseContextV1<Database extends object>(
  auth: Readonly<FunctionRuntimeAuthV1>,
  db: Database,
): Readonly<FunctionRuntimeBaseContextV1<Database>> {
  return createFunctionRuntimeBaseContextV1(auth, db);
}

export function createMutationFunctionRuntimeBaseContextV1<Database extends object>(
  auth: Readonly<FunctionRuntimeAuthV1>,
  db: Database,
): Readonly<FunctionRuntimeBaseContextV1<Database>> {
  return createFunctionRuntimeBaseContextV1(auth, db);
}

function createFunctionRuntimeBaseContextV1<Database extends object>(
  auth: Readonly<FunctionRuntimeAuthV1>,
  db: Database,
): Readonly<FunctionRuntimeBaseContextV1<Database>> {
  return freeze({ auth, db });
}

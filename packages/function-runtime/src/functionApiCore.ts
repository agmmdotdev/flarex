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

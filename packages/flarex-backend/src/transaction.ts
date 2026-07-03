import { Data, Effect } from "effect";
import { readResponseJsonOrNullEffect } from "./http";
import { partitionObjectName } from "./routing";
import { encodeFlarexId, isFlarexIdForTable } from "./ids";
import type {
  BeginResponse,
  CommitRequest,
  CommitResponse,
  DeploymentSchema,
  DocumentReadResponse,
  DocumentWrite,
  Env,
  IndexReadResponse,
  Json,
  ReadSet,
  StoredDocument,
} from "./types";

type PartitionEnv = Pick<Env, "PARTITIONS">;

type StagedWrite = Required<Pick<DocumentWrite, "id">> & Pick<DocumentWrite, "tableId" | "value">;

export type TransactionCommitOptions = {
  source?: string;
  idempotencyKey?: string;
};

export type CreateRootTransactionOptions = {
  rootTableId: number;
  preallocatedRootId: string;
};

export type TransactionBeginOptions = {
  createRoot?: CreateRootTransactionOptions;
};

type CreateRootState = CreateRootTransactionOptions & {
  consumed: boolean;
};

export class PartitionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Partition request failed with status ${status}.`);
    this.name = "PartitionRequestError";
  }
}

type PartitionHttpResponse = Pick<Response, "json" | "ok" | "status">;

export class PartitionResponseError extends Data.TaggedError("PartitionResponseError")<{
  readonly status: number;
  readonly body: unknown;
}> {}

export class PartitionFetchError extends Data.TaggedError("PartitionFetchError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class TransactionInvariantError extends Data.TaggedError("TransactionInvariantError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export type TransactionOperationError =
  | PartitionFetchError
  | PartitionResponseError
  | TransactionInvariantError;

export class SingleShardTransaction {
  private readonly readSet: ReadSet = {};
  private readonly stagedWrites = new Map<string, StagedWrite>();

  private constructor(
    private readonly partition: DurableObjectStub,
    readonly partitionKey: string,
    readonly beginTs: number,
    readonly schemaVersion: number,
    private readonly createRoot?: CreateRootState,
  ) {}

  static async begin(
    env: PartitionEnv,
    deploymentId: string,
    partitionKey: string,
    options: TransactionBeginOptions = {},
  ): Promise<SingleShardTransaction> {
    return await runTransactionOperation(
      SingleShardTransaction.beginEffect(env, deploymentId, partitionKey, options),
    );
  }

  static beginEffect(
    env: PartitionEnv,
    deploymentId: string,
    partitionKey: string,
    options: TransactionBeginOptions = {},
  ): Effect.Effect<SingleShardTransaction, TransactionOperationError> {
    return Effect.fn("SingleShardTransaction.begin")(function* () {
      const partition = env.PARTITIONS.getByName(partitionObjectName(deploymentId, partitionKey));
      const begin = yield* fetchJsonEffect<BeginResponse>(
        () => partition.fetch("https://flarex.internal/begin", { method: "POST" }),
      );
      const createRoot = options.createRoot === undefined
        ? undefined
        : {
            ...options.createRoot,
            consumed: false,
          };
      if (
        createRoot !== undefined &&
        !isFlarexIdForTable(createRoot.preallocatedRootId, createRoot.rootTableId)
      ) {
        return yield* transactionInvariantFailure(
          `Preallocated root id ${createRoot.preallocatedRootId} must be an ID for table ${createRoot.rootTableId}.`,
        );
      }
      return new SingleShardTransaction(
        partition,
        partitionKey,
        begin.beginTs,
        begin.schemaVersion,
        createRoot,
      );
    })();
  }

  static async ensureSchema(
    env: PartitionEnv,
    deploymentId: string,
    partitionKey: string,
    schema: DeploymentSchema,
  ): Promise<void> {
    return await runTransactionOperation(
      SingleShardTransaction.ensureSchemaEffect(env, deploymentId, partitionKey, schema),
    );
  }

  static ensureSchemaEffect(
    env: PartitionEnv,
    deploymentId: string,
    partitionKey: string,
    schema: DeploymentSchema,
  ): Effect.Effect<void, PartitionFetchError | PartitionResponseError> {
    return Effect.fn("SingleShardTransaction.ensureSchema")(function* () {
      const partition = env.PARTITIONS.getByName(partitionObjectName(deploymentId, partitionKey));
      const health = yield* fetchJsonEffect<{ schemaVersion: number; partitionKey?: string | null }>(
        () => partition.fetch("https://flarex.internal/health"),
      );
      if (health.schemaVersion === schema.version && health.partitionKey === partitionKey) return;

      yield* fetchJsonEffect<{ schemaVersion: number }>(
        () => partition.fetch("https://flarex.internal/schema-cache", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ partitionKey, schema }),
        }),
      );
    })();
  }

  async get(tableId: number, id: string): Promise<StoredDocument | null> {
    return await runTransactionOperation(this.getEffect(tableId, id));
  }

  getEffect(
    tableId: number,
    id: string,
  ): Effect.Effect<StoredDocument | null, PartitionFetchError | PartitionResponseError> {
    const self = this;
    return Effect.fn("SingleShardTransaction.get")(function* () {
      const staged = self.stagedWrites.get(documentKey(tableId, id));
      if (staged) {
        return staged.value === null
          ? null
          : { tableId, id, ts: self.beginTs, value: staged.value };
      }

      const result = yield* fetchJsonEffect<DocumentReadResponse>(
        () => self.partition.fetch(
          `https://flarex.internal/document?tableId=${tableId}&id=${encodeURIComponent(id)}&at=${self.beginTs}`,
        ),
      );
      mergeReadSet(self.readSet, result.readSet);
      return result.document;
    })();
  }

  async queryIndex(options: {
    indexId: number;
    lower?: string;
    upper?: string;
    limit?: number;
    cursor?: string;
    order?: "asc" | "desc";
  }): Promise<StoredDocument[]> {
    return await runTransactionOperation(this.queryIndexEffect(options));
  }

  queryIndexEffect(options: {
    indexId: number;
    lower?: string;
    upper?: string;
    limit?: number;
    cursor?: string;
    order?: "asc" | "desc";
  }): Effect.Effect<StoredDocument[], PartitionFetchError | PartitionResponseError> {
    return this.queryIndexPageEffect(options).pipe(
      Effect.map(result => result.documents),
    );
  }

  async queryIndexPage(options: {
    indexId: number;
    lower?: string;
    upper?: string;
    limit?: number;
    cursor?: string;
    order?: "asc" | "desc";
  }): Promise<{ documents: StoredDocument[]; isDone: boolean; continueCursor: string }> {
    return await runTransactionOperation(this.queryIndexPageEffect(options));
  }

  queryIndexPageEffect(options: {
    indexId: number;
    lower?: string;
    upper?: string;
    limit?: number;
    cursor?: string;
    order?: "asc" | "desc";
  }): Effect.Effect<
    { documents: StoredDocument[]; isDone: boolean; continueCursor: string },
    PartitionFetchError | PartitionResponseError
  > {
    const self = this;
    return Effect.fn("SingleShardTransaction.queryIndexPage")(function* () {
      const params = new URLSearchParams({
        indexId: String(options.indexId),
        at: String(self.beginTs),
        limit: String(options.limit ?? 100),
      });
      if (options.lower !== undefined) params.set("lower", options.lower);
      if (options.upper !== undefined) params.set("upper", options.upper);
      if (options.cursor !== undefined) params.set("cursor", options.cursor);
      if (options.order !== undefined) params.set("order", options.order);

      const result = yield* fetchJsonEffect<IndexReadResponse>(
        () => self.partition.fetch(`https://flarex.internal/index?${params}`),
      );
      mergeReadSet(self.readSet, result.readSet);
      return {
        documents: result.entries.map(entry => entry.document),
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    })();
  }

  insertEffect(
    tableId: number,
    value: Json,
    id?: string,
  ): Effect.Effect<string, TransactionInvariantError> {
    return Effect.try({
      try: () => {
        const writeId = this.idForInsert(tableId, id);
        const key = documentKey(tableId, writeId);
        if (this.stagedWrites.has(key)) {
          throw new Error(`Document ${writeId} already has a staged write.`);
        }
        this.stagedWrites.set(key, { tableId, id: writeId, value });
        return writeId;
      },
      catch: transactionInvariantError,
    });
  }

  replaceEffect(tableId: number, id: string, value: Json): Effect.Effect<void> {
    return Effect.sync(() => {
      this.stagedWrites.set(documentKey(tableId, id), { tableId, id, value });
    });
  }

  async patch(tableId: number, id: string, value: Record<string, Json>): Promise<void> {
    return await runTransactionOperation(this.patchEffect(tableId, id, value));
  }

  patchEffect(
    tableId: number,
    id: string,
    value: Record<string, Json>,
  ): Effect.Effect<void, TransactionOperationError> {
    const self = this;
    return Effect.fn("SingleShardTransaction.patch")(function* () {
      const current = yield* self.getEffect(tableId, id);
      if (current === null) {
        return yield* transactionInvariantFailure(`Cannot patch missing document ${id}.`);
      }
      if (!isJsonObject(current.value)) {
        return yield* transactionInvariantFailure(`Cannot patch non-object document ${id}.`);
      }
      yield* self.replaceEffect(tableId, id, { ...current.value, ...value });
    })();
  }

  deleteEffect(tableId: number, id: string): Effect.Effect<void> {
    return Effect.sync(() => {
      this.stagedWrites.set(documentKey(tableId, id), { tableId, id, value: null });
    });
  }

  pendingWrites(): DocumentWrite[] {
    return Array.from(this.stagedWrites.values()).map(write => ({
      tableId: write.tableId,
      id: write.id,
      value: write.value,
    }));
  }

  currentReadSet(): ReadSet {
    return cloneReadSet(this.readSet);
  }

  commit(options: TransactionCommitOptions = {}): Promise<CommitResponse> {
    return runTransactionOperation(this.commitEffect(options));
  }

  commitEffect(
    options: TransactionCommitOptions = {},
  ): Effect.Effect<CommitResponse, TransactionOperationError> {
    const self = this;
    return Effect.fn("SingleShardTransaction.commit")(function* () {
      if (self.createRoot !== undefined && !self.createRoot.consumed) {
        return yield* transactionInvariantFailure(
          `Create-root transaction must insert root document ${self.createRoot.preallocatedRootId} before commit.`,
        );
      }
      if (self.createRoot !== undefined) {
        const rootWrite = self.stagedWrites.get(
          documentKey(self.createRoot.rootTableId, self.createRoot.preallocatedRootId),
        );
        if (rootWrite === undefined || rootWrite.value === null) {
          return yield* transactionInvariantFailure(
            `Create-root transaction must commit root document ${self.createRoot.preallocatedRootId}.`,
          );
        }
      }
      const request: CommitRequest = {
        beginTs: self.beginTs,
        schemaVersion: self.schemaVersion,
        readSet: self.currentReadSet(),
        writes: self.pendingWrites(),
        ...(options.source === undefined ? {} : { source: options.source }),
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      };
      return yield* fetchJsonEffect<CommitResponse>(
        () => self.partition.fetch("https://flarex.internal/commit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
    })();
  }

  private idForInsert(tableId: number, id: string | undefined): string {
    if (this.createRoot === undefined || tableId !== this.createRoot.rootTableId) {
      return id ?? encodeFlarexId(tableId);
    }
    if (this.createRoot.consumed) {
      throw new Error(
        `Create-root transaction already inserted root document ${this.createRoot.preallocatedRootId}.`,
      );
    }
    if (id !== undefined && id !== this.createRoot.preallocatedRootId) {
      throw new Error(
        `Create-root insert for table ${tableId} must use preallocated root id ${this.createRoot.preallocatedRootId}.`,
      );
    }
    this.createRoot.consumed = true;
    return this.createRoot.preallocatedRootId;
  }
}

async function fetchJson<T>(responsePromise: Promise<Response>): Promise<T> {
  return await runTransactionOperation(fetchJsonEffect(() => responsePromise));
}

function fetchJsonEffect<T>(
  response: () => Promise<Response>,
): Effect.Effect<T, PartitionFetchError | PartitionResponseError> {
  return fetchPartitionResponse(response).pipe(
    Effect.flatMap(partitionResponse => decodePartitionJsonResponse<T>(partitionResponse)),
  );
}

function fetchPartitionResponse(response: () => Promise<Response>): Effect.Effect<Response, PartitionFetchError> {
  return Effect.tryPromise({
    try: response,
    catch: cause => new PartitionFetchError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    }),
  });
}

export const decodePartitionJsonResponse = Effect.fn("SingleShardTransaction.decodePartitionJsonResponse")(
  function* <T>(response: PartitionHttpResponse) {
    const body = yield* readPartitionResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new PartitionResponseError({
        status: response.status,
        body,
      }));
    }
    return body as T;
  },
);

function readPartitionResponseJson(response: PartitionHttpResponse): Effect.Effect<unknown> {
  return readResponseJsonOrNullEffect(response);
}

function partitionResponseErrorToRequestError(error: PartitionResponseError): PartitionRequestError {
  return new PartitionRequestError(error.status, error.body);
}

function runTransactionOperation<A>(
  effect: Effect.Effect<A, TransactionOperationError>,
): Promise<A> {
  // Deliberate runtime bridge: backend database APIs remain Promise-shaped.
  return Effect.runPromise(effect.pipe(
    Effect.mapError(transactionOperationErrorToPromiseError),
  ));
}

function transactionOperationErrorToPromiseError(error: TransactionOperationError): Error {
  if (error instanceof PartitionResponseError) {
    return partitionResponseErrorToRequestError(error);
  }
  return new Error(error.message);
}

function transactionInvariantFailure(
  message: string,
  cause?: unknown,
): Effect.Effect<never, TransactionInvariantError> {
  return Effect.fail(new TransactionInvariantError({ message, cause }));
}

function transactionInvariantError(cause: unknown): TransactionInvariantError {
  return new TransactionInvariantError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function mergeReadSet(target: ReadSet, source: ReadSet): void {
  for (const read of source.documents ?? []) {
    pushUnique(target, "documents", read, `${read.tableId}:${read.id}`);
  }
  for (const read of source.tables ?? []) {
    pushUnique(target, "tables", read, String(read.tableId));
  }
  for (const read of source.indexes ?? []) {
    pushUnique(
      target,
      "indexes",
      read,
      `${read.indexId}:${read.lower ?? ""}:${read.upper ?? ""}`,
    );
  }
}

function pushUnique<Key extends keyof ReadSet>(
  readSet: ReadSet,
  key: Key,
  value: NonNullable<ReadSet[Key]>[number],
  identity: string,
): void {
  const values = (readSet[key] ?? []) as Array<NonNullable<ReadSet[Key]>[number]>;
  const identities = new Set(
    values.map(read => {
      if ("id" in read) return `${read.tableId}:${read.id}`;
      if ("tableId" in read) return String(read.tableId);
      return `${read.indexId}:${read.lower ?? ""}:${read.upper ?? ""}`;
    }),
  );
  if (!identities.has(identity)) {
    values.push(value);
    readSet[key] = values as ReadSet[Key];
  }
}

function cloneReadSet(readSet: ReadSet): ReadSet {
  return {
    ...(readSet.documents === undefined ? {} : { documents: [...readSet.documents] }),
    ...(readSet.tables === undefined ? {} : { tables: [...readSet.tables] }),
    ...(readSet.indexes === undefined ? {} : { indexes: [...readSet.indexes] }),
  };
}

function documentKey(tableId: number, id: string): string {
  return `${tableId}:${id}`;
}

function isJsonObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

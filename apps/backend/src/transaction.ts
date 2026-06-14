import { partitionObjectName } from "./routing";
import { encodeFlarexId } from "./ids";
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

export class PartitionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Partition request failed with status ${status}.`);
    this.name = "PartitionRequestError";
  }
}

export class SingleShardTransaction {
  private readonly readSet: ReadSet = {};
  private readonly stagedWrites = new Map<string, StagedWrite>();

  private constructor(
    private readonly partition: DurableObjectStub,
    readonly beginTs: number,
    readonly schemaVersion: number,
  ) {}

  static async begin(
    env: PartitionEnv,
    deploymentId: string,
    partitionKey: string,
  ): Promise<SingleShardTransaction> {
    const partition = env.PARTITIONS.getByName(partitionObjectName(deploymentId, partitionKey));
    const begin = await fetchJson<BeginResponse>(
      partition.fetch("https://flarex.internal/begin", { method: "POST" }),
    );
    return new SingleShardTransaction(partition, begin.beginTs, begin.schemaVersion);
  }

  static async ensureSchema(
    env: PartitionEnv,
    deploymentId: string,
    partitionKey: string,
    schema: DeploymentSchema,
  ): Promise<void> {
    const partition = env.PARTITIONS.getByName(partitionObjectName(deploymentId, partitionKey));
    const health = await fetchJson<{ schemaVersion: number }>(
      partition.fetch("https://flarex.internal/health"),
    );
    if (health.schemaVersion === schema.version) return;

    await fetchJson<{ schemaVersion: number }>(
      partition.fetch("https://flarex.internal/schema-cache", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schema),
      }),
    );
  }

  async get(tableId: number, id: string): Promise<StoredDocument | null> {
    const staged = this.stagedWrites.get(documentKey(tableId, id));
    if (staged) {
      return staged.value === null
        ? null
        : { tableId, id, ts: this.beginTs, value: staged.value };
    }

    const result = await fetchJson<DocumentReadResponse>(
      this.partition.fetch(
        `https://flarex.internal/document?tableId=${tableId}&id=${encodeURIComponent(id)}&at=${this.beginTs}`,
      ),
    );
    mergeReadSet(this.readSet, result.readSet);
    return result.document;
  }

  async queryIndex(options: {
    indexId: number;
    lower?: string;
    upper?: string;
    limit?: number;
    cursor?: string;
    order?: "asc" | "desc";
  }): Promise<StoredDocument[]> {
    return (await this.queryIndexPage(options)).documents;
  }

  async queryIndexPage(options: {
    indexId: number;
    lower?: string;
    upper?: string;
    limit?: number;
    cursor?: string;
    order?: "asc" | "desc";
  }): Promise<{ documents: StoredDocument[]; isDone: boolean; continueCursor: string }> {
    const params = new URLSearchParams({
      indexId: String(options.indexId),
      at: String(this.beginTs),
      limit: String(options.limit ?? 100),
    });
    if (options.lower !== undefined) params.set("lower", options.lower);
    if (options.upper !== undefined) params.set("upper", options.upper);
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    if (options.order !== undefined) params.set("order", options.order);

    const result = await fetchJson<IndexReadResponse>(
      this.partition.fetch(`https://flarex.internal/index?${params}`),
    );
    mergeReadSet(this.readSet, result.readSet);
    return {
      documents: result.entries.map(entry => entry.document),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  }

  insert(tableId: number, value: Json, id = encodeFlarexId(tableId)): string {
    const key = documentKey(tableId, id);
    if (this.stagedWrites.has(key)) {
      throw new Error(`Document ${id} already has a staged write.`);
    }
    this.stagedWrites.set(key, { tableId, id, value });
    return id;
  }

  replace(tableId: number, id: string, value: Json): void {
    this.stagedWrites.set(documentKey(tableId, id), { tableId, id, value });
  }

  async patch(tableId: number, id: string, value: Record<string, Json>): Promise<void> {
    const current = await this.get(tableId, id);
    if (current === null) {
      throw new Error(`Cannot patch missing document ${id}.`);
    }
    if (!isJsonObject(current.value)) {
      throw new Error(`Cannot patch non-object document ${id}.`);
    }
    this.replace(tableId, id, { ...current.value, ...value });
  }

  delete(tableId: number, id: string): void {
    this.stagedWrites.set(documentKey(tableId, id), { tableId, id, value: null });
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
    const request: CommitRequest = {
      beginTs: this.beginTs,
      schemaVersion: this.schemaVersion,
      readSet: this.currentReadSet(),
      writes: this.pendingWrites(),
      ...(options.source === undefined ? {} : { source: options.source }),
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    };
    return fetchJson<CommitResponse>(
      this.partition.fetch("https://flarex.internal/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
  }
}

async function fetchJson<T>(responsePromise: Promise<Response>): Promise<T> {
  const response = await responsePromise;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PartitionRequestError(response.status, body);
  return body as T;
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

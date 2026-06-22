import type {
  ApplyFreshnessCommitResult as DurableApplyFreshnessCommitResult,
  DocumentFreshnessVersionRecord,
  FreshnessProcessedEventRecord,
  HasIndexEntryAfterTsInput,
  OutboxEventRecord,
  TableFreshnessVersionRecord,
} from "@flarex/persistence-postgres";

export interface FreshnessOutboxEventKey {
  deploymentId: string;
  ts: number;
  sequence: number;
}

export interface FreshnessVersion {
  deploymentId: string;
  version: number;
  outboxTs: number;
  outboxSequence: number;
}

export interface DocumentFreshnessVersion extends FreshnessVersion {
  documentId: string;
}

export interface TableFreshnessVersion extends FreshnessVersion {
  tableId: number;
}

export interface ApplyCommitFreshnessInput {
  eventKey: FreshnessOutboxEventKey;
  commitTs: number;
  documentIds: string[];
  tableIds: number[];
}

export interface ApplyCommitFreshnessResult {
  applied: boolean;
  documentVersions: DocumentFreshnessVersion[];
  tableVersions: TableFreshnessVersion[];
}

export interface FreshnessMirrorStore {
  applyCommitFreshness(
    input: ApplyCommitFreshnessInput,
  ): Promise<ApplyCommitFreshnessResult>;
  getDocumentVersion(
    deploymentId: string,
    documentId: string,
  ): DocumentFreshnessVersion | null | Promise<DocumentFreshnessVersion | null>;
  getTableVersion(
    deploymentId: string,
    tableId: number,
  ): TableFreshnessVersion | null | Promise<TableFreshnessVersion | null>;
  hasIndexEntryAfterTs?(
    input: HasIndexEntryAfterTsInput,
  ): boolean | Promise<boolean>;
}

export interface DurableFreshnessMirrorPersistence {
  applyFreshnessCommit(
    input: ApplyCommitFreshnessInput,
  ): Promise<DurableApplyFreshnessCommitResult>;
  getFreshnessProcessedEvent(
    input: FreshnessOutboxEventKey,
  ): Promise<FreshnessProcessedEventRecord | null>;
  getDocumentFreshnessVersion(
    deploymentId: string,
    documentId: string,
  ): Promise<DocumentFreshnessVersionRecord | null>;
  getTableFreshnessVersion(
    deploymentId: string,
    tableId: number,
  ): Promise<TableFreshnessVersionRecord | null>;
  hasIndexEntryAfterTs(input: HasIndexEntryAfterTsInput): Promise<boolean>;
}

export interface ApplyOutboxEventsToFreshnessMirrorInput {
  store: FreshnessMirrorStore;
  events: OutboxEventRecord[];
}

export interface ApplyOutboxEventsToFreshnessMirrorResult {
  processed: number;
  skipped: number;
  documentVersions: DocumentFreshnessVersion[];
  tableVersions: TableFreshnessVersion[];
}

export type FreshnessDeliveryHandler = (
  events: OutboxEventRecord[],
) => Promise<ApplyOutboxEventsToFreshnessMirrorResult>;

export interface FreshnessReadSet {
  documents?: Array<{
    tableId: number;
    id: string;
    observedTs: number | null;
  }>;
  tables?: Array<{
    tableId: number;
    observedTs: number;
  }>;
  indexes?: Array<{
    indexId: number;
    observedTs: number;
    lower?: string;
    upper?: string;
  }>;
}

export interface FreshnessSourceReadSet {
  documents?: Array<{
    tableId: number;
    id: string;
    observedTs?: number | null;
  }>;
  tables?: Array<{
    tableId: number;
    observedTs?: number;
  }>;
  indexes?: Array<{
    indexId: number;
    observedTs?: number;
    lower?: string;
    upper?: string;
  }>;
}

export type ReadSetFreshnessStatus = "fresh" | "stale" | "unsupported";

export type ReadSetFreshnessStaleDependency =
  | {
      kind: "document";
      id: string;
      observedTs: number | null;
      version: number;
    }
  | {
      kind: "table";
      id: string;
      observedTs: number;
      version: number;
    }
  | {
      kind: "index";
      indexId: number;
      observedTs: number;
      lower?: string;
      upper?: string;
    };

export interface ReadSetFreshnessUnsupportedDependency {
  kind: "index";
  indexId: number;
  reason: string;
}

export interface CheckReadSetFreshnessInput {
  store: FreshnessMirrorStore;
  deploymentId: string;
  readSet: FreshnessReadSet;
}

export interface CheckReadSetFreshnessResult {
  status: ReadSetFreshnessStatus;
  stale: ReadSetFreshnessStaleDependency[];
  unsupported: ReadSetFreshnessUnsupportedDependency[];
}

export class FreshnessOutboxEventShapeError extends Error {
  constructor(message: string) {
    super(`Invalid freshness outbox event: ${message}`);
    this.name = "FreshnessOutboxEventShapeError";
  }
}

export async function applyOutboxEventsToFreshnessMirror(
  input: ApplyOutboxEventsToFreshnessMirrorInput,
): Promise<ApplyOutboxEventsToFreshnessMirrorResult> {
  const documentVersions: DocumentFreshnessVersion[] = [];
  const tableVersions: TableFreshnessVersion[] = [];
  let processed = 0;
  let skipped = 0;

  for (const outboxEvent of input.events) {
    const commit = parseCommitOutboxEvent(outboxEvent);
    const result = await input.store.applyCommitFreshness({
      eventKey: {
        deploymentId: outboxEvent.deploymentId,
        ts: outboxEvent.ts,
        sequence: outboxEvent.sequence,
      },
      commitTs: commit.commitTs,
      documentIds: commit.changedDocumentIds,
      tableIds: commit.changedTableIds,
    });
    if (result.applied) {
      processed += 1;
      documentVersions.push(...result.documentVersions);
      tableVersions.push(...result.tableVersions);
    } else {
      skipped += 1;
    }
  }

  return {
    processed,
    skipped,
    documentVersions,
    tableVersions,
  };
}

export class MemoryFreshnessMirrorStore implements FreshnessMirrorStore {
  private readonly processedEvents = new Set<string>();
  private readonly documentVersions = new Map<string, DocumentFreshnessVersion>();
  private readonly tableVersions = new Map<string, TableFreshnessVersion>();

  async applyCommitFreshness(
    input: ApplyCommitFreshnessInput,
  ): Promise<ApplyCommitFreshnessResult> {
    const eventKey = freshnessEventKey(input.eventKey);
    if (this.processedEvents.has(eventKey)) {
      return {
        applied: false,
        documentVersions: [],
        tableVersions: [],
      };
    }

    this.processedEvents.add(eventKey);
    const documentVersions = input.documentIds.map((documentId) =>
      this.applyDocumentVersion(input, documentId),
    );
    const tableVersions = input.tableIds.map((tableId) =>
      this.applyTableVersion(input, tableId),
    );

    return {
      applied: true,
      documentVersions,
      tableVersions,
    };
  }

  getProcessedEvent(input: FreshnessOutboxEventKey): boolean {
    return this.processedEvents.has(freshnessEventKey(input));
  }

  getDocumentVersion(
    deploymentId: string,
    documentId: string,
  ): DocumentFreshnessVersion | null {
    return this.documentVersions.get(`${deploymentId}:${documentId}`) ?? null;
  }

  getTableVersion(
    deploymentId: string,
    tableId: number,
  ): TableFreshnessVersion | null {
    return this.tableVersions.get(`${deploymentId}:${tableId}`) ?? null;
  }

  private applyDocumentVersion(
    input: ApplyCommitFreshnessInput,
    documentId: string,
  ): DocumentFreshnessVersion {
    const key = `${input.eventKey.deploymentId}:${documentId}`;
    const next: DocumentFreshnessVersion = {
      deploymentId: input.eventKey.deploymentId,
      documentId,
      version: input.commitTs,
      outboxTs: input.eventKey.ts,
      outboxSequence: input.eventKey.sequence,
    };
    const current = this.documentVersions.get(key);
    if (current === undefined || current.version <= next.version) {
      this.documentVersions.set(key, next);
      return next;
    }
    return current;
  }

  private applyTableVersion(
    input: ApplyCommitFreshnessInput,
    tableId: number,
  ): TableFreshnessVersion {
    const key = `${input.eventKey.deploymentId}:${tableId}`;
    const next: TableFreshnessVersion = {
      deploymentId: input.eventKey.deploymentId,
      tableId,
      version: input.commitTs,
      outboxTs: input.eventKey.ts,
      outboxSequence: input.eventKey.sequence,
    };
    const current = this.tableVersions.get(key);
    if (current === undefined || current.version <= next.version) {
      this.tableVersions.set(key, next);
      return next;
    }
    return current;
  }
}

export function createMemoryFreshnessMirrorStore(): MemoryFreshnessMirrorStore {
  return new MemoryFreshnessMirrorStore();
}

export class PostgresFreshnessMirrorStore implements FreshnessMirrorStore {
  constructor(private readonly persistence: DurableFreshnessMirrorPersistence) {}

  async applyCommitFreshness(
    input: ApplyCommitFreshnessInput,
  ): Promise<ApplyCommitFreshnessResult> {
    return await this.persistence.applyFreshnessCommit(input);
  }

  async getProcessedEvent(
    input: FreshnessOutboxEventKey,
  ): Promise<boolean> {
    return (await this.persistence.getFreshnessProcessedEvent(input)) !== null;
  }

  async getDocumentVersion(
    deploymentId: string,
    documentId: string,
  ): Promise<DocumentFreshnessVersion | null> {
    return await this.persistence.getDocumentFreshnessVersion(
      deploymentId,
      documentId,
    );
  }

  async getTableVersion(
    deploymentId: string,
    tableId: number,
  ): Promise<TableFreshnessVersion | null> {
    return await this.persistence.getTableFreshnessVersion(deploymentId, tableId);
  }

  async hasIndexEntryAfterTs(
    input: HasIndexEntryAfterTsInput,
  ): Promise<boolean> {
    return await this.persistence.hasIndexEntryAfterTs(input);
  }
}

export function createPostgresFreshnessMirrorStore(
  persistence: DurableFreshnessMirrorPersistence,
): PostgresFreshnessMirrorStore {
  return new PostgresFreshnessMirrorStore(persistence);
}

export function createFreshnessDeliveryHandler(
  store: FreshnessMirrorStore,
): FreshnessDeliveryHandler {
  return async (events) =>
    await applyOutboxEventsToFreshnessMirror({ store, events });
}

export function createPostgresFreshnessDeliveryHandler(
  persistence: DurableFreshnessMirrorPersistence,
): FreshnessDeliveryHandler {
  return createFreshnessDeliveryHandler(
    createPostgresFreshnessMirrorStore(persistence),
  );
}

export function readSetToFreshnessReadSet(
  readSet: FreshnessSourceReadSet,
  observedTs: number,
): FreshnessReadSet {
  return {
    ...(readSet.documents === undefined
      ? {}
      : {
          documents: readSet.documents.map((read) => ({
            tableId: read.tableId,
            id: read.id,
            observedTs: optionalObservedTimestamp(read.observedTs, observedTs),
          })),
        }),
    ...(readSet.tables === undefined
      ? {}
      : {
          tables: readSet.tables.map((read) => ({
            tableId: read.tableId,
            observedTs: read.observedTs ?? observedTs,
          })),
        }),
    ...(readSet.indexes === undefined
      ? {}
      : {
          indexes: readSet.indexes.map((read) => ({
            indexId: read.indexId,
            observedTs: read.observedTs ?? observedTs,
            ...(read.lower === undefined ? {} : { lower: read.lower }),
            ...(read.upper === undefined ? {} : { upper: read.upper }),
          })),
        }),
  };
}

export async function checkReadSetFreshness(
  input: CheckReadSetFreshnessInput,
): Promise<CheckReadSetFreshnessResult> {
  const stale: ReadSetFreshnessStaleDependency[] = [];
  const unsupported: ReadSetFreshnessUnsupportedDependency[] = [];

  for (const read of input.readSet.documents ?? []) {
    const version = await input.store.getDocumentVersion(
      input.deploymentId,
      read.id,
    );
    if (version !== null && isStale(read.observedTs, version.version)) {
      stale.push({
        kind: "document",
        id: read.id,
        observedTs: read.observedTs,
        version: version.version,
      });
    }
  }

  for (const read of input.readSet.tables ?? []) {
    const version = await input.store.getTableVersion(
      input.deploymentId,
      read.tableId,
    );
    if (version !== null && isStale(read.observedTs, version.version)) {
      stale.push({
        kind: "table",
        id: String(read.tableId),
        observedTs: read.observedTs,
        version: version.version,
      });
    }
  }

  for (const read of input.readSet.indexes ?? []) {
    if (input.store.hasIndexEntryAfterTs === undefined) {
      unsupported.push({
        kind: "index",
        indexId: read.indexId,
        reason: "index/range freshness requires durable index history",
      });
      continue;
    }

    const changed = await input.store.hasIndexEntryAfterTs({
      deploymentId: input.deploymentId,
      indexId: read.indexId,
      afterTs: read.observedTs,
      ...(read.lower === undefined ? {} : { lower: read.lower }),
      ...(read.upper === undefined ? {} : { upper: read.upper }),
    });
    if (changed) {
      stale.push({
        kind: "index",
        indexId: read.indexId,
        observedTs: read.observedTs,
        ...(read.lower === undefined ? {} : { lower: read.lower }),
        ...(read.upper === undefined ? {} : { upper: read.upper }),
      });
    }
  }

  return {
    status:
      unsupported.length > 0
        ? "unsupported"
        : stale.length > 0
          ? "stale"
          : "fresh",
    stale,
    unsupported,
  };
}

function parseCommitOutboxEvent(input: OutboxEventRecord): {
  commitTs: number;
  changedTableIds: number[];
  changedDocumentIds: string[];
} {
  const event = input.event;
  if (event["type"] !== "commit") {
    throw new FreshnessOutboxEventShapeError(
      `expected commit event at ${input.deploymentId}@${input.ts}/${input.sequence}`,
    );
  }
  if (event["deploymentId"] !== input.deploymentId) {
    throw new FreshnessOutboxEventShapeError(
      `event deploymentId does not match outbox row at ${input.deploymentId}@${input.ts}/${input.sequence}`,
    );
  }
  const commitTs = event["commitTs"];
  if (typeof commitTs !== "number" || !Number.isFinite(commitTs)) {
    throw new FreshnessOutboxEventShapeError("commitTs must be a finite number");
  }
  return {
    commitTs,
    changedTableIds: parseNumberArray(
      event["changedTableIds"],
      "changedTableIds",
    ),
    changedDocumentIds: parseStringArray(
      event["changedDocumentIds"],
      "changedDocumentIds",
    ),
  };
}

function parseNumberArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || !value.every((item) => Number.isInteger(item))) {
    throw new FreshnessOutboxEventShapeError(
      `${field} must be an integer array`,
    );
  }
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new FreshnessOutboxEventShapeError(`${field} must be a string array`);
  }
  return value;
}

function freshnessEventKey(input: FreshnessOutboxEventKey): string {
  return `${input.deploymentId}:${input.ts}:${input.sequence}`;
}

function isStale(observedTs: number | null, version: number): boolean {
  return observedTs === null || version > observedTs;
}

function optionalObservedTimestamp(
  observedTs: number | null | undefined,
  fallback: number,
): number | null {
  return observedTs === undefined ? fallback : observedTs;
}

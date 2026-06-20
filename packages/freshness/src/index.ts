import type { OutboxEventRecord } from "@flarex/persistence-postgres";

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

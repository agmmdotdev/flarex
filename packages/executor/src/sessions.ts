import type {
  BeginInvokeSessionInput,
  BeginInvokeSessionResult,
  AbortInvokeSessionInput,
  AbortInvokeSessionResult,
  AbortStaleInvokeSessionsInput,
  AbortStaleInvokeSessionsResult,
  Clock,
  FinishInvokeSessionInput,
  FinishInvokeSessionResult,
  FlarexExecutorControlPersistence,
  IdGenerator,
  InvokeSyscallInput,
  InvokeSyscallResult,
  InvokeReadSet,
  LiveQueryInvalidationConfig,
  LiveQueryInvalidationTriggerInput,
  DeploymentSchemaMetadata,
  SchemaIndexMetadata,
} from "./types";
import {
  parseFlarexDocumentId,
  encodeIndexValues,
  indexBoundsForExpressions,
  type DocumentRevisionRecord,
  type PersistenceJson,
  type InvokeSessionMetadataRecord,
  type InvokeSessionDocumentWriteRecord,
  type IndexRangeExpression,
} from "@flarex/persistence-postgres";
import type {
  LegacyV1AppDataEngine,
} from "@flarex/persistence-postgres/legacy-v1-app-data-engine";
import { encodeFlarexId } from "flarex/ids";
import { isWritableJsonObject } from "flarex-protocol/json";

import {
  legacyV1StorageAuthorityForPersistedSession,
  type AppDataEngineRegistry,
} from "./appDataEngines";
import { prepareInvoke } from "./invoke";
import { deploymentSchemaFromAnalysis, tableForName } from "./invoke";
import {
  DeploymentNotFoundError,
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
  FlarexInsertIdTableMismatchError,
  InvokeDeleteDocumentNotFoundError,
  InvokeFinishNotImplementedError,
  InvokePatchDocumentNotFoundError,
  InvokePatchNonObjectDocumentError,
  InvokePatchValueError,
  InvokeQueryRequestError,
  InvokeReplaceDocumentNotFoundError,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
  MaintenancePolicyError,
} from "./errors";

const ANONYMOUS_EXECUTION_IDENTITY = { kind: "anonymous" } as const;

export async function beginInvokeSession(
  persistence: FlarexExecutorControlPersistence,
  clock: Clock,
  ids: IdGenerator,
  input: BeginInvokeSessionInput,
): Promise<BeginInvokeSessionResult> {
  const prepared = await prepareInvoke(persistence, input);
  const sessionId = ids.nextId();
  const beginTs = clock.now().getTime();
  const identity = input.identity ?? ANONYMOUS_EXECUTION_IDENTITY;

  await persistence.insertInvokeSessionMetadata({
    deploymentId: prepared.deployment.deploymentId,
    sessionId,
    projectId: prepared.deployment.projectId,
    packageId: prepared.package.packageId,
    functionPath: prepared.function.path,
    functionKind: prepared.function.kind,
    partitionKey: prepared.scope.partitionKey,
    scopeJson: prepared.scope,
    argsJson: input.args,
    identityJson: identity,
    idempotencyKey: input.idempotencyKey ?? null,
    beginTs,
    schemaVersion: prepared.schema.version,
    executionModule: prepared.executionModule,
  });

  return {
    sessionId,
    beginTs,
    identity,
    schemaVersion: prepared.schema.version,
    function: {
      path: prepared.function.path,
      kind: prepared.function.kind,
    },
    scope: prepared.scope,
    executionModule: prepared.executionModule,
  };
}

export async function invokeSyscall(
  persistence: FlarexExecutorControlPersistence,
  appDataEngines: AppDataEngineRegistry,
  input: InvokeSyscallInput,
): Promise<InvokeSyscallResult> {
  const session = await requireActiveSession(persistence, input);

  if (isWriteSyscall(input.syscall.op) && session.functionKind !== "mutation") {
    throw new InvokeSyscallNotAllowedError(
      input.syscall.op,
      session.functionKind,
    );
  }
  const appDataEngine = appDataEngines.resolve(
    legacyV1StorageAuthorityForPersistedSession(session),
  );

  if (input.syscall.op === "get") {
    const parsed = parseFlarexDocumentId(input.syscall.id);
    const document = await documentAtTransactionView(
      appDataEngine,
      session,
      input.syscall.id,
    );
    if (document.recordRead) {
      await appDataEngine.insertInvokeSessionDocumentRead({
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: parsed.tableId,
        documentId: input.syscall.id,
        observedTs: document.observedTs,
      });
    }
    return {
      value:
        document.value === null
          ? null
          : documentValue(input.syscall.id, document.value),
      readSet: {
        documents: [
          {
            tableId: parsed.tableId,
            id: input.syscall.id,
          },
        ],
      },
    };
  }

  if (input.syscall.op === "query") {
    const request = queryRequest(input.syscall.request);
    const schema = await schemaForSession(persistence, session);
    const table = tableForName(schema, request.table);
    if (request.index !== undefined) {
      const index = schema.indexes.find(
        (candidate) =>
          candidate.tableId === table.tableId &&
          candidate.name === request.index &&
          (candidate.state === undefined || candidate.state === "enabled"),
      );
      if (index === undefined) {
        throw new InvokeQueryRequestError(
          `unknown index ${request.table}.${request.index}.`,
        );
      }
      let bounds: { lower?: string; upper?: string };
      try {
        bounds = indexBoundsForExpressions(index.fields, request.range);
      } catch (error) {
        throw new InvokeQueryRequestError(
          `invalid range for index ${request.table}.${request.index}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const result = await indexDocumentsAtTransactionView(
        appDataEngine,
        session,
        index,
        bounds,
        request.cursor,
        request.order,
        request.limit,
      );
      for (const document of result.documents) {
        await appDataEngine.insertInvokeSessionDocumentRead({
          deploymentId: input.deploymentId,
          sessionId: input.sessionId,
          tableId: index.tableId,
          documentId: document.id,
          observedTs: document.observedTs,
        });
      }
      await appDataEngine.insertInvokeSessionIndexRead({
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        indexId: index.indexId,
        ...(bounds.lower === undefined ? {} : { lowerKey: bounds.lower }),
        ...(bounds.upper === undefined ? {} : { upperKey: bounds.upper }),
        observedTs: session.beginTs,
      });
      return {
        value: {
          page: result.documents.map((document) =>
            documentValue(document.id, document.value),
          ),
          isDone: result.isDone,
          continueCursor: result.continueCursor,
        },
        readSet: {
          ...(result.documents.length === 0
            ? {}
            : {
                documents: result.documents.map((document) => ({
                  tableId: index.tableId,
                  id: document.id,
                  observedTs: document.observedTs,
                })),
              }),
          indexes: [
            {
              indexId: index.indexId,
              ...bounds,
            },
          ],
        },
      };
    }
    const documents = await tableDocumentsAtTransactionView(
      appDataEngine,
      session,
      table.tableId,
      request.order,
      request.limit,
    );
    await appDataEngine.insertInvokeSessionTableRead({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: table.tableId,
      observedTs: session.beginTs,
    });
    const page = documents.map((document) =>
      documentValue(document.id, document.value),
    );
    return {
      value: {
        page,
        isDone: true,
        continueCursor: String(
          typeof page.at(-1) === "object" && page.at(-1) !== null
            ? (page.at(-1) as { _id?: unknown })._id ?? ""
            : "",
        ),
      },
      readSet: {
        tables: [{ tableId: table.tableId }],
      },
    };
  }

  if (input.syscall.op === "insert") {
    const table = await tableForSession(persistence, session, input.syscall.table);
    const id = idForInsert(table.tableId, input.syscall.id);
    await appDataEngine.stageInvokeSessionDocumentWrite({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: table.tableId,
      documentId: id,
      op: "insert",
      valueJson: input.syscall.value,
    });
    return { value: id };
  }

  if (input.syscall.op === "patch") {
    const patch = requireJsonObject(input.syscall.value);
    const parsed = parseFlarexDocumentId(input.syscall.id);
    const document = await documentAtTransactionView(
      appDataEngine,
      session,
      input.syscall.id,
    );
    if (document.value === null) {
      throw new InvokePatchDocumentNotFoundError(
        input.deploymentId,
        input.syscall.id,
      );
    }
    if (!isWritableJsonObject(document.value)) {
      throw new InvokePatchNonObjectDocumentError(
        input.deploymentId,
        input.syscall.id,
      );
    }
    if (document.recordRead) {
      await appDataEngine.insertInvokeSessionDocumentRead({
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: parsed.tableId,
        documentId: input.syscall.id,
        observedTs: document.observedTs,
      });
    }
    await appDataEngine.stageInvokeSessionDocumentWrite({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: parsed.tableId,
      documentId: input.syscall.id,
      op: "patch",
      valueJson: patch,
    });
    return {
      value: null,
      readSet: {
        documents: [
          {
            tableId: parsed.tableId,
            id: input.syscall.id,
          },
        ],
      },
    };
  }

  if (input.syscall.op === "replace") {
    const parsed = parseFlarexDocumentId(input.syscall.id);
    const document = await documentAtTransactionView(
      appDataEngine,
      session,
      input.syscall.id,
    );
    if (document.value === null) {
      throw new InvokeReplaceDocumentNotFoundError(
        input.deploymentId,
        input.syscall.id,
      );
    }
    if (document.recordRead) {
      await appDataEngine.insertInvokeSessionDocumentRead({
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: parsed.tableId,
        documentId: input.syscall.id,
        observedTs: document.observedTs,
      });
    }
    await appDataEngine.stageInvokeSessionDocumentWrite({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: parsed.tableId,
      documentId: input.syscall.id,
      op: "replace",
      valueJson: input.syscall.value,
    });
    return {
      value: null,
      readSet: {
        documents: [
          {
            tableId: parsed.tableId,
            id: input.syscall.id,
          },
        ],
      },
    };
  }

  if (input.syscall.op === "delete") {
    const parsed = parseFlarexDocumentId(input.syscall.id);
    const document = await documentAtTransactionView(
      appDataEngine,
      session,
      input.syscall.id,
    );
    if (document.value === null) {
      throw new InvokeDeleteDocumentNotFoundError(
        input.deploymentId,
        input.syscall.id,
      );
    }
    if (document.recordRead) {
      await appDataEngine.insertInvokeSessionDocumentRead({
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: parsed.tableId,
        documentId: input.syscall.id,
        observedTs: document.observedTs,
      });
    }
    await appDataEngine.stageInvokeSessionDocumentWrite({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: parsed.tableId,
      documentId: input.syscall.id,
      op: "delete",
      valueJson: null,
    });
    return {
      value: null,
      readSet: {
        documents: [
          {
            tableId: parsed.tableId,
            id: input.syscall.id,
          },
        ],
      },
    };
  }

  throw new InvokeSyscallNotImplementedError("unknown");
}

export async function finishInvokeSession(
  persistence: FlarexExecutorControlPersistence,
  appDataEngines: AppDataEngineRegistry,
  clock: Clock,
  liveQueryInvalidation: LiveQueryInvalidationConfig | undefined,
  input: FinishInvokeSessionInput,
): Promise<FinishInvokeSessionResult> {
  const session = await requireActiveSession(persistence, input);
  const appDataEngine = appDataEngines.resolve(
    legacyV1StorageAuthorityForPersistedSession(session),
  );
  if (session.functionKind === "query") {
    const documentReads = await appDataEngine.listInvokeSessionDocumentReads(
      input.deploymentId,
      input.sessionId,
    );
    const tableReads = await appDataEngine.listInvokeSessionTableReads(
      input.deploymentId,
      input.sessionId,
    );
    const indexReads = await appDataEngine.listInvokeSessionIndexReads(
      input.deploymentId,
      input.sessionId,
    );
    const finished = await persistence.finishInvokeSessionMetadata({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      finishedAt: clock.now(),
    });
    if (finished === null) {
      throw new InvokeSessionNotFoundError(input.deploymentId, input.sessionId);
    }

    return {
      value: input.value,
      readSet: readSetFromReads(documentReads, tableReads, indexReads),
      readTs: session.beginTs,
    };
  }

  if (session.functionKind === "mutation") {
    const commit = await appDataEngine.commitInvokeSessionWrites({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      source: `invoke:${session.functionPath}`,
      finishedAt: clock.now(),
      minimumTs: session.beginTs,
    });
    await runLiveQueryInvalidationHook(liveQueryInvalidation, {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      functionPath: session.functionPath,
      committedTs: commit.committedTs,
      writes: commit.writes,
    });
    return {
      value: input.value,
      committedTs: commit.committedTs,
      writes: commit.writes,
    };
  }

  throw new InvokeFinishNotImplementedError(session.functionKind);
}

async function runLiveQueryInvalidationHook(
  config: LiveQueryInvalidationConfig | undefined,
  input: LiveQueryInvalidationTriggerInput,
): Promise<void> {
  if (config === undefined || input.writes.length === 0) return;

  try {
    if (config.freshnessStore !== undefined) {
      await config.freshnessStore.applyCommitFreshness({
        eventKey: {
          deploymentId: input.deploymentId,
          ts: input.committedTs,
          sequence: 0,
        },
        commitTs: input.committedTs,
        documentIds: Array.from(new Set(input.writes.map(write => write.id))),
        tableIds: Array.from(new Set(input.writes.map(write => write.tableId))),
      });
    }
    const notify = config.notifyTrigger?.(input);
    if (notify !== undefined) {
      void Promise.resolve(notify).catch(error => {
        void config.onError?.({ ...input, error });
      });
    }
  } catch (error) {
    await config.onError?.({ ...input, error });
  }
}

export async function abortInvokeSession(
  persistence: FlarexExecutorControlPersistence,
  clock: Clock,
  input: AbortInvokeSessionInput,
): Promise<AbortInvokeSessionResult> {
  await requireActiveSession(persistence, input);
  const aborted = await persistence.abortInvokeSessionMetadata({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    finishedAt: clock.now(),
  });
  if (aborted === null) {
    throw new InvokeSessionNotFoundError(input.deploymentId, input.sessionId);
  }
  return { aborted: true };
}

export async function abortStaleInvokeSessions(
  persistence: FlarexExecutorControlPersistence,
  clock: Clock,
  input: AbortStaleInvokeSessionsInput,
): Promise<AbortStaleInvokeSessionsResult> {
  if (
    input.limit !== undefined &&
    (!Number.isFinite(input.limit) ||
      !Number.isInteger(input.limit) ||
      input.limit <= 0)
  ) {
    throw new MaintenancePolicyError("limit must be a positive integer.");
  }

  const deployment = await persistence.getDeploymentMetadata(input.deploymentId);
  if (deployment === null) {
    throw new DeploymentNotFoundError(input.deploymentId);
  }
  if (deployment.projectId !== input.projectId) {
    throw new DeploymentProjectMismatchError(
      input.deploymentId,
      input.projectId,
      deployment.projectId,
    );
  }

  const aborted = await persistence.abortStaleInvokeSessionsMetadata({
    deploymentId: input.deploymentId,
    olderThan: input.olderThan,
    finishedAt: clock.now(),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });

  return {
    aborted: aborted.sessions.length,
    sessions: aborted.sessions.map((session) => session.sessionId).sort(),
    hasMore: aborted.hasMore,
  };
}

async function requireActiveSession(
  persistence: FlarexExecutorControlPersistence,
  input: { deploymentId: string; projectId: string; sessionId: string },
): Promise<InvokeSessionMetadataRecord> {
  const session = await persistence.getInvokeSessionMetadata(
    input.deploymentId,
    input.sessionId,
  );
  if (session === null) {
    throw new InvokeSessionNotFoundError(input.deploymentId, input.sessionId);
  }
  if (session.projectId !== input.projectId) {
    throw new InvokeSessionProjectMismatchError(
      input.deploymentId,
      input.sessionId,
      input.projectId,
      session.projectId,
    );
  }
  if (session.state !== "active") {
    throw new InvokeSessionNotActiveError(
      input.deploymentId,
      input.sessionId,
      session.state,
    );
  }
  return session;
}

function readSetFromReads(
  documentReads: Array<{
    tableId: number;
    documentId: string;
    observedTs: number | null;
  }>,
  tableReads: Array<{ tableId: number }>,
  indexReads: Array<{ indexId: number; lowerKey: string; upperKey: string }>,
): InvokeReadSet {
  const readSet: InvokeReadSet = {};
  if (documentReads.length > 0) {
    readSet.documents = documentReads.map((read) => ({
      tableId: read.tableId,
      id: read.documentId,
      observedTs: read.observedTs,
    }));
  }
  if (tableReads.length > 0) {
    readSet.tables = tableReads.map((read) => ({
      tableId: read.tableId,
    }));
  }
  if (indexReads.length > 0) {
    readSet.indexes = indexReads.map((read) => ({
      indexId: read.indexId,
      ...(read.lowerKey === "" ? {} : { lower: read.lowerKey }),
      ...(read.upperKey === "" ? {} : { upper: read.upperKey }),
    }));
  }
  return readSet;
}

function isWriteSyscall(op: string): boolean {
  return (
    op === "insert" || op === "patch" || op === "replace" || op === "delete"
  );
}

async function documentAtTransactionView(
  appDataEngine: LegacyV1AppDataEngine,
  session: InvokeSessionMetadataRecord,
  id: string,
): Promise<{
  value: PersistenceJson | null;
  observedTs: number | null;
  recordRead: boolean;
}> {
  const base = await appDataEngine.getDocumentRevisionAtTs(
    session.deploymentId,
    id,
    session.beginTs,
  );
  const staged = await stagedWriteForDocument(appDataEngine, session, id);
  if (staged === undefined) {
    return {
      value: base === null || base.deleted ? null : base.value,
      observedTs: base?.ts ?? null,
      recordRead: true,
    };
  }

  if (staged.op === "insert") {
    return {
      value: staged.valueJson as PersistenceJson,
      observedTs: base?.ts ?? null,
      recordRead: false,
    };
  }

  if (staged.op === "delete") {
    return {
      value: null,
      observedTs: base?.ts ?? null,
      recordRead: true,
    };
  }

  if (staged.op === "replace") {
    return {
      value: staged.valueJson as PersistenceJson,
      observedTs: base?.ts ?? null,
      recordRead: true,
    };
  }

  if (
    staged.op === "patch" &&
    base !== null &&
    !base.deleted &&
    isWritableJsonObject(base.value)
  ) {
    return {
      value: { ...base.value, ...staged.valueJson },
      observedTs: base.ts,
      recordRead: true,
    };
  }

  return {
    value: base === null || base.deleted ? null : base.value,
    observedTs: base?.ts ?? null,
    recordRead: true,
  };
}

async function tableDocumentsAtTransactionView(
  appDataEngine: LegacyV1AppDataEngine,
  session: InvokeSessionMetadataRecord,
  tableId: number,
  order: "asc" | "desc" | undefined,
  limit: number | undefined,
): Promise<Array<{ id: string; value: PersistenceJson }>> {
  const baseDocuments = await appDataEngine.listDocumentsInTableAtTs(
    session.deploymentId,
    tableId,
    session.beginTs,
  );
  const visible = new Map<string, { id: string; value: PersistenceJson }>();
  for (const document of baseDocuments) {
    visible.set(document.id, { id: document.id, value: document.value });
  }

  const stagedWrites = await appDataEngine.listInvokeSessionDocumentWrites(
    session.deploymentId,
    session.sessionId,
  );
  for (const write of stagedWrites.filter(
    (candidate) => candidate.tableId === tableId,
  )) {
    applyStagedWriteToTableView(visible, write, baseDocuments);
  }

  const sorted = Array.from(visible.values()).sort((left, right) =>
    order === "desc"
      ? right.id.localeCompare(left.id)
      : left.id.localeCompare(right.id),
  );
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

async function indexDocumentsAtTransactionView(
  appDataEngine: LegacyV1AppDataEngine,
  session: InvokeSessionMetadataRecord,
  index: SchemaIndexMetadata,
  bounds: { lower?: string; upper?: string },
  cursor: string | undefined,
  order: "asc" | "desc" | undefined,
  limit: number | undefined,
): Promise<{
  documents: Array<{
    key: string;
    id: string;
    value: PersistenceJson;
    observedTs: number | null;
  }>;
  isDone: boolean;
  continueCursor: string;
}> {
  const base = await appDataEngine.listDocumentsInIndexAtTs({
    deploymentId: session.deploymentId,
    indexId: index.indexId,
    ts: session.beginTs,
    ...bounds,
  });
  const visible = new Map<
    string,
    { key: string; id: string; value: PersistenceJson; observedTs: number | null }
  >();
  for (const { key, document } of base.documents) {
    visible.set(document.id, {
      key,
      id: document.id,
      value: document.value,
      observedTs: document.ts,
    });
  }

  const stagedWrites = await appDataEngine.listInvokeSessionDocumentWrites(
    session.deploymentId,
    session.sessionId,
  );
  for (const write of stagedWrites.filter(
    (candidate) => candidate.tableId === index.tableId,
  )) {
    await applyStagedWriteToIndexView(
      appDataEngine,
      session,
      visible,
      index,
      bounds,
      write,
    );
  }

  const sorted = Array.from(visible.values())
    .filter((entry) => cursorAllows(entry.key, cursor, order))
    .sort((left, right) =>
      order === "desc"
        ? right.key.localeCompare(left.key)
        : left.key.localeCompare(right.key),
    );
  const page = limit === undefined ? sorted : sorted.slice(0, limit);
  return {
    documents: page,
    isDone: limit === undefined || sorted.length <= limit,
    continueCursor: page.at(-1)?.key ?? cursor ?? "",
  };
}

async function applyStagedWriteToIndexView(
  appDataEngine: LegacyV1AppDataEngine,
  session: InvokeSessionMetadataRecord,
  visible: Map<
    string,
    { key: string; id: string; value: PersistenceJson; observedTs: number | null }
  >,
  index: SchemaIndexMetadata,
  bounds: { lower?: string; upper?: string },
  write: InvokeSessionDocumentWriteRecord,
): Promise<void> {
  visible.delete(write.documentId);

  if (write.op === "delete") {
    return;
  }

  const value =
    write.op === "patch"
      ? await patchedIndexDocumentValue(appDataEngine, session, write)
      : (write.valueJson as PersistenceJson);
  if (value === null) {
    return;
  }

  const key = indexKeyForDocument(index, write.documentId, value);
  if (!keyInRange(key, bounds.lower, bounds.upper)) {
    return;
  }
  visible.set(write.documentId, {
    key,
    id: write.documentId,
    value,
    observedTs: await observedTsForStagedWrite(appDataEngine, session, write),
  });
}

async function observedTsForStagedWrite(
  appDataEngine: LegacyV1AppDataEngine,
  session: InvokeSessionMetadataRecord,
  write: InvokeSessionDocumentWriteRecord,
): Promise<number | null> {
  if (write.op === "insert") return null;
  const base = await appDataEngine.getDocumentRevisionAtTs(
    session.deploymentId,
    write.documentId,
    session.beginTs,
  );
  return base?.ts ?? null;
}

async function patchedIndexDocumentValue(
  appDataEngine: LegacyV1AppDataEngine,
  session: InvokeSessionMetadataRecord,
  write: Extract<InvokeSessionDocumentWriteRecord, { op: "patch" }>,
): Promise<PersistenceJson | null> {
  const base = await appDataEngine.getDocumentRevisionAtTs(
    session.deploymentId,
    write.documentId,
    session.beginTs,
  );
  if (
    base === null ||
    base.deleted ||
    !isWritableJsonObject(base.value)
  ) {
    return null;
  }
  return { ...base.value, ...write.valueJson };
}

function applyStagedWriteToTableView(
  visible: Map<string, { id: string; value: PersistenceJson }>,
  write: InvokeSessionDocumentWriteRecord,
  baseDocuments: DocumentRevisionRecord[],
): void {
  if (write.op === "insert") {
    visible.set(write.documentId, {
      id: write.documentId,
      value: write.valueJson as PersistenceJson,
    });
    return;
  }

  if (write.op === "delete") {
    visible.delete(write.documentId);
    return;
  }

  if (write.op === "replace") {
    visible.set(write.documentId, {
      id: write.documentId,
      value: write.valueJson as PersistenceJson,
    });
    return;
  }

  if (write.op === "patch") {
    const current =
      visible.get(write.documentId) ??
      baseDocuments.find((document) => document.id === write.documentId);
    if (current !== undefined && isWritableJsonObject(current.value)) {
      visible.set(write.documentId, {
        id: write.documentId,
        value: { ...current.value, ...write.valueJson },
      });
    }
  }
}

function indexKeyForDocument(
  index: SchemaIndexMetadata,
  documentId: string,
  value: PersistenceJson,
): string {
  return encodeIndexValues([
    ...index.fields.map((field) => getField(value, field)),
    documentId,
  ]);
}

function getField(
  value: PersistenceJson,
  field: string,
): PersistenceJson | undefined {
  if (!isWritableJsonObject(value)) {
    return undefined;
  }
  let cursor: PersistenceJson | undefined = value;
  for (const segment of field.split(".")) {
    if (cursor === undefined || !isWritableJsonObject(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function keyInRange(key: string, lower?: string, upper?: string): boolean {
  return (
    (lower === undefined || key >= lower) &&
    (upper === undefined || key < upper)
  );
}

function cursorAllows(
  key: string,
  cursor: string | undefined,
  order: "asc" | "desc" | undefined,
): boolean {
  if (cursor === undefined) return true;
  return order === "desc" ? key < cursor : key > cursor;
}

async function stagedWriteForDocument(
  appDataEngine: LegacyV1AppDataEngine,
  session: InvokeSessionMetadataRecord,
  id: string,
): Promise<InvokeSessionDocumentWriteRecord | undefined> {
  const writes = await appDataEngine.listInvokeSessionDocumentWrites(
    session.deploymentId,
    session.sessionId,
  );
  return writes.find((write) => write.documentId === id);
}

async function tableForSession(
  persistence: FlarexExecutorControlPersistence,
  session: InvokeSessionMetadataRecord,
  tableName: string,
) {
  const schema = await schemaForSession(persistence, session);
  return tableForName(schema, tableName);
}

async function schemaForSession(
  persistence: FlarexExecutorControlPersistence,
  session: InvokeSessionMetadataRecord,
): Promise<DeploymentSchemaMetadata> {
  const deploymentPackage = await persistence.getDeploymentPackageMetadata(
    session.deploymentId,
    session.packageId,
  );
  if (deploymentPackage === null) {
    throw new DeploymentPackageNotFoundError(
      session.deploymentId,
      session.packageId,
    );
  }
  const schema = deploymentSchemaFromAnalysis(
    deploymentPackage.analysisJson,
    deploymentPackage.deploymentId,
    deploymentPackage.packageId,
  );
  return schema;
}

function queryRequest(value: PersistenceJson): {
  table: string;
  index?: string;
  range: IndexRangeExpression[];
  limit?: number;
  cursor?: string;
  order?: "asc" | "desc";
} {
  if (!isWritableJsonObject(value)) {
    throw new InvokeQueryRequestError("request must be an object.");
  }
  const table = value.table;
  if (typeof table !== "string" || table.length === 0) {
    throw new InvokeQueryRequestError("request.table must be a non-empty string.");
  }
  const index = value.index;
  if (index !== undefined && (typeof index !== "string" || index.length === 0)) {
    throw new InvokeQueryRequestError("request.index must be a non-empty string.");
  }
  const range = queryRange(value.range);
  const cursor = value.cursor;
  if (cursor !== undefined && typeof cursor !== "string") {
    throw new InvokeQueryRequestError("request.cursor must be a string.");
  }
  const rawOrder = value.order;
  if (rawOrder !== undefined && rawOrder !== "asc" && rawOrder !== "desc") {
    throw new InvokeQueryRequestError("request.order must be asc or desc.");
  }
  const order: "asc" | "desc" | undefined = rawOrder;
  const limit = value.limit;
  const result = {
    table,
    range,
    ...(index === undefined ? {} : { index }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(order === undefined ? {} : { order }),
  };
  if (limit === undefined) return result;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
    throw new InvokeQueryRequestError("request.limit must be a non-negative integer.");
  }
  return { ...result, limit };
}

function queryRange(value: PersistenceJson | undefined): IndexRangeExpression[] {
  if (value === undefined) return [];
  if (!isWritableJsonObject(value)) {
    throw new InvokeQueryRequestError("request.range must be an object.");
  }
  const expressions = value.expressions;
  if (expressions === undefined) return [];
  if (!Array.isArray(expressions)) {
    throw new InvokeQueryRequestError("request.range.expressions must be an array.");
  }
  return expressions.map((expression, index) => {
    if (!isWritableJsonObject(expression)) {
      throw new InvokeQueryRequestError(
        `request.range.expressions[${index}] must be an object.`,
      );
    }
    if (
      expression.op !== "eq" &&
      expression.op !== "gt" &&
      expression.op !== "gte" &&
      expression.op !== "lt" &&
      expression.op !== "lte"
    ) {
      throw new InvokeQueryRequestError(
        `request.range.expressions[${index}].op is invalid.`,
      );
    }
    if (typeof expression.field !== "string" || expression.field.length === 0) {
      throw new InvokeQueryRequestError(
        `request.range.expressions[${index}].field must be a non-empty string.`,
      );
    }
    if (!("value" in expression)) {
      throw new InvokeQueryRequestError(
        `request.range.expressions[${index}].value is required.`,
      );
    }
    return {
      op: expression.op,
      field: expression.field,
      value: expression.value as PersistenceJson,
    };
  });
}

function idForInsert(tableId: number, requestedId?: string): string {
  if (requestedId === undefined) {
    return encodeFlarexId(tableId);
  }
  const parsed = parseFlarexDocumentId(requestedId);
  if (parsed.tableId !== tableId) {
    throw new FlarexInsertIdTableMismatchError(requestedId, tableId);
  }
  return requestedId;
}

function documentValue(id: string, value: PersistenceJson): PersistenceJson {
  if (isWritableJsonObject(value)) {
    return { ...value, _id: id };
  }
  return value;
}

function requireJsonObject(value: PersistenceJson): Record<string, PersistenceJson> {
  if (!isWritableJsonObject(value)) {
    throw new InvokePatchValueError();
  }
  return value;
}

export const defaultIds: IdGenerator = {
  nextId() {
    return `session_${crypto.randomUUID()}`;
  },
};

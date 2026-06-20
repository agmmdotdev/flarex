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
  FlarexExecutorPersistence,
  IdGenerator,
  InvokeSyscallInput,
  InvokeSyscallResult,
  InvokeReadSet,
  DeploymentSchemaMetadata,
} from "./types";
import {
  parseFlarexDocumentId,
  indexBoundsForExpressions,
  type DocumentRevisionRecord,
  type PersistenceJson,
  type InvokeSessionMetadataRecord,
  type InvokeSessionDocumentWriteRecord,
  type IndexRangeExpression,
} from "@flarex/persistence-postgres";
import { prepareInvoke } from "./invoke";
import {
  deploymentSchemaFromAnalysis,
  encodeFlarexId,
  tableForName,
} from "./invoke";
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
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
  MaintenancePolicyError,
} from "./errors";

export async function beginInvokeSession(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  ids: IdGenerator,
  input: BeginInvokeSessionInput,
): Promise<BeginInvokeSessionResult> {
  const prepared = await prepareInvoke(persistence, input);
  const sessionId = ids.nextId();
  const beginTs = clock.now().getTime();

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
    idempotencyKey: input.idempotencyKey ?? null,
    beginTs,
    schemaVersion: prepared.schema.version,
    executionModule: prepared.executionModule,
  });

  return {
    sessionId,
    beginTs,
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
  persistence: FlarexExecutorPersistence,
  input: InvokeSyscallInput,
): Promise<InvokeSyscallResult> {
  const session = await requireActiveSession(persistence, input);

  if (isWriteSyscall(input.syscall.op) && session.functionKind !== "mutation") {
    throw new InvokeSyscallNotAllowedError(
      input.syscall.op,
      session.functionKind,
    );
  }

  if (input.syscall.op === "get") {
    const parsed = parseFlarexDocumentId(input.syscall.id);
    const document = await documentAtTransactionView(
      persistence,
      session,
      input.syscall.id,
    );
    if (document.recordRead) {
      await persistence.insertInvokeSessionDocumentRead({
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
      const result = await persistence.listDocumentsInIndexAtTs({
        deploymentId: input.deploymentId,
        indexId: index.indexId,
        ts: session.beginTs,
        ...bounds,
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.order === undefined ? {} : { order: request.order }),
      });
      await persistence.insertInvokeSessionIndexRead({
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        indexId: index.indexId,
        ...(bounds.lower === undefined ? {} : { lowerKey: bounds.lower }),
        ...(bounds.upper === undefined ? {} : { upperKey: bounds.upper }),
        observedTs: session.beginTs,
      });
      return {
        value: {
          page: result.documents.map(({ document }) =>
            documentValue(document.id, document.value),
          ),
          isDone: result.isDone,
          continueCursor: result.continueCursor,
        },
        readSet: {
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
      persistence,
      session,
      table.tableId,
      request.order,
      request.limit,
    );
    await persistence.insertInvokeSessionTableRead({
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
    await persistence.insertInvokeSessionDocumentWrite({
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
    const document = await persistence.getDocumentRevisionAtTs(
      input.deploymentId,
      input.syscall.id,
      session.beginTs,
    );
    if (document === null || document.deleted) {
      throw new InvokePatchDocumentNotFoundError(
        input.deploymentId,
        input.syscall.id,
      );
    }
    if (!isJsonObject(document.value)) {
      throw new InvokePatchNonObjectDocumentError(
        input.deploymentId,
        input.syscall.id,
      );
    }
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: parsed.tableId,
      documentId: input.syscall.id,
      observedTs: document.ts,
    });
    await persistence.insertInvokeSessionDocumentWrite({
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

  if (input.syscall.op === "delete") {
    const parsed = parseFlarexDocumentId(input.syscall.id);
    const document = await persistence.getDocumentRevisionAtTs(
      input.deploymentId,
      input.syscall.id,
      session.beginTs,
    );
    if (document === null || document.deleted) {
      throw new InvokeDeleteDocumentNotFoundError(
        input.deploymentId,
        input.syscall.id,
      );
    }
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: parsed.tableId,
      documentId: input.syscall.id,
      observedTs: document.ts,
    });
    await persistence.insertInvokeSessionDocumentWrite({
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
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: FinishInvokeSessionInput,
): Promise<FinishInvokeSessionResult> {
  const session = await requireActiveSession(persistence, input);
  if (session.functionKind === "query") {
    const documentReads = await persistence.listInvokeSessionDocumentReads(
      input.deploymentId,
      input.sessionId,
    );
    const tableReads = await persistence.listInvokeSessionTableReads(
      input.deploymentId,
      input.sessionId,
    );
    const indexReads = await persistence.listInvokeSessionIndexReads(
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
    };
  }

  if (session.functionKind === "mutation") {
    const commit = await persistence.commitInvokeSessionWrites({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      source: `invoke:${session.functionPath}`,
      finishedAt: clock.now(),
      minimumTs: session.beginTs,
    });
    return {
      value: input.value,
      committedTs: commit.committedTs,
      writes: commit.writes,
    };
  }

  throw new InvokeFinishNotImplementedError(session.functionKind);
}

export async function abortInvokeSession(
  persistence: FlarexExecutorPersistence,
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
  persistence: FlarexExecutorPersistence,
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
  persistence: FlarexExecutorPersistence,
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
  documentReads: Array<{ tableId: number; documentId: string }>,
  tableReads: Array<{ tableId: number }>,
  indexReads: Array<{ indexId: number; lowerKey: string; upperKey: string }>,
): InvokeReadSet {
  const readSet: InvokeReadSet = {};
  if (documentReads.length > 0) {
    readSet.documents = documentReads.map((read) => ({
      tableId: read.tableId,
      id: read.documentId,
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
  return op === "insert" || op === "patch" || op === "delete";
}

async function documentAtTransactionView(
  persistence: FlarexExecutorPersistence,
  session: InvokeSessionMetadataRecord,
  id: string,
): Promise<{
  value: PersistenceJson | null;
  observedTs: number | null;
  recordRead: boolean;
}> {
  const base = await persistence.getDocumentRevisionAtTs(
    session.deploymentId,
    id,
    session.beginTs,
  );
  const staged = await stagedWriteForDocument(persistence, session, id);
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

  if (
    staged.op === "patch" &&
    base !== null &&
    !base.deleted &&
    isJsonObject(base.value) &&
    isJsonObject(staged.valueJson)
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
  persistence: FlarexExecutorPersistence,
  session: InvokeSessionMetadataRecord,
  tableId: number,
  order: "asc" | "desc" | undefined,
  limit: number | undefined,
): Promise<Array<{ id: string; value: PersistenceJson }>> {
  const baseDocuments = await persistence.listDocumentsInTableAtTs(
    session.deploymentId,
    tableId,
    session.beginTs,
  );
  const visible = new Map<string, { id: string; value: PersistenceJson }>();
  for (const document of baseDocuments) {
    visible.set(document.id, { id: document.id, value: document.value });
  }

  const stagedWrites = await persistence.listInvokeSessionDocumentWrites(
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

  if (write.op === "patch" && isJsonObject(write.valueJson)) {
    const current =
      visible.get(write.documentId) ??
      baseDocuments.find((document) => document.id === write.documentId);
    if (current !== undefined && isJsonObject(current.value)) {
      visible.set(write.documentId, {
        id: write.documentId,
        value: { ...current.value, ...write.valueJson },
      });
    }
  }
}

async function stagedWriteForDocument(
  persistence: FlarexExecutorPersistence,
  session: InvokeSessionMetadataRecord,
  id: string,
): Promise<InvokeSessionDocumentWriteRecord | undefined> {
  const writes = await persistence.listInvokeSessionDocumentWrites(
    session.deploymentId,
    session.sessionId,
  );
  return writes.find((write) => write.documentId === id);
}

async function tableForSession(
  persistence: FlarexExecutorPersistence,
  session: InvokeSessionMetadataRecord,
  tableName: string,
) {
  const schema = await schemaForSession(persistence, session);
  return tableForName(schema, tableName);
}

async function schemaForSession(
  persistence: FlarexExecutorPersistence,
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvokeQueryRequestError("request.range must be an object.");
  }
  const expressions = value.expressions;
  if (expressions === undefined) return [];
  if (!Array.isArray(expressions)) {
    throw new InvokeQueryRequestError("request.range.expressions must be an array.");
  }
  return expressions.map((expression, index) => {
    if (typeof expression !== "object" || expression === null || Array.isArray(expression)) {
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
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...value, _id: id };
  }
  return value;
}

function requireJsonObject(value: PersistenceJson): Record<string, PersistenceJson> {
  if (!isJsonObject(value)) {
    throw new InvokePatchValueError();
  }
  return value;
}

function isJsonObject(value: unknown): value is Record<string, PersistenceJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const defaultIds: IdGenerator = {
  nextId() {
    return `session_${crypto.randomUUID()}`;
  },
};

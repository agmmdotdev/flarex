import type {
  BeginInvokeSessionInput,
  BeginInvokeSessionResult,
  Clock,
  FinishInvokeSessionInput,
  FinishInvokeSessionResult,
  FlarexExecutorPersistence,
  IdGenerator,
  InvokeSyscallInput,
  InvokeSyscallResult,
  InvokeReadSet,
} from "./types";
import {
  parseFlarexDocumentId,
  type PersistenceJson,
  type InvokeSessionMetadataRecord,
} from "@flarex/persistence-postgres";
import { prepareInvoke } from "./invoke";
import {
  deploymentSchemaFromAnalysis,
  encodeFlarexId,
  tableForName,
} from "./invoke";
import {
  DeploymentPackageNotFoundError,
  FlarexInsertIdTableMismatchError,
  InvokeFinishNotImplementedError,
  InvokePatchDocumentNotFoundError,
  InvokePatchNonObjectDocumentError,
  InvokePatchValueError,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
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
    const document = await persistence.getDocumentRevisionAtTs(
      input.deploymentId,
      input.syscall.id,
      session.beginTs,
    );
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: parsed.tableId,
      documentId: input.syscall.id,
      observedTs: document?.ts ?? null,
    });
    return {
      value:
        document === null || document.deleted
          ? null
          : documentValue(document.id, document.value),
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

  if (input.syscall.op === "insert") {
    const table = await tableForInsert(persistence, session, input.syscall.table);
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

  throw new InvokeSyscallNotImplementedError(input.syscall.op);
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
      readSet: readSetFromDocumentReads(documentReads),
    };
  }

  if (session.functionKind === "mutation") {
    const commit = await persistence.commitInvokeSessionInserts({
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

function readSetFromDocumentReads(
  reads: Array<{ tableId: number; documentId: string }>,
): InvokeReadSet {
  return reads.length === 0
    ? {}
    : {
        documents: reads.map((read) => ({
          tableId: read.tableId,
          id: read.documentId,
        })),
      };
}

function isWriteSyscall(op: string): boolean {
  return op === "insert" || op === "patch" || op === "delete";
}

async function tableForInsert(
  persistence: FlarexExecutorPersistence,
  session: InvokeSessionMetadataRecord,
  tableName: string,
) {
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
  return tableForName(schema, tableName);
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

function isJsonObject(value: PersistenceJson): value is Record<string, PersistenceJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const defaultIds: IdGenerator = {
  nextId() {
    return `session_${crypto.randomUUID()}`;
  },
};

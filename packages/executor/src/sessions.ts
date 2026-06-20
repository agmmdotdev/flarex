import type {
  BeginInvokeSessionInput,
  BeginInvokeSessionResult,
  Clock,
  FlarexExecutorPersistence,
  IdGenerator,
  InvokeSyscallInput,
  InvokeSyscallResult,
} from "./types";
import {
  parseFlarexDocumentId,
  type PersistenceJson,
} from "@flarex/persistence-postgres";
import { prepareInvoke } from "./invoke";
import {
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

  throw new InvokeSyscallNotImplementedError(input.syscall.op);
}

function isWriteSyscall(op: string): boolean {
  return op === "insert" || op === "patch" || op === "delete";
}

function documentValue(id: string, value: PersistenceJson): PersistenceJson {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...value, _id: id };
  }
  return value;
}

export const defaultIds: IdGenerator = {
  nextId() {
    return `session_${crypto.randomUUID()}`;
  },
};

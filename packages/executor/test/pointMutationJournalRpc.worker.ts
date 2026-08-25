import { WorkerEntrypoint } from "cloudflare:workers";
import { Cause, Effect, Exit } from "effect";

import {
  makePointMutationJournalRpcSessionV1,
  PointMutationJournalResultRejectedV1Error,
  type PointMutationJournalRpcSessionV1,
  type PointMutationJournalRpcBoundaryV1Error,
} from "@flarex/executor/point-mutation-journal-rpc";
import {
  InvalidPointMutationJournalCapabilityV1Error,
  type PointMutationJournalIndexV1,
  type PointMutationJournalTableV1,
} from "../src/pointMutationJournal";
import type {
  PointMutationOccBoundJournalV1,
} from "../src/storedAttemptAuthentication";
import type {
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalPointOperationV1Result,
} from "@flarex/persistence-postgres/session-journal-store";
import {
  CommitSyscallSequenceV1Schema,
} from "flarex-protocol/commit-protocol";
import { decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import {
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
} from "flarex-protocol/internal/application-revision-syscall-validation-v1";
import { ApplicationRevisionSyscallDocumentValidationV1Error } from
  "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";

type Scenario =
  | "success"
  | "indexedSuccess"
  | "resultRejected"
  | "operationFailure"
  | "validationFailure"
  | "validationLookalike"
  | "delayedSuccess"
  | "orderedFailures"
  | "defect"
  | "interruption";

interface ScenarioRecord {
  readonly scenario: Scenario;
  readonly session: PointMutationJournalRpcSessionV1;
  readonly firstError: InvalidPointMutationJournalCapabilityV1Error;
  readonly secondError: InvalidPointMutationJournalCapabilityV1Error;
  readonly defect: Error;
  operationCalls: number;
  indexCalls: number;
  indexSyscallSequenceType: string;
  indexIdentityPreserved: boolean;
  pointSyscallSequenceType: string;
  tableIdentityPreserved: boolean;
  closePromise:
    | Promise<
      Exit.Exit<void, PointMutationJournalRpcBoundaryV1Error>
    >
    | undefined;
  closeFinished: boolean;
}

const EXECUTED_MISSING = Object.freeze({
  kind: "completed",
  delivery: "executed",
  outcome: Object.freeze({ kind: "missing", document: null }),
} satisfies RunSessionJournalPointOperationV1Result);

const EXECUTED_INDEX_PAGE = Object.freeze({
  kind: "completed",
  delivery: "executed",
  outcome: Object.freeze({
    kind: "indexRangePage",
    documents: Object.freeze([{ status: "open" }]),
    isDone: true,
  }),
} satisfies RunSessionJournalIndexedQueryV1Result);

const BUSINESS_REJECTED = Object.freeze({
  kind: "rejected",
  delivery: "executed",
  issue: Object.freeze({
    reason: "invalidDocument",
    operation: "insert",
  }),
} satisfies RunSessionJournalPointOperationV1Result);

const SEQUENCE_REJECTED = Object.freeze({
  kind: "sequenceRejected",
  issue: Object.freeze({
    reason: "sequenceGap",
    actual: CommitSyscallSequenceV1Schema.make(2n),
    expectedNext: CommitSyscallSequenceV1Schema.make(1n),
  }),
} satisfies RunSessionJournalPointOperationV1Result);

const STATE_REJECTED = Object.freeze({
  kind: "stateRejected",
  issue: Object.freeze({ reason: "journalSealed" }),
} satisfies RunSessionJournalPointOperationV1Result);

const records = new Map<string, ScenarioRecord>();

export class PointMutationJournalRpcTestProvider extends WorkerEntrypoint {
  open(id: string, scenario: Scenario) {
    if (records.has(id)) throw new Error("duplicate test session");
    const firstError = new InvalidPointMutationJournalCapabilityV1Error({
      capability: "attempt",
    });
    const secondError = new InvalidPointMutationJournalCapabilityV1Error({
      capability: "table",
    });
    const defect = new Error("private journal defect");
    // This fixture represents an already-resolved process-local journal handle.
    // Its nominal brand is intentionally inaccessible outside the journal owner.
    const table = Object.freeze({}) as PointMutationJournalTableV1;
    const index = Object.freeze({}) as PointMutationJournalIndexV1;
    let record: ScenarioRecord;
    const journal = Object.freeze({
      resolvePointTable: () => Effect.succeed(table),
      runPointOperation: (_table, operation) => {
        record.operationCalls += 1;
        record.tableIdentityPreserved &&= _table === table;
        record.pointSyscallSequenceType = syscallSequenceType(operation);
        switch (record.scenario) {
          case "success":
          case "indexedSuccess":
            return Effect.succeed(EXECUTED_MISSING);
          case "resultRejected":
            return Effect.succeed(rejectedResultForOperation(operation));
          case "operationFailure":
            return Effect.fail(record.firstError);
          case "validationFailure":
            return isFirstOperation(operation)
              ? Effect.fail(
                new ApplicationRevisionSyscallDocumentValidationV1Error({
                  operation: "insert",
                  tableName: "orders",
                  documentId: decodeAppDocumentIdV1(
                    "1:00000000-0000-0000-0000-000000000001",
                  ),
                  issue: {
                    reason: "validator",
                    issue: {
                      reason: "typeMismatch",
                      path: "$document.status",
                      expected: "string",
                    },
                  },
                  message:
                    APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
                }),
              )
              : Effect.succeed(EXECUTED_MISSING);
          case "validationLookalike":
            return Effect.fail(new Proxy(record.firstError, {
              get: (target, property, receiver) =>
                property === "name"
                  ? APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1
                  : property === "message"
                  ? APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1
                  : Reflect.get(target, property, receiver),
            }));
          case "delayedSuccess":
            return Effect.promise(() => awaitOperationGate(operation)).pipe(
              Effect.as(EXECUTED_MISSING),
            );
          case "orderedFailures":
            return isFirstOperation(operation)
              ? Effect.promise(() => awaitOperationGate(operation)).pipe(
                Effect.flatMap(() => Effect.fail(record.firstError)),
              )
              : Effect.fail(record.secondError);
          case "defect":
            return Effect.die(record.defect);
          case "interruption":
            return Effect.interrupt;
        }
      },
      resolveDeveloperIndex: () => record.scenario === "indexedSuccess"
        ? Effect.succeed(index)
        : Effect.die(new Error("index resolution must not run")),
      runIndexedQuery: (_index, operation) => {
        record.indexCalls += 1;
        record.indexIdentityPreserved &&= _index === index;
        record.indexSyscallSequenceType = syscallSequenceType(operation);
        return record.scenario === "indexedSuccess"
          ? Effect.succeed(EXECUTED_INDEX_PAGE)
          : Effect.die(new Error("indexed query must not run"));
      },
      resolveApplicationRelationRead: () =>
        Effect.die(new Error("relation resolution must not run")),
      runApplicationRelationIncomingRead: () =>
        Effect.die(new Error("relation read must not run")),
    } satisfies PointMutationOccBoundJournalV1);
    const session = makePointMutationJournalRpcSessionV1(journal);
    record = {
      scenario,
      session,
      firstError,
      secondError,
      defect,
      operationCalls: 0,
      indexCalls: 0,
      indexSyscallSequenceType: "missing",
      indexIdentityPreserved: true,
      pointSyscallSequenceType: "missing",
      tableIdentityPreserved: true,
      closePromise: undefined,
      closeFinished: false,
    };
    records.set(id, record);
    return session.target;
  }

  startClose(id: string): void {
    const record = requireRecord(id);
    if (record.closePromise !== undefined) return;
    const closePromise = Effect.runPromiseExit(record.session.closeAndDrain);
    record.closePromise = closePromise;
    void closePromise.then(() => {
      record.closeFinished = true;
    });
  }

  inspect(id: string) {
    const record = requireRecord(id);
    return Object.freeze({
      closeFinished: record.closeFinished,
      closeStarted: record.closePromise !== undefined,
      indexCalls: record.indexCalls,
      indexSyscallSequenceType: record.indexSyscallSequenceType,
      indexIdentityPreserved: record.indexIdentityPreserved,
      operationCalls: record.operationCalls,
      pointSyscallSequenceType: record.pointSyscallSequenceType,
      tableIdentityPreserved: record.tableIdentityPreserved,
    });
  }

  async finishClose(id: string) {
    const record = requireRecord(id);
    this.startClose(id);
    const exit = await record.closePromise;
    if (exit === undefined) throw new Error("close did not start");
    if (Exit.isSuccess(exit)) return Object.freeze({ kind: "success" });
    const failed = exit.cause.reasons.find(Cause.isFailReason);
    if (failed !== undefined) {
      if (
        failed.error instanceof PointMutationJournalResultRejectedV1Error
      ) {
        return Object.freeze({
          kind: "failure",
          tag: failed.error._tag,
          resultKind: failed.error.result.kind,
          reason: failed.error.result.issue.reason,
        });
      }
      return Object.freeze({
        kind: "failure",
        identity: failed.error === record.firstError
          ? "first"
          : failed.error === record.secondError
          ? "second"
          : "unknown",
        tag: failed.error._tag,
      });
    }
    const died = exit.cause.reasons.find(Cause.isDieReason);
    if (died !== undefined) {
      return Object.freeze({
        kind: "defect",
        identity: died.defect === record.defect ? "original" : "unknown",
      });
    }
    if (exit.cause.reasons.some(Cause.isInterruptReason)) {
      return Object.freeze({ kind: "interruption" });
    }
    return Object.freeze({ kind: "unknown" });
  }
}

function syscallSequenceType(operation: unknown): string {
  if (typeof operation !== "object" || operation === null) return "missing";
  return typeof Reflect.get(operation, "syscallSequence");
}

function requireRecord(id: string): ScenarioRecord {
  const record = records.get(id);
  if (record === undefined) throw new Error("unknown test session");
  return record;
}

function isFirstOperation(operation: unknown): boolean {
  return typeof operation === "object" &&
    operation !== null &&
    Reflect.get(operation, "id") === "first";
}

function rejectedResultForOperation(
  operation: unknown,
): Exclude<
  RunSessionJournalPointOperationV1Result,
  { readonly kind: "completed" }
> {
  if (typeof operation !== "object" || operation === null) {
    throw new Error("missing rejected-result test operation");
  }
  switch (Reflect.get(operation, "id")) {
    case "rejected":
      return BUSINESS_REJECTED;
    case "sequenceRejected":
      return SEQUENCE_REJECTED;
    case "stateRejected":
      return STATE_REJECTED;
    default:
      throw new Error("unknown rejected-result test operation");
  }
}

async function awaitOperationGate(operation: unknown): Promise<void> {
  if (typeof operation !== "object" || operation === null) {
    throw new Error("missing test operation gate");
  }
  const gate = Reflect.get(operation, "gate");
  if (!(gate instanceof ReadableStream)) {
    throw new Error("invalid test operation gate");
  }
  const reader = gate.getReader();
  try {
    await reader.read();
  } finally {
    reader.releaseLock();
  }
}

export default {
  fetch: () => new Response("private", { status: 404 }),
};

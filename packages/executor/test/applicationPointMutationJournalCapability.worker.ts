import { Effect, Exit } from "effect";
import { decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type {
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalPointOperationV1Result,
} from "@flarex/persistence-postgres/session-journal-store";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import {
  makeApplicationPointMutationJournalCapabilitySessionV1,
} from "@flarex/executor/internal/application-point-mutation-journal-capability";
import type {
  PointMutationJournalIndexV1,
  PointMutationJournalTableV1,
} from "../src/pointMutationJournal";
import type {
  PointMutationOccBoundJournalV1,
} from "../src/storedAttemptAuthentication";

const DOCUMENT_ID = decodeAppDocumentIdV1(
  "1:00000000-0000-4000-8000-000000000001",
);

export default {
  async fetch(): Promise<Response> {
    const table = Object.freeze({}) as PointMutationJournalTableV1;
    const index = Object.freeze({}) as PointMutationJournalIndexV1;
    const operations: Array<Record<string, unknown>> = [];
    let active = 0;
    let maximumActive = 0;
    const journal = Object.freeze({
      resolvePointTable: (tableName: unknown) => {
        if (tableName !== "users") return Effect.die("wrong table");
        return Effect.succeed(table);
      },
      resolveDeveloperIndex: (
        receivedTable: PointMutationJournalTableV1,
        descriptor: unknown,
      ) => receivedTable === table && descriptor === "by_email"
        ? Effect.succeed(index)
        : Effect.die("wrong index"),
      runPointOperation: (
        receivedTable: PointMutationJournalTableV1,
        operation: unknown,
      ) => Effect.gen(function* () {
        if (receivedTable !== table || typeof operation !== "object" ||
          operation === null) return yield* Effect.die("wrong point input");
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        yield* Effect.promise(() => Promise.resolve());
        active -= 1;
        const record = operation as Record<string, unknown>;
        if (record.kind === "insert" &&
          typeof record.fields === "object" && record.fields !== null &&
          Reflect.get(record.fields, "invalid") === true) {
          return yield* new ApplicationRevisionSyscallDocumentValidationV1Error({
            operation: "insert",
            tableName: "users",
            documentId: DOCUMENT_ID,
            issue: { reason: "unexpectedSystemField", field: "invalid" },
            message: "The resulting document failed the active schema validator.",
          });
        }
        operations.push({
          kind: record.kind,
          syscallSequence: String(record.syscallSequence),
          documentId: record.documentId,
        });
        return pointResult(record.kind);
      }),
      runIndexedQuery: (
        receivedIndex: PointMutationJournalIndexV1,
        operation: unknown,
      ) => Effect.gen(function* () {
        if (receivedIndex !== index || typeof operation !== "object" ||
          operation === null) return yield* Effect.die("wrong index input");
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        yield* Effect.promise(() => Promise.resolve());
        active -= 1;
        const record = operation as Record<string, unknown>;
        operations.push({
          kind: record.kind,
          syscallSequence: String(record.syscallSequence),
        });
        return Object.freeze({
          kind: "completed",
          delivery: "executed",
          outcome: Object.freeze({
            kind: "indexRangePage",
            documents: Object.freeze([{ _id: DOCUMENT_ID, name: "Ada" }]),
            isDone: true,
          }),
        }) satisfies RunSessionJournalIndexedQueryV1Result;
      }),
    } satisfies PointMutationOccBoundJournalV1);
    const session = makeApplicationPointMutationJournalCapabilitySessionV1(
      journal,
      [{ tableId: 1, logicalName: "users" }],
    );
    let validationName = "missing";
    try {
      await session.target.insertPointDocument("users", { invalid: true });
    } catch (cause) {
      validationName = cause instanceof Error ? cause.name : "unknown";
    }
    const validAfterValidation = await session.target.insertPointDocument(
      "users",
      { name: "Valid after catch" },
    );
    const results = await Promise.all([
      session.target.readPointDocument("users", DOCUMENT_ID),
      session.target.queryIndexRange("users", "by_email", {}, 10),
      session.target.insertPointDocument("users", { name: "Grace" }),
      session.target.patchPointDocument(DOCUMENT_ID, { name: "Lin" }),
      session.target.replacePointDocument(DOCUMENT_ID, { name: "Edsger" }),
      session.target.deletePointDocument(DOCUMENT_ID),
    ]);
    const close = await Effect.runPromiseExit(session.closeAndDrain);
    let lateName = "missing";
    try {
      await session.target.revalidate();
    } catch (cause) {
      lateName = cause instanceof Error ? cause.name : "unknown";
    }
    return Response.json({
      close: Exit.isSuccess(close) ? "success" : "failure",
      results,
      operations,
      validationName,
      validAfterValidation,
      maximumActive,
      lateName,
    });
  },
};

function pointResult(kind: unknown): RunSessionJournalPointOperationV1Result {
  const outcome = kind === "get"
    ? Object.freeze({
        kind: "present" as const,
        document: Object.freeze({ _id: DOCUMENT_ID, name: "Ada" }),
      })
    : kind === "insert"
    ? Object.freeze({
        kind: "inserted" as const,
        documentId: DOCUMENT_ID,
        document: Object.freeze({ _id: DOCUMENT_ID, name: "Grace" }),
      })
    : Object.freeze({
        kind: "unit" as const,
        operation: kind as "patch" | "replace" | "delete",
      });
  return Object.freeze({
    kind: "completed",
    delivery: "executed",
    outcome,
  });
}

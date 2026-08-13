import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {} }));

import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from
  "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import type {
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalPointOperationV1Result,
} from "@flarex/persistence-postgres/session-journal-store";
import {
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
} from "flarex-protocol/internal/application-revision-syscall-validation-v1";
import {
  decodeAppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import {
  SchemaManifestAppTableNameSchema,
} from "flarex-protocol/schema-manifest";

import {
  ApplicationPointMutationJournalProjectionV1Error,
  makeApplicationPointMutationJournalRpcSessionV1,
} from "../src/pointMutationJournalRpc";
import type {
  PointMutationJournalIndexV1,
  PointMutationJournalTableV1,
} from "../src/pointMutationJournal";
import type {
  PointMutationOccBoundJournalV1,
} from "../src/storedAttemptAuthentication";

const tableId = Schema.decodeUnknownSync(CatalogTableIdSchema);
const tableName = Schema.decodeUnknownSync(SchemaManifestAppTableNameSchema);
const RECIPE_ID = decodeAppDocumentIdV1(
  "1:00000000-0000-0000-0000-000000000001",
);
const INSERTED_ID = decodeAppDocumentIdV1(
  "1:00000000-0000-0000-0000-000000000002",
);
const FOREIGN_ID = decodeAppDocumentIdV1(
  "2:00000000-0000-0000-0000-000000000003",
);

describe("Application point-mutation journal RPC capability", () => {
  it("serializes the flat Worker capability over the existing journal", async () => {
    const table = Object.freeze({}) as PointMutationJournalTableV1;
    const index = Object.freeze({}) as PointMutationJournalIndexV1;
    const pointOperations: unknown[] = [];
    const indexOperations: unknown[] = [];
    let tableResolutions = 0;
    let indexResolutions = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const journal = Object.freeze({
      resolvePointTable: () => {
        tableResolutions += 1;
        return Effect.succeed(table);
      },
      runPointOperation: (_table, operation) => {
        expect(_table).toBe(table);
        pointOperations.push(operation);
        const kind = field(operation, "kind");
        const result = pointResult(kind);
        return pointOperations.length === 1
          ? Effect.promise(() => firstGate).pipe(Effect.as(result))
          : Effect.succeed(result);
      },
      resolveDeveloperIndex: (_table, descriptor) => {
        expect(_table).toBe(table);
        expect(descriptor).toBe("by_status");
        indexResolutions += 1;
        return Effect.succeed(index);
      },
      runIndexedQuery: (_index, operation) => {
        expect(_index).toBe(index);
        indexOperations.push(operation);
        return Effect.succeed(Object.freeze({
          kind: "completed" as const,
          delivery: "executed" as const,
          outcome: Object.freeze({
            kind: "indexRangePage" as const,
            documents: Object.freeze([{ status: "published" }]),
            isDone: true,
          }),
        } satisfies RunSessionJournalIndexedQueryV1Result));
      },
    } satisfies PointMutationOccBoundJournalV1);
    const session = makeApplicationPointMutationJournalRpcSessionV1(
      journal,
      [{ tableId: tableId(1), logicalName: tableName("recipes") }],
    );

    await session.target.revalidate();
    const read = session.target.readPointDocument("recipes", RECIPE_ID);
    const insert = session.target.insertPointDocument("recipes", {
      title: "Soup",
    });
    await waitUntil(() => pointOperations.length === 1);
    expect(pointOperations).toHaveLength(1);
    releaseFirst();
    await expect(read).resolves.toEqual({ title: "Stew" });
    await expect(insert).resolves.toBe(INSERTED_ID);
    await expect(session.target.patchPointDocument(
      RECIPE_ID,
      { title: "Broth" },
    )).resolves.toBeUndefined();
    await expect(session.target.queryIndexRange(
      "recipes",
      "by_status",
      { startInclusive: "00" },
      8,
    )).resolves.toEqual({
      documents: [{ status: "published" }],
      isDone: true,
    });
    await expect(session.target.replacePointDocument(
      RECIPE_ID,
      { title: "Stock" },
    )).resolves.toBeUndefined();
    await expect(session.target.deletePointDocument(RECIPE_ID)).resolves
      .toBeUndefined();

    expect(pointOperations.map(operation => field(operation, "kind"))).toEqual([
      "get",
      "insert",
      "patch",
      "replace",
      "delete",
    ]);
    expect([
      ...pointOperations,
      ...indexOperations,
    ].map(operation => field(operation, "syscallSequence")).sort((a, b) =>
      Number(a) - Number(b)
    )).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    expect(field(indexOperations[0], "syscallSequence")).toBe(4n);
    expect(tableResolutions).toBe(1);
    expect(indexResolutions).toBe(1);
    await Effect.runPromise(session.closeAndDrain);
    await expect(session.target.revalidate()).rejects.toMatchObject({
      name: "FlarexJournalRpcStopped",
    });
  });

  it("fails closed on document/table substitution and retains the local cause", async () => {
    let operations = 0;
    const journal = inertJournal(() => {
      operations += 1;
    });
    const session = makeApplicationPointMutationJournalRpcSessionV1(
      journal,
      [
        { tableId: tableId(1), logicalName: tableName("recipes") },
        { tableId: tableId(2), logicalName: tableName("users") },
      ],
    );

    await expect(session.target.readPointDocument("users", RECIPE_ID)).rejects
      .toMatchObject({ name: "FlarexJournalRpcStopped" });
    await expect(session.target.readPointDocument("recipes", RECIPE_ID)).rejects
      .toMatchObject({ name: "FlarexJournalRpcStopped" });
    expect(operations).toBe(0);

    const exit = await Effect.runPromiseExit(session.closeAndDrain);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) return;
    const failure = exit.cause.reasons.find(Cause.isFailReason);
    expect(failure?.error).toBeInstanceOf(
      ApplicationPointMutationJournalProjectionV1Error,
    );
    if (
      failure !== undefined &&
      failure.error instanceof ApplicationPointMutationJournalProjectionV1Error
    ) {
      expect(failure.error.reason).toBe("documentTableMismatch");
    }
  });

  it("does not consume a sequence or poison the adapter on catchable validation", async () => {
    const table = Object.freeze({}) as PointMutationJournalTableV1;
    const sequences: bigint[] = [];
    let calls = 0;
    const validation = new ApplicationRevisionSyscallDocumentValidationV1Error({
      operation: "insert",
      tableName: "recipes",
      documentId: RECIPE_ID,
      issue: {
        reason: "validator",
        issue: {
          reason: "typeMismatch",
          path: "$document.title",
          expected: "string",
        },
      },
      message: APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
    });
    const journal = Object.freeze({
      resolvePointTable: () => Effect.succeed(table),
      runPointOperation: (_table, operation) => {
        sequences.push(field(operation, "syscallSequence") as bigint);
        calls += 1;
        return calls === 1
          ? Effect.fail(validation)
          : Effect.succeed(Object.freeze({
              kind: "completed" as const,
              delivery: "executed" as const,
              outcome: Object.freeze({
                kind: "inserted" as const,
                documentId: INSERTED_ID,
                document: Object.freeze({ title: "Soup" }),
              }),
            } satisfies RunSessionJournalPointOperationV1Result));
      },
      resolveDeveloperIndex: () => Effect.die("not used"),
      runIndexedQuery: () => Effect.die("not used"),
    } satisfies PointMutationOccBoundJournalV1);
    const session = makeApplicationPointMutationJournalRpcSessionV1(
      journal,
      [{ tableId: tableId(1), logicalName: tableName("recipes") }],
    );

    await expect(session.target.insertPointDocument("recipes", { title: 1 }))
      .rejects.toBe(validation);
    await expect(session.target.insertPointDocument(
      "recipes",
      { title: "Soup" },
    )).resolves.toBe(INSERTED_ID);
    expect(sequences).toEqual([1n, 1n]);
    await Effect.runPromise(session.closeAndDrain);
  });

  it("rejects an inserted identity outside the resolved table", async () => {
    const table = Object.freeze({}) as PointMutationJournalTableV1;
    const journal = Object.freeze({
      resolvePointTable: () => Effect.succeed(table),
      runPointOperation: () => Effect.succeed(Object.freeze({
        kind: "completed" as const,
        delivery: "executed" as const,
        outcome: Object.freeze({
          kind: "inserted" as const,
          documentId: FOREIGN_ID,
          document: Object.freeze({ title: "Foreign" }),
        }),
      } satisfies RunSessionJournalPointOperationV1Result)),
      resolveDeveloperIndex: () => Effect.die("not used"),
      runIndexedQuery: () => Effect.die("not used"),
    } satisfies PointMutationOccBoundJournalV1);
    const session = makeApplicationPointMutationJournalRpcSessionV1(
      journal,
      [
        { tableId: tableId(1), logicalName: tableName("recipes") },
        { tableId: tableId(2), logicalName: tableName("users") },
      ],
    );

    await expect(session.target.insertPointDocument("recipes", {
      title: "Foreign",
    })).rejects.toMatchObject({ name: "FlarexJournalRpcStopped" });
    const exit = await Effect.runPromiseExit(session.closeAndDrain);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) return;
    const failure = exit.cause.reasons.find(Cause.isFailReason);
    expect(failure?.error).toMatchObject({
      _tag: "ApplicationPointMutationJournalProjectionV1Error",
      reason: "documentTableMismatch",
    });
  });

  it("rejects duplicate table bindings before issuing a capability", () => {
    expect(() => makeApplicationPointMutationJournalRpcSessionV1(
      inertJournal(),
      [
        { tableId: tableId(1), logicalName: tableName("recipes") },
        { tableId: tableId(1), logicalName: tableName("meals") },
      ],
    )).toThrow(ApplicationPointMutationJournalProjectionV1Error);
  });
});

function pointResult(kind: unknown): RunSessionJournalPointOperationV1Result {
  switch (kind) {
    case "get":
      return Object.freeze({
        kind: "completed" as const,
        delivery: "executed" as const,
        outcome: Object.freeze({
          kind: "present" as const,
          document: Object.freeze({ title: "Stew" }),
        }),
      });
    case "insert":
      return Object.freeze({
        kind: "completed" as const,
        delivery: "executed" as const,
        outcome: Object.freeze({
          kind: "inserted" as const,
          documentId: INSERTED_ID,
          document: Object.freeze({ title: "Soup" }),
        }),
      });
    case "patch":
    case "replace":
    case "delete":
      return Object.freeze({
        kind: "completed" as const,
        delivery: "executed" as const,
        outcome: Object.freeze({ kind: "unit" as const, operation: kind }),
      });
    default:
      throw new Error("unexpected operation");
  }
}

function inertJournal(onOperation: () => void = () => undefined) {
  const table = Object.freeze({}) as PointMutationJournalTableV1;
  return Object.freeze({
    resolvePointTable: () => Effect.succeed(table),
    runPointOperation: () => {
      onOperation();
      return Effect.die("unexpected operation");
    },
    resolveDeveloperIndex: () => Effect.die("unexpected index"),
    runIndexedQuery: () => Effect.die("unexpected query"),
  } satisfies PointMutationOccBoundJournalV1);
}

function field(input: unknown, name: string): unknown {
  return typeof input === "object" && input !== null
    ? Reflect.get(input, name)
    : undefined;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error("condition did not settle");
}

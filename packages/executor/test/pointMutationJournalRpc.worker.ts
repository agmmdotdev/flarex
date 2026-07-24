import { WorkerEntrypoint } from "cloudflare:workers";
import { Cause, Effect, Exit } from "effect";

import {
  makePointMutationJournalRpcSessionV1,
  type PointMutationJournalRpcSessionV1,
} from "@flarex/executor/point-mutation-journal-rpc";
import {
  InvalidPointMutationJournalCapabilityV1Error,
  type PointMutationJournalBoundaryV1Error,
  type PointMutationJournalTableV1,
} from "../src/pointMutationJournal";
import type {
  PointMutationOccBoundJournalV1,
} from "../src/storedAttemptAuthentication";
import type {
  RunSessionJournalPointOperationV1Result,
} from "@flarex/persistence-postgres/session-journal-store";

type Scenario =
  | "success"
  | "operationFailure"
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
  tableIdentityPreserved: boolean;
  closePromise:
    | Promise<
      Exit.Exit<void, PointMutationJournalBoundaryV1Error>
    >
    | undefined;
  closeFinished: boolean;
}

const EXECUTED_MISSING = Object.freeze({
  kind: "completed",
  delivery: "executed",
  outcome: Object.freeze({ kind: "missing", document: null }),
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
    let record: ScenarioRecord;
    const journal = Object.freeze({
      resolvePointTable: () => Effect.succeed(table),
      runPointOperation: (_table, operation) => {
        record.operationCalls += 1;
        record.tableIdentityPreserved &&= _table === table;
        switch (record.scenario) {
          case "success":
            return Effect.succeed(EXECUTED_MISSING);
          case "operationFailure":
            return Effect.fail(record.firstError);
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
    } satisfies PointMutationOccBoundJournalV1);
    const session = makePointMutationJournalRpcSessionV1(journal);
    record = {
      scenario,
      session,
      firstError,
      secondError,
      defect,
      operationCalls: 0,
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
      operationCalls: record.operationCalls,
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

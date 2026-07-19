import type { ProbeMockFinishRequestV1 } from "./commitProtocol";

export type PostgresFinishRequest = Exclude<
  ProbeMockFinishRequestV1,
  { readonly scenario: "commit_wake" }
>;

export interface PostgresCommitTransactionPort {
  begin(): Promise<void>;
  lockCursor(scopeId: string): Promise<number | null>;
  findOutcome(attemptId: string): Promise<string | null>;
  insertOutcome(request: PostgresFinishRequest, requestJson: string): Promise<void>;
  advanceCursor(request: PostgresFinishRequest): Promise<boolean>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export async function commitOrFindExactOutcome(
  transaction: PostgresCommitTransactionPort,
  request: PostgresFinishRequest,
): Promise<"committed" | "recovered"> {
  const requestJson = JSON.stringify(request);
  await transaction.begin();
  try {
    const cursor = await transaction.lockCursor(request.scopeId);
    if (!Number.isSafeInteger(cursor)) {
      throw new Error("postgres probe scope cursor is missing or invalid");
    }
    const existingRequestJson = await transaction.findOutcome(request.attemptId);
    if (existingRequestJson !== null) {
      if (existingRequestJson !== requestJson) {
        throw new Error("postgres probe attempt fence conflict");
      }
      await transaction.commit();
      return "recovered";
    }
    if (
      cursor !== request.snapshotRevision ||
      request.commitSeq !== cursor + 1
    ) {
      throw new Error("postgres probe snapshot or commit fence rejected");
    }
    await transaction.insertOutcome(request, requestJson);
    if (!(await transaction.advanceCursor(request))) {
      throw new Error("postgres probe cursor fence update failed");
    }
    await transaction.commit();
    return "committed";
  } catch (cause) {
    await transaction.rollback();
    throw cause;
  }
}

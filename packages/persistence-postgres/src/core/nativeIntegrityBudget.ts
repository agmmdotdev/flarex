/** One preparation/acceptance resource owner across native reference families. */
import { Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CoreTransactionError, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CoreAccounting, CORE_TRANSACTION_REFERENCE_LIMITS } from "./accounting";
import type { CoreInterval } from "./contracts";
import type { CoreFinalizedState } from "./transaction";
import { CoreReadSetBuilder } from "./writeLog";

export class CoreNativeIntegrityBudget {
  readonly accounting: CoreAccounting;
  private readonly queries = new CoreReadSetBuilder();
  private readonly unrepresentedQueries: number;
  private readonly identities: Set<string>;
  private readonly sources: readonly Readonly<{ tablets: readonly string[]; maxIdentities: number; identities: Set<string> }>[];
  constructor(private readonly transaction: CoreFinalizedState) {
    this.accounting = new CoreAccounting(transaction.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS, transaction.usage);
    this.unrepresentedQueries = transaction.queryReads === undefined ? transaction.usage.databaseQueries : 0;
    for (const read of transaction.queryReads ?? []) for (const interval of read.intervals) this.queries.add(read.indexId, interval);
    this.identities = new Set(transaction.nativeObservations?.identities ?? []);
    this.sources = transaction.nativeObservations?.sourceCaptures?.map(source => ({ tablets: source.tablets,
      maxIdentities: source.limits.maxIdentities, identities: new Set(source.identities) })) ?? [];
  }
  query(index: CoreIndexDefinition, interval: CoreInterval): Result.Result<void, CoreTransactionError> {
    this.queries.add(index.ref.id, interval);
    return this.unrepresentedQueries + this.queries.intervalCount > (this.transaction.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS).databaseQueries
      ? Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native integrity query limit" })) : Result.succeed(undefined);
  }
  reserve(table: CoreTableDefinition, id: string): Result.Result<void, CoreTransactionError> {
    this.identities.add(id);
    const source = this.sources.find(value => value.tablets.includes(encodeBytesToLowercaseHex(table.tabletId)));
    source?.identities.add(id);
    return this.identities.size > (this.transaction.nativeObservations?.limits.maxIdentities
      ?? (this.transaction.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS).documentsRead)
      || source !== undefined && source.identities.size > source.maxIdentities
      ? Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native integrity identity limit" })) : Result.succeed(undefined);
  }
}

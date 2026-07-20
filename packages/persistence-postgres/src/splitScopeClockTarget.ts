import type {
  ScopeEpoch,
  ScopeId,
} from "flarex-protocol/storage-authority";
import { Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  captureSplitScopePhysicalLocator,
} from "./scopeAuthorityProvisioningReceipt";
import { getScopeClock, type ScopeClockRecord } from "./scopeClock";
import {
  insertInitialScopeClockInTransactionResult,
  isExactInitialScopeClock,
} from "./scopeClockInitialization";
import type { SplitScopePhysicalLocator } from "./scopeMetadataTypes";

export interface EnsureSplitScopeInitialClockInput {
  readonly scopeId: ScopeId;
  readonly initialEpoch: ScopeEpoch;
}

export const EnsureSplitScopeInitialClockStatuses = {
  created: "created",
  alreadyInitialized: "already_initialized",
} as const satisfies Readonly<Record<string, string>>;

export interface EnsureSplitScopeInitialClockResult {
  readonly status: "created" | "already_initialized";
  readonly clock: ScopeClockRecord;
}

export interface LocatedSplitScopeClockTarget {
  readonly physicalLocator: SplitScopePhysicalLocator;
  ensureInitialClock(
    input: EnsureSplitScopeInitialClockInput,
  ): Promise<EnsureSplitScopeInitialClockResult>;
  getCurrentClock(scopeId: ScopeId): Promise<ScopeClockRecord | null>;
}

export class SplitScopeInitialClockConflictError extends Error {
  constructor(
    readonly expected: EnsureSplitScopeInitialClockInput,
    readonly actual: ScopeClockRecord,
  ) {
    super(
      `Located scope clock ${expected.scopeId} does not match its reserved initial authority`,
    );
    this.name = "SplitScopeInitialClockConflictError";
  }
}

export function createLocatedSplitScopeClockTarget(
  db: FlarexMetadataDatabase,
  physicalLocator: SplitScopePhysicalLocator,
): LocatedSplitScopeClockTarget {
  const capturedLocator = captureSplitScopePhysicalLocator(physicalLocator);
  return {
    physicalLocator: capturedLocator,
    ensureInitialClock: (input) =>
      db.transaction(async (tx) => {
        // Drizzle 0.45 rolls back only when this Promise callback rejects.
        // Delete the projection when the transaction boundary becomes Effect-native.
        const initialized = Result.getOrThrow(
          await insertInitialScopeClockInTransactionResult(tx, {
            scopeId: input.scopeId,
            initialEpoch: input.initialEpoch,
          }),
        );
        if (!isExactInitialScopeClock(initialized.clock, input)) {
          throw new SplitScopeInitialClockConflictError(
            input,
            initialized.clock,
          );
        }
        return {
          status: initialized.created
            ? EnsureSplitScopeInitialClockStatuses.created
            : EnsureSplitScopeInitialClockStatuses.alreadyInitialized,
          clock: initialized.clock,
        } satisfies EnsureSplitScopeInitialClockResult;
      }),
    getCurrentClock: (scopeId) => getScopeClock(db, scopeId),
  } satisfies LocatedSplitScopeClockTarget;
}

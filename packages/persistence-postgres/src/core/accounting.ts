/**
 * Mechanisms translated from Convex crates/database/src/{reads,writes,execution_size}.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Result } from "effect";
import { CoreTransactionError, type CoreDocumentUsage, type CoreTransactionLimits, type CoreTransactionUsage } from "./api";
import type { CoreInterval } from "./contracts";
import { CoreReadSetBuilder } from "./writeLog";

/** db914cf06 execution_size.rs/knobs.rs defaults; configurable, not selected DO capacity. */
export const CORE_TRANSACTION_REFERENCE_LIMITS: CoreTransactionLimits = Object.freeze({
  documentsRead: 32000, bytesRead: 1 << 24, databaseQueries: 4096,
  documentsWritten: 16000, bytesWritten: 1 << 24,
  systemDocumentsWritten: 40000, systemBytesWritten: 1 << 27,
});

interface MutableUsage { documentsRead: number; bytesRead: number; documentsWritten: number; bytesWritten: number }

/** Charges happen before checks, independently of coalescing, caching or a caught refusal. */
export class CoreAccounting {
  private readonly user: MutableUsage = { documentsRead: 0, bytesRead: 0, documentsWritten: 0, bytesWritten: 0 };
  private readonly system: MutableUsage = { documentsRead: 0, bytesRead: 0, documentsWritten: 0, bytesWritten: 0 };
  private readonly directReads = new CoreReadSetBuilder();
  private queries = 0;
  constructor(private readonly limits: CoreTransactionLimits, initial?: CoreTransactionUsage) {
    if (initial !== undefined) {
      Object.assign(this.user, initial.user);
      Object.assign(this.system, initial.system);
      this.queries = initial.databaseQueries;
    }
  }

  read(system: boolean, bytes: number): Result.Result<void, CoreTransactionError> {
    const usage = system ? this.system : this.user;
    usage.documentsRead += 1;
    usage.bytesRead += bytes;
    if (system) return Result.succeed(undefined);
    return Result.flatMap(this.check("documentsRead", usage.documentsRead, this.limits.documentsRead),
      () => this.check("bytesRead", usage.bytesRead, this.limits.bytesRead));
  }

  write(system: boolean, bytes: number): Result.Result<void, CoreTransactionError> {
    const usage = system ? this.system : this.user;
    usage.documentsWritten += 1;
    usage.bytesWritten += bytes;
    return Result.flatMap(this.check("documentsWritten", usage.documentsWritten,
      system ? this.limits.systemDocumentsWritten : this.limits.documentsWritten),
    () => this.check("bytesWritten", usage.bytesWritten,
      system ? this.limits.systemBytesWritten : this.limits.bytesWritten));
  }

  query(indexId: Uint8Array, interval: CoreInterval): Result.Result<void, CoreTransactionError> {
    this.directReads.add(indexId, interval);
    this.queries = this.directReads.intervalCount;
    return this.check("databaseQueries", this.queries, this.limits.databaseQueries);
  }

  snapshot(): CoreTransactionUsage {
    return Object.freeze({ user: copyUsage(this.user), system: copyUsage(this.system), databaseQueries: this.queries });
  }

  private check(budget: string, actual: number, limit: number): Result.Result<void, CoreTransactionError> {
    return actual <= limit ? Result.succeed(undefined) : Result.fail(new CoreTransactionError({
      reason: "capacity", cause: Object.freeze({ budget, actual, limit }),
    }));
  }
}

function copyUsage(usage: MutableUsage): CoreDocumentUsage { return Object.freeze({ ...usage }); }

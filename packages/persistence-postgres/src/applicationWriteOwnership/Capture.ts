import { sql, type SQL } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { ScopeIdSchema, type ScopeId } from "flarex-protocol/storage-authority";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import type { AppRowTransaction } from "../appRows";
import { ApplicationWriteOwnershipError } from "./Model";

/** Fixed scope-owned metadata read. Body groups are transferred only when the
 * existing history budget can admit the complete group before decoding it. */
export function buildApplicationWriteOwnershipSnapshotReadStatement(scopeId: ScopeId, schemaName?: string,
  remaining: Readonly<{ records: number; bytes: number }> = { records: 64, bytes: 1_048_576 }): SQL {
  const reader = schemaName === undefined ? sql`fx_read_application_write_ownership_snapshot`
    : sql`${sql.identifier(schemaName)}.fx_read_application_write_ownership_snapshot`;
  return sql`select * from ${reader}(${scopeId}::text, ${remaining.records}::integer, ${remaining.bytes}::integer)`;
}

const CapturedOwnershipEnvelopeSchema = Schema.Struct({
  kind: Schema.Literals(["head", "headActivation", "ownership", "activation", "readiness"]),
  ordinal: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), scopeId: Schema.toType(ScopeIdSchema),
  sequenceText: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/))),
  previousSequenceText: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/))), revisionId: Schema.NullOr(Schema.String),
  evidenceLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), bodyWithheld: Schema.Boolean,
});
export type CapturedOwnershipEnvelope = typeof CapturedOwnershipEnvelopeSchema.Type;
export const decodeCapturedOwnershipEnvelopeResult = Schema.decodeUnknownResult(CapturedOwnershipEnvelopeSchema);

/** Raw byte columns remain deferred until the original owning budget accepts. */
export const CapturedOwnershipBodySchema = Schema.Struct({ evidenceBytes: Schema.Uint8Array, evidenceSha256: Schema.Uint8Array });
export const decodeCapturedOwnershipBodyResult = Schema.decodeUnknownResult(CapturedOwnershipBodySchema);

export const captureApplicationWriteOwnershipInTransaction = Effect.fn("ApplicationWriteOwnership.captureSnapshot")(
  function* (tx: AppRowTransaction, scopeId: ScopeId, remaining: Readonly<{ records: number; bytes: number }> = { records: 64, bytes: 1_048_576 }): Effect.fn.Return<readonly unknown[], ApplicationWriteOwnershipError> {
    const result = yield* Effect.uninterruptible(runDrizzleStatementEffect(tx.execute(buildApplicationWriteOwnershipSnapshotReadStatement(scopeId, undefined, remaining)),
      cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause })));
    return rowsFromDriverExecuteResult(result, () => {
      // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - a resolved SQL metadata read must expose the driver rows wrapper.
      throw new Error("Write ownership driver result has no rows");
    });
  });

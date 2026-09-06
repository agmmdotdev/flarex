import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { projectScopeIdUuidV1, type ScopeId } from "flarex-protocol/storage-authority";
import { fxAppRowCurrent } from "../schema";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationSchemaBindingV3 } from "flarex-protocol/internal/application-schema-binding";
import type { AppRowTransaction } from "../appRows";
import type { FlarexMetadataDatabase } from "../deployments";
import { fxSystemApplicationReadiness } from "../applicationRelationSchema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { canonicalizeApplicationWriteOwnership } from "./Codec";
import { readPreviouslyApplicationWritableTables } from "./History";
import { ApplicationWriteOwnershipError, type CanonicalApplicationWriteOwnership } from "./Model";
import { retainApplicationManagedTableClaims, type ApplicationWriteOwnershipHistoryBudget } from "./Policy";
import { readApplicationWriteOwnershipInTransaction } from "./Repository";

/** The existing readiness/activation scope-clock lock serializes this proof with publication. */
export const prepareApplicationWriteOwnershipInTransaction = Effect.fn("ApplicationWriteOwnership.prepareInTransaction")(
  function* (tx: AppRowTransaction, controlDb: FlarexMetadataDatabase, input: Readonly<{
    scopeId: ScopeId; deploymentId: string; revisionId: string;
    schemaVersionId: CatalogSchemaVersionId;
    policy: Pick<ApplicationSchemaBindingV3, "writePolicies" | "writePolicySetSha256"> | null;
  }>, budget: ApplicationWriteOwnershipHistoryBudget): Effect.fn.Return<CanonicalApplicationWriteOwnership | null, ApplicationWriteOwnershipError> {
    if (input.policy === null) return null;
    const snapshot = yield* readApplicationWriteOwnershipInTransaction(tx, input.scopeId, budget);
    const retainedActivation = snapshot.history.find(owned => owned.frame.revisionId === input.revisionId);
    const priorReadiness = retainedActivation ?? (yield* readRetainedOwnershipPlan(tx, input.scopeId, input.revisionId, budget));
    if (priorReadiness !== null) {
      if (priorReadiness.frame.scopeId !== input.scopeId || priorReadiness.frame.revisionId !== input.revisionId ||
        priorReadiness.frame.writePolicySetSha256 !== input.policy.writePolicySetSha256) return yield* invalid();
      // Committed activation replay keeps its original claims instead of allocating a new sequence.
      if (snapshot.history.some(owned => owned.sha256Hex === priorReadiness.sha256Hex)) {
        const retained = yield* Effect.fromResult(retainApplicationManagedTableClaims({ policies: input.policy.writePolicies,
          previous: priorReadiness.frame.claims, previouslyWritable: new Set(),
          activationSequence: BigInt(priorReadiness.frame.activationSequence), revisionId: input.revisionId }));
        if (retained.length !== priorReadiness.frame.claims.length) return yield* invalid();
        return priorReadiness;
      }
    }
    const previous = snapshot.ownership?.frame.claims ?? [];
    const established = new Set(previous.map(claim => claim.policy.tableId));
    const hasNewManaged = input.policy.writePolicies.some(policy => policy.owner === "payload" && !established.has(policy.tableId));
    if (hasNewManaged) {
      const newTableIds = input.policy.writePolicies.filter(policy => policy.owner === "payload" && !established.has(policy.tableId)).map(policy => policy.tableId);
      const written = yield* query(tx.select({ tableId: fxAppRowCurrent.tableId }).from(fxAppRowCurrent).where(and(
        eq(fxAppRowCurrent.scopeUuid, projectScopeIdUuidV1(input.scopeId).scopeUuid), inArray(fxAppRowCurrent.tableId, newTableIds))).limit(1));
      yield* Effect.fromResult(budget.consume(written.length, 0));
      if (written.length !== 0) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "previouslyWritable" }));
    }
    const previouslyWritable = hasNewManaged
      ? yield* readPreviouslyApplicationWritableTables(tx, controlDb, input, budget)
      : new Set<never>();
    const activationSequence = (snapshot.active?.head.activationSequence ?? 0n) + 1n;
    const claims = yield* Effect.fromResult(retainApplicationManagedTableClaims({ policies: input.policy.writePolicies,
      previous, previouslyWritable, activationSequence, revisionId: input.revisionId }));
    const planned = yield* canonicalizeApplicationWriteOwnership({
      format: "flarex.application-write-ownership", version: 1, scopeId: input.scopeId,
      storageGeneration: "flarexdb_v1", activationSequence: activationSequence.toString(), revisionId: input.revisionId,
      writePolicySetSha256: input.policy.writePolicySetSha256,
      predecessor: snapshot.ownership === null ? null : {
        activationSequence: snapshot.ownership.frame.activationSequence, claimsSha256: snapshot.ownership.sha256Hex,
      }, claims,
    });
    if (priorReadiness !== null && priorReadiness.sha256Hex !== planned.sha256Hex) {
      return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "authorityChanged" }));
    }
    return planned;
  },
);

const readRetainedOwnershipPlan = Effect.fn("ApplicationWriteOwnership.readRetainedPlan")(
  function* (tx: AppRowTransaction, scopeId: ScopeId, revisionId: string, budget: ApplicationWriteOwnershipHistoryBudget) {
    const predicate = and(eq(fxSystemApplicationReadiness.scopeId, scopeId), eq(fxSystemApplicationReadiness.revisionId, revisionId));
    const sizes = yield* query(tx.select({ length: sql<number>`octet_length(${fxSystemApplicationReadiness.readinessBytes})` })
      .from(fxSystemApplicationReadiness).where(predicate).limit(1));
    if (sizes[0] === undefined) return null;
    yield* Effect.fromResult(budget.consume(1, sizes[0].length));
    const rows = yield* query(tx.select({ bytes: fxSystemApplicationReadiness.readinessBytes }).from(fxSystemApplicationReadiness).where(predicate).limit(1));
    const bytes = rows[0]?.bytes;
    if (bytes === undefined || bytes.byteLength !== sizes[0].length) return yield* invalid();
    const frame = yield* Effect.try({ try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      catch: cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }) });
    if (!isNonArrayRecord(frame) || frame.format !== "flarex.application-readiness" || frame.version !== 3) return yield* invalid();
    const canonical = yield* canonicalizeApplicationWriteOwnership(frame.writeOwnership);
    if (canonical.sha256Hex !== frame.writeOwnershipSha256) return yield* invalid();
    // The readiness owner reconstructs and authenticates its complete outer frame in this transaction.
    return canonical;
  },
);

function invalid() { return Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" })); }
function query<A>(statement: PromiseLike<A>) {
  return runDrizzleStatementEffect(statement, cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }));
}

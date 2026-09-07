import type { FlarexMetadataDatabase } from "../deployments";
import { readOwnershipUniqueClosure } from "./UniqueEvidence";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { verifyApplicationManifestV3, type ApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { verifyApplicationWritePolicies } from "@flarex/analysis/internal/application-write-policy";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeCanonicalJson, type Json, type JsonObject } from "flarex-protocol/json";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ApplicationSchemaBindingV3 } from "flarex-protocol/internal/application-schema-binding";
import type { AppRowTransaction } from "../appRows";
import { fxSystemApplicationPublications } from "../applicationRelationSchema";
import { fxSystemApplicationAnalysesV1 } from "../schema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { ApplicationWriteOwnershipError, type ApplicationManagedTableClaim } from "./Model";
import type { ApplicationWriteOwnershipHistoryBudget } from "./Policy";
import { digestApplicationWriteOwnership } from "./Digest";

declare const successorBrand: unique symbol;
export interface ApplicationOwnershipSuccessor { readonly [successorBrand]: true }
type Policy = ApplicationSchemaBindingV3["writePolicies"][number];
const successors = new WeakMap<object, ReadonlyMap<number, Readonly<{ prior: string; next: string }>>>();
const same = (left: Json, right: Json) => encodeCanonicalJson(left, invalidJson) === encodeCanonicalJson(right, invalidJson);
function invalidJson(): never { throw new Error("Authenticated Application manifest lost JSON"); }
const refused = () => new ApplicationWriteOwnershipError({ reason: "ownershipChanged" });

/** Pure policy over verified manifests. Old bytes keep their original scalar meaning. */
export function isOptionalPostRelationSuccessor(prior: ApplicationManifestV3, next: ApplicationManifestV3): boolean {
  const before = prior.schema.writePolicies.configuration;
  const after = next.schema.writePolicies.configuration;
  if (before.profile !== "payload.scalar" || after.profile !== "payload.content-relations" ||
    before.provenanceSha256 !== after.provenanceSha256 || before.tables.length !== 1 ||
    before.tables[0]?.logicalTableName !== "posts" || after.tables.length !== 1 ||
    !same(before.tables, after.tables.map(table => ({ ...table, fields: table.fields.filter(field => field.kind !== "relationship") }))) ||
    prior.schema.relations.length !== 0 || next.schema.relations.length !== 1 ||
    !same(prior.schema.indexes, next.schema.indexes) || prior.schema.tables.length !== next.schema.tables.length ||
    !same(prior.schema.writePolicies.tables.filter(table => table.logicalTableName !== "posts"), next.schema.writePolicies.tables.filter(table => table.logicalTableName !== "posts"))) return false;
  return prior.schema.tables.every((table, index) => {
    const candidate = next.schema.tables[index];
    if (candidate === undefined) return false;
    if (table.name !== "posts") return same(table, candidate);
    if (candidate.validator.type !== "object") return false;
    const { relatedPost: _relation, ...fields } = candidate.validator.value;
    return same(table, { ...candidate, validator: { ...candidate.validator, value: fields } });
  });
}

/** No Boolean, digest pair, or caller-owned manifest can issue this capability. */
export const prepareApplicationOwnershipSuccessor = Effect.fn("ApplicationWriteOwnership.prepareSuccessor")(function* (
  tx: AppRowTransaction, scopeId: ScopeId, priorRevision: string, nextRevision: string,
  previous: readonly ApplicationManagedTableClaim[], policies: readonly Policy[], expectedPolicySetSha256: string, budget: ApplicationWriteOwnershipHistoryBudget, controlDb?: FlarexMetadataDatabase,
  commitments?: Readonly<{ prior: JsonObject; next: JsonObject }>,
): Effect.fn.Return<ApplicationOwnershipSuccessor | undefined, ApplicationWriteOwnershipError> {
  const changed = previous.filter(claim => policies.find(policy => policy.tableId === claim.policy.tableId)?.writePolicySha256 !== claim.policy.writePolicySha256);
  if (changed.length === 0) return undefined;
  const before = yield* readPolicyManifest(tx, scopeId, priorRevision, budget);
  const after = yield* readPolicyManifest(tx, scopeId, nextRevision, budget);
  if (commitments !== undefined && (!matchesReadiness(before, commitments.prior) || !matchesReadiness(after, commitments.next))) return yield* Effect.fail(refused());
  if (!isOptionalPostRelationSuccessor(before.manifest, after.manifest)) return yield* Effect.fail(refused());
  const verifiedBefore = yield* verifyApplicationWritePolicies(before.manifest.schema.writePolicies, before.manifest.schema.tables.map(table => table.name)).pipe(Effect.mapError(cause =>
    new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
  const verifiedAfter = yield* verifyApplicationWritePolicies(after.manifest.schema.writePolicies, after.manifest.schema.tables.map(table => table.name)).pipe(Effect.mapError(cause =>
    new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
  if (verifiedAfter.policySetSha256 !== expectedPolicySetSha256) return yield* Effect.fail(refused());
  for (const policy of policies) if (!verifiedAfter.tables.some(table => table.declaration.logicalTableName === policy.logicalName && table.writePolicySha256 === policy.writePolicySha256)) return yield* Effect.fail(refused());
  if (controlDb === undefined || before.deploymentId !== after.deploymentId) return yield* Effect.fail(refused());
  const priorUnique = yield* readOwnershipUniqueClosure(controlDb, before.deploymentId, before.schemaVersionId, budget);
  const nextUnique = yield* readOwnershipUniqueClosure(controlDb, after.deploymentId, after.schemaVersionId, budget);
  if (priorUnique.closure.definitionCount !== nextUnique.closure.definitionCount ||
    priorUnique.closure.definitionSetSha256Hex !== nextUnique.closure.definitionSetSha256Hex) return yield* Effect.fail(refused());
  const pairs = new Map<number, Readonly<{ prior: string; next: string }>>();
  for (const claim of previous) {
    const prior = claim.policy;
    const next = policies.find(policy => policy.tableId === prior.tableId);
    if (prior.owner !== "payload" || next?.owner !== "payload" || next.logicalName !== prior.logicalName ||
      next.policyId !== prior.policyId || next.provenanceSha256 !== prior.provenanceSha256 ||
      !verifiedBefore.tables.some(table => table.declaration.logicalTableName === prior.logicalName && table.writePolicySha256 === prior.writePolicySha256)) {
      return yield* Effect.fail(refused());
    }
    pairs.set(prior.tableId, { prior: prior.writePolicySha256, next: next.writePolicySha256 });
  }
  // SAFETY: only this authenticated repository operation issues registry-backed evidence.
  const token = Object.freeze({}) as ApplicationOwnershipSuccessor;
  successors.set(token, pairs);
  return token;
});

export function admitsApplicationOwnershipSuccessor(token: ApplicationOwnershipSuccessor | undefined, prior: Policy, next: Policy): boolean {
  const pair = token === undefined ? undefined : successors.get(token)?.get(prior.tableId);
  return pair !== undefined && next.tableId === prior.tableId && pair.prior === prior.writePolicySha256 && pair.next === next.writePolicySha256;
}

const readPolicyManifest = Effect.fn("ApplicationWriteOwnership.readSuccessorManifest")(function* (
  tx: AppRowTransaction, scopeId: ScopeId, revisionId: string, budget: ApplicationWriteOwnershipHistoryBudget,
) {
  const predicate = and(eq(fxSystemApplicationPublications.scopeId, scopeId), eq(fxSystemApplicationPublications.revisionId, revisionId));
  const join = and(eq(fxSystemApplicationAnalysesV1.scopeId, fxSystemApplicationPublications.scopeId), eq(fxSystemApplicationAnalysesV1.analysisId, fxSystemApplicationPublications.analysisId));
  const sizes = yield* query(tx.select({ length: sql<number>`octet_length(${fxSystemApplicationAnalysesV1.manifestBytes})` })
    .from(fxSystemApplicationPublications).innerJoin(fxSystemApplicationAnalysesV1, join).where(predicate).limit(1));
  const size = sizes[0];
  if (size === undefined || !Number.isSafeInteger(size.length) || size.length < 1) return yield* Effect.fail(refused());
  yield* Effect.fromResult(budget.consume(1, size.length));
  const rows = yield* query(tx.select({ bytes: fxSystemApplicationAnalysesV1.manifestBytes, hash: fxSystemApplicationPublications.manifestSha256,
    publicationHash: fxSystemApplicationPublications.publicationSha256, analysisHash: fxSystemApplicationAnalysesV1.manifestSha256, deploymentId: fxSystemApplicationPublications.deploymentId, schemaVersionId: fxSystemApplicationPublications.schemaVersionId }).from(fxSystemApplicationPublications).innerJoin(fxSystemApplicationAnalysesV1, join).where(predicate).limit(1));
  const row = rows[0];
  if (row?.bytes === null || row?.bytes === undefined || row.bytes.byteLength !== size.length || row.analysisHash === null || !bytesEqualFullScan(row.hash, row.analysisHash)) return yield* Effect.fail(refused());
  const bytes = row.bytes;
  const value = yield* Effect.try({ try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), catch: cause =>
    new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }) });
  const canonical = yield* verifyApplicationManifestV3(value).pipe(Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
  if (!bytesEqualFullScan(canonical.canonicalBytes, row.bytes) || !bytesEqualFullScan(yield* digestApplicationWriteOwnership(canonical.canonicalBytes), row.hash)) return yield* Effect.fail(refused());
  return { manifest: canonical.manifest, deploymentId: row.deploymentId, schemaVersionId: row.schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(row.hash), publicationSha256: encodeBytesToLowercaseHex(row.publicationHash) };
});

const query = Effect.fn("ApplicationWriteOwnership.successorQuery")(<Value>(statement: PromiseLike<Value>) =>
  runDrizzleStatementEffect(statement, cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause })));

function matchesReadiness(publication: Readonly<{ deploymentId: string; schemaVersionId: string; manifestSha256: string; publicationSha256: string }>, frame: JsonObject): boolean {
  return publication.deploymentId === frame.deploymentId && publication.schemaVersionId === frame.schemaVersionId &&
    publication.manifestSha256 === frame.manifestSha256 && publication.publicationSha256 === frame.publicationSha256;
}

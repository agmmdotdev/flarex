import { Result } from "effect";
import type { ApplicationSchemaBindingV3 } from "flarex-protocol/internal/application-schema-binding";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  ApplicationWriteOwnershipError,
  MAX_WRITE_OWNERSHIP_CLAIMS,
  MAX_WRITE_OWNERSHIP_HISTORY_BYTES,
  MAX_WRITE_OWNERSHIP_HISTORY_RECORDS,
  type ApplicationManagedTableClaim,
} from "./Model";

/** A single admission owns this budget across preparation and all stores. */
export class ApplicationWriteOwnershipHistoryBudget {
  private records = 0;
  private bytes = 0;

  consume(records: number, bytes: number): Result.Result<void, ApplicationWriteOwnershipError> {
    if (!Number.isSafeInteger(records) || records < 0 || !Number.isSafeInteger(bytes) || bytes < 0 ||
      this.records + records > MAX_WRITE_OWNERSHIP_HISTORY_RECORDS ||
      this.bytes + bytes > MAX_WRITE_OWNERSHIP_HISTORY_BYTES) {
      return Result.fail(new ApplicationWriteOwnershipError({ reason: "historyLimit" }));
    }
    this.records += records;
    this.bytes += bytes;
    return Result.succeed(undefined);
  }
}

/** Inputs have already been authenticated by the Application repositories. */
export function retainApplicationManagedTableClaims(input: Readonly<{
  policies: ApplicationSchemaBindingV3["writePolicies"];
  previous: ReadonlyArray<ApplicationManagedTableClaim>;
  previouslyWritable: ReadonlySet<CatalogTableId>;
  activationSequence: bigint;
  revisionId: string;
}>): Result.Result<ReadonlyArray<ApplicationManagedTableClaim>, ApplicationWriteOwnershipError> {
  const policies = new Map(input.policies.map(policy => [policy.tableId, policy]));
  const claims = new Map(input.previous.map(claim => [claim.policy.tableId, claim]));
  if (input.policies.length > MAX_WRITE_OWNERSHIP_CLAIMS || policies.size !== input.policies.length ||
    input.previous.length > MAX_WRITE_OWNERSHIP_CLAIMS || claims.size !== input.previous.length) {
    return Result.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
  }
  for (const previous of input.previous) {
    const current = policies.get(previous.policy.tableId);
    if (current === undefined || current.owner !== "payload" || previous.policy.owner !== "payload" ||
      current.logicalName !== previous.policy.logicalName || current.writePolicySha256 !== previous.policy.writePolicySha256 ||
      current.policyId !== previous.policy.policyId || current.configSha256 !== previous.policy.configSha256 ||
      current.provenanceSha256 !== previous.policy.provenanceSha256) {
      return Result.fail(new ApplicationWriteOwnershipError({ reason: "ownershipChanged" }));
    }
  }
  for (const policy of input.policies) {
    if (policy.owner !== "payload" || claims.has(policy.tableId)) continue;
    if (input.previouslyWritable.has(policy.tableId)) {
      return Result.fail(new ApplicationWriteOwnershipError({ reason: "previouslyWritable" }));
    }
    claims.set(policy.tableId, Object.freeze({ policy,
      establishingActivationSequence: input.activationSequence.toString(), establishingRevisionId: input.revisionId }));
  }
  if (claims.size > MAX_WRITE_OWNERSHIP_CLAIMS) return Result.fail(new ApplicationWriteOwnershipError({ reason: "historyLimit" }));
  return Result.succeed(Object.freeze([...claims.values()].toSorted((left, right) => left.policy.tableId - right.policy.tableId)));
}

export function denyManagedApplicationTableWrites(
  attemptedTables: Iterable<CatalogTableId>,
  claims: ReadonlyArray<ApplicationManagedTableClaim>,
): Result.Result<void, ApplicationWriteOwnershipError> {
  const managed = new Set(claims.map(claim => claim.policy.tableId));
  for (const tableId of attemptedTables) {
    if (managed.has(tableId)) return Result.fail(new ApplicationWriteOwnershipError({ reason: "writeDenied" }));
  }
  return Result.succeed(undefined);
}

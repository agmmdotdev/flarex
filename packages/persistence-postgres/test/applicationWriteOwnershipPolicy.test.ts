import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ApplicationSchemaWritePolicyBindingSchema } from "flarex-protocol/internal/application-schema-binding";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { hashPolicyFixture } from "./applicationWritePolicyFixture";
import { canonicalizeApplicationWriteOwnership, decodeStoredApplicationWriteOwnership } from "../src/applicationWriteOwnership/Codec";
import { ApplicationWriteOwnershipHistoryBudget, denyManagedApplicationTableWrites, retainApplicationManagedTableClaims } from "../src/applicationWriteOwnership/Policy";

const managed = Schema.decodeUnknownSync(ApplicationSchemaWritePolicyBindingSchema)({ applicationTableId: 2, logicalName: "posts", tableId: 12,
  owner: "payload", policyId: "payload.scalar", writePolicySha256: hashPolicyFixture({ format: "flarex.application-table-write-policy", version: 1,
    logicalTableName: "posts", owner: "payload", policyId: "payload.scalar", configSha256: "b".repeat(64), provenanceSha256: "c".repeat(64) }),
  configSha256: "b".repeat(64), provenanceSha256: "c".repeat(64) });
const ordinary = Schema.decodeUnknownSync(ApplicationSchemaWritePolicyBindingSchema)({ applicationTableId: 1, logicalName: "audit", tableId: 11,
  owner: "application", writePolicySha256: "d".repeat(64) });

describe("Application write ownership", () => {
  it("retains managed claims and refuses removal, transfer, identity changes and historical reuse", () => {
    const input = { policies: [ordinary, managed], previous: [], previouslyWritable: new Set([ordinary.tableId]), activationSequence: 2n, revisionId: "revision-policy" };
    const claims = Result.getOrThrow(retainApplicationManagedTableClaims(input));
    expect(claims).toHaveLength(1);
    expect(Result.getOrThrow(retainApplicationManagedTableClaims({ ...input, previous: claims, activationSequence: 3n, revisionId: "next" }))).toEqual(claims);
    for (const policies of [[ordinary], [ordinary, { ...ordinary, tableId: managed.tableId }],
      [ordinary, { ...managed, writePolicySha256: "f".repeat(64) }]]) {
      expect(retainApplicationManagedTableClaims({ ...input, previous: claims, policies })).toMatchObject({ _tag: "Failure", failure: { reason: "ownershipChanged" } });
    }
    expect(retainApplicationManagedTableClaims({ ...input, previouslyWritable: new Set([managed.tableId]) })).toMatchObject({ _tag: "Failure", failure: { reason: "previouslyWritable" } });
    expect(Result.isSuccess(denyManagedApplicationTableWrites([ordinary.tableId], claims))).toBe(true);
    expect(denyManagedApplicationTableWrites([ordinary.tableId, managed.tableId], claims)).toMatchObject({ _tag: "Failure", failure: { reason: "writeDenied" } });
  });

  it("charges one aggregate history budget across phases and stores", () => {
    const budget = new ApplicationWriteOwnershipHistoryBudget();
    expect(Result.isSuccess(budget.consume(32, 524_288))).toBe(true);
    expect(Result.isSuccess(budget.consume(32, 524_288))).toBe(true);
    expect(Result.isFailure(budget.consume(1, 0))).toBe(true);
    expect(Result.isFailure(budget.consume(0, 1))).toBe(true);
    expect(Result.isFailure(budget.consume(-1, 0))).toBe(true);
  });

  it("owns canonical claims and rejects tampered or accessor-bearing evidence", async () => {
    const claims = Result.getOrThrow(retainApplicationManagedTableClaims({ policies: [ordinary, managed], previous: [],
      previouslyWritable: new Set(), activationSequence: 1n, revisionId: "policy" }));
    const input = { format: "flarex.application-write-ownership", version: 1, scopeId: ScopeIdSchema.make("scope-policy"),
      storageGeneration: "flarexdb_v1", activationSequence: "1", revisionId: "policy", writePolicySetSha256: "e".repeat(64), predecessor: null, claims };
    const owned = await Effect.runPromise(canonicalizeApplicationWriteOwnership(input));
    const retained = await Effect.runPromise(decodeStoredApplicationWriteOwnership(owned.canonicalBytes, owned.sha256));
    expect(retained.frame).toEqual(input);
    owned.canonicalBytes.fill(0);
    expect(owned.canonicalBytes).toEqual(retained.canonicalBytes);
    const broken = retained.canonicalBytes;
    broken[0] = 0;
    expect(Result.isFailure(await Effect.runPromise(Effect.result(decodeStoredApplicationWriteOwnership(broken, retained.sha256))))).toBe(true);
    let reads = 0;
    const getter = Object.defineProperty({ ...input }, "claims", { enumerable: true, get() { reads++; return claims; } });
    expect(Result.isFailure(await Effect.runPromise(Effect.result(canonicalizeApplicationWriteOwnership(getter))))).toBe(true);
    expect(reads).toBe(0);
  });
});

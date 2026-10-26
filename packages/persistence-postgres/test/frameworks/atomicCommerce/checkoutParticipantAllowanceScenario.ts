import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { AtomicCommerceParticipantInput } from "../../../src/frameworks/atomicCommerce/participants";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { prepareNeutralLogicalFixture } from "../../storage/relationalSchema/neutralLogicalFixture";

/** Eighteen real sources use one scope owner and one outer settlement. The
 * same row ID in every source makes cross-source aliasing visible. */
export async function checkoutParticipantAllowanceScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const definitions = Array.from({ length: 18 }, (_, index) => {
      const key = "neutral.checkout-owner-" + index, evidence = { kind: "synthetic", sourceId: key };
      const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: key, capabilities: [], tables: [{
        tableId: "entry", origin: evidence, columns: ["id", "owner"].map(columnId => ({
          columnId, type: "text", nullable: false, default: { kind: "none" }, origin: evidence,
        })), keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin: evidence }], indexes: [], constraints: [], relationships: [],
      }] }));
      return { key, evidence, schema };
    });
    const sources = [];
    for (const { key, evidence, schema } of definitions) sources.push(await Effect.runPromise(captureLogicalSchemaSource({
      key, owner: "medusa", writeProfile: key, evidence, definition: { kind: "relational", schema },
      bindings: [{ kind: "definition", localName: "entry", table: { namespace: "medusa", logicalName: key + "/entry" } }],
    })));
    const fixture = await prepareNeutralLogicalFixture(driver, release => cleanup.push(release), { name: "neutral-checkout-eighteen", sources });
    if (driver === "postgres") expect((await fixture.persistence.query(
      "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
      .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const decodeRow = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String, owner: Schema.String }));
    let calls = 0;
    const write = defineCommerceCommand("checkoutAllowanceWrite", "write", (ctx, input) => Effect.gen(function* () {
      const row = yield* decodeRow(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      calls++;
      yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [row]);
      return row;
    }));
    const read = defineCommerceCommand("checkoutAllowanceRead", "read", ctx => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("entry")).prepareRead({ order: { column: "id", direction: "asc" }, take: 4 }).find(ctx.manager)];
    }));
    const members: AtomicCommerceParticipantInput[] = [];
    for (const definition of definitions) {
      const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: definition.key, writeProfile: definition.key,
        schema: definition.schema, evidence: definition.evidence },
        initialization: { stepId: "checkout-allowance-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
      await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy: { profile: definition.key },
        logicalStorage, commands: [write, read] }), host => host.initialize([]), host => host.close));
      members.push({ participant: defineAtomicCommerceParticipant("checkoutOwner" + members.length), logicalStorage, commands: [write, read] });
    }
    const root = defineAtomicCommerceCommand("checkoutAllowanceRoot", (ctx, mode) => Effect.gen(function* () {
      const output = [];
      for (const [index, member] of members.entries()) output.push(yield* ctx.call(member.participant, mode === "read" ? read : write,
        mode === "read" ? null : { id: mode === "fail" ? "rollback" : "same-id", owner: "owner-" + index }));
      if (mode === "fail") return yield* ctx.refuse(commerceError("invalidInput"));
      return output;
    }));
    const input = { ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-checkout-eighteen" },
      commands: [root], participants: members, executionIsolation: "scopeExclusive" as const };
    expect(await Effect.runPromise(Effect.result(makeAtomicCommerceHost(input)))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...input, requestParticipantLimit: 18 }), host => Effect.gen(function* () {
      expect(yield* Effect.result(host.run(host.newRequestKey(), root, "write"))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    }), host => host.close));
    // This neutral eighteen-call root selects the existing explicit call ABI.
    // Participant admission must not silently increase the ordinary call limit.
    const baselineCalls = calls;
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...input, requestParticipantLimit: 18, requestCallLimit: 128 }), host => Effect.gen(function* () {
      expect(yield* host.run(host.newRequestKey(), root, "read")).toEqual(members.map(() => []));
      const request = host.newRequestKey(), expected = members.map((_, index) => ({ id: "same-id", owner: "owner-" + index }));
      expect(yield* host.run(request, root, "write")).toEqual(expected);
      expect(calls - baselineCalls).toBe(18);
      expect(yield* host.run(request, root, "write")).toEqual(expected);
      expect(calls - baselineCalls).toBe(18);
      expect(yield* Effect.result(host.run(host.newRequestKey(), root, "fail"))).toMatchObject({ _tag: "Failure" });
      expect(calls - baselineCalls).toBe(36);
      expect(yield* host.run(host.newRequestKey(), root, "read")).toEqual(expected.map(row => [row]));
    }), host => host.close));
  } finally {
    for (const release of cleanup.reverse()) await release();
  }
}

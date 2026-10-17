import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { isJsonObject } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";

const Mode = Schema.Literals(["matched", "empty", "zeroWindow", "retained", "invalid"]);
const mode = Schema.decodeUnknownResult(Mode);
const queryFor = (value: typeof Mode.Type) => ({ fields: value === "invalid" ? ["not_a_field"] : ["entry_key", "text"],
  order: { column: "entry_key", direction: "asc" }, skip: 0, take: value === "zeroWindow" ? 0 : 8,
  predicate: { kind: "in", column: "folio_key", values: value === "empty" ? ["absent-owner"] : ["evidence-owner", "missing", "evidence-owner"] },
});

/** Real committed neutral rows exercise the ordinary atomic owner. No Medusa
 * module, custom row store, fake query execution or alternate proof issuer. */
export const logicalRelationalReadEvidenceScenario = Effect.fn("LogicalReadEvidence.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
  schemaVersionId: CatalogSchemaVersionId, source: unknown, session: RelationalSession,
) {
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const logicalStorage: LogicalCommerceSelectionInput = { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
    unique: fixture.uniqueConstraintEligibility, schemaVersionId, source,
    initialization: { stepId: "folio.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const hostInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
    session, target, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-read-evidence" } };
  const participant = defineAtomicCommerceParticipant("neutralReadEvidence");
  const seed = defineCommerceCommand("neutralReadEvidenceSeed", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "evidence-owner" }, { folio_key: "outside-owner" }]);
    return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [
      { entry_key: "b", folio_key: "evidence-owner", text: "second" },
      { entry_key: "a", folio_key: "evidence-owner", text: "first" },
      { entry_key: "outside", folio_key: "outside-owner", text: "unselected" },
    ])];
  }));
  const read = defineCommerceCommand("neutralReadEvidenceSelection", "read", (ctx, input) => Effect.gen(function* () {
    const selected = yield* Effect.fromResult(mode(input).pipe(Result.mapError(cause => commerceError("invalidInput", cause))));
    const query = queryFor(selected), store = yield* ctx.table("entry"), program = store.prepareRead(query);
    const rows = yield* program.find(ctx.manager);
    if (selected === "retained") { query.take = 0; query.predicate.values.splice(0, query.predicate.values.length, "outside-owner"); }
    return { rows: [...rows], count: yield* program.count(ctx.manager) };
  }));
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [read] }),
    host => host.initialize([]), host => host.close);
  const receipts: string[] = [];
  const validateLogicalCall: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
    expect(call.events).toEqual([]);
    if (call.commandName !== "neutralReadEvidenceSelection") return;
    const selected = Result.getOrThrow(mode(call.input)), query = queryFor(selected);
    const total = selected === "empty" ? 0 : 2, returned = selected === "zeroWindow" ? 0 : total;
    expect(activity.mutations).toEqual([]); expect(activity.lifecycle).toEqual([]);
    expect(activity.relationalReads).toEqual([0, 1].map(() => ({ table: "entry", query, total, returned })));
    expect(call.result).toEqual({ rows: returned === 0 ? [] : [{ entry_key: "a", text: "first" }, { entry_key: "b", text: "second" }], count: total });
    const ownedQuery = activity.relationalReads[0]?.query;
    if (ownedQuery === undefined || !isJsonObject(ownedQuery)) throw new Error("Missing captured query object");
    expect(Reflect.set(ownedQuery, "take", 100)).toBe(false);
    receipts.push(selected);
  });
  const seedRoot = defineAtomicCommerceCommand("neutralReadEvidenceSeedRoot", ctx => ctx.call(participant, seed, null));
  const readRoot = defineAtomicCommerceCommand("neutralReadEvidenceRoot", (ctx, input) => Effect.gen(function* () {
    if (input !== "chain") return yield* ctx.call(participant, read, input);
    const results = [];
    for (const input of ["matched", "empty", "zeroWindow", "retained"]) results.push(yield* ctx.call(participant, read, input));
    return results;
  }));
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [seedRoot, readRoot],
    participants: [{ participant, logicalStorage, commands: [seed, read], validateLogicalCall }],
  }), host => Effect.gen(function* () {
    yield* host.run(host.newRequestKey(), seedRoot, null);
    const request = host.newRequestKey();
    const value = yield* host.run(request, readRoot, "chain");
    expect(receipts).toEqual(["matched", "empty", "zeroWindow", "retained"]);
    expect(yield* host.run(request, readRoot, "chain")).toEqual(value);
    expect(receipts).toHaveLength(4);
    expect(yield* Effect.result(host.run(host.newRequestKey(), readRoot, "invalid")))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(receipts).toHaveLength(4);
    yield* host.run(host.newRequestKey(), readRoot, "empty");
    expect(receipts).toEqual(["matched", "empty", "zeroWindow", "retained", "empty"]);
  }), host => host.close);
});

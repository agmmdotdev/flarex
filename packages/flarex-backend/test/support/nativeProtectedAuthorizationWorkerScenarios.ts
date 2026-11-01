import { Cause, Effect, Exit, Schema } from "effect";
import { expect } from "vitest";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { canonicalizeTransactionGrantIdentityAccessPolicyV1Effect } from "flarex-protocol/transaction-grant";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { Json } from "flarex-protocol/json";
import { isNonArrayRecord } from "@flarex/utils/records";
import { CmsTransactionError } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import type { CoreNativeRootRecoveryInput } from "../../../persistence-postgres/src/core/api";
import type { PrivateReferencePermissions } from "../../../persistence-postgres/src/execution/journal/privatePermissionEvidence";
import { coreNativeFixtureData } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { createNativeProtectedWorkerFixture, type NativeProtectedReadSelection } from "./nativeProtectedWorkerFixture";

const document = Schema.Struct({ id: Schema.String, headline: Schema.String, featuredProduct: Schema.optionalKey(Schema.NullOr(Schema.String)) });
const decodeResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, results: Schema.Array(document) }));
interface Step { readonly method: string; readonly args: Json; readonly previous?: true; readonly participant?: string }
interface ReadProfile { readonly root: CoreNativeRootRecoveryInput; readonly selection: NativeProtectedReadSelection }
type HookMode = "none" | "beforeValidate" | "beforeChange" | "nestedUpdate";
const create = (headline: string, target?: string | null): Step => ({ method: "payload-create", args: {
  collection: "articles", data: { headline, ...(target === undefined ? {} : { featuredProduct: target }) } } });
const update = (id: string, data: Json): Step => ({ method: "payload-update", args: { collection: "articles", id, data } });
const handlerSource = `export async function save(ctx, args) {
  const id = await ctx.db.insert("users", { name: "Protected authorization" });
  const results = [];
  for (const operation of args.operations) {
    const input = operation.previous ? { ...operation.args, id: results[results.length - 1].id } : operation.args;
    try { results.push(await ctx.privateMixed.call(operation.participant || "payload", operation.method, input)); }
    catch (failure) { if (!args.catchFailure) throw failure; }
  }
  return { id, results };
}`;

/** Native Payload hooks and access execute normally; this fixture only changes
 * selected stored permissions and arranges genuine lifecycle callbacks. */
export async function nativeProtectedAuthorizationWorkerScenario(driver: "pglite" | "postgres") {
  let hookMode: HookMode = "none", normalizedTarget = "", nestedId = "";
  let changes = 0, validations = 0, executions = 0;
  const fixture = await createNativeProtectedWorkerFixture(driver, { handlerSource, payloadInstrumentation: {
    onExecute: () => { executions++; },
    hooks: {
      beforeValidate: [({ data }) => {
        validations++;
        if (hookMode !== "beforeValidate") return data;
        const captured: unknown = data;
        if (!isNonArrayRecord(captured)) throw new Error("Expected native Payload hook data");
        return { ...captured, featuredProduct: normalizedTarget };
      }],
      beforeChange: [async ({ data, req }) => {
        changes++;
        const captured: unknown = data;
        if (!isNonArrayRecord(captured)) throw new Error("Expected native Payload hook data");
        if (hookMode === "nestedUpdate") await req.payload.update({ collection: "articles", id: nestedId,
          data: { headline: "Unadmitted nested update" }, req, overrideAccess: false });
        return hookMode === "beforeChange" ? { ...captured, featuredProduct: normalizedTarget } : captured;
      }],
    },
  } });
  try {
    const { run, access, path, policyDocumentId } = fixture;
    let ordinal = 0;
    const key = (label: string) => TransactionRequestKeyV1Schema.make(`native-authorization-${++ordinal}-${label}`);
    const invoke = (operations: readonly Step[], label: string, catchFailure = false, profile?: ReadProfile) =>
      fixture.port(profile?.root, profile?.selection).invoke(path, { operations, catchFailure }, key(label), access);
    const foreignAccess = await run(canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({ policyVersion: access.policy.policyVersion,
      capabilities: access.policy.capabilities, auth: { kind: "trustedDev", principal: "another-captured-canonical-principal" } }));
    const beforeForeign = await fixture.inventory(), foreignLoads = fixture.loader.loads, foreignOpens = fixture.opens;
    expect(foreignAccess.sha256Hex).not.toBe(access.sha256Hex);
    expect(await run(Effect.flip(fixture.port().invoke(path, { operations: [], catchFailure: false }, key("foreign-canonical-principal"), foreignAccess))))
      .toMatchObject({ reason: "authorityRevoked" });
    expect({ loads: fixture.loader.loads, opens: fixture.opens }).toEqual({ loads: foreignLoads, opens: foreignOpens });
    expect(await fixture.inventory()).toEqual(beforeForeign);
    const setPolicy = (policy: PrivateReferencePermissions) => run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
      const operation = yield* database.begin();
      yield* operation.patch(policyDocumentId, { policy });
      yield* database.commit(yield* operation.finalize());
    })));
    const denied = async (operations: readonly Step[], label: string, reason: CmsTransactionError["reason"], catchFailure = false, profile?: ReadProfile) => {
      const before = await fixture.inventory();
      const outcome = await run(Effect.exit(invoke(operations, label, catchFailure, profile)));
      if (Exit.isSuccess(outcome)) throw new Error(`Protected authorization unexpectedly published: ${label}`);
      const nativeReasons = outcome.cause.reasons.filter(Cause.isFailReason).map(failure => failure.error)
        .filter(failure => failure instanceof CmsTransactionError);
      expect(nativeReasons.some(failure => failure.reason === reason), `${label}: ${Cause.pretty(outcome.cause)}`).toBe(true);
      expect(coreNativeFixtureData(await fixture.inventory()), label).toEqual(coreNativeFixtureData(before));
      return nativeReasons;
    };
    const first = fixture.seedProduct.id;
    const second = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await run(fixture.product.host.run(
      fixture.product.host.newRequestKey(), fixture.product.runtime.commands.internalProductCreate,
      { title: "Other authorization target", handle: "native-authorization-other" }))).id;

    await setPolicy({ ...fixture.policy, assign: [], retain: [] });
    for (const [label, target] of [["omitted", undefined], ["null", null]] as const) {
      const saved = decodeResult((await run(invoke([create(label, target)], label))).value).results[0];
      if (saved === undefined) throw new Error("Missing genuine unlinked article");
      expect(saved.featuredProduct ?? null).toBeNull();
    }
    await denied([create("No assignment grant", first)], "assignment-denied", "invalidAuthority");

    await setPolicy({ ...fixture.policy, source: { ...fixture.policy.source, create: false } });
    const beforeSourceDenied = { changes, validations, executions };
    await denied([create("Target grant cannot create", first)], "source-create-denied", "invalidInput");
    expect({ changes, validations }).toEqual({ changes: beforeSourceDenied.changes, validations: beforeSourceDenied.validations });
    expect(executions).toBe(beforeSourceDenied.executions + 1);

    await setPolicy({ ...fixture.policy, assign: [first], retain: [] });
    hookMode = "beforeValidate"; normalizedTarget = first;
    const normalized = decodeResult((await run(invoke([create("Native normalized alias", "picker-alias")], "before-validate"))).value).results[0];
    if (normalized === undefined) throw new Error("Missing normalized article");
    expect(normalized.featuredProduct).toBe(first);
    nestedId = normalized.id;
    hookMode = "beforeChange";
    expect(decodeResult((await run(invoke([create("Before change alias", "picker-alias")], "before-change"))).value)
      .results[0]?.featuredProduct).toBe(first);
    normalizedTarget = second;
    await denied([create("Hook changes permitted target", first)], "effective-hook-edge", "invalidAuthority", true);
    hookMode = "nestedUpdate";
    await denied([create("Nested method cannot borrow create", first)], "nested-method", "invalidInput");
    hookMode = "none";

    await setPolicy({ ...fixture.policy, assign: [], retain: [first] });
    expect(decodeResult((await run(invoke([update(normalized.id, { headline: "Retain existing" })], "retain"))).value)
      .results[0]?.featuredProduct).toBe(first);
    expect(decodeResult((await run(invoke([update(normalized.id, { featuredProduct: first })], "explicit-retain"))).value)
      .results[0]?.featuredProduct).toBe(first);
    await denied([update(normalized.id, { featuredProduct: null }), update(normalized.id, { featuredProduct: first })],
      "retain-cannot-reassign", "invalidAuthority", true);
    await setPolicy({ ...fixture.policy, assign: [], retain: [] });
    await denied([update(normalized.id, { headline: "Retention revoked" })], "retain-denied", "invalidAuthority");
    expect(decodeResult((await run(invoke([update(normalized.id, { featuredProduct: null })], "clear-without-target-grant"))).value)
      .results[0]?.featuredProduct).toBeNull();

    await setPolicy({ ...fixture.policy, assign: [first], retain: [] });
    const pending = await run(invoke([create("New pending assignment", first), { method: "payload-update", previous: true,
      args: { collection: "articles", data: { headline: "Same pending assignment" } } }], "pending-create-update"));
    expect(decodeResult(pending.value).results.map(value => value.featuredProduct)).toEqual([first, first]);
    const pendingArticle = decodeResult(pending.value).results[0];
    if (pendingArticle === undefined) throw new Error("Missing pending assignment article");
    await setPolicy({ ...fixture.policy, source: { ...fixture.policy.source, update: false } });
    const beforeUpdate = changes;
    await denied([update(pendingArticle.id, { headline: "Forbidden update" })], "source-update-denied", "invalidInput");
    expect(changes).toBe(beforeUpdate);
    await setPolicy({ ...fixture.policy, source: { ...fixture.policy.source, delete: false } });
    await denied([{ method: "payload-delete", args: { collection: "articles", id: pendingArticle.id } }], "source-delete-denied", "invalidInput");

    const readProfile = (ids: readonly string[], targetReadIds: readonly string[]): ReadProfile => ({
      root: fixture.sourceRoot(ids, { targetReadIds }), selection: { kind: "sourceRead", ids, targetReadIds },
    });
    const reads: readonly Step[] = [
      { method: "payload-findByID", args: { collection: "articles", id: pendingArticle.id } },
      { participant: "medusa.product", method: "retrieve", args: { id: first } },
    ];
    const beforeRead = await fixture.inventory();
    const read = await run(invoke(reads, "explicit-source-and-target", false, readProfile([pendingArticle.id], [first])));
    const consumed = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, results: Schema.Array(Schema.Unknown) }))(read.value);
    expect(Schema.decodeUnknownSync(document)(consumed.results[0])).toMatchObject({ id: pendingArticle.id,
      headline: "Same pending assignment", featuredProduct: first });
    expect(Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String }))(consumed.results[1]))
      .toEqual({ id: first, title: "Actual Product native Worker" });
    const afterRead = await fixture.inventory();
    expect(afterRead.rows.length - beforeRead.rows.length).toBe(1);
    expect(afterRead.revisions.filter(row => row.timestamp === read.timestamp)).toHaveLength(1);
    expect(afterRead.rows.filter(row => row.table !== "users")).toEqual(beforeRead.rows.filter(row => row.table !== "users"));
    await denied(reads, "source-cannot-grant-target", "invalidAuthority", true, readProfile([pendingArticle.id], []));
    await denied(reads, "target-cannot-grant-source", "invalidAuthority", true, readProfile([], [first]));

    await setPolicy(fixture.policy);
    for (const extra of [{ overrideAccess: true }, { context: { flarexPrivateReferenceSave: {} } }, { user: { role: "admin" } }]) {
      const refused = await denied([{ method: "payload-create", args: { collection: "articles", data: { headline: "Forged native authority", featuredProduct: first }, ...extra } }],
        "forged-native-context", "unsupportedProfile", true);
      expect(refused.some(failure => failure.reason === "unsupportedProfile" && Schema.isSchemaError(failure.cause))).toBe(true);
    }
    for (const principal of [{ ...fixture.principal, principalDigest: "f".repeat(64) },
      { ...fixture.principal, scopeId: ScopeIdSchema.make("scope_77000000-0000-4000-8000-000000000001") }]) {
      await setPolicy({ ...fixture.policy, principal });
      const loaded = fixture.loader.loads, beforeHooks = { changes, validations, executions };
      await denied([create("Foreign policy principal", first)], "foreign-policy-principal", "invalidAuthority");
      expect(fixture.loader.loads).toBe(loaded);
      expect({ changes, validations, executions }).toEqual(beforeHooks);
    }
    for (const mode of ["storedCorruption", "missing"] as const) {
      await run(fixture.useGeneration(({ database }) => Effect.gen(function* () {
        const operation = yield* database.begin();
        if (mode === "missing") yield* operation.delete(policyDocumentId);
        else yield* operation.patch(policyDocumentId, { policy: {} });
        yield* database.commit(yield* operation.finalize());
      })));
      const loaded = fixture.loader.loads, beforeHooks = { changes, validations, executions };
      await denied([create("Unavailable protected policy", first)], `policy-${mode}`,
        mode === "storedCorruption" ? "storedCorruption" : "invalidAuthority");
      expect(fixture.loader.loads).toBe(loaded);
      expect({ changes, validations, executions }).toEqual(beforeHooks);
    }
  } finally { await fixture.close(); }
}

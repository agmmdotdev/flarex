import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect } from "effect";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile, type CommerceProfile } from "../src/commerceTransaction/profile";
import { defineCommerceCommand, type CommerceCommandContext } from "../src/commerceTransaction/commands";
import { makeLocalCommerceHost, type LocalCommerceEventPolicy } from "../src/commerceTransaction/host";
import { commerceError } from "../src/commerceTransaction/model";
import { makeCommerceBinding } from "../src/commerce";
import { makeDataBindingHost, dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { commerceHostFixture, type CommerceHostTestFixture } from "./commerceHostFixture";
import { commerceInventory } from "./commerceInventory";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture } from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { structuralCommerceProvenance, structuralCommerceSchema } from "./structuralCommerceSchema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid structural binding driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let escaped: CommerceCommandContext | undefined;
let deliveries = 0;
const events: LocalCommerceEventPolicy = {
  capture: () => Effect.fail(commerceError("unadmittedEvent")),
  validate: entries => entries.length === 0 ? Effect.void : Effect.fail(commerceError("unadmittedEvent")),
  deliver: entries => Effect.sync(() => { deliveries += entries.length; }),
};
const seed = defineCommerceCommand("seed-parent-child", "write", Effect.fn(function* (ctx) {
  yield* (yield* ctx.table("parent")).write(ctx.manager, "insert", [{ id: "parent-with-child" }]);
  yield* (yield* ctx.table("child")).write(ctx.manager, "insert", [{ id: "child", parent_id: "parent-with-child" }]);
  return null;
}));
const insert = defineCommerceCommand("insert-parent", "write", Effect.fn(function* (ctx, rows) {
  escaped = ctx;
  return yield* (yield* ctx.table("parent")).write(ctx.manager, "insert", rows);
}));
const read = defineCommerceCommand("read-parent", "read", Effect.fn(function* (ctx) {
  return yield* (yield* ctx.table("parent")).find(ctx.manager, { fields: ["id"], order: { column: "id", direction: "asc" } });
}));
const remove = defineCommerceCommand("remove-parent", "write", Effect.fn(function* (ctx) {
  return yield* (yield* ctx.table("parent")).delete(ctx.manager, [{ id: "parent-with-child" }]);
}));
const forbidden = ["find", "count", "insert", "update", "upsert", "delete", "softDelete", "restore"].map(operation =>
  defineCommerceCommand(`structural-${operation}`, operation === "find" || operation === "count" ? "read" : "write", Effect.fn(function* (ctx) {
    const child = yield* ctx.table("child");
    switch (operation) {
      case "find": return yield* child.find(ctx.manager, { fields: ["id"], order: { column: "id", direction: "asc" } });
      case "count": return yield* child.count(ctx.manager, {});
      case "insert": case "update": case "upsert": return yield* child.write(ctx.manager, operation, [{ id: "child", parent_id: "parent-with-child" }]);
      case "delete": return yield* child.delete(ctx.manager, [{ id: "child" }]);
      case "softDelete": case "restore": return yield* child.lifecycle(ctx.manager, operation, [{ id: "child" }]);
      default: return yield* ctx.refuse(commerceError("invalidInput"));
    }
  })));
const caught = defineCommerceCommand("caught-structural-refusal", "write", Effect.fn(function* (ctx) {
  yield* (yield* ctx.table("parent")).write(ctx.manager, "insert", [{ id: "must-roll-back" }]);
  const result = yield* Effect.result(ctx.table("child"));
  expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  return "caught";
}));
const publish = defineCommerceCommand("publish-structural", "write", Effect.fn(function* (ctx) {
  yield* ctx.captureLocalEvent({ tableId: "child", id: "child" });
  return null;
}));
const commands = [seed, insert, read, remove, caught, publish, ...forbidden];

beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  fixture = await commerceHostFixture(resource.persistence, resource.session, Effect.fn(function* (deploymentId, target) {
    const { artifact } = yield* captureRelationalSchemaArtifact({ deploymentId, provenance: structuralCommerceProvenance, schema: structuralCommerceSchema() });
    const layout = yield* captureRelationalPhysicalLayout({ artifact, ...target });
    const profile = yield* registerLocalCommerceProfile(artifact, layout, "test.seed", ["parent", "child", "independent"].map(tableId => ({ tableId, keyId: `${tableId}.primary` })));
    return { profile, initialization: { rows: undefined } };
  }), commands, control, () => events);
  await runEffect(fixture.host.run(fixture.host.newRequestKey(), seed, {}));
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120000);

async function activate(profiles: readonly CommerceProfile[], attempt: string) {
  const bindings = await runEffect(makeDataBindingHost({ ...fixture.bindingsInput, commerceProfiles: profiles }));
  const binding = await runEffect(makeCommerceBinding(fixture.availability, profiles));
  const frame = { ...fixture.candidate.frame, commerce: [binding] };
  // The current host authenticates the selected profiles before the next activation.
  const previous = await runEffect(activeBindings().withCurrent(readAdmittedDataBinding));
  const candidate = await runEffect(bindings.prepare(frame));
  const request = dataBindingActivationRequest(frame.application.scopeId, frame.application.storageGeneration, attempt, candidate.sha256, previous.head);
  await runEffect(bindings.activate(request));
  expect(await runEffect(bindings.recover(request))).toMatchObject({ current: { _tag: "Success", success: { selected: true } } });
  selectedBindings = bindings;
  return { bindings, frame, candidate };
}
let selectedBindings: CommerceHostTestFixture["bindings"] | undefined;
const activeBindings = () => selectedBindings ?? fixture.bindings;

it("authenticates structural ownership through activation, restart, replay, replacement and revocation", async () => {
  const { artifact, layout } = fixture.descriptor;
  const parentGrant = [{ tableId: "parent", keyId: "parent.primary", remove: "declaredKey" as const }];
  const issue = () => registerLocalCommerceProfile(artifact, layout, "test.parent", parentGrant, undefined, ["child"]);
  const profile = await runEffect(issue());
  const independent = await runEffect(registerLocalCommerceProfile(artifact, layout, "test.independent", [{ tableId: "independent", keyId: "independent.primary" }]));
  const { bindings, frame } = await activate([profile, independent], "structural-activate");
  const local = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, profile }, events));
  const key = local.host.newRequestKey();
  const result = await runEffect(local.host.run(key, insert, [{ id: "retained" }]));
  const freshProfile = await runEffect(issue());
  const restartedBindings = await runEffect(makeDataBindingHost({ ...fixture.bindingsInput, commerceProfiles: [freshProfile, independent] }));
  expect(await runEffect(restartedBindings.withCurrent(readAdmittedDataBinding))).toEqual(await runEffect(bindings.withCurrent(readAdmittedDataBinding)));
  const restarted = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, profile: freshProfile }, events));
  const before = await commerceInventory(fixture);
  expect(await runEffect(restarted.host.run(key, insert, [{ id: "retained" }]))).toEqual(result);
  expect(await runEffect(restarted.host.read(read, {}))).toEqual([{ id: "parent-with-child" }, { id: "retained" }]);
  for (const command of forbidden) {
    expect(await runEffectFailure(restarted.host.run(restarted.host.newRequestKey(), command, {}))).toMatchObject({ reason: "invalidAuthority" });
  }
  expect(await runEffectFailure(restarted.host.run(restarted.host.newRequestKey(), caught, {}))).toMatchObject({ reason: "closed" });
  expect(await runEffectFailure(restarted.host.run(restarted.host.newRequestKey(), publish, {}))).toMatchObject({ reason: "unadmittedEvent" });
  expect(await runEffectFailure(restarted.host.initialize([{ id: "unadmitted-seed" }]))).toMatchObject({ reason: "unsupportedProfile" });
  if (escaped === undefined) throw new Error("Missing escaped context");
  expect(await runEffectFailure(escaped.table("child"))).toMatchObject({ reason: "invalidAuthority" });
  expect(await runEffectFailure(escaped.store.find(escaped.manager, {}))).toMatchObject({ reason: "invalidAuthority" });
  // Existing trusted reverse-FK probes must still see rows outside data grants.
  expect(await runEffectFailure(restarted.host.run(restarted.host.newRequestKey(), remove, {}))).toMatchObject({ reason: "unsupportedProfile" });
  expect(await commerceInventory(fixture)).toEqual(before);
  expect(deliveries).toBe(0);
  const legacy = await runEffect(registerLocalCommerceProfile(artifact, layout, "test.parent", parentGrant));
  const wrong = await runEffect(makeDataBindingHost({ ...fixture.bindingsInput, commerceProfiles: [legacy, independent] }));
  expect(await runEffectFailure(wrong.prepare(frame))).toMatchObject({ reason: "unsupportedProfile" });
  expect(await runEffectFailure(wrong.withCurrent(readAdmittedDataBinding))).toMatchObject({ reason: "unsupportedProfile" });
  // Same profile ID with different authenticated capabilities cannot replay the old outcome.
  await activate([legacy], "structural-replace");
  const legacyHost = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, profile: legacy }, events));
  expect(await runEffectFailure(legacyHost.host.run(key, insert, [{ id: "retained" }]))).toMatchObject({ reason: "requestConflict" });
  expect(await runEffectFailure(restarted.host.read(read, {}))).toMatchObject({ reason: "unsupportedProfile" });
  await activate([independent], "structural-revoke");
  expect(await runEffectFailure(legacyHost.host.read(read, {}))).toMatchObject({ reason: "unsupportedProfile" });
  expect(await commerceInventory(fixture)).toEqual(before);
}, 120000);

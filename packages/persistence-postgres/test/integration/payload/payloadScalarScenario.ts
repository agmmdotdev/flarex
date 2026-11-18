import { makeCmsCommandBinding, type CmsCommandBinding } from "../../../src/frameworks/cmsTransaction/construction";
import { inspectPayloadHostForTest, inspectPayloadRuntimeForTest, withPayloadRuntimeScopeForTest } from "../../../../payload-adapter/src/testing";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { expect } from "vitest";
import { Effect } from "effect";
import { ValidationError } from "payload";
import { isJsonObject } from "flarex-protocol/json";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { makeCmsHost, type CmsHostInput } from "../../../src/frameworks/cmsTransaction/host";

import { makePayloadConformanceRuntime, type PayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { makePayloadRuntime, type PayloadHost } from "../../../../payload-adapter/src/runtime";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { payloadScalarFields, payloadScalarContentIdentity,
  payloadPostsCollectionDefinition } from "../../../../payload-adapter/src/testing/profiles";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes, fxSystemCommitAppRowChanges, fxSystemScopeClocks, fxAppUniqueKeys, fxAppIndexEntryCurrent } from "../../../src/database/schema";
import { cmsHostFixture } from "../../frameworks/cmsTransaction/cmsHostFixture";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

export function payloadScalarScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession,
  native?: (context: { conformance: PayloadConformanceRuntime;
    hostInput: Omit<CmsHostInput<unknown>, "commands" | "expectedContentIdentity">;
    createBinding: (session: RelationalSession) => Promise<CmsCommandBinding>;
    host: PayloadHost; inventory: () => Promise<unknown> }) => Promise<void>) {
  return runEffect(Effect.scoped(makePayloadConformanceRuntime().pipe(Effect.flatMap(conformance => Effect.promise(async () => {
    const compiled = await runEffect(compilePayloadCollections([payloadPostsCollectionDefinition("payload.scalar")]));
    const { fixture } = await cmsHostFixture(persistence, { cmsFields: payloadScalarFields }, compiled);
    const hostInput = { hostRuntime: preparedHostTestRuntime(persistence.drizzle), database: persistence.drizzle, controlDatabase: fixture.control.drizzle, session,
      deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
      authority: fixture.authorityPorts, pointCommitAuthority: fixture.pointCommitAuthority,
      application: fixture.relationActivation,
      identityAndAccessPolicy: { profile: "payload.scalar", release: "3.88.0", access: "closed-headless-local-api", hook: "fixed-nested-conformance" },
      materialization: fixture.servingOwners.materialization };
    const createBinding = (selectedSession: RelationalSession) => runEffect(withPayloadRuntimeScopeForTest(conformance.runtime,
      fixture.makeServing(selectedSession).pipe(Effect.flatMap(serving => makeCmsCommandBinding({ serving,
        hostRuntime: hostInput.hostRuntime, identityAndAccessPolicy: hostInput.identityAndAccessPolicy, profile: { kind: "fullProof" } })))));
    const binding = await createBinding(session);
    const host = await runEffect(conformance.runtime.bind(binding));
    const inventory = async () => ({ rows: await persistence.drizzle.select().from(fxAppRowCurrent), revisions: await persistence.drizzle.select().from(fxAppRowRevisions),
      commits: await persistence.drizzle.select().from(fxSystemCommits), outcomes: await persistence.drizzle.select().from(fxSystemIdempotency),
      wakes: await persistence.drizzle.select().from(fxSystemCommitWakes), facts: await persistence.drizzle.select().from(fxSystemCommitAppRowChanges),
      clocks: await persistence.drizzle.select().from(fxSystemScopeClocks), unique: await persistence.drizzle.select().from(fxAppUniqueKeys), indexes: await persistence.drizzle.select().from(fxAppIndexEntryCurrent) });
    const initial = await inventory();
    expect(await runEffect(host.find({ collection: "posts",}))).toEqual({ docs: [], totalDocs: 0, limit: 10, totalPages: 1,
      page: 1, pagingCounter: 1, hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null });
    const key = host.newRequestKey();
    const input = { collection: "posts", data: { title: "first", publishedAt: "2026-01-01" } };
    const created = await runEffect(host.create(key, input));
    if (!isJsonObject(created) || typeof created.id !== "string") throw new Error("Expected Payload document");
    expect(created).toMatchObject({ title: "first", score: 0, enabled: false, publishedAt: "2026-01-01T00:00:00.000Z" });
    expect(typeof created.createdAt).toBe("string");
    expect(created).not.toHaveProperty("_id");
    const published = await inventory();
    expect(published.rows).toHaveLength(initial.rows.length + 1);
    for (const name of ["commits", "outcomes", "wakes", "facts"] as const) expect(published[name]).toHaveLength(initial[name].length + 1);
    const expected = { ...payloadScalarContentIdentity };
    const capturedHost = await runEffect(makeCmsHost({ ...hostInput, commands: Object.values(inspectPayloadRuntimeForTest(conformance.runtime).commands), expectedContentIdentity: expected }));
    expected.configSha256 = "0".repeat(64);
    expect(await runEffect(capturedHost.run(key, inspectPayloadRuntimeForTest(conformance.runtime).commands.create, input))).toEqual(created);
    const mismatched = await runEffect(makeCmsHost({ ...hostInput, commands: Object.values(inspectPayloadRuntimeForTest(conformance.runtime).commands), expectedContentIdentity: expected }));
    expected.configSha256 = payloadScalarContentIdentity.configSha256;
    const beforeMismatch = conformance.observations.executions();
    expect(await runEffectFailure(mismatched.run(key, inspectPayloadRuntimeForTest(conformance.runtime).commands.create, input))).toMatchObject({ reason: "invalidAuthority" });
    expect(await runEffectFailure(mismatched.read(inspectPayloadRuntimeForTest(conformance.runtime).commands.find, { collection: "posts",}))).toMatchObject({ reason: "invalidAuthority" });
    expect(conformance.observations.executions()).toBe(beforeMismatch);
    expect(await runEffect(host.create(key, input))).toEqual(created);
    expect(await inventory()).toEqual(published);
    expect(await runEffect(host.findByID({ collection: "posts", id: created.id }))).toEqual(created);
    expect(await runEffect(host.count({ collection: "posts", where: { title: { equals: "first" } } }))).toEqual({ totalDocs: 1 });
    const updated = await runEffect(host.update(host.newRequestKey(), { collection: "posts", id: created.id, data: { title: "updated", score: 2, enabled: true } }));
    expect(updated).toMatchObject({ id: created.id, createdAt: created.createdAt, title: "updated", score: 2, enabled: true });
    const stable = await inventory();
    const invalid = await runEffectFailure(host.create(host.newRequestKey(), { collection: "posts", data: { publishedAt: "2026-01-01" } }));
    expect(invalid).toMatchObject({ reason: "documentInvalid", cause: { status: 400, data: { errors: [{ path: "title" }] } } });
    expect(invalid.cause).toBeInstanceOf(ValidationError);
    const duplicate = await runEffectFailure(host.create(host.newRequestKey(), { collection: "posts", data: { title: "updated", publishedAt: "2026-01-01" } }));
    expect(duplicate.cause).toBeInstanceOf(ValidationError);
    expect(duplicate).toMatchObject({ reason: "documentInvalid", cause: { status: 400, data: { errors: [{ path: "title", message: "Value must be unique" }] } } });
    expect(await inventory()).toEqual(stable);
    await runEffect(host.create(host.newRequestKey(), { collection: "posts", data: { title: "nested-ok", publishedAt: "2026-01-01" } }));
    const nested = await inventory();
    expect(nested.rows).toHaveLength(stable.rows.length + 2);
    expect(nested.commits).toHaveLength(stable.commits.length + 1);
    expect(nested.facts).toHaveLength(stable.facts.length + 2);
    for (const title of ["nested-fail", "nested-caught"]) {
      await runEffectFailure(host.create(host.newRequestKey(), { collection: "posts", data: { title, publishedAt: "2026-01-01" } }));
      expect(await inventory()).toEqual(nested);
    }
    expect(conformance.observations.hookRuns()).toBe(3);
    const page = await runEffect(host.find({ collection: "posts", limit: 1, page: 2 }));
    expect(page).toMatchObject({ totalDocs: 3, totalPages: 3, page: 2, pagingCounter: 2, hasPrevPage: true, hasNextPage: true, prevPage: 1, nextPage: 3 });
    // Content-only composition still refuses mandatory preference cleanup.
    const beforeDelete = await inventory();
    const deletion = await runEffectFailure(host.delete(host.newRequestKey(), { collection: "posts", id: created.id }));
    expect(deletion).toMatchObject({ reason: "unsupportedProfile" });
    expect(await inventory()).toEqual(beforeDelete);
    expect(await runEffect(host.findByID({ collection: "posts", id: created.id }))).toEqual(updated);
    expect(await runEffect(host.count({ collection: "posts",}))).toEqual({ totalDocs: 3 });
    const unpaginated = await runEffect(host.find({ collection: "posts", limit: 1, page: 2, pagination: false }));
    expect(unpaginated).toMatchObject({ totalDocs: 1, totalPages: 1, page: 2, pagingCounter: 1, hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null });
    const unsupportedQueries = [{ where: { or: [{ title: { equals: "updated" } }] } }, { where: { title: { contains: "updated" } } },
      { where: { score: { equals: 2 } } }, { limit: 33 }, { page: 0 }, { sort: "-id" }, { select: { title: true } }, { depth: 1 }];
    for (const query of unsupportedQueries) await runEffectFailure(inspectPayloadHostForTest(host).host.read(
      inspectPayloadHostForTest(host).commands.find, { collection: "posts", ...query }));
    const beforeMalformed = conformance.observations.executions();
    // Preserve the old first-failure order while decoding each operation separately.
    expect(await runEffectFailure(inspectPayloadHostForTest(host).host.run(host.newRequestKey(), inspectPayloadHostForTest(host).commands.update, { collection: "posts", id: 1, data: null }))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await runEffectFailure(inspectPayloadHostForTest(host).host.run(host.newRequestKey(), inspectPayloadHostForTest(host).commands.update, { collection: "posts", id: 1, data: {} }))).toMatchObject({ reason: "invalidInput" });
    expect(await runEffectFailure(inspectPayloadHostForTest(host).host.run(host.newRequestKey(), inspectPayloadHostForTest(host).commands.create, { collection: "posts", data: { title: "unknown-field", extra: true } }))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await runEffectFailure(inspectPayloadHostForTest(host).host.read(inspectPayloadHostForTest(host).commands.findByID, { collection: "posts", id: 1, depth: 1 }))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await runEffectFailure(inspectPayloadHostForTest(host).host.read(inspectPayloadHostForTest(host).commands.find, { collection: "posts", where: null, limit: 0 }))).toMatchObject({ reason: "invalidInput" });
    expect(await runEffectFailure(inspectPayloadHostForTest(host).host.read(inspectPayloadHostForTest(host).commands.find, { collection: "posts", where: { id: { in: [created.id] } } }))).toMatchObject({ reason: "invalidInput" });
    expect(await runEffectFailure(inspectPayloadHostForTest(host).host.read(inspectPayloadHostForTest(host).commands.count, { collection: "posts", where: {}, depth: 0 }))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await runEffectFailure(inspectPayloadHostForTest(host).host.read(inspectPayloadHostForTest(host).commands.find, null)))
      .toMatchObject({ reason: "invalidInput" });
    expect(conformance.observations.executions()).toBe(beforeMalformed);
    expect(await inventory()).toEqual(beforeDelete);
    const pending = await runEffect(host.create(host.newRequestKey(), { collection: "posts", data: { title: "id-pending", publishedAt: "2026-01-01" } }));
    expect(pending).toMatchObject({ title: "id-pending" });
    const beforeInvalidIds = await inventory();
    for (const title of ["id-foreign", "id-blank", "id-zero", "id-removed"]) {
      await runEffectFailure(host.create(host.newRequestKey(), { collection: "posts", data: { title, publishedAt: "2026-01-01" } }));
      expect(await inventory()).toEqual(beforeInvalidIds);
    }
    expect(new Set(conformance.observations.touched())).toEqual(new Set(["posts"]));
    if (native !== undefined) await native({ conformance, hostInput, createBinding, host, inventory });
    // Ordinary construction must not interpret document titles as test controls.
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const ordinary = yield* makePayloadRuntime(yield* compilePayloadCollections([{ slug: "posts", fields: [
        { name: "title", type: "text", required: true, unique: true },
        { name: "score", type: "number", required: true, defaultValue: 0 },
        { name: "enabled", type: "checkbox", required: true, defaultValue: false },
        { name: "publishedAt", type: "date", required: true },
      ] }]));
      const ordinaryHost = yield* ordinary.bind(yield* makeCmsCommandBinding({ serving: yield* fixture.makeServing(session),
        hostRuntime: hostInput.hostRuntime, identityAndAccessPolicy: { profile: "payload.scalar", access: "closed-headless-local-api", hook: "none" },
        profile: { kind: "fullProof" } }));
      const beforeOrdinary = yield* Effect.promise(inventory);
      const observed = conformance.observations.executions();
      for (const title of ["nested-fail", "id-foreign"]) {
        expect(yield* ordinaryHost.create(ordinaryHost.newRequestKey(), { collection: "posts", data: { title, publishedAt: "2026-01-01" } })).toMatchObject({ title });
      }
      const afterOrdinary = yield* Effect.promise(inventory);
      expect(afterOrdinary.rows).toHaveLength(beforeOrdinary.rows.length + 2);
      expect(afterOrdinary.facts).toHaveLength(beforeOrdinary.facts.length + 2);
      expect(afterOrdinary.commits).toHaveLength(beforeOrdinary.commits.length + 2);
      expect(conformance.observations.executions()).toBe(observed);
    })));
    const active = await runEffect(fixture.relationActivation.readActive());
    const peerScopeId = ScopeIdSchema.make("scope_payload_scalar_peer");
    await fixture.control.insertScopeMetadata({ deploymentId: fixture.deploymentId,
      scopeId: peerScopeId, physicalLocator: active.basis.authority.physicalLocator });
    const beforePeer = await inventory();
    expect(await runEffectFailure(makeCmsHost({ ...hostInput, scopeId: peerScopeId, commands: Object.values(inspectPayloadRuntimeForTest(conformance.runtime).commands),
      expectedContentIdentity: payloadScalarContentIdentity })))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(await inventory()).toEqual(beforePeer);
    const selected = await runEffect(conformance.runtime.bind(binding));
    const scopedKey = selected.newRequestKey();
    const scopedInput = { collection: "posts", data: { title: "selected-after-peer", publishedAt: "2026-01-01" } };
    const scoped = await runEffect(selected.create(scopedKey, scopedInput));
    if (!isJsonObject(scoped) || typeof scoped.id !== "string") throw new Error("Missing selected Payload document ID");
    expect(scoped).toMatchObject({ title: "selected-after-peer" });
    expect(await runEffect(selected.create(scopedKey, scopedInput))).toEqual(scoped);
    expect(await runEffect(selected.findByID({ collection: "posts", id: scoped.id }))).toEqual(scoped);
    const afterPeer = await inventory();
    expect(afterPeer.rows).toHaveLength(beforePeer.rows.length + 1);
    expect(afterPeer.commits).toHaveLength(beforePeer.commits.length + 1);
    expect(afterPeer.outcomes).toHaveLength(beforePeer.outcomes.length + 1);
    const beforeClose = await inventory();
    // These escaped capabilities execute only after Effect.scoped has destroyed Payload.
    return async () => {
      expect(await runEffectFailure(conformance.runtime.bind(binding))).toMatchObject({ reason: "closed" });
      expect(await runEffectFailure(host.create(key, input))).toMatchObject({ reason: "closed" });
      expect(await runEffectFailure(host.create(host.newRequestKey(), input))).toMatchObject({ reason: "closed" });
      expect(await runEffectFailure(host.find({ collection: "posts",}))).toMatchObject({ reason: "closed" });
      expect(await inventory()).toEqual(beforeClose);
    };
  }))))).then(checkClosed => checkClosed());
}

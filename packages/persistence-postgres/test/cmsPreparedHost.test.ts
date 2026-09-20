import { afterAll, expect, it } from "vitest";
import { Effect, Tracer } from "effect";
import { and, eq } from "drizzle-orm";
import { fxSystemApplicationFunctions, fxSystemApplicationPublications } from "../src/applicationRelationSchema";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { fxSystemDataBindingHeads } from "../src/frameworkSchema/binding/schema";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture } from "./postgresHelpers";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { prepareAdditionalRelationRevision } from "./applicationRelationReadinessFixture";

const cleanup: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const close of cleanup.reverse()) await close();
});

it("reuses host preparation while revalidating warm reads, writes and replay", async () => {
  const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres")
    throw new Error("Invalid driver");
  const resource =
    driver === "pglite"
      ? await createRelationalPGliteFixture({
          registerCleanup: (close) => {
            cleanup.push(close);
          },
        })
      : await (async () => {
          const fixture = await createFileScopedPostgresFixture();
          cleanup.push(fixture.dispose);
          return {
            persistence: fixture.persistence,
            session: makePostgresRelationalSession(fixture.persistence),
          };
        })();
  const tested = await cmsExecutionMeasurementFixture(
    resource.persistence,
    resource.session,
  );
  const spans: string[] = [];
  const tracer = Tracer.make({
    span(options) {
      spans.push(options.name);
      return new Tracer.NativeSpan(options);
    },
  });
  const observe = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.provideService(Tracer.Tracer, tracer));
  const host = await runEffect(observe(makeCmsHost(tested.input)));
  expect(spans.filter((name) => name === "CmsAdmission.prepare")).toHaveLength(
    1,
  );
  spans.length = 0;
  const before = await tested.inventory();
  const key = host.newRequestKey();
  const args = { count: 1, prefix: "prepared-host" };
  const value = await runEffect(observe(host.run(key, tested.insert, args)));
  const after = await tested.verifyInsert(before, value, 1, args.prefix);
  expect(await runEffect(observe(host.run(key, tested.insert, args)))).toEqual(
    value,
  );
  expect(await runEffect(observe(host.read(tested.read, [])))).toEqual([]);
  expect(tested.executionCount()).toBe(1);
  expect(spans).not.toContain("CmsAdmission.prepare");
  expect(
    spans.filter(
      (name) =>
        name === "ApplicationRelationReadinessFold.acceptPreparedActiveRead",
    ),
  ).toHaveLength(3);
  expect(await tested.inventory()).toEqual(after);

  const db = resource.persistence.drizzle;
  // The retained bundle now contains commitments rather than these byte frames.
  // A warm host must nevertheless verify the actual frames, including for replay.
  const publicationSlot = and(eq(fxSystemApplicationPublications.scopeId, tested.fixture.authority.scopeId),
    eq(fxSystemApplicationPublications.revisionId, tested.fixture.input.revisionId));
  const publication = (await db.select().from(fxSystemApplicationPublications).where(publicationSlot))[0];
  const functionSlot = and(eq(fxSystemApplicationFunctions.scopeId, tested.fixture.authority.scopeId),
    eq(fxSystemApplicationFunctions.revisionId, tested.fixture.input.revisionId));
  const functions = await db.select().from(fxSystemApplicationFunctions).where(functionSlot);
  if (publication === undefined || functions.length === 0) throw new Error("Missing publication fixture");
  const damage = (bytes: Uint8Array) => {
    const damaged = new Uint8Array(bytes);
    damaged[0] = (damaged[0] ?? 0) ^ 1;
    return damaged;
  };
  for (const field of ["schemaBytes", "functionCatalogBytes", "entryBytes"] as const) {
    const priorCounts = [tested.executionCount(), tested.readExecutionCount()];
    if (field === "entryBytes") {
      await db.update(fxSystemApplicationFunctions).set({ entryBytes: new Uint8Array([0]) }).where(functionSlot);
    } else {
      await db.update(fxSystemApplicationPublications).set({ [field]: damage(publication[field]) }).where(publicationSlot);
    }
    try {
      for (const request of [host.read(tested.read, []), host.run(key, tested.insert, args),
        host.run(host.newRequestKey(), tested.insert, { count: 1, prefix: "corrupt-publication" })]) {
        expect(await runEffectFailure(observe(request))).toMatchObject({ reason: "invalidAuthority" });
      }
      expect([tested.executionCount(), tested.readExecutionCount()]).toEqual(priorCounts);
      expect(await tested.inventory()).toEqual(after);
    } finally {
      if (field === "entryBytes") {
        for (const row of functions) await db.update(fxSystemApplicationFunctions).set({ entryBytes: row.entryBytes })
          .where(and(functionSlot, eq(fxSystemApplicationFunctions.functionPath, row.functionPath)));
      } else {
        await db.update(fxSystemApplicationPublications).set({ [field]: publication[field] }).where(publicationSlot);
      }
    }
    expect(await runEffect(observe(host.run(key, tested.insert, args)))).toEqual(value);
    expect(await runEffect(observe(host.read(tested.read, [])))).toEqual([]);
    expect(spans).not.toContain("CmsAdmission.prepare");
  }
  const slot = eq(
    fxSystemDataBindingHeads.scopeId,
    tested.fixture.authority.scopeId,
  );
  const head = (
    await db.select().from(fxSystemDataBindingHeads).where(slot)
  )[0];
  if (head === undefined) throw new Error("Missing binding head");
  const damaged = new Uint8Array(head.canonicalBytes);
  damaged[0] = (damaged[0] ?? 0) ^ 1;
  const executions = [tested.executionCount(), tested.readExecutionCount()];
  await db
    .update(fxSystemDataBindingHeads)
    .set({ canonicalBytes: damaged })
    .where(slot);
  try {
    for (const effect of [
      host.read(tested.read, []),
      host.run(key, tested.insert, args),
      host.run(host.newRequestKey(), tested.insert, {
        count: 1,
        prefix: "refused",
      }),
    ]) {
      expect(await runEffectFailure(observe(effect))).toMatchObject({
        reason: "invalidAuthority",
      });
    }
    expect([tested.executionCount(), tested.readExecutionCount()]).toEqual(
      executions,
    );
    expect(await tested.inventory()).toEqual(after);
    expect(spans).not.toContain("CmsAdmission.prepare");
  } finally {
    await db
      .update(fxSystemDataBindingHeads)
      .set({ canonicalBytes: head.canonicalBytes })
      .where(slot);
  }
  expect(await runEffect(observe(host.run(key, tested.insert, args)))).toEqual(
    value,
  );
  expect(await runEffect(observe(host.read(tested.read, [])))).toEqual([]);
  expect(await tested.inventory()).toEqual(after);
  expect(spans).not.toContain("CmsAdmission.prepare");
  const active = await runEffect(tested.fixture.relationActivation.readActive());
  const next = await prepareAdditionalRelationRevision(tested.fixture);
  await runEffect(tested.fixture.relationActivation.activate({
    revisionId: next.readiness.revisionId, expectedActiveHead: active.expectedActiveHead,
  }));
  const activated = await tested.inventory();
  const callbackCounts = [tested.executionCount(), tested.readExecutionCount()];
  for (const effect of [host.read(tested.read, []), host.run(key, tested.insert, args)]) {
    expect(await runEffectFailure(observe(effect))).toMatchObject({ reason: "invalidAuthority" });
  }
  expect([tested.executionCount(), tested.readExecutionCount()]).toEqual(callbackCounts);
  expect(await tested.inventory()).toEqual(activated);
  expect(spans).not.toContain("CmsAdmission.prepare");
  const rebuilt = await runEffect(observe(makeCmsHost(tested.input)));
  expect(spans.filter(name => name === "CmsAdmission.prepare")).toHaveLength(1);
  // The new Application revision also needs an explicit data-binding cutover.
  // Reconstructing the host must not silently repair that independent authority.
  expect(await runEffectFailure(rebuilt.read(tested.read, []))).toMatchObject({ reason: "bindingChanged" });
  expect(await tested.inventory()).toEqual(activated);
}, 180_000);

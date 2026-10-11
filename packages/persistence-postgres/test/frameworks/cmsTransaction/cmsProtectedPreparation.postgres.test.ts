import { expect, it } from "vitest";
import { Effect, Exit, Scope, Tracer } from "effect";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { createProtectedPayloadLatencyResource, preparePayloadLatencyRuntime } from "../../integration/payload/payloadLatencyFixture";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

it.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "retains CMS binding structure and replaces preferences with the real protected generation", async () => {
    const owner = await createFileScopedPostgresFixture({}, {}, "ordinary");
    try {
      const resource = await createProtectedPayloadLatencyResource(owner);
      const scope = await runEffect(Scope.make());
      try {
        const { host } = await preparePayloadLatencyRuntime(owner.persistence, scope, resource);
        const spans: string[] = [];
        const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
        const observe = <A, E>(work: Effect.Effect<A, E>) => work.pipe(Effect.provideService(Tracer.Tracer, tracer));
        const key = host.newRequestKey();
        const args = { collection: "news-items", data: { headline: "protected-cms-preparation", score: 1 } };
        const created = await runEffect(observe(host.create(key, args)));
        expect(created).toMatchObject({ headline: args.data.headline, score: 1 });
        // Binding candidate and lane replay may be retained only after their
        // original proof. Actual heads and preference evidence remain fresh.
        spans.length = 0;
        expect(await runEffect(observe(host.create(key, args)))).toEqual(created);
        expect(await runEffect(observe(host.find({ collection: "news-items" })))).toMatchObject({ totalDocs: 1 });
        expect(spans).not.toContain("DataBindingRepository.readCandidate");
        expect(spans.filter(name => name === "InstallationRuntime.readEvidence")).toHaveLength(2);
        expect(spans).not.toContain("CmsAdmission.preparePreferences");

        // This genuine writer changes no durable application data, but its
        // statement invalidates target metadata and replaces the current graph.
        await resource.target.activation.persistence.query("update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
        spans.length = 0;
        expect(await runEffect(observe(host.find({ collection: "news-items" })))).toMatchObject({ totalDocs: 1 });
        expect(spans.filter(name => name === "CmsAdmission.preparePreferences")).toHaveLength(1);
        expect(spans.filter(name => name === "InstallationRuntime.prepare")).toHaveLength(1);
        // Restoration snapshots are charged to the replacement generation;
        // its accepting read still runs a separate fresh evidence digest.
        expect(spans.filter(name => name === "InstallationRuntime.readEvidence")).toHaveLength(2);
        spans.length = 0;
        expect(await runEffect(observe(host.create(key, args)))).toEqual(created);
        expect(spans).not.toContain("CmsAdmission.preparePreferences");
        expect(spans).not.toContain("DataBindingRepository.readCandidate");
        expect(spans.filter(name => name === "InstallationRuntime.readEvidence")).toHaveLength(1);

        await runEffect(Scope.close(scope, Exit.succeed(undefined)));
        expect(await runEffectFailure(host.find({ collection: "news-items" }))).toMatchObject({ reason: "closed" });
      } finally {
        await runEffect(Scope.close(scope, Exit.succeed(undefined)));
        await resource.dispose();
      }
    } finally { await owner.dispose(); }
  }, 180_000,
);

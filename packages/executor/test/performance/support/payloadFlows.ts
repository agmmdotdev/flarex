import { makeCmsCommandBinding } from "../../../../persistence-postgres/src/frameworks/cmsTransaction/construction";
import { createHash } from "node:crypto";
import { Effect, Exit, Schema, Scope } from "effect";
import { expect } from "vitest";
import { count } from "drizzle-orm";
import { fxSystemCommits } from "../../../../persistence-postgres/src/database/schema";
import { compilePayloadLatencyCollections, createProtectedPayloadLatencyResource,
  preparePayloadLatencyRuntime } from "../../../../persistence-postgres/test/integration/payload/payloadLatencyFixture";
import { cmsHostFixture } from "../../../../persistence-postgres/test/frameworks/cmsTransaction/cmsHostFixture";
import { policyManifestFixture } from "../../../../persistence-postgres/test/application/ownership/applicationWritePolicyFixture";
import { payloadRelationManifest } from "../../../../persistence-postgres/test/integration/payload/payloadRelationFixture";
import { installPayloadPreferenceFixture } from "../../../../persistence-postgres/test/frameworks/payloadPreferences/payloadPreferenceFixture";
import { installationBindingReference } from "../../../../persistence-postgres/test/installation/frameworkSchema/frameworkDataBindingPhysicalTestSupport";
import { preparedHostTestRuntime } from "../../../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { createFileScopedPostgresFixture, type PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/support/postgresHelpers";
import { createRelationalPGliteFixture } from "../../../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { makePostgresRelationalSession } from "../../../../persistence-postgres/src/database/relationalTransaction/session";
import { dataBindingActivationRequest } from "../../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import { makePayloadConformanceRuntime } from "../../../../payload-adapter/src/testing/conformance";
import { payloadScalarFields, payloadScalarConfiguration } from "../../../../payload-adapter/src/testing/profiles";
import type { Json } from "flarex-protocol/json";
import type { CorePerformanceScenario } from "./scenario";
import type { MixedMutationEffectDiagnostics } from "./measurement";
import { selectedCorePerformanceScenarios, type CorePerformanceScenarioName, type CorePerformanceSize } from "./scenarioCatalog";

const document = Schema.decodeUnknownSync(Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]));
const joinedPage = Schema.decodeUnknownSync(Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String })), hasNextPage: Schema.Boolean }));

/** Fresh-install relation fixtures use the existing fixed many/join profile;
 * this does not extend configurable collection compilation or relation policy. */
export async function preparePayloadFlows(driver: "pglite" | "postgres", profile: "scalar" | "one" | "many" | "joins", size: CorePerformanceSize,
  postgresEndpoints?: PostgresFixtureEndpoints) {
  const relations = profile !== "scalar";
  const started = performance.now();
  const resource = await acquirePayloadResource(driver, profile, postgresEndpoints);
  const persistence = resource.persistence;
  const session = resource.session;
  const scope = await Effect.runPromise(Scope.make());
  let closed = false;
  const dispose = async () => {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    try { await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))); } catch (cause) { failures.push(cause); }
    try { await resource.dispose(); } catch (cause) { failures.push(cause); }
    if (failures.length > 0) throw new AggregateError(failures, "Payload measurement cleanup failed");
  };
  try {
    const prepared = await prepareHost();
    const { runtime, host } = prepared;

    const collection = relations ? "posts" : "news-items";
    const width = profile === "one" ? 1 : size === "small" ? 2 : 8;
    let diagnostics: MixedMutationEffectDiagnostics | undefined;
    const runEffect = <A, E>(work: Effect.Effect<A, E>, observed = false): Promise<A> =>
      Effect.runPromise(!observed || diagnostics === undefined ? work
        : diagnostics.provide(diagnostics.traceEffect("native Payload operation", work)));
    const create = async (title: string, fields: Record<string, Json> = {}) => document(await Effect.runPromise(host.create(host.newRequestKey(), { collection, data: relations ? { title, publishedAt: "2026-01-01", ...fields } : { headline: title, ...fields } })));
    const read = (id: string, depth: 0 | 1 = 0, joins?: { referencedBy: { limit: number } }, observed = false) => runEffect(host.findByID({ collection, id, depth, ...(joins === undefined ? {} : { joins }) }), observed);
    const remove = (id: string, observed = false) => runEffect(host.delete(host.newRequestKey(), { collection, id }), observed);
    const timings = { provisionAndPrepareMs: performance.now() - started, runtimeConstructionMs: null, initialSeedMs: 0,
      ...(resource.installation === undefined ? {} : { installation: resource.installation }) };
    return {
      dispose, prepareSample,
      scenario(name: CorePerformanceScenarioName): CorePerformanceScenario {
        return { timings, ...("pool" in persistence ? { pools: {
          controlPool: resource.protectedPayload?.control.persistence.pool ?? persistence.pool, targetPool: persistence.pool } } : {}), dispose,
          workload: { flow: name, cardinality: { roots: 1, relatedTargets: relations ? width : 0,
            }, limitations: relations ? ["Fixed fresh-install self-relation/join conformance profile; both fields and default joins are present."] : [] },
          setEffectDiagnostics: next => { diagnostics = next; },
          prepareSample: id => prepareSample(name, id) };
      },
    };

    async function prepareSample(name: CorePerformanceScenarioName, suffix: string) {
      const family = profile === "scalar" ? "payload-scalar" : `payload-${profile}`;
      if (!selectedCorePerformanceScenarios("payload").some(value => value.name === name && value.family === family))
        throw new Error("Unknown Payload measurement flow for prepared profile");
      const created: string[] = [];
      let root: ReturnType<typeof document> | undefined;
      const targets: Array<ReturnType<typeof document>> = [];
      const sourceIds: string[] = [];
      let replayKey: ReturnType<typeof host.newRequestKey> | undefined;
      let createdResult: unknown;
      const input = { collection, data: relations ? { title: suffix, publishedAt: "2026-01-01" } : { headline: suffix } };
      if (relations) {
        for (let index = 0; index < width; index++) { const target = await create(`${suffix}-target-${index}`); targets.push(target); created.push(target.id); }
        const target = targets[0];
        if (target === undefined) throw new Error("Missing relation target");
        root = await create(suffix, { relatedPost: target.id,
          ...(profile === "one" ? {} : { relatedPosts: targets.map(value => value.id) }) });
        created.push(root.id);
        if (name === "payload-reverse-join") {
          for (let index = 0; index < width; index++) { const source = await create(`${suffix}-source-${index}`, { relatedPost: root.id });
            created.push(source.id); sourceIds.push(source.id); }
        }
      } else if (name !== "payload-create") {
        replayKey = host.newRequestKey();
        root = document(await Effect.runPromise(host.create(replayKey, input)));
        created.push(root.id);
      }
      let deleted = false;
      const before = (await persistence.drizzle.select({ value: count() }).from(fxSystemCommits))[0]?.value;
      return {
        async run() {
          if (name === "payload-create") {
            const result = await runEffect(host.create(host.newRequestKey(), input), true);
            createdResult = result;
            return result;
          }
          if (root === undefined) throw new Error("Missing prepared Payload root");
          switch (name) {
            case "payload-update": return runEffect(host.update(host.newRequestKey(), { collection, id: root.id, data: { score: 7 } }), true);
            case "payload-delete": {
              const result = await remove(root.id, true); deleted = true; return result;
            }
            case "payload-replay": {
              if (replayKey === undefined) throw new Error("Missing committed request key");
              return runEffect(host.create(replayKey, input), true);
            }
            case "payload-find": return runEffect(host.find({ collection, where: { headline: { equals: suffix } }, limit: 4 }), true);
            case "payload-count": return runEffect(host.count({ collection, where: { headline: { equals: suffix } } }), true);
            case "payload-replace-many": return runEffect(host.update(host.newRequestKey(), { collection, id: root.id, data: { relatedPosts: targets.toReversed().map(value => value.id) } }), true);
            case "payload-populate-one": case "payload-populate-many": return read(root.id, 1, undefined, true);
            case "payload-reverse-join": return read(root.id, 1, { referencedBy: { limit: width } }, true);
            case "payload-find-by-id": return read(root.id, 0, undefined, true);
            default: throw new Error("Unknown Payload measurement flow");
          }
        },
        async verify(result: unknown) {
          const writes = name === "payload-create" || name === "payload-update" || name === "payload-delete" || name === "payload-replace-many";
          expect((await persistence.drizzle.select({ value: count() }).from(fxSystemCommits))[0]?.value).toBe((before ?? 0) + (writes ? 1 : 0));
          if (name === "payload-create") {
            const row = document(result);
            expect(row).toMatchObject({ headline: suffix, score: 0 });
            expect(await read(row.id)).toEqual(result);
          } else if (name === "payload-delete") {
            expect(document(result).id).toBe(root?.id);
            expect(await Effect.runPromise(host.count({ collection, where: { headline: { equals: suffix } } }))).toEqual({ totalDocs: 0 });
          } else if (name === "payload-count") expect(result).toEqual({ totalDocs: 1 });
          else if (name === "payload-find") expect(result).toMatchObject({ totalDocs: 1, docs: [{ id: root?.id }] });
          else if (name === "payload-update") expect(await read(document(result).id)).toMatchObject({ id: root?.id, score: 7 });
          else if (name === "payload-replay" || name === "payload-find-by-id") expect(result).toEqual(root);
          else if (name === "payload-replace-many") {
            expect(await read(document(result).id)).toMatchObject({ relatedPosts: targets.toReversed().map(value => value.id) });
          } else if (name === "payload-reverse-join") {
            const row = document(result);
            const joined = joinedPage(row.referencedBy);
            expect(joined.docs.map(value => value.id).sort()).toEqual([...sourceIds].sort());
            expect(joined.hasNextPage).toBe(false);
          } else {
            expect(result).toMatchObject({ id: root?.id, relatedPost: { id: targets[0]?.id },
              ...(profile === "one" ? {} : { relatedPosts: targets.map(value => ({ id: value.id })) }) });
          }
        },
        async cleanup() {
          if (createdResult !== undefined) created.push(document(createdResult).id);
          for (const id of created.toReversed()) if (!deleted || id !== root?.id) await remove(id);
        },
      };
    }

    async function prepareHost() {
      if (profile === "scalar" && "pool" in persistence) return preparePayloadLatencyRuntime(
        resource.protectedPayload?.owner.persistence ?? persistence, scope, resource.protectedPayload);
      const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
      if (schemaName === undefined) throw new Error("Missing fixture namespace");
      const compiled = relations ? undefined : await Effect.runPromise(compilePayloadLatencyCollections());
      const scalar = relations ? await policyManifestFixture(undefined, true, payloadScalarFields, payloadScalarConfiguration) : undefined;
      const relation = scalar === undefined ? undefined : await payloadRelationManifest(scalar.manifest, profile !== "one", profile === "joins");
      const { fixture, target, bindings, reference, candidate } = await cmsHostFixture(persistence, {
        ...(relation === undefined ? {} : { cmsFields: payloadScalarFields,
          cmsManifest: { manifest: relation.manifest, manifestSha256: createHash("sha256").update(relation.canonicalBytes).digest("hex") } }),
        physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } }, compiled);
      const { profile: preferenceProfile, availability } = await installPayloadPreferenceFixture(persistence, target, fixture.deploymentId);
      const prior = await Effect.runPromise(bindings.withCurrent(readAdmittedDataBinding));
      const combined = await Effect.runPromise(bindings.prepare({ ...candidate.frame,
        payloadLifecycle: { ...installationBindingReference(availability), profiles: [preferenceProfile.profile] } }));
      await Effect.runPromise(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
        "executor-measurement-preferences", combined.sha256, prior.head)));
      return Effect.runPromise(Effect.gen(function* () {
        const runtime = compiled === undefined ? (yield* makePayloadConformanceRuntime(profile === "one" ? "payload.content-relations"
          : profile === "many" ? "payload.content-many" : "payload.content-joins")).runtime
          : yield* makePayloadRuntime(compiled);
        const binding = yield* makeCmsCommandBinding({ serving: yield* fixture.makeServing(session),
          hostRuntime: preparedHostTestRuntime(persistence.drizzle), identityAndAccessPolicy: { subject: "executor-relation-measurement" },
          profile: { kind: "fullProof", payloadPreferenceTarget: target } });
        return { runtime, host: yield* runtime.bind(binding) };
      }).pipe(Effect.provideService(Scope.Scope, scope)));
    }
  } catch (cause) {
    try { await dispose(); } catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "Payload preparation and cleanup failed"); }
    throw cause;
  }
}

async function acquirePayloadResource(driver: "pglite" | "postgres", profile: "scalar" | "one" | "many" | "joins",
  postgresEndpoints?: PostgresFixtureEndpoints) {
  if (driver === "postgres") {
    const resource = await createFileScopedPostgresFixture({}, {}, "ordinary", postgresEndpoints);
    if (profile === "scalar") {
      try {
        const protectedPayload = await createProtectedPayloadLatencyResource(resource, postgresEndpoints);
        return { persistence: protectedPayload.persistence, session: protectedPayload.session, protectedPayload,
          installation: { migrationMs: protectedPayload.installationTiming.baseMigration.migrationMs,
            managedSetupMs: protectedPayload.installationTiming.managedSetupMs,
            coLocatedSetupMs: protectedPayload.installationTiming.coLocatedSetupMs },
          async dispose() {
            const failures: unknown[] = [];
            try { await protectedPayload.dispose(); } catch (cause) { failures.push(cause); }
            try { await resource.dispose(); } catch (cause) { failures.push(cause); }
            if (failures.length > 0) throw new AggregateError(failures, "Payload resource cleanup failed");
          } };
      } catch (cause) {
        try { await resource.dispose(); } catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "Payload resource setup failed"); }
        throw cause;
      }
    }
    return { persistence: resource.persistence, session: makePostgresRelationalSession(resource.persistence), dispose: resource.dispose,
      protectedPayload: undefined,
      installation: { migrationMs: resource.installationTiming.baseMigration.migrationMs } };
  }
  if (postgresEndpoints !== undefined) throw new Error("PostgreSQL endpoints require the PostgreSQL driver");
  const releases: Array<() => Promise<void>> = [];
  const dispose = async () => {
    const failures: unknown[] = [];
    for (const release of releases.toReversed()) try { await release(); } catch (cause) { failures.push(cause); }
    releases.length = 0;
    if (failures.length > 0) throw new AggregateError(failures, "PGlite fixture cleanup failed");
  };
  try {
    const resource = await createRelationalPGliteFixture({ registerCleanup: release => { releases.push(release); } });
    return { persistence: resource.persistence, session: resource.session, dispose, installation: undefined,
      protectedPayload: undefined };
  } catch (cause) {
    try { await dispose(); } catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "PGlite acquisition and cleanup failed"); }
    throw cause;
  }
}

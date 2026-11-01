import { makeCmsCommandBinding } from "../../../../persistence-postgres/src/frameworks/cmsTransaction/construction";
import { Effect, Exit, Schema, Scope } from "effect";
import { expect } from "vitest";
import { count } from "drizzle-orm";
import { fxSystemCommits } from "../../../../persistence-postgres/src/database/schema";
import { compilePayloadLatencyCollections, createProtectedPayloadLatencyResource,
  preparePayloadLatencyRuntime } from "../../../../persistence-postgres/test/integration/payload/payloadLatencyFixture";
import { cmsHostFixture } from "../../../../persistence-postgres/test/frameworks/cmsTransaction/cmsHostFixture";
import { installPayloadPreferenceFixture } from "../../../../persistence-postgres/test/frameworks/payloadPreferences/payloadPreferenceFixture";
import { installationBindingReference } from "../../../../persistence-postgres/test/installation/frameworkSchema/frameworkDataBindingPhysicalTestSupport";
import { preparedHostTestRuntime } from "../../../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { createFileScopedPostgresFixture, type PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/support/postgresHelpers";
import { createRelationalPGliteFixture } from "../../../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { dataBindingActivationRequest } from "../../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import type { CorePerformanceScenario } from "./scenario";
import type { MixedMutationEffectDiagnostics } from "./measurement";
import { selectedCorePerformanceScenarios, type CorePerformanceScenarioName, type CorePerformanceSize } from "./scenarioCatalog";
import { prepareCorePayloadFlows } from "./corePayloadFlows";

const document = Schema.decodeUnknownSync(Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]));

/** Relation workloads use their current shared-core installation and native host.
 * The protected scalar comparison retains its separately named compatibility lane. */
export async function preparePayloadFlows(driver: "pglite" | "postgres", profile: "scalar" | "one" | "many" | "joins", size: CorePerformanceSize,
  postgresEndpoints?: PostgresFixtureEndpoints) {
  return profile === "scalar" ? prepareScalarPayloadFlows(driver, postgresEndpoints) : prepareCorePayloadFlows(driver, profile, size, postgresEndpoints);
}

/** Retained scalar protected-host baseline; its lifetime/installer replacement is
 * a separate full-goal obligation, not a fallback for current relation consumers. */
async function prepareScalarPayloadFlows(driver: "pglite" | "postgres", postgresEndpoints?: PostgresFixtureEndpoints) {
  const started = performance.now();
  const resource = await acquirePayloadResource(driver, postgresEndpoints);
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
    const { host } = await prepareHost();
    const collection = "news-items";
    let diagnostics: MixedMutationEffectDiagnostics | undefined;
    const runEffect = <A, E>(work: Effect.Effect<A, E>, observed = false): Promise<A> =>
      Effect.runPromise(!observed || diagnostics === undefined ? work
        : diagnostics.provide(diagnostics.traceEffect("native Payload operation", work)));
    const read = (id: string, observed = false) => runEffect(host.findByID({ collection, id, depth: 0 }), observed);
    const remove = (id: string, observed = false) => runEffect(host.delete(host.newRequestKey(), { collection, id }), observed);
    const timings = { provisionAndPrepareMs: performance.now() - started, runtimeConstructionMs: null, initialSeedMs: 0,
      ...(resource.installation === undefined ? {} : { installation: resource.installation }) };
    return {
      dispose, prepareSample,
      scenario(name: CorePerformanceScenarioName): CorePerformanceScenario {
        return { timings, ...("pool" in persistence ? { pools: {
          controlPool: resource.protectedPayload?.control.persistence.pool ?? persistence.pool, targetPool: persistence.pool } } : {}), dispose,
          workload: { flow: name, cardinality: { roots: 1, relatedTargets: 0 }, limitations: [] },
          setEffectDiagnostics: next => { diagnostics = next; },
          prepareSample: suffix => prepareSample(name, suffix) };
      },
    };

    async function prepareSample(name: CorePerformanceScenarioName, suffix: string) {
      if (!selectedCorePerformanceScenarios("payload").some(value => value.name === name && value.family === "payload-scalar"))
        throw new Error("Unknown Payload measurement flow for prepared scalar profile");
      const created: string[] = [];
      let root: ReturnType<typeof document> | undefined;
      let replayKey: ReturnType<typeof host.newRequestKey> | undefined;
      let createdResult: unknown;
      const input = { collection, data: { headline: suffix } };
      if (name !== "payload-create") {
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
            case "payload-find-by-id": return read(root.id, true);
            default: throw new Error("Unknown Payload scalar measurement flow");
          }
        },
        async verify(result: unknown) {
          const writes = name === "payload-create" || name === "payload-update" || name === "payload-delete";
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
          else expect(result).toEqual(root);
        },
        async cleanup() {
          if (createdResult !== undefined) created.push(document(createdResult).id);
          for (const id of created.toReversed()) if (!deleted || id !== root?.id) await remove(id);
        },
      };
    }

    async function prepareHost() {
      if ("pool" in persistence) return preparePayloadLatencyRuntime(resource.protectedPayload?.owner.persistence ?? persistence, scope, resource.protectedPayload);
      const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
      if (schemaName === undefined) throw new Error("Missing fixture namespace");
      const compiled = await Effect.runPromise(compilePayloadLatencyCollections());
      const { fixture, target, bindings, reference, candidate } = await cmsHostFixture(persistence, {
        physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } }, compiled);
      const { profile: preferenceProfile, availability } = await installPayloadPreferenceFixture(persistence, target, fixture.deploymentId);
      const prior = await Effect.runPromise(bindings.withCurrent(readAdmittedDataBinding));
      const combined = await Effect.runPromise(bindings.prepare({ ...candidate.frame,
        payloadLifecycle: { ...installationBindingReference(availability), profiles: [preferenceProfile.profile] } }));
      await Effect.runPromise(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
        "executor-measurement-preferences", combined.sha256, prior.head)));
      return Effect.runPromise(Effect.gen(function* () {
        const runtime = yield* makePayloadRuntime(compiled);
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

async function acquirePayloadResource(driver: "pglite" | "postgres", postgresEndpoints?: PostgresFixtureEndpoints) {
  if (driver === "postgres") {
    const resource = await createFileScopedPostgresFixture({}, {}, "ordinary", postgresEndpoints);
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
    return { persistence: resource.persistence, session: resource.session, dispose, installation: undefined, protectedPayload: undefined };
  } catch (cause) {
    try { await dispose(); } catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "PGlite acquisition and cleanup failed"); }
    throw cause;
  }
}

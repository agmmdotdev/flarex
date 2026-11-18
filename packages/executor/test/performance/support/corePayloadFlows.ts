import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { createCorePayloadFixture } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { makePayloadConformanceRuntime } from "../../../../payload-adapter/src/testing/conformance";
import { preparePayloadConformanceSource } from "../../../../persistence-postgres/test/integration/payload/payloadNativeManyFixture";
import type { PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/support/postgresHelpers";
import type { MixedMutationEffectDiagnostics } from "./measurement";
import type { CorePerformanceScenario } from "./scenario";
import { selectedCorePerformanceScenarios, type CorePerformanceScenarioName, type CorePerformanceSize } from "./scenarioCatalog";

const document = Schema.decodeUnknownSync(Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]));
const joinedPage = Schema.decodeUnknownSync(Schema.Struct({ docs: Schema.Array(Schema.Struct({ id: Schema.String })), hasNextPage: Schema.Boolean }));

/** Uses exactly the current native installation/Local API owner from integration
 * proof. This constructs a workload; it does not run or authorize a campaign. */
export async function prepareCorePayloadFlows(driver: "pglite" | "postgres", profile: "one" | "many" | "joins", size: CorePerformanceSize,
  postgresEndpoints?: PostgresFixtureEndpoints) {
  if (driver !== "postgres" && postgresEndpoints !== undefined) throw new Error("PostgreSQL endpoints require the PostgreSQL driver");
  const started = performance.now();
  const compiled = await preparePayloadConformanceSource(profile === "one" ? "payload.content-relations"
    : profile === "many" ? "payload.content-many" : "payload.content-joins");
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver,
    ...(postgresEndpoints === undefined ? {} : { postgresEndpoints }) }, {
    compiled, preferences: true,
    makeRuntime: source => makePayloadConformanceRuntime(undefined, source).pipe(Effect.map(value => value.runtime)),
  });
  let diagnostics: MixedMutationEffectDiagnostics | undefined;
  const run = <A, E>(work: Effect.Effect<A, E>, observed = false) => fixture.run(!observed || diagnostics === undefined ? work
    : diagnostics.provide(diagnostics.traceEffect("native Payload operation", work)));
  const create = async (title: string, fields: Record<string, string | readonly string[]> = {}) => document(await run(fixture.writer.create(
    fixture.writer.newRequestKey(), { collection: "posts", data: { title, publishedAt: "2026-01-01", ...fields } })));
  const remove = (id: string) => run(fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id }));
  const width = profile === "one" ? 1 : size === "small" ? 2 : 8;
  const timings = { provisionAndPrepareMs: performance.now() - started, runtimeConstructionMs: null, initialSeedMs: 0 };
  const pool = fixture.physical.runtimePool;
  if (driver === "postgres" && pool === undefined) {
    await fixture.close();
    throw new Error("Current native PostgreSQL flow has no runtime-pool diagnostics");
  }
  return {
    dispose: fixture.close, prepareSample,
    scenario(name: CorePerformanceScenarioName): CorePerformanceScenario {
      return { timings, dispose: fixture.close,
        ...(pool === undefined ? {} : { pools: { controlPool: pool, targetPool: pool } }),
        workload: { flow: name, cardinality: { roots: 1, relatedTargets: width }, limitations: [
          "Fixed fresh-install native relationship profile; both fields/default joins are present where admitted.",
          "Total physical/logical preparation is recorded; separate physical installation timing is not attributed.",
        ] },
        setEffectDiagnostics: next => { diagnostics = next; },
        prepareSample: suffix => prepareSample(name, suffix),
      };
    },
  };

  async function prepareSample(name: CorePerformanceScenarioName, suffix: string) {
    if (!selectedCorePerformanceScenarios("payload").some(value => value.name === name && value.family === "payload-" + profile))
      throw new Error("Unknown Payload flow for the current native profile");
    const created: string[] = [], sourceIds: string[] = [];
    const targets: Array<ReturnType<typeof document>> = [];
    try {
      for (let index = 0; index < width; index++) {
        const target = await create(suffix + "-target-" + index); targets.push(target); created.push(target.id);
      }
      const firstTarget = targets[0];
      if (firstTarget === undefined) throw new Error("Missing current relation target");
      const root = await create(suffix, { relatedPost: firstTarget.id,
        ...(profile === "one" ? {} : { relatedPosts: targets.map(target => target.id) }) });
      created.push(root.id);
      if (name === "payload-reverse-join") for (let index = 0; index < width; index++) {
        const source = await create(suffix + "-source-" + index, { relatedPost: root.id }); created.push(source.id); sourceIds.push(source.id);
      }
      const before = await fixture.inventory();
      const beforeTimestamp = await run(fixture.database.publishedTimestamp);
      const committed = before.outcomes.filter(outcome => outcome.value.state === "committed").length;
      let writeKey: string | undefined;
      return {
        async run() {
          switch (name) {
            case "payload-replace-many": {
              writeKey = fixture.writer.newRequestKey();
              return run(fixture.writer.update(writeKey, { collection: "posts", id: root.id,
                data: { relatedPosts: targets.toReversed().map(target => target.id) } }), true);
            }
            case "payload-populate-one": case "payload-populate-many":
              return run(fixture.reader.findByID({ collection: "posts", id: root.id, depth: 1 }), true);
            case "payload-reverse-join":
              return run(fixture.reader.findByID({ collection: "posts", id: root.id, depth: 1, joins: { referencedBy: { limit: width } } }), true);
            default: throw new Error("Unknown current native Payload relation flow");
          }
        },
        async verify(result: unknown) {
          const after = await fixture.inventory();
          const writes = name === "payload-replace-many";
          expect(after.outcomes.filter(outcome => outcome.value.state === "committed")).toHaveLength(committed + (writes ? 1 : 0));
          const timestamp = await run(fixture.database.publishedTimestamp);
          if (writes) {
            expect(timestamp > beforeTimestamp).toBe(true);
            const outcome = after.outcomes.find(value => value.value.key === writeKey);
            const source = after.rows.find(value => value.table === "posts" && value.value._id === root.id);
            expect(outcome?.value.state).toBe("committed");
            expect(source?.timestamp).toBe(outcome?.timestamp);
            expect(await run(fixture.reader.findByID({ collection: "posts", id: document(result).id })))
              .toMatchObject({ relatedPosts: targets.toReversed().map(target => target.id) });
          } else {
            expect(timestamp).toBe(beforeTimestamp);
            if (name === "payload-reverse-join") {
              const page = joinedPage(document(result).referencedBy);
              expect(page.docs.map(source => source.id).sort()).toEqual(sourceIds.toSorted());
              expect(page.hasNextPage).toBe(false);
            } else expect(result).toMatchObject({ id: root.id, relatedPost: { id: firstTarget.id },
              ...(profile === "one" ? {} : { relatedPosts: targets.map(target => ({ id: target.id })) }) });
          }
        },
        async cleanup() { for (const id of created.toReversed()) await remove(id); },
      };
    } catch (cause) {
      const failures: unknown[] = [cause];
      for (const id of created.toReversed()) { try { await remove(id); } catch (cleanup) { failures.push(cleanup); } }
      throw failures.length === 1 ? cause : new AggregateError(failures, "Native Payload sample setup and cleanup failed");
    }
  }
}

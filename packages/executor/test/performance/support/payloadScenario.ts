import { Effect, Exit, Schema, Scope } from "effect";
import { expect } from "vitest";
import { createFileScopedPostgresFixture } from "../../../../persistence-postgres/test/postgresHelpers";
import { preparePayloadLatencyRuntime } from "../../../../persistence-postgres/test/payloadLatencyFixture";
import type { CorePerformanceScenario } from "./scenario";

const decodePayloadCreated = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  headline: Schema.String, score: Schema.Number }));

export async function prepareStandalonePayloadScenario(): Promise<CorePerformanceScenario> {
  const provisionStarted = performance.now();
  const resource = await createFileScopedPostgresFixture();
  const scope = await Effect.runPromise(Scope.make());
  let closed = false;
  const dispose = async () => {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    try { await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))); }
    catch (cause) { failures.push(cause); }
    try { await resource.dispose(); } catch (cause) { failures.push(cause); }
    if (failures.length > 0) throw new AggregateError(failures, "Payload scenario cleanup failed");
  };
  try {
    const prepared = await preparePayloadLatencyRuntime(resource.persistence, scope);
    const provisionAndPrepareMs = performance.now() - provisionStarted;
    return {
      timings: { provisionAndPrepareMs, runtimeConstructionMs: null, initialSeedMs: 0,
        installation: { migrationMs: resource.installationTiming.baseMigration.migrationMs } },
      pools: { controlPool: resource.persistence.pool, targetPool: resource.persistence.pool },
      async prepareSample(id) {
        const input = { collection: "news-items", data: { headline: id } };
        let createdId: string | undefined;
        return {
          run: () => Effect.runPromise(prepared.host.run(prepared.host.newRequestKey(), prepared.runtime.commands.create, input)),
          async verify(result) {
            const created = decodePayloadCreated(result);
            createdId = created.id;
            expect(created).toMatchObject({ headline: id, score: 0 });
            expect(await Effect.runPromise(prepared.host.read(prepared.runtime.commands.findByID,
              { collection: "news-items", id: created.id }))).toEqual(result);
          },
          async cleanup() {
            if (createdId !== undefined) await Effect.runPromise(prepared.host.run(prepared.host.newRequestKey(),
              prepared.runtime.commands.delete, { collection: "news-items", id: createdId }));
          },
        };
      },
      dispose,
    };
  } catch (cause) {
    try { await dispose(); } catch (cleanupCause) {
      throw new AggregateError([cause, cleanupCause], "Payload preparation and cleanup failed");
    }
    throw cause;
  }
}

import { Clock, Effect, Result, Schema } from "effect";
import { captureDocumentObject, decodeDocumentValue, encodeDocumentValue } from "flarex-protocol/document-value";
import { expect, it } from "vitest";
import { inspectPayloadRuntimeForTest } from "../src/testing";
import { defineCmsCommand } from "../../persistence-postgres/src/frameworks/cmsTransaction/commands";
import { createCorePGliteFixture, createCorePostgresFixture, type CorePersistenceFixture } from "../../persistence-postgres/test/core/fixture";
import { readNative10CapturedStore, seedNative10CapturedStore } from "../../persistence-postgres/test/core/physicalNativePayloadStore";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { createCorePayloadFixture, type CorePayloadFixture } from "./support/core-payload-fixture";
import { openCoreDatabase } from "../../persistence-postgres/src/core/database";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../persistence-postgres/test/core/schemaFixture";

const document = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String }));
const decodePhysicalDocuments = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  id: Schema.Uint8Array, table_id: Schema.Uint8Array, ts: Schema.String, json_value: Schema.Uint8Array,
})));
// Freeze the old private clause shape explicitly; do not derive this witness
// from the current normalized policy reader.
const isActiveUnaryPolicy = Schema.is(Schema.Struct({ nativePolicy: Schema.Struct({ state: Schema.Literal("active"),
  uniqueConstraints: Schema.Array(Schema.Struct({ descriptor: Schema.String, field: Schema.String, indexName: Schema.String })
    .annotate({ parseOptions: { onExcessProperty: "error" } })),
}) }));

async function physicalFixture(driver: "pglite" | "postgres"): Promise<CorePersistenceFixture> {
  if (driver === "pglite") return createCorePGliteFixture();
  const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
  if (postgresUrl === null || provisioning === undefined) throw new Error("Native frozen-store fixture requires both PostgreSQL endpoints");
  return createCorePostgresFixture({ connectionString: postgresUrl, provisioningConnectionString: provisioning });
}

async function closeBorrowedFixture(fixture: CorePayloadFixture | undefined, physical: CorePersistenceFixture): Promise<void> {
  const failures: unknown[] = [];
  // Drain the native owner before closing its borrowed physical target.
  try { await fixture?.close(); } catch (cause) { failures.push(cause); }
  try { await physical.close(); } catch (cause) { failures.push(cause); }
  if (failures.length > 0) throw new AggregateError(failures, "Frozen Native10 fixture cleanup failed");
}

/** This immutable store was produced by the actual pre-tuple-policy Native10 runtime. */
export function registerCorePayloadNativeStore(driver: "pglite" | "postgres"): void {
  it("authenticates and replays the exact frozen Native10 command after a cold five-table load", async () => {
    const captured = await readNative10CapturedStore();
    const physical = await physicalFixture(driver);
    let fixture: CorePayloadFixture | undefined;
    try {
      await seedNative10CapturedStore(physical, captured);
      fixture = await createCorePayloadFixture({ kind: "physical", physical, installation: "existing", instanceName: captured.instance }, {
        scopeUuid: captured.nativeIdentity.scopeUuid, epochUuid: captured.nativeIdentity.epochUuid,
      });
      expect(fixture.definition.identity).toEqual(captured.nativeIdentity);
      const publishedBeforeReplay = await fixture.run(fixture.database.publishedTimestamp);
      const existingProposal = await fixture.run(fixture.database.prepareSchema({ native: fixture.definition }));
      await fixture.run(fixture.database.activateSchema(existingProposal, { programs: [], native: fixture.definition }));
      expect(await fixture.run(fixture.database.publishedTimestamp)).toBe(publishedBeforeReplay);
      let bodies = 0;
      const create = inspectPayloadRuntimeForTest(fixture.runtime).commands.create;
      const command = defineCmsCommand({ name: captured.command, mode: "write", run: Effect.fn(function* (ctx, title) {
        bodies++;
        return yield* ctx.nested(create, { collection: "news", data: { title } });
      }) });
      const host = await fixture.run(fixture.openHost([command]));
      expect(await fixture.run(host.run(captured.requestKey, command, captured.input))).toEqual(captured.result);
      expect(bodies).toBe(0);
      const created = document(captured.result);
      expect(await fixture.run(fixture.reader.findByID({ collection: "news", id: created.id }))).toEqual(captured.result);
      expect(await fixture.run(fixture.reader.count({ collection: "news", where: { title: { equals: captured.input } } })))
        .toEqual({ totalDocs: 1 });
      expect(await fixture.run(Effect.result(host.run(captured.requestKey, command, "different-cold-arguments"))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(bodies).toBe(0);
      const duplicate = await fixture.run(Effect.result(fixture.writer.create(fixture.writer.newRequestKey(), {
        collection: "news", data: { title: captured.input },
      })));
      expect(Result.isFailure(duplicate) && duplicate.failure).toMatchObject({ reason: "documentInvalid",
        cause: { data: { errors: [{ path: "title", message: "Value must be unique" }] } } });
      expect(await fixture.run(fixture.reader.count({ collection: "news", where: {} }))).toEqual({ totalDocs: 1 });
    } finally { await closeBorrowedFixture(fixture, physical); }
  }, 60_000);

  it("rejects a weaker valid-shaped tuple policy substituted into the frozen unary store", async () => {
    const captured = await readNative10CapturedStore();
    const physical = await physicalFixture(driver);
    try {
      await seedNative10CapturedStore(physical, captured);
      const rows = decodePhysicalDocuments(await physical.query(
        `SELECT id,table_id,ts::text AS ts,json_value FROM "${physical.namespace}"."documents"
         WHERE instance_name=$1 AND NOT deleted ORDER BY ts DESC`, [captured.instance]));
      let changed = false;
      for (const row of rows) {
        const original = Result.getOrThrow(captureDocumentObject(Result.getOrThrow(decodeDocumentValue(row.json_value))));
        if (!isActiveUnaryPolicy(original)) continue;
        expect(original.nativePolicy.uniqueConstraints).toHaveLength(1);
        expect(original.nativePolicy.uniqueConstraints[0]?.field).toBe("title");
        const weakened = { ...original, nativePolicy: { ...original.nativePolicy,
          uniqueConstraints: original.nativePolicy.uniqueConstraints.map(clause => ({ descriptor: clause.descriptor,
            fields: [clause.field], indexName: clause.indexName, nullsDistinct: true })),
        } };
        await physical.query(`UPDATE "${physical.namespace}"."documents" SET json_value=$1
          WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
        [Result.getOrThrow(encodeDocumentValue(weakened)), captured.instance, row.table_id, row.id, row.ts]);
        changed = true;
        break;
      }
      expect(changed).toBe(true);
      const reopened = await physical.reopen(captured.instance);
      const result = await Effect.runPromise(Effect.scoped(Effect.result(openCoreDatabase(reopened, {
        schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
        now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
        randomBytes: (length: 16 | 32) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))),
      }))));
      expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "corruptData" });
    } finally { await physical.close(); }
  }, 60_000);
}

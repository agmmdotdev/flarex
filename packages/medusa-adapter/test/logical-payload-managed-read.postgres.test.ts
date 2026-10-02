import { Cause, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { isJsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity, decodeAppDocumentIdentityV1Result,
  decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadManagedReadAccessRuntime } from "@flarex/payload-adapter/internal/testing";
import { CmsTransactionError } from "../../persistence-postgres/src/cmsTransaction/model";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("managed Payload Local API reads", () => {
  it("preserves native document and query results while refusing writes on the read host", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), { managedRead: true });
      const managed = fixture.managedRead;
      const source = fixture.sourcePins.find(pin => pin.sourceKey === "payload");
      if (managed === undefined || source === undefined) throw new Error("Missing managed Payload source");
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
          { name: "title", type: "text", required: true, unique: true },
        ] }]);
        const accessRuntime = yield* makePayloadManagedReadAccessRuntime(compiled);
        const { runtime } = accessRuntime;
        const common = { hostRuntime: fixture.hostInput.hostRuntime, database: fixture.persistence.drizzle,
          controlDatabase: fixture.control.drizzle, session: fixture.session,
          deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
          authority: fixture.application.authorityPorts, application: fixture.application.activation,
          identityAndAccessPolicy: { profile: "payload.scalar", access: "closed-headless-local-api" } };
        const writer = yield* runtime.bind({ ...common, materialization: {}, logicalStorage: {
          ports: { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts },
          unique: fixture.application.uniqueConstraintEligibility, schemaVersionId: fixture.schemaVersionId,
          source: compiled.sourceContract,
        } });
        const readInput = { ...common,
          installation: managed.readInstallation, logicalStorage: {
            schemaVersionId: fixture.schemaVersionId, source,
          } };
        const reader = yield* runtime.bindRead(readInput);
        const created = yield* writer.run(writer.newRequestKey(), runtime.commands.create,
          { collection: "news", data: { title: "Managed Local API" } });
        if (!isJsonObject(created) || typeof created.id !== "string") throw new Error("Missing native Payload id");
        const findByID = { collection: "news", id: created.id };
        const find = { collection: "news", where: { title: { equals: "Managed Local API" } }, limit: 5 };
        expect(yield* reader.read(runtime.commands.findByID, findByID))
          .toEqual(yield* writer.read(runtime.commands.findByID, findByID));
        expect(yield* reader.read(runtime.commands.find, find)).toEqual(yield* writer.read(runtime.commands.find, find));
        expect(yield* reader.read(runtime.commands.count, { collection: "news", where: {} }))
          .toEqual(yield* writer.read(runtime.commands.count, { collection: "news", where: {} }));
        const hidden = yield* writer.run(writer.newRequestKey(), runtime.commands.create,
          { collection: "news", data: { title: "Hidden by native access" } });
        if (!isJsonObject(hidden) || typeof hidden.id !== "string") throw new Error("Missing hidden Payload id");
        accessRuntime.selectVisibility("selected");
        const visibleQuery = { collection: "news", where: {}, limit: 5 };
        // The scalar adapter admits one normalized predicate map. Payload's
        // compound access filter remains an explicit unsupported capability.
        for (const host of [reader, writer]) {
          expect(originalCmsFailure(yield* Effect.flip(host.read(runtime.commands.find, visibleQuery))))
            .toMatchObject({ reason: "unsupportedProfile", cause: { capability: "where operator" } });
        }
        accessRuntime.selectVisibility("denied");
        const denied = originalCmsFailure(yield* Effect.flip(reader.read(runtime.commands.find, visibleQuery)));
        expect(denied).toMatchObject({ reason: "invalidInput", cause: { status: 403 } });
        expect(originalCmsFailure(yield* Effect.flip(writer.read(runtime.commands.find, visibleQuery))))
          .toMatchObject({ reason: denied.reason, cause: { status: 403 } });
        expect(accessRuntime.observations.accessCalls()).toBeGreaterThan(0);
        accessRuntime.selectVisibility("all");
        expect(reader).not.toHaveProperty("run");
        expect(reader).not.toHaveProperty("newRequestKey");
        expect(yield* Effect.result(reader.read(runtime.commands.create,
          { collection: "news", data: { title: "Forbidden" } })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
        // The existing logical source profile does not admit native preference
        // cleanup on delete. Preserve that refusal and the existing document.
        expect(originalCmsFailure(yield* Effect.flip(writer.run(writer.newRequestKey(), runtime.commands.delete, findByID))))
          .toMatchObject({ reason: "unsupportedProfile" });
        expect(yield* reader.read(runtime.commands.findByID, findByID)).toEqual(created);
        const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(created.id));
        const missingInput = { collection: "news", id: appDocumentIdV1FromRowIdentity({ tableId: identity.tableId,
          rowId: decodeAppRowIdHexV1("ffffffffffffffffffffffffffffffff") }) };
        const missing = originalCmsFailure(yield* Effect.flip(writer.read(runtime.commands.findByID, missingInput)));
        const managedMissing = originalCmsFailure(yield* Effect.flip(reader.read(runtime.commands.findByID, missingInput)));
        expect(missing).toMatchObject({ reason: "documentMissing", cause: { status: 404 } });
        expect(managedMissing).toMatchObject({ reason: "documentMissing", cause: { status: 404 } });
        expect(managedMissing.cause).toEqual(missing.cause);
        expect(yield* reader.read(runtime.commands.count, { collection: "news", where: {} }))
          .toEqual(yield* writer.read(runtime.commands.count, { collection: "news", where: {} }));
        yield* reader.close;
        expect(yield* Effect.result(reader.read(runtime.commands.find, find)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
        const scopedReader = yield* runtime.bindRead(readInput);
        return { read: scopedReader.read(runtime.commands.find, find), bind: runtime.bindRead(readInput) };
      })).pipe(Effect.flatMap(escaped => Effect.gen(function* () {
        expect(yield* Effect.result(escaped.read))
          .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
        expect(yield* Effect.result(escaped.bind))
          .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
      }))));
    } finally {
      const failures: unknown[] = [];
      for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
      if (failures.length !== 0) throw new AggregateError(failures, "Managed Payload cleanup failed");
    }
  }, 180_000);
});

function originalCmsFailure(failure: CmsTransactionError): CmsTransactionError {
  let current = failure;
  for (let depth = 0; depth < 4; depth++) {
    if (current.reason !== "rollbackOnly") return current;
    const underlying = Cause.isCause(current.cause) ? Result.getOrThrow(Cause.findError(current.cause)) : current.cause;
    if (!(underlying instanceof CmsTransactionError)) return current;
    current = underlying;
  }
  throw new Error("Unexpected nested CMS failure");
}

import { makeCmsCommandBinding, makeCmsReadBinding } from "../../persistence-postgres/src/frameworks/cmsTransaction/construction";
import { inspectPayloadHostForTest } from "@flarex/payload-adapter/internal/testing";
import { Cause, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { isJsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity, decodeAppDocumentIdentityV1Result,
  decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadManagedReadAccessRuntime } from "@flarex/payload-adapter/internal/testing";
import { CmsTransactionError } from "../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
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
        const identityAndAccessPolicy = { profile: "payload.scalar", access: "closed-headless-local-api" };
        const writer = yield* runtime.bind(yield* makeCmsCommandBinding({
          serving: yield* fixture.application.makeServing(fixture.session), hostRuntime: fixture.hostInput.hostRuntime,
          identityAndAccessPolicy, profile: { kind: "source", schemaVersionId: fixture.schemaVersionId, source: compiled.sourceContract },
        }));
        const readServing = yield* fixture.application.makeReadServing(fixture.session);
        const readBinding = yield* makeCmsReadBinding({ serving: readServing, hostRuntime: fixture.hostInput.hostRuntime,
          identityAndAccessPolicy, schemaVersionId: fixture.schemaVersionId, source });
        const reader = yield* runtime.bindRead(readBinding);
        const created = yield* writer.create(writer.newRequestKey(), { collection: "news", data: { title: "Managed Local API" } });
        if (!isJsonObject(created) || typeof created.id !== "string") throw new Error("Missing native Payload id");
        const findByID = { collection: "news", id: created.id };
        const find = { collection: "news", where: { title: { equals: "Managed Local API" } }, limit: 5 };
        expect(yield* reader.findByID(findByID))
          .toEqual(yield* writer.findByID(findByID));
        expect(yield* reader.find(find)).toEqual(yield* writer.find(find));
        expect(yield* reader.count({ collection: "news", where: {} }))
          .toEqual(yield* writer.count({ collection: "news", where: {} }));
        const hidden = yield* writer.create(writer.newRequestKey(), { collection: "news", data: { title: "Hidden by native access" } });
        if (!isJsonObject(hidden) || typeof hidden.id !== "string") throw new Error("Missing hidden Payload id");
        accessRuntime.selectVisibility("selected");
        const visibleQuery = { collection: "news", where: {}, limit: 5 };
        // The scalar adapter admits one normalized predicate map. Payload's
        // compound access filter remains an explicit unsupported capability.
        for (const host of [reader, writer]) {
          expect(originalCmsFailure(yield* Effect.flip(host.find(visibleQuery))))
            .toMatchObject({ reason: "unsupportedProfile", cause: { capability: "where operator" } });
        }
        accessRuntime.selectVisibility("denied");
        const denied = originalCmsFailure(yield* Effect.flip(reader.find(visibleQuery)));
        expect(denied).toMatchObject({ reason: "invalidInput", cause: { status: 403 } });
        expect(originalCmsFailure(yield* Effect.flip(writer.find(visibleQuery))))
          .toMatchObject({ reason: denied.reason, cause: { status: 403 } });
        expect(accessRuntime.observations.accessCalls()).toBeGreaterThan(0);
        accessRuntime.selectVisibility("all");
        expect(reader).not.toHaveProperty("run");
        expect(reader).not.toHaveProperty("newRequestKey");
        expect(yield* Effect.result(inspectPayloadHostForTest(reader).host.read(inspectPayloadHostForTest(reader).commands.create,
          { collection: "news", data: { title: "Forbidden" } })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
        // The existing logical source profile does not admit native preference
        // cleanup on delete. Preserve that refusal and the existing document.
        expect(originalCmsFailure(yield* Effect.flip(writer.delete(writer.newRequestKey(), findByID))))
          .toMatchObject({ reason: "unsupportedProfile" });
        expect(yield* reader.findByID(findByID)).toEqual(created);
        const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(created.id));
        const missingInput = { collection: "news", id: appDocumentIdV1FromRowIdentity({ tableId: identity.tableId,
          rowId: decodeAppRowIdHexV1("ffffffffffffffffffffffffffffffff") }) };
        const missing = originalCmsFailure(yield* Effect.flip(writer.findByID(missingInput)));
        const managedMissing = originalCmsFailure(yield* Effect.flip(reader.findByID(missingInput)));
        expect(missing).toMatchObject({ reason: "documentMissing", cause: { status: 404 } });
        expect(managedMissing).toMatchObject({ reason: "documentMissing", cause: { status: 404 } });
        expect(managedMissing.cause).toEqual(missing.cause);
        expect(yield* reader.count({ collection: "news", where: {} }))
          .toEqual(yield* writer.count({ collection: "news", where: {} }));
        yield* reader.close;
        expect(yield* Effect.result(reader.find(find)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
        const scopedReader = yield* runtime.bindRead(readBinding);
        return { read: scopedReader.find(find), bind: runtime.bindRead(readBinding) };
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

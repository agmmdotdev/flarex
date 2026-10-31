import { inspectPayloadHostForTest } from "@flarex/payload-adapter/internal/testing";
import { Cause, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { isJsonObject } from "flarex-protocol/json";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import { CmsTransactionError } from "../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { createCorePayloadFixture } from "./support/core-payload-fixture";

for (const driver of ["pglite", "postgres"] as const) describe.skipIf(driver === "postgres" &&
  (postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL))(`core-native managed Payload Local API reads (${driver})`, () => {
  it("preserves native document and query results while refusing writes on the read host", async () => {
    const fixture = await createCorePayloadFixture(driver);
    try {
      const escaped = await fixture.run(Effect.gen(function* () {
        const { writer, reader, runtime, accessRuntime } = fixture;
        if (accessRuntime === undefined) throw new Error("Missing native access fixture");
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
        const identity = yield* Effect.fromResult(decodeDocumentId(created.id));
        const missingInput = { collection: "news", id: yield* Effect.fromResult(encodeDocumentId(identity.tableNumber,
          new Uint8Array(16).fill(255))) };
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
        const scopedReader = yield* runtime.bindNativeRead(fixture.cmsBinding);
        return { read: scopedReader.find(find), bind: runtime.bindNativeRead(fixture.cmsBinding) };
      }));
      await fixture.closeOwner();
      await Effect.runPromise(Effect.gen(function* () {
        expect(yield* Effect.result(escaped.read))
          .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
        expect(yield* Effect.result(escaped.bind))
          .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
      }));
    } finally { await fixture.close(); }
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

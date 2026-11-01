import { Cause, Effect, Exit, Option, Result } from "effect";
import { expect } from "vitest";
import { bytesEqual } from "@flarex/utils/bytes";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import { makePayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { createCorePayloadFixture } from "../../../../payload-adapter/test/support/core-payload-fixture";
import type { CoreSqlConnection, CoreSqlDriver } from "../../../src/database/corePersistence/driver";
import { makeCmsRequestLifetime } from "../../../src/frameworks/cmsTransaction/lifetime";
import { makeNativeCmsDocuments } from "../../../src/frameworks/cmsTransaction/nativeDocuments";
import { preparePayloadConformanceSource } from "../../integration/payload/payloadNativeManyFixture";
import { coreNativeTestBudget } from "../../core/nativeTestBudget";

/** A real installed Core operation supplies authorization; no throwing stub
 * stands in for the missing-table path or its absence/body observations. */
export async function nativeCmsIdValidationScenario(driver: "pglite" | "postgres") {
  let recording = false, statements = 0;
  const record = (connection: CoreSqlConnection): CoreSqlConnection => ({ query: (sql, parameters) =>
    Effect.sync(() => { if (recording) statements++; }).pipe(Effect.andThen(connection.query(sql, parameters))) });
  const wrapRuntimeDriver = (original: CoreSqlDriver): CoreSqlDriver => ({ query: record(original).query,
    withConnection: work => original.withConnection(connection => work(record(connection))),
    transaction: work => original.transaction(connection => work(record(connection))),
  });
  const compiled = await preparePayloadConformanceSource("payload.content-many");
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, { compiled, wrapRuntimeDriver,
    makeRuntime: source => makePayloadConformanceRuntime(undefined, source).pipe(Effect.map(value => value.runtime)),
  });
  try {
    const created = await fixture.run(fixture.writer.create(fixture.writer.newRequestKey(), {
      collection: "posts", data: { title: "ID-only target", publishedAt: "2026-01-01" },
    }));
    const target = created.id;
    const parts = Result.getOrThrow(decodeDocumentId(target));
    const missingBytes = parts.internalId.slice(); missingBytes[0] = (missingBytes[0] ?? 0) ^ 0xff;
    const missing = Result.getOrThrow(encodeDocumentId(parts.tableNumber, missingBytes));
    const wrongTable = Result.getOrThrow(encodeDocumentId(parts.tableNumber === 0xffff_ffff ? 1 : parts.tableNumber + 1, parts.internalId));
    const before = await fixture.inventory();
    const metadata = await fixture.run(fixture.database.readNativeBinding(fixture.binding));
    const posts = metadata.tables.find(table => table.name === "posts");
    if (posts === undefined) throw new Error("Missing installed native posts table");
    await fixture.run(Effect.acquireUseRelease(fixture.database.beginNative(fixture.binding,
      { commandName: "payload-findByID", ...coreNativeTestBudget() }), operation => Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeCmsRequestLifetime({ hostId: Symbol() }, { requestId: Symbol() },
        "actual-core-id-validation", "read"), value => value.close);
      const documents = makeNativeCmsDocuments(operation.operations, lifetime);
      statements = 0; recording = true;
      // Raw native normalization keeps ordinary no-ID and wrong-ID absence for
      // an admitted table. The CMS batch authenticates the table even when empty.
      expect(yield* operation.operations.normalizeId("posts", undefined)).toEqual(Option.none());
      expect(yield* operation.operations.normalizeId("posts", wrongTable)).toEqual(Option.none());
      yield* documents.validateIds(lifetime.context, undefined, "posts", []);
      yield* documents.validateIds(lifetime.context, undefined, "posts", [target, missing]);
      const denied = yield* Effect.flip(documents.validateIds(lifetime.context, undefined, "missing_native_table", []));
      expect(denied).toMatchObject({ reason: "bindingChanged", cause: { _tag: "CoreTransactionError", reason: "missingTable" } });
      expect(yield* Effect.flip(documents.validateIds(lifetime.context, undefined, "posts", []))).toMatchObject({ reason: "rollbackOnly" });
      const sealed = yield* Effect.exit(lifetime.seal);
      if (Exit.isSuccess(sealed)) return yield* Effect.die(new Error("Caught missing-table refusal cleared CMS rollback-only state"));
      expect(sealed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason))
        .toEqual(expect.arrayContaining(["rollbackOnly", "bindingChanged"]));
      // This trusted diagnostic consumes the Core read after CMS has refused;
      // no user result or settlement can escape the failed CMS lifetime.
      const token = yield* operation.finishRead();
      expect(token.reads.some(read => posts.indexes.some(index => bytesEqual(read.indexId, index.ref.id)))).toBe(false);
      expect(statements).toBe(0);
    })).pipe(Effect.ensuring(Effect.sync(() => { recording = false; }))), operation => operation.abort()));
    expect(await fixture.inventory()).toEqual(before);
  } finally { recording = false; await fixture.close(); }
}

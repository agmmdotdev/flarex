import { Effect } from "effect";
import { expect } from "vitest";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { makePayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { payloadPostsCollectionDefinition } from "../../../../payload-adapter/src/testing/profiles";
import { createCorePayloadFixture } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { isJsonObject } from "flarex-protocol/json";
import { finishPayloadSuccessor } from "./payloadNativeRelationFixture";
import { preparePayloadConformanceSource } from "./payloadNativeManyFixture";

/** An emptied native owner is not a fresh many installation. */
export async function payloadManyUpgradeScenario(driver: "pglite" | "postgres") {
  const scalar = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition()]));
  const one = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition("payload.content-relations")]));
  const many = await preparePayloadConformanceSource("payload.content-many");
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, {
    compiled: scalar, preferences: true, futureSources: [{ compiled: one }, { compiled: many }],
    makeRuntime: source => makePayloadConformanceRuntime(undefined, source).pipe(Effect.map(value => value.runtime)),
  });
  try {
    const { run } = fixture;
    const row = await run(fixture.writer.create(fixture.writer.newRequestKey(),
      { collection: "posts", data: { title: "old-post", publishedAt: "2026-01-01" } }));
    if (!isJsonObject(row) || typeof row.id !== "string") throw new Error("Missing actual retained scalar post");
    await run(fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: row.id }));
    expect(await run(fixture.reader.count({ collection: "posts" }))).toMatchObject({ totalDocs: 0 });
    const before = await fixture.inventory();
    await expect(fixture.prepareSuccessor(many)).rejects.toMatchObject({ _tag: "CoreSchemaError", reason: "unsupportedCapability" });
    expect(await fixture.inventory()).toEqual(before);
    const successor = await fixture.prepareSuccessor(one);
    await finishPayloadSuccessor(fixture, successor);
    await fixture.rebind(successor);
    const after = await fixture.inventory();
    await expect(fixture.prepareSuccessor(many)).rejects.toMatchObject({ _tag: "CoreSchemaError", reason: "unsupportedCapability" });
    expect(await fixture.inventory()).toEqual(after);
    await fixture.reopen();
    expect(await run(fixture.reader.count({ collection: "posts" }))).toMatchObject({ totalDocs: 0 });
    expect(await fixture.inventory()).toEqual(after);
  } finally { await fixture.close(); }
}

import { expect } from "vitest";
import { Effect } from "effect";
import { makePayloadConformanceRuntime } from "../../payload-adapter/src/testing";
import { isJsonObject } from "flarex-protocol/json";
import { preparePayloadRelationSuccessor } from "./payloadRelationFixture";
import { type payloadRelationScenario } from "./payloadRelationScenario";
import { runEffect } from "./effectTestRuntime";

/** An emptied table still has its authenticated owner; it is never a fresh installation. */
export async function payloadManyUpgradeScenario(input: Parameters<typeof payloadRelationScenario>[0]) {
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const conformance = yield* makePayloadConformanceRuntime();
    const host = yield* conformance.runtime.bind(input.hostInput);
    const row = yield* host.run(host.newRequestKey(), conformance.runtime.commands.create, { data: { title: "old-post", publishedAt: "2026-01-01" } });
    if (!isJsonObject(row) || typeof row.id !== "string") throw new Error("Missing old post");
    yield* host.run(host.newRequestKey(), conformance.runtime.commands.delete, { id: row.id });
    expect(yield* host.read(conformance.runtime.commands.count, {})).toMatchObject({ totalDocs: 0 });
  })));
  const { fixture } = input;
  const before = await runEffect(fixture.relationActivation.readActive());
  await expect(preparePayloadRelationSuccessor(fixture, true, 71)).rejects.toMatchObject({ cause: { cause: { reason: "ownershipChanged" } } });
  expect((await runEffect(fixture.relationActivation.readActive())).expectedActiveHead).toEqual(before.expectedActiveHead);
  const one = await preparePayloadRelationSuccessor(fixture);
  await runEffect(fixture.relationActivation.activate({ revisionId: one.input.revisionId, expectedActiveHead: before.expectedActiveHead }));
  const after = await runEffect(fixture.relationActivation.readActive());
  await expect(preparePayloadRelationSuccessor(one, true, 72)).rejects.toMatchObject({ cause: { cause: { reason: "ownershipChanged" } } });
  expect((await runEffect(fixture.relationActivation.readActive())).expectedActiveHead).toEqual(after.expectedActiveHead);
}

import { makeCmsCommandBinding } from "../../../src/frameworks/cmsTransaction/construction";
import { expect } from "vitest";
import { Effect } from "effect";
import { makePayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { isJsonObject } from "flarex-protocol/json";
import { preparePayloadRelationSuccessor } from "./payloadRelationFixture";
import { type payloadRelationScenario } from "./payloadRelationScenario";
import { runEffect } from "../../support/effectTestRuntime";

/** An emptied table still has its authenticated owner; it is never a fresh installation. */
export async function payloadManyUpgradeScenario(input: Parameters<typeof payloadRelationScenario>[0]) {
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const conformance = yield* makePayloadConformanceRuntime();
    const host = yield* conformance.runtime.bind(yield* makeCmsCommandBinding({ serving: yield* input.fixture.makeServing(input.hostInput.session),
      hostRuntime: input.hostInput.hostRuntime, identityAndAccessPolicy: input.hostInput.identityAndAccessPolicy,
      profile: { kind: "fullProof", ...(input.hostInput.payloadPreferenceTarget === undefined ? {} : { payloadPreferenceTarget: input.hostInput.payloadPreferenceTarget }) } }));
    const row = yield* host.create(host.newRequestKey(), { collection: "posts", data: { title: "old-post", publishedAt: "2026-01-01" } });
    if (!isJsonObject(row) || typeof row.id !== "string") throw new Error("Missing old post");
    yield* host.delete(host.newRequestKey(), { collection: "posts", id: row.id });
    expect(yield* host.count({ collection: "posts",})).toMatchObject({ totalDocs: 0 });
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

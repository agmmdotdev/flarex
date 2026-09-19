import { expect } from "vitest";
import { createPointCommitPublisherPortV1 } from "../src/pointCommitTransaction";
import type { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { prepareNativeRangePublication } from "./nativeCommandPublicationScenario";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

type Fixture = Awaited<ReturnType<typeof cmsExecutionMeasurementFixture>>;

export async function verifyNativeAuditPublication(tested: Fixture, before: Awaited<ReturnType<Fixture["inventory"]>>) {
  const after = await tested.inventory();
  for (const family of ["rows", "revisions", "indexes", "indexRevisions", "facts", "commits", "outcomes", "wakes"] as const) {
    expect(after[family].length - before[family].length).toBe(1);
  }
  expect(after.claims).toEqual(before.claims);
  expect(after.builds).toEqual(before.builds);
  expect(after.uniqueBuilds).toEqual(before.uniqueBuilds);
  expect(after.clock[0]?.lastCommitSeq).toBe((before.clock[0]?.lastCommitSeq ?? -1n) + 1n);
  const added = after.rows.filter(row => !before.rows.some(prior => Buffer.from(prior.rowId).equals(Buffer.from(row.rowId))));
  expect(added).toHaveLength(1);
  expect(added[0]?.tableId).toBe(tested.fixture.relation.binding.tables.find(table => table.logicalName === "audit")?.tableId);
  return after;
}

export async function nativeCmsPublicationCorrectness(tested: Fixture) {
  const prepared = await runEffect(prepareNativeRangePublication(tested.fixture, "native-committed"));
  expect(prepared.command.rowIntents).toHaveLength(1);
  const publisher = createPointCommitPublisherPortV1(tested.fixture.pointCommitAuthority, prepared.options);
  const before = await tested.inventory();
  const published = await runEffect(publisher.publish(prepared.command));
  expect(published.kind).toBe("published");
  const after = await verifyNativeAuditPublication(tested, before);
  expect(await runEffect(publisher.publish(prepared.command))).toMatchObject({ kind: "replayed" });
  expect(await tested.inventory()).toEqual(after);

  const stale = await runEffect(prepareNativeRangePublication(tested.fixture, "native-must-rollback"));
  await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 1, prefix: "native-phantom" }));
  const beforeConflict = await tested.inventory();
  const failure = await runEffectFailure(createPointCommitPublisherPortV1(tested.fixture.pointCommitAuthority, stale.options).publish(stale.command));
  expect(failure).toMatchObject({ _tag: "PointCommitConflictV1Error", conflict: { kind: "appIndexRange", reason: "overlap" } });
  expect(await tested.inventory()).toEqual(beforeConflict);
}

import { expect } from "vitest";
import { Schema } from "effect";
import {
  appOrderedIndexDocumentPathV1,
  compileAppOrderedIndexBoundsV1,
  orderedIndexValueFromFlarexValueV1,
} from "flarex-protocol/ordered-index";
import { decodeSchemaManifestAppIndexFieldPath } from "flarex-protocol/schema-manifest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  createPointCommitPublisherPortV1,
} from "../../../src/commit/point/construction";
import type { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { createAppDeveloperIndexDefinitionPortV1 } from "../../../src/storage/indexes/appDeveloperIndexCommitV1";
import { prepareNativeRangePublication } from "../nativeCommandPublicationScenario";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

type Fixture = Awaited<ReturnType<typeof cmsExecutionMeasurementFixture>>;
const CreatedPost = Schema.Struct({ _id: Schema.String, title: Schema.String });
const decodeCreatedPost = Schema.decodeUnknownSync(CreatedPost);
const decodeCreatedPosts = Schema.decodeUnknownSync(Schema.Array(CreatedPost));

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
  await nativeCmsLookaheadPublicationCorrectness(tested);
  await nativeCmsLookaheadKeyMoveCorrectness(tested);
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

async function nativeCmsLookaheadPublicationCorrectness(tested: Fixture) {
  const deletingHost = await runEffect(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, tested.remove] }));
  const created = decodeCreatedPosts(await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, {
    titles: ["native-lookahead-a", "native-lookahead-b"],
  })));
  const first = created[0];
  const second = created[1];
  expect(created).toHaveLength(2);
  if (first === undefined || second === undefined) throw new Error("Expected two native lookahead posts");
  const stale = await runEffect(prepareNativeRangePublication(tested.fixture, "native-lookahead-must-rollback", 1));
  expect(stale.page).toMatchObject({ documents: [{ title: first.title }], isDone: false });
  expect(stale.readAccounting.readDocuments).toBe(1);
  expect(stale.command.dependencies.map(dependency => dependency.documentId)).toContain(first._id);
  expect(stale.command.dependencies.map(dependency => dependency.documentId)).not.toContain(second._id);

  await runEffect(deletingHost.run(deletingHost.newRequestKey(), tested.remove, second._id));
  const fresh = await runEffect(prepareNativeRangePublication(tested.fixture, undefined, 1));
  expect(fresh.page).toMatchObject({ documents: [{ title: first.title }], isDone: true });
  expect(fresh.readAccounting.readDocuments).toBe(1);
  expect(fresh.readAccounting.readSemanticBytes).toBe(stale.readAccounting.readSemanticBytes);

  const beforeConflict = await tested.inventory();
  const failure = await runEffectFailure(createPointCommitPublisherPortV1(tested.fixture.pointCommitAuthority, stale.options).publish(stale.command));
  expect(failure).toMatchObject({ _tag: "PointCommitConflictV1Error", conflict: { kind: "appIndexRange", reason: "overlap" } });
  // The stale page cannot publish its audit write, outcome or any durable facts.
  expect(await tested.inventory()).toEqual(beforeConflict);
  await runEffect(deletingHost.run(deletingHost.newRequestKey(), tested.remove, first._id));
}

async function nativeCmsLookaheadKeyMoveCorrectness(tested: Fixture) {
  const created = decodeCreatedPosts(await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, {
    titles: ["native-lookahead-move-a", "native-lookahead-move-b", "native-lookahead-move-c"],
  })));
  const first = created[0];
  const second = created[1];
  const third = created[2];
  expect(created).toHaveLength(3);
  if (first === undefined || second === undefined || third === undefined) throw new Error("Expected three native lookahead posts");
  const posts = tested.fixture.relation.binding.tables.find(table => table.logicalName === "posts");
  if (posts === undefined) throw new Error("Expected native posts binding");
  const definitions = await runEffect(createAppDeveloperIndexDefinitionPortV1(tested.fixture.control.drizzle).locate({
    deploymentId: TransactionGrantDeploymentIdV1Schema.make(tested.fixture.deploymentId),
    scopeId: decodeReplacementScopeIdV1(tested.fixture.authority.scopeId),
    schemaVersionId: tested.fixture.relation.binding.schemaVersionId,
    tableIds: [posts.tableId], maximumDefinitions: 32,
  }));
  expect(definitions).toHaveLength(1);
  const definition = definitions?.[0];
  if (definition?.access.kind !== "developer") throw new Error("Expected native posts developer index");
  const bounds = compileAppOrderedIndexBoundsV1({ spec: definition.physicalSpec, expressions: [{
    op: "lt", field: appOrderedIndexDocumentPathV1(decodeSchemaManifestAppIndexFieldPath("title")),
    value: orderedIndexValueFromFlarexValueV1(third.title),
  }] });
  const stale = await runEffect(prepareNativeRangePublication(tested.fixture, "native-lookahead-move-must-rollback", 1, bounds));
  expect(stale.page).toMatchObject({ documents: [{ title: first.title }], isDone: false });
  expect(stale.readAccounting.readDocuments).toBe(1);
  expect(stale.command.dependencies.map(dependency => dependency.documentId)).toContain(first._id);
  expect(stale.command.dependencies.map(dependency => dependency.documentId)).not.toContain(second._id);
  expect(stale.command.dependencies.map(dependency => dependency.documentId)).not.toContain(third._id);

  const replacement = decodeCreatedPost(await runEffect(tested.host.run(tested.host.newRequestKey(), tested.moveAndReuse, {
    firstId: third._id, secondId: second._id, firstTitle: third.title, temporaryTitle: "native-lookahead-move-d",
  })));
  const fresh = await runEffect(prepareNativeRangePublication(tested.fixture, undefined, 1, bounds));
  expect(fresh.page).toMatchObject({ documents: [{ title: first.title }], isDone: true });
  expect(fresh.readAccounting.readDocuments).toBe(1);
  expect(fresh.readAccounting.readSemanticBytes).toBe(stale.readAccounting.readSemanticBytes);
  const beforeConflict = await tested.inventory();
  const failure = await runEffectFailure(createPointCommitPublisherPortV1(tested.fixture.pointCommitAuthority, stale.options).publish(stale.command));
  expect(failure).toMatchObject({ _tag: "PointCommitConflictV1Error", conflict: { kind: "appIndexRange", reason: "overlap" } });
  expect(await tested.inventory()).toEqual(beforeConflict);

  const deletingHost = await runEffect(makeCmsHost({ ...tested.input, commands: [...tested.input.commands, tested.remove] }));
  for (const document of [first, second, replacement]) {
    await runEffect(deletingHost.run(deletingHost.newRequestKey(), tested.remove, document._id));
  }
}

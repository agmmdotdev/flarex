import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { canonicalStandaloneApplicationBinding, decodeStandaloneApplicationBinding } from "../src/applicationStandaloneBinding";
import { backfillStandaloneApplicationBindings } from "../src/applicationActivation";
import { fxSystemApplicationActiveHeads, fxSystemApplicationReadBindings } from "../src/applicationActivationSchema";
import { fxSystemApplicationReadiness } from "../src/applicationRelationSchema";
import { fxSystemPreparedMetadataEpoch } from "../src/schema";
import { relationReadinessFixture, prepareReadinessEvidence } from "./applicationRelationReadinessFixture";
import { runEffect } from "./effectTestRuntime";

it("publishes a parent-derived binding and backfills an existing activation without altering its durable head", async () => {
  const fixture = await relationReadinessFixture({ writePolicy: true });
  await prepareReadinessEvidence(fixture);
  await runEffect(fixture.fold.settle(fixture.input));
  await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
  const database = fixture.persistence.drizzle;
  const [stored] = await database.select().from(fxSystemApplicationReadBindings);
  if (stored === undefined) throw new Error("Missing activation read binding");
  const original = await runEffect(decodeStandaloneApplicationBinding(stored));
  expect(original.readiness.kind).toBe("policy");
  const [before] = await database.select().from(fxSystemPreparedMetadataEpoch);
  await database.update(fxSystemApplicationActiveHeads).set({ updatedAt: fxSystemApplicationActiveHeads.updatedAt })
    .where(sql`false`);
  const [after] = await database.select().from(fxSystemPreparedMetadataEpoch);
  expect(after?.generation).toBe((before?.generation ?? -2n) + 1n);
  await database.delete(fxSystemApplicationReadBindings).where(eq(fxSystemApplicationReadBindings.scopeId, stored.scopeId));
  await runEffect(backfillStandaloneApplicationBindings(database));
  const [backfilled] = await database.select().from(fxSystemApplicationReadBindings);
  expect(backfilled).toEqual(stored);
  await runEffect(backfillStandaloneApplicationBindings(database));
  expect(await database.select().from(fxSystemApplicationReadBindings)).toEqual([stored]);

  const publish = async (bytes: Uint8Array, digest: Uint8Array) => database.select({ published: sql<null>`
    fx_publish_application_read_binding(${bytes}::bytea, ${digest}::bytea)` })
    .from(sql`(values (1)) as publication_input(value)`);
  const noncanonical = new TextEncoder().encode(JSON.stringify(original, null, 2));
  await expect(publish(noncanonical, new Uint8Array(createHash("sha256").update(noncanonical).digest())))
    .rejects.toThrow();
  for (const change of [{ deploymentId: "other-deployment" }, { schemaVersionId: "other-schema" },
    { analysis: { ...original.analysis, candidateId: "other-candidate" } }, { readinessSha256: "0".repeat(64) }]) {
    const forged = await runEffect(canonicalStandaloneApplicationBinding({ ...original, ...change }));
    await expect(publish(forged.bytes, forged.sha256)).rejects.toThrow();
  }
  const [parent] = await database.select().from(fxSystemApplicationReadiness);
  if (parent === undefined) throw new Error("Missing readiness parent");
  await database.update(fxSystemApplicationReadiness).set({ epoch: sql`${fxSystemApplicationReadiness.epoch} || '_changed'` })
    .where(eq(fxSystemApplicationReadiness.scopeId, parent.scopeId));
  try {
    await expect(publish(stored.bindingBytes, stored.bindingSha256)).rejects.toThrow();
    await expect(runEffect(backfillStandaloneApplicationBindings(database))).rejects.toMatchObject({ reason: "resourceFailure" });
  } finally {
    await database.update(fxSystemApplicationReadiness).set({ epoch: parent.epoch })
      .where(eq(fxSystemApplicationReadiness.scopeId, parent.scopeId));
  }
  expect(await database.select().from(fxSystemApplicationReadBindings)).toEqual([stored]);
}, 180_000);

it("requires canonical detached bytes, exact row roots, strict nested shapes and bounded sequences", async () => {
  const frame = { format: "flarex.application.read-binding", deploymentId: "deployment", scopeId: "scope",
    storageGeneration: "flarexdb_v1", storageGenerationFence: "1", epoch: "epoch", activationSequence: "1",
    headSha256: "1".repeat(64), activationSha256: "2".repeat(64), revisionId: "revision", schemaVersionId: "schema",
    applicationSchemaSha256: "3".repeat(64), schemaManifestSha256: "4".repeat(64), readinessSha256: "5".repeat(64),
    readiness: { kind: "legacy", schemaBindingSha256: "6".repeat(64) },
    analysis: { candidateId: "candidate", analysisId: "analysis", manifestSha256: "7".repeat(64), sourceArtifactRootSha256: "8".repeat(64) } };
  const canonical = await runEffect(canonicalStandaloneApplicationBinding(frame));
  const row = { bindingBytes: canonical.bytes, bindingSha256: canonical.sha256, scopeId: "scope", activationSequence: 1n, readinessContractVersion: 1 as const,
    revisionId: "revision", activationSha256: new Uint8Array(Buffer.from(frame.activationSha256, "hex")),
    readinessSha256: new Uint8Array(Buffer.from(frame.readinessSha256, "hex")) };
  expect(await runEffect(decodeStandaloneApplicationBinding(row))).toEqual(frame);
  const noncanonical = new TextEncoder().encode(JSON.stringify(frame, null, 2));
  await expect(runEffect(decodeStandaloneApplicationBinding({ ...row, bindingBytes: noncanonical,
    bindingSha256: new Uint8Array(createHash("sha256").update(noncanonical).digest()) }))).rejects.toMatchObject({ reason: "storedState" });
  await expect(runEffect(decodeStandaloneApplicationBinding({ ...row, activationSequence: 2n }))).rejects.toMatchObject({ reason: "storedState" });
  await expect(runEffect(canonicalStandaloneApplicationBinding({ ...frame, activationSequence: "9223372036854775808" })))
    .rejects.toMatchObject({ reason: "storedState" });
  await expect(runEffect(canonicalStandaloneApplicationBinding({ ...frame, analysis: { ...frame.analysis, extra: true } })))
    .rejects.toMatchObject({ reason: "storedState" });
});

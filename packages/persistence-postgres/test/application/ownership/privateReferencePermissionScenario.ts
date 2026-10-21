import { Effect, Option } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { inspectPrivateReferencePermissionEvidence } from "../../../src/execution/journal/privatePermissionEvidence";
import type { privatePermissionFixture } from "./privatePermissionFixture";

const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);
type Fixture = Awaited<ReturnType<typeof privatePermissionFixture>>;
type Root = Awaited<ReturnType<Fixture["open"]>>;

/** Real command/point/dependency/publication owners perform every decision. */
export async function privateReferencePermissionScenario(fixture: Fixture) {
  const writer = await fixture.open();
  const permissions = { format: "flarex.private-reference-permissions", version: 1, principal: writer.principal,
    collection: "articles", relation: "featuredProduct", source: { create: true, update: true, delete: false },
    assign: ["product-one"], retain: ["product-one"] };
  const command = await Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(writer.attempt, "audit"));
  const inserted = await Effect.runPromise(command.run({ kind: "insert", syscallSequence: sequence(1n),
    fields: { policy: permissions } }, writer.validator));
  if (inserted.kind !== "completed" || inserted.outcome.kind !== "inserted") throw new Error("Missing permission point");
  const documentId = inserted.outcome.documentId;
  expect(await writer.publish()).toMatchObject({ kind: "published" });
  expect(await Effect.runPromise(command.run({ kind: "delete", documentId, syscallSequence: sequence(2n) }, writer.validator)))
    .toMatchObject({ kind: "stateRejected" });

  const read = (root: Root, syscallSequence = sequence(1n)) => fixture.store.readPrivateReferencePermissionsEffect(root.attempt, {
    tableName: "audit", documentId, syscallSequence, principal: root.principal,
  }, root.validator);
  const reader = await fixture.open();
  const captured = await Effect.runPromise(read(reader));
  if (Option.isNone(captured)) throw new Error("Missing permission evidence");
  const evidence = captured.value;
  expect(inspectPrivateReferencePermissionEvidence(evidence, reader.attempt, reader.principal)?.permissions).toEqual(permissions);
  expect(inspectPrivateReferencePermissionEvidence({ ...evidence }, reader.attempt, reader.principal)).toBeUndefined();
  expect(inspectPrivateReferencePermissionEvidence(evidence, { ...reader.attempt }, reader.principal)).toBeUndefined();
  expect(inspectPrivateReferencePermissionEvidence(evidence, reader.attempt, { ...reader.principal,
    principalDigest: "f".repeat(64) })).toBeUndefined();
  const replayed = await Effect.runPromise(read(reader));
  if (Option.isNone(replayed)) throw new Error("Receipt replay lost permission evidence");
  expect(inspectPrivateReferencePermissionEvidence(replayed.value, reader.attempt, reader.principal)?.permissions).toEqual(permissions);
  await expect(Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(reader.attempt, "audit")))
    .rejects.toMatchObject({ _tag: "InvalidSessionJournalCapabilityV1Error" });
  expect(await reader.publish()).toMatchObject({ kind: "published" });
  expect(inspectPrivateReferencePermissionEvidence(evidence, reader.attempt, reader.principal)).toBeUndefined();

  // Ordinary writes, including empty/no-op writes and receipt reuse, cannot borrow command authority.
  for (const operation of [
    { kind: "insert", fields: { policy: permissions } },
    { kind: "patch", documentId, patch: {} },
    { kind: "replace", documentId, fields: { policy: permissions } },
    { kind: "delete", documentId },
  ] as const) {
    const root = await fixture.open();
    const table = await Effect.runPromise(fixture.store.resolvePointTableEffect(root.attempt, "audit"));
    await expect(Effect.runPromise(fixture.store.runPointOperationEffect(table,
      { ...operation, syscallSequence: sequence(1n) }, root.validator)))
      .rejects.toMatchObject({ _tag: "ApplicationTableWriteDeniedError", operation: operation.kind });
    await expect(root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
  }
  const ordinary = await fixture.open();
  const users = await Effect.runPromise(fixture.store.resolvePointTableEffect(ordinary.attempt, "users"));
  expect(await Effect.runPromise(fixture.store.runPointOperationEffect(users, { kind: "insert", fields: { name: "ordinary" },
    syscallSequence: sequence(1n) }, ordinary.validator))).toMatchObject({ kind: "completed", outcome: { kind: "inserted" } });
  expect(await ordinary.publish()).toMatchObject({ kind: "published" });
  const concurrent = await fixture.open();
  const reading = Effect.runPromise(read(concurrent));
  const minting = Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(concurrent.attempt, "audit"));
  const mintingCheck = expect(minting).rejects.toMatchObject({ _tag: "InvalidSessionJournalCapabilityV1Error" });
  expect(Option.isSome(await reading)).toBe(true);
  await mintingCheck;
  expect(await concurrent.publish()).toMatchObject({ kind: "published" });
  const wrongTable = await fixture.open();
  await expect(Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(wrongTable.attempt, "users")))
    .rejects.toMatchObject({ _tag: "InvalidSessionJournalCapabilityV1Error" });
  await Effect.runPromise(fixture.store.discardFiniteRootEffect(wrongTable.attempt));

  for (const principal of [
    { ...reader.principal, principalDigest: "f".repeat(64) },
    { ...reader.principal, scopeId: ScopeIdSchema.make("foreign-permission-scope") },
  ]) {
    const root = await fixture.open();
    await expect(Effect.runPromise(fixture.store.readPrivateReferencePermissionsEffect(root.attempt, {
      tableName: "audit", documentId, syscallSequence: sequence(1n), principal,
    }, root.validator))).rejects.toMatchObject({ _tag: "PrivatePermissionEvidenceError", reason: "invalidAuthority" });
    await expect(root.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
  }

  const stale = await fixture.open();
  const staleEvidence = await Effect.runPromise(read(stale));
  expect(Option.isSome(staleEvidence)).toBe(true);
  const revoker = await fixture.open();
  const revoke = await Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(revoker.attempt, "audit"));
  const revoked = { ...permissions, source: { create: false, update: false, delete: false }, assign: [], retain: [] };
  expect(await Effect.runPromise(revoke.run({ kind: "patch", documentId, patch: { policy: revoked },
    syscallSequence: sequence(1n) }, revoker.validator))).toMatchObject({ kind: "completed" });
  expect(await revoker.publish()).toMatchObject({ kind: "published" });
  const staleUsers = await Effect.runPromise(fixture.store.resolvePointTableEffect(stale.attempt, "users"));
  await Effect.runPromise(fixture.store.runPointOperationEffect(staleUsers, { kind: "insert", fields: { name: "must roll back" },
    syscallSequence: sequence(2n) }, stale.validator));
  await expect(stale.publish()).rejects.toMatchObject({ _tag: "PointCommitConflictV1Error" });
  const fresh = await fixture.open();
  const freshEvidence = await Effect.runPromise(read(fresh));
  if (Option.isNone(freshEvidence)) throw new Error("Revocation lost policy point");
  expect(inspectPrivateReferencePermissionEvidence(freshEvidence.value, fresh.attempt, fresh.principal)?.permissions).toEqual(revoked);
  expect(await fresh.publish()).toMatchObject({ kind: "published" });
  const lifetimeReader = await fixture.open();
  const lifetimeEvidence = await Effect.runPromise(read(lifetimeReader));
  if (Option.isNone(lifetimeEvidence)) throw new Error("Missing lifetime permission evidence");

  // A privileged writer cannot supply permission evidence or hand its receipt to ordinary writes.
  const privileged = await fixture.open();
  const privilegedCommand = await Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(privileged.attempt, "audit"));
  await Effect.runPromise(privilegedCommand.run({ kind: "patch", documentId, patch: {}, syscallSequence: sequence(1n) }, privileged.validator));
  const privilegedTable = await Effect.runPromise(fixture.store.resolvePointTableEffect(privileged.attempt, "audit"));
  await expect(Effect.runPromise(fixture.store.runPointOperationEffect(privilegedTable, { kind: "patch", documentId, patch: {},
    syscallSequence: sequence(1n) }, privileged.validator))).rejects.toMatchObject({ _tag: "ApplicationTableWriteDeniedError" });
  await expect(privileged.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
  const privilegedReader = await fixture.open();
  await Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(privilegedReader.attempt, "audit"));
  await expect(Effect.runPromise(read(privilegedReader))).rejects.toMatchObject({ _tag: "PrivatePermissionEvidenceError", reason: "invalidAuthority" });
  await expect(privilegedReader.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });

  const corruptor = await fixture.open();
  const corrupt = await Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(corruptor.attempt, "audit"));
  await Effect.runPromise(corrupt.run({ kind: "replace", documentId, fields: { policy: "malformed" }, syscallSequence: sequence(1n) }, corruptor.validator));
  expect(await corruptor.publish()).toMatchObject({ kind: "published" });
  const corruptReader = await fixture.open();
  await expect(Effect.runPromise(read(corruptReader))).rejects.toMatchObject({ _tag: "PrivatePermissionEvidenceError", reason: "storedCorruption" });
  await expect(corruptReader.publish()).rejects.toMatchObject({ _tag: "SessionJournalSealV1Error" });
  const remover = await fixture.open();
  const remove = await Effect.runPromise(fixture.store.preparePrivateApplicationCommandEffect(remover.attempt, "audit"));
  await Effect.runPromise(remove.run({ kind: "delete", documentId, syscallSequence: sequence(1n) }, remover.validator));
  expect(await remover.publish()).toMatchObject({ kind: "published" });
  const missing = await fixture.open();
  expect(await Effect.runPromise(read(missing))).toEqual(Option.none());
  expect(await missing.publish()).toMatchObject({ kind: "published" });
  const unchanged = await fixture.open();
  const unchangedTable = await Effect.runPromise(fixture.store.resolvePointTableEffect(unchanged.attempt, "audit"));
  await expect(Effect.runPromise(fixture.store.runPointOperationEffect(unchangedTable, { kind: "delete", documentId,
    syscallSequence: sequence(1n) }, unchanged.validator))).rejects.toMatchObject({ _tag: "ApplicationTableWriteDeniedError" });
  expect(inspectPrivateReferencePermissionEvidence(lifetimeEvidence.value, lifetimeReader.attempt, lifetimeReader.principal)).toBeDefined();
  await fixture.closePreparation();
  expect(inspectPrivateReferencePermissionEvidence(lifetimeEvidence.value, lifetimeReader.attempt, lifetimeReader.principal)).toBeUndefined();
}

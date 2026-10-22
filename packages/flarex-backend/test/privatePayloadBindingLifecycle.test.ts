import { Effect, Result, Schema } from "effect";
import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate } from "../../analysis/src/logicalSchemaCandidate";
import type { LogicalSchemaCandidate } from "flarex-protocol/internal/logical-schema-candidate";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { dataBindingActivationRequest } from "../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { fxSystemDataBindingCandidates, fxSystemDataBindingHeads, fxSystemDataBindingActivations } from
  "../../persistence-postgres/src/installation/frameworkSchema/binding/schema";
import { fxControlSchemaVersions, fxControlTables, fxSystemScopeClocks, fxSystemScopeExecutionAuthorities, fxSystemMetadataContractObservations,
  fxSystemIndexBuildStates,
  fxSystemIndexMaintenanceObligations, fxSystemUniqueMaintenanceObligations, fxAppRowCurrent, fxAppRowRevisions } from
  "../../persistence-postgres/src/database/schema";
import { prepareIndexBuildReadinessWitness } from "../../persistence-postgres/test/storage/documents/logicalReadIndexReadinessTestSupport";
import { privatePayloadSaveFixture, type PrivatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { bindPrivatePayloadSave, preparePrivateSavePolicy } from "./support/privatePayloadSaveCommands";
import { publishedScopeCounts } from "./support/payloadCommerceReferenceFixture";

const productId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));

async function snapshot(fixture: PrivatePayloadSaveFixture) {
  const db = fixture.fixture.application.persistence.drizzle;
  const control = fixture.fixture.control.drizzle;
  const deploymentId = fixture.fixture.application.deploymentId;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const { scopeUuid } = projectScopeIdUuidV1(scopeId);
  return {
    catalogs: await control.select({ schemaVersionId: fxControlSchemaVersions.schemaVersionId,
      manifestSha256: fxControlSchemaVersions.manifestSha256 }).from(fxControlSchemaVersions)
      .where(eq(fxControlSchemaVersions.deploymentId, deploymentId)).orderBy(fxControlSchemaVersions.schemaVersionId),
    tableIdentities: await control.select().from(fxControlTables).where(eq(fxControlTables.deploymentId, deploymentId))
      .orderBy(fxControlTables.tableId),
    application: await Effect.runPromise(fixture.fixture.application.relationActivation.readActive()),
    heads: await db.select().from(fxSystemDataBindingHeads).where(eq(fxSystemDataBindingHeads.scopeId, scopeId)),
    activations: await db.select().from(fxSystemDataBindingActivations).where(eq(fxSystemDataBindingActivations.scopeId, scopeId))
      .orderBy(fxSystemDataBindingActivations.sequence),
    clock: await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)),
    authority: await db.select().from(fxSystemScopeExecutionAuthorities).where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId)),
    metadata: await db.select().from(fxSystemMetadataContractObservations).where(eq(fxSystemMetadataContractObservations.scopeId, scopeId))
      .orderBy(fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey,
        fxSystemMetadataContractObservations.contractKey),
    indexes: await db.select().from(fxSystemIndexMaintenanceObligations).where(eq(fxSystemIndexMaintenanceObligations.scopeId, scopeId))
      .orderBy(fxSystemIndexMaintenanceObligations.indexDefinitionId, fxSystemIndexMaintenanceObligations.authorityKind,
        fxSystemIndexMaintenanceObligations.activationSequence),
    indexBuilds: await db.select().from(fxSystemIndexBuildStates).where(eq(fxSystemIndexBuildStates.scopeId, scopeId))
      .orderBy(fxSystemIndexBuildStates.indexDefinitionId),
    uniques: await db.select().from(fxSystemUniqueMaintenanceObligations).where(eq(fxSystemUniqueMaintenanceObligations.scopeId, scopeId))
      .orderBy(fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId, fxSystemUniqueMaintenanceObligations.authorityKind,
        fxSystemUniqueMaintenanceObligations.activationSequence),
    rows: await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid))
      .orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
    revisions: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))
      .orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    published: await publishedScopeCounts(db, scopeId),
  };
}

async function candidateRefusals(fixture: PrivatePayloadSaveFixture) {
  const extension = fixture.authored.extensions[0];
  const application = fixture.authored.sources.find(source => source.owner === "application");
  const payload = fixture.authored.sources.find(source => source.key === "payload");
  if (extension === undefined || application === undefined || payload === undefined) throw new Error("Missing genuine sources");
  const before = await snapshot(fixture);
  const invalidExtensions: LogicalSchemaCandidate["extensions"] = [
    { ...extension, target: { ...extension.target, table: { namespace: "medusa", logicalName: "absent-product" } } },
    { ...extension, target: { ...extension.target, field: "created_at" } },
    { ...extension, sourceKey: application.key },
    { ...extension, liveness: { ...extension.liveness, target: { kind: "current" as const } } },
  ];
  for (const invalid of invalidExtensions) {
    expect(await Effect.runPromise(prepareLogicalSchemaCandidate({ ...fixture.authored, extensions: [invalid] }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "LogicalSchemaCandidateError", reason: "invalidInput" } });
    expect(await snapshot(fixture)).toEqual(before);
  }
  const { sourceSha256: _applicationDigest, ...applicationInput } = application;
  const { sourceSha256: _payloadDigest, ...payloadInput } = payload;
  const changedEvidence = await Effect.runPromise(captureLogicalSchemaSource({ ...applicationInput, evidence: {} }));
  const changedOwner = await Effect.runPromise(captureLogicalSchemaSource({ ...payloadInput, owner: "application" }));
  const changedProfile = await Effect.runPromise(captureLogicalSchemaSource({ ...payloadInput, writeProfile: "payload.unadmitted" }));
  const deniedCandidates = [
    { ...fixture.authored, scopeId: "scope_00000002-0000-4000-8000-000000000002" },
    { ...fixture.authored, sources: fixture.authored.sources.filter(source => source !== application) },
    ...[changedEvidence, changedOwner, changedProfile].map(changed => ({ ...fixture.authored,
      sources: fixture.authored.sources.map(source => source.key === changed.key ? changed : source) })),
  ];
  for (const [index, input] of deniedCandidates.entries()) {
    const candidate = await Effect.runPromise(prepareLogicalSchemaCandidate(input));
    expect(await Effect.runPromise(fixture.admit(candidate, { schemaVersionId: decodeCatalogSchemaVersionId(`lifecycle-denied-${index}`),
      version: decodeCatalogSchemaVersion(110 + index) }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "LogicalSchemaAdmissionError", reason: index === 0 ? "wrongTarget" : "ownershipChanged" } });
    expect(await snapshot(fixture)).toEqual(before);
  }
}

async function referenceTransitionRefusals(fixture: PrivatePayloadSaveFixture) {
  const extension = fixture.authored.extensions[0];
  if (extension === undefined) throw new Error("Missing original strong reference");
  const { onTargetSoftDelete: _retention, ...withoutRetention } = extension;
  const transitions: readonly Readonly<{ name: string; extensions: LogicalSchemaCandidate["extensions"] }>[] = [
    { name: "without-reference", extensions: [] },
    { name: "renamed-reference", extensions: [{ ...extension, name: "renamed_post_product" }] },
    { name: "changed-retention", extensions: [withoutRetention] },
    { name: "new-populated-reference", extensions: [extension,
      { ...extension, name: "post_title_product", source: { ...extension.source, field: "title" } }] },
  ];
  const db = fixture.fixture.application.persistence.drizzle;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const candidates = () => db.select().from(fxSystemDataBindingCandidates).where(eq(fxSystemDataBindingCandidates.scopeId, scopeId));
  for (const [index, transition] of transitions.entries()) {
    // Preserve all three genuine source contracts byte-for-byte. Candidate,
    // build and binding owners must classify only this reference transition.
    const candidate = await Effect.runPromise(prepareLogicalSchemaCandidate({ ...fixture.authored, extensions: transition.extensions }));
    const schemaVersionId = decodeCatalogSchemaVersionId(`private-save-${transition.name}`);
    await Effect.runPromise(fixture.admit(candidate, { schemaVersionId, version: decodeCatalogSchemaVersion(120 + index) }));
    const next = await fixture.prepareSchemaBinding(schemaVersionId);
    await next.build();
    const before = await snapshot(fixture);
    const storedBefore = await candidates();
    const prepared = await Effect.runPromise(next.binding.prepare(next.frame));
    // Preparation may retain an inactive immutable candidate, never an activation.
    expect(await candidates()).toHaveLength(storedBefore.length + 1);
    expect(await snapshot(fixture)).toEqual(before);
    const current = await Effect.runPromise(fixture.schemaBinding.binding.withCurrent(readAdmittedDataBinding));
    const result = await Effect.runPromise(next.binding.activate(dataBindingActivationRequest(scopeId,
      next.frame.application.storageGeneration, `refuse-${transition.name}`, prepared.sha256, current.head)).pipe(Effect.result));
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "DataBindingError", reason: "unsupportedProfile" } });
    expect(await snapshot(fixture)).toEqual(before);
  }
}

async function rebindAndWithdrawal(fixture: PrivatePayloadSaveFixture) {
  const { binding, frame } = fixture.schemaBinding;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const db = fixture.fixture.application.persistence.drizzle;
  const current = await Effect.runPromise(binding.withCurrent(readAdmittedDataBinding));
  const original = await Effect.runPromise(binding.prepare(frame));
  const before = await snapshot(fixture);
  if (frame.logicalSchema === null || frame.payloadLifecycle === null) throw new Error("Missing genuine binding dependencies");
  const candidatesBefore = await db.select().from(fxSystemDataBindingCandidates).where(eq(fxSystemDataBindingCandidates.scopeId, scopeId))
    .orderBy(fxSystemDataBindingCandidates.sha256);
  for (const invalid of [
    { frame: { ...frame, logicalSchema: null }, reason: "logicalSchemaMismatch" },
    { frame: { ...frame, logicalSchema: { ...frame.logicalSchema, manifestSha256: "f".repeat(64) } }, reason: "logicalSchemaMismatch" },
    { frame: { ...frame, payloadLifecycle: { ...frame.payloadLifecycle, installationReceiptSha256: "f".repeat(64) } }, reason: "unavailableInstallation" },
    { frame: { ...frame, payloadLifecycle: { ...frame.payloadLifecycle,
      profiles: frame.payloadLifecycle.profiles.map(profile => ({ ...profile, contractSha256: "f".repeat(64) })) } }, reason: "unsupportedProfile" },
  ]) {
    expect(await Effect.runPromise(binding.prepare(invalid.frame).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "DataBindingError", reason: invalid.reason } });
    expect(await snapshot(fixture)).toEqual(before);
    expect(await db.select().from(fxSystemDataBindingCandidates).where(eq(fxSystemDataBindingCandidates.scopeId, scopeId))
      .orderBy(fxSystemDataBindingCandidates.sha256)).toEqual(candidatesBefore);
  }
  expect(await Effect.runPromise(binding.activate(dataBindingActivationRequest(scopeId, frame.application.storageGeneration,
    "missing-binding-candidate", "f".repeat(64), current.head)).pipe(Effect.result)))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "DataBindingError", reason: "missingDependency" } });
  expect(await snapshot(fixture)).toEqual(before);
  const rebound = await Effect.runPromise(binding.activate(dataBindingActivationRequest(scopeId,
    frame.application.storageGeneration, "unchanged-reference-rebind", original.sha256, current.head)));
  expect(Result.getOrThrow(rebound.current).selected).toBe(true);
  expect(BigInt(rebound.receipt.frame.sequence)).toBe(BigInt(current.head.sequence) + 1n);
  expect(rebound.receipt.frame.strongReferences.map(reference => reference.name)).toEqual(["post_product"]);
  const reboundState = await snapshot(fixture);
  expect(reboundState.rows).toEqual(before.rows);
  expect(reboundState.revisions).toEqual(before.revisions);
  expect(reboundState.published).toEqual(before.published);
  expect(reboundState.authority).toEqual(before.authority);

  // Negative readiness injection uses the actual reverse-index build row.
  // It is not an admitted withdrawal or a substitute for the transition below.
  const reference = rebound.receipt.frame.strongReferences[0];
  if (reference === undefined) throw new Error("Missing active reverse dependency");
  const readiness = await prepareIndexBuildReadinessWitness(db, scopeId, reference.reverseIndex.indexDefinitionId);
  await readiness.retire();
  try {
    const unavailable = await snapshot(fixture);
    expect(await Effect.runPromise(binding.prepare(frame).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
    expect(await Effect.runPromise(binding.activate(dataBindingActivationRequest(scopeId, frame.application.storageGeneration,
      "unready-reference-rebind", original.sha256, Result.getOrThrow(rebound.current).head)).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
    expect(await snapshot(fixture)).toEqual(unavailable);
  } finally { await readiness.restore(); }
  expect(await snapshot(fixture)).toEqual(reboundState);

  const withdrawn = await Effect.runPromise(binding.prepare({ ...frame, payloadLifecycle: null }));
  expect(await snapshot(fixture)).toEqual(reboundState);
  const withdrawal = await Effect.runPromise(binding.activate(dataBindingActivationRequest(scopeId, frame.application.storageGeneration,
    "withdraw-private-payload-preferences", withdrawn.sha256, Result.getOrThrow(rebound.current).head)));
  expect(Result.getOrThrow(withdrawal.current).selected).toBe(true);
  expect(withdrawal.receipt.frame.strongReferences).toEqual(rebound.receipt.frame.strongReferences);
  const after = await snapshot(fixture);
  expect(after.rows).toEqual(before.rows);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.published).toEqual(before.published);
  const oldAuthority = reboundState.authority[0], newAuthority = after.authority[0];
  if (oldAuthority === undefined || newAuthority === undefined) throw new Error("Missing actual scope authority");
  expect(newAuthority.authorizationRevocationEpoch).toBe(oldAuthority.authorizationRevocationEpoch + 1n);
}

async function bindingLifecycle(fixture: PrivatePayloadSaveFixture) {
  const product = productId(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: "Retained reference", handle: "binding-lifecycle-product" })));
  const policy = await preparePrivateSavePolicy(fixture, {
    source: { create: true, update: true, delete: true }, assign: [product.id], retain: [product.id],
  });
  expect(await policy.root.publish()).toMatchObject({ kind: "published" });
  const root = await fixture.open();
  const saving = await bindPrivatePayloadSave(fixture, root, policy.documentId);
  try {
    expect(await Effect.runPromise(saving.invoke("create", { collection: "posts",
      data: { title: "Still protected", featuredProduct: product.id } })))
      .toMatchObject({ kind: "completed", result: { featuredProduct: product.id } });
    expect(await root.publish(null, [root.payloadProfile(saving.selected.profileRevision)])).toMatchObject({ kind: "published" });
  } finally { await saving.close(); }

  await candidateRefusals(fixture);
  await referenceTransitionRefusals(fixture);
  await rebindAndWithdrawal(fixture);
}

it("preserves protected Payload/Product binding lifecycle admission and refusal (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle,
    transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control });
  try { await bindingLifecycle(fixture); } finally { await fixture.close(); }
}, 480_000);

describe.skipIf(postgresUrl === null)("private binding lifecycle with an ordinary-role PostgreSQL target", () => {
  it("preserves active contracts, supports unchanged rebinding and withdraws the preference profile", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence,
        session: makePostgresRelationalSession(database.persistence) });
      try { await bindingLifecycle(fixture); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 480_000);
});

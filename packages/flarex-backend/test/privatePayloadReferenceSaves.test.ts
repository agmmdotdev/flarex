import { createHash } from "node:crypto";
import { Effect, Exit, Option, Result, Scope } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate } from "../../analysis/src/logicalSchemaCandidate";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId, SchemaManifestAppTableNameSchema } from "flarex-protocol/schema-manifest";
import { prepareFiniteActiveApplication } from "../../persistence-postgres/src/application/activation/repositoryIdentity";
import { retainPreparedHost } from "../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { privatePayloadReferenceSaveScenario } from "./support/privatePayloadReferenceSaveScenario";

const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);
async function witness(fixture: Awaited<ReturnType<typeof privatePayloadSaveFixture>>) {
  const native = fixture.authored.sources.find(source => source.owner === "application");
  const payload = fixture.authored.sources.find(source => source.key === "payload");
  if (native === undefined || payload === undefined || native.definition.kind !== "documents") throw new Error("Missing native source definitions");
  const { sourceSha256: _nativeDigest, ...nativeInput } = native;
  const { sourceSha256: _payloadDigest, ...payloadInput } = payload;
  const changedEvidence = await Effect.runPromise(captureLogicalSchemaSource({ ...nativeInput, evidence: {} }));
  const reclassifiedPayload = await Effect.runPromise(captureLogicalSchemaSource({ ...payloadInput, owner: "application" }));
  const renamed = await Effect.runPromise(captureLogicalSchemaSource({ ...nativeInput,
    definition: { ...native.definition, tables: native.definition.tables.map(table => table.logicalName === "audit" ? { ...table, logicalName: SchemaManifestAppTableNameSchema.make("renamed_audit") } : table) },
    bindings: native.bindings.map(binding => binding.localName === "audit" ? { ...binding, localName: "renamed_audit", table: { ...binding.table, logicalName: "renamed_audit" } } : binding),
  }));
  for (const [index, sources] of [fixture.authored.sources.filter(source => source !== native),
    fixture.authored.sources.map(source => source === native ? changedEvidence : source),
    fixture.authored.sources.map(source => source === payload ? reclassifiedPayload : source),
    fixture.authored.sources.map(source => source === native ? renamed : source)].entries()) {
    const candidate = await Effect.runPromise(prepareLogicalSchemaCandidate({ ...fixture.authored, sources }));
    expect(await Effect.runPromise(fixture.admit(candidate, { schemaVersionId: decodeCatalogSchemaVersionId(`denied-ownership-${index}`),
      version: decodeCatalogSchemaVersion(101 + index) }).pipe(Effect.result))).toMatchObject({
      _tag: "Failure", failure: { _tag: "LogicalSchemaAdmissionError", reason: "ownershipChanged" },
    });
  }
  const active = await Effect.runPromise(fixture.fixture.application.relationActivation.readActive());
  expect(await Effect.runPromise(retainPreparedHost(preparedHostTestRuntime(fixture.fixture.application.persistence.drizzle),
    prepareFiniteActiveApplication(fixture.fixture.application.relationActivation, active.selection)).pipe(
      Effect.flatMap(host => host.close), Effect.result))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidComposition" } });
  const policyWriter = await fixture.fixture.open();
  const command = await Effect.runPromise(fixture.fixture.store.preparePrivateApplicationCommandEffect(policyWriter.attempt, "audit"));
  const inserted = await Effect.runPromise(command.run({ kind: "insert", syscallSequence: sequence(1n), fields: { policy: {
    format: "flarex.private-reference-permissions", version: 1, principal: policyWriter.principal, collection: "posts", relation: "featuredProduct",
    source: { create: true, update: true, delete: true }, assign: [], retain: [],
  } } }, policyWriter.validator));
  if (inserted.kind !== "completed" || inserted.outcome.kind !== "inserted") throw new Error("Missing protected policy");
  const documentId = inserted.outcome.documentId;
  expect(await policyWriter.publish()).toMatchObject({ kind: "published" });
  const root = await fixture.open();
  const policy = await Effect.runPromise(fixture.fixture.store.readPrivateReferencePermissionsEffect(root.attempt,
    { tableName: "audit", documentId, syscallSequence: sequence(1n), principal: root.principal }, root.validator));
  expect(Option.isSome(policy)).toBe(true);
  const scope = await Effect.runPromise(Scope.make());
  try {
    const runtime = await Effect.runPromise(Scope.provide(scope)(makePayloadRuntime(fixture.compiled)));
    const native = await Effect.runPromise(Scope.provide(scope)(runtime.makeAttempt(root.attempt)));
    const admission = root.admissions.get("payload");
    if (admission === undefined || !root.admissions.has("medusa.product")) throw new Error("Missing real joint admissions");
    const frame = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({ format: "flarex.admitted-framework-operation", version: 1,
      participant: "payload", operation: "payload-create", args: { collection: "posts", data: { title: "Joint foundation" } } }));
    const created = await Effect.runPromise(fixture.fixture.store.runAdmittedOperationEffect(root.attempt, admission,
      { syscallSequence: sequence(2n), requestBytes: frame.bytes, requestSha256: createHash("sha256").update(frame.bytes).digest(),
        participant: "payload", method: "payload-create", profileRevision: "1".repeat(64) }, native.borrowParticipant));
    expect(created).toMatchObject({ kind: "completed", result: { title: "Joint foundation", featuredProduct: null } });
    expect(await root.publish()).toMatchObject({ kind: "published" });
  } finally { await Effect.runPromise(Scope.close(scope, Exit.void)); }
  const ordinary = await fixture.open();
  const audit = await Effect.runPromise(fixture.fixture.store.resolvePointTableEffect(ordinary.attempt, "audit"));
  await expect(Effect.runPromise(fixture.fixture.store.runPointOperationEffect(audit,
    { kind: "patch", syscallSequence: sequence(1n), documentId, patch: {} }, ordinary.validator)))
    .rejects.toMatchObject({ _tag: "ApplicationTableWriteDeniedError" });
  await expect(ordinary.publish()).rejects.toBeDefined();
}

it("joins the protected V3 source and native Payload/Product admissions (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle, transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control });
  try { await witness(fixture); await privatePayloadReferenceSaveScenario(fixture); } finally { await fixture.close(); }
}, 240_000);

describe.skipIf(postgresUrl === null)("protected joint composition with an ordinary-role PostgreSQL target", () => {
  it("preserves protected writes and tracked dependencies through native publication", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) });
      try { await witness(fixture); await privatePayloadReferenceSaveScenario(fixture); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 240_000);
});

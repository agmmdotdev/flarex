import { Cause, Effect, Exit, Result, Schema } from "effect";
import { canonicalizeApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import {
  decodePointMutationExactRuntimeResultV1Effect,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  PointCommitConflictV1Error,
} from "../../../persistence-postgres/src/commit/point/errors";
import {
  ApplicationActivationError,
} from "../../../persistence-postgres/src/application/activation/errors";
import {
  installAppSchemaCandidateValidationEffect,
} from "../../../persistence-postgres/src/storage/catalog/appSchemaCandidateValidation";
import {
  inspectLogicalParticipantCommitAuthoritySource,
} from "../../../persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission";
import {
  finiteMetadataContractKey,
} from "../../../persistence-postgres/src/execution/finiteMetadataDependencies";
import {
  readFrozenFiniteAttempt,
} from "../../../persistence-postgres/src/testing/sessionJournalInspection";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemCommitWakes } from
  "../../../persistence-postgres/src/database/schema";
import {
  fxSystemCommitRelationalChanges,
} from "../../../persistence-postgres/src/commit/publication/relationalFactsSchema";
import { fxSystemCommitEvents } from "../../../persistence-postgres/src/commit/events/schema";
import {
  createMixedMutationProductFixture,
  type MixedMutationFinalEntryTestContext,
} from "../performance/support/mixedMutationProductFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("frozen preparation generation on %s", driver => {
  for (const change of ["unrelatedMetadata", "consumedFunction"] as const)
    it(`retains original frozen obligations after ${change}`, async () => {
      const fixture = await createMixedMutationProductFixture({ driver, suffix: `generation-frozen-${change.toLowerCase()}-${driver}` });
      try {
        expect(inspectLogicalParticipantCommitAuthoritySource(fixture.participantAuthority)).not.toBeNull();
        // Verification only, following applicationWritePolicyScenario's durable
        // publication snapshot and this fixture's canonical revision inspection.
        // A changed Application head correctly refuses the old ordinary reader;
        // committed schema evidence remains observable without reblessing it.
        const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
        const db = fixture.currency.persistence.drizzle;
        const publicationState = async () => {
          const revisions = await db.select().from(fxAppRowRevisions)
            .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))
            .orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq);
          const values = [];
          for (const row of revisions) {
            if (row.isTombstone) {
              expect(row.valueBytes).toBeNull();
              expect(row.valueSha256).toBeNull();
              continue;
            }
            if (row.valueBytes === null || row.valueSha256 === null) throw new Error("Missing committed canonical row evidence");
            values.push((await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: row.valueBytes,
              sha256: row.valueSha256, profile: "appDocument" })).value);
          }
          return {
            revisions, values,
            rows: await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid))
              .orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
            indexes: await db.select().from(fxAppIndexEntryCurrent).where(eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid))
              .orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.encodedKey, fxAppIndexEntryCurrent.rowId),
            indexRevisions: await db.select().from(fxAppIndexEntryRevisions).where(eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid))
              .orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.encodedKey,
                fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
            commits: await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid))
              .orderBy(fxSystemCommits.commitSeq),
            changes: await db.select().from(fxSystemCommitAppRowChanges).where(eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid))
              .orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal),
            relationalChanges: await db.select().from(fxSystemCommitRelationalChanges).where(eq(fxSystemCommitRelationalChanges.scopeUuid, scopeUuid))
              .orderBy(fxSystemCommitRelationalChanges.commitSeq, fxSystemCommitRelationalChanges.changeOrdinal),
            events: await db.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid))
              .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
            outcomes: await db.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid))
              .orderBy(fxSystemIdempotency.requestKey),
            wakes: await db.select().from(fxSystemCommitWakes).where(eq(fxSystemCommitWakes.scopeUuid, scopeUuid))
              .orderBy(fxSystemCommitWakes.commitSeq),
          };
        };
        const original = change === "consumedFunction" ? await publicationState() : undefined;
        if (original !== undefined) expect(original.rows.length).toBeGreaterThan(0);
        const raw = await fixture.runExecution();
        const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
          result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
        const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
        const frozen = await Effect.runPromise(fixture.freeze(value));
        const functionIdentity = { namespace: "execution", ownerKey: "application",
          contractKey: finiteMetadataContractKey("function", "users:create") };
        const captured = readFrozenFiniteAttempt(frozen);
        if (captured === undefined) throw new Error("Missing authentic frozen root");
        expect(captured.graph.metadataDependencies).toEqual(expect.arrayContaining([
          expect.objectContaining({ ...functionIdentity, observed: expect.objectContaining({ kind: "present" }) }),
        ]));
        const originalActive = await Effect.runPromise(fixture.application.activation.readActive());
        if (change === "unrelatedMetadata") {
          // The sanctioned writer advances the protected epoch without changing
          // any dependency consumed by the sealed contribution.
          await fixture.currency.testOwner.query("update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
        } else {
          // Accepted finite semantic OCC (design-notes/flarexdb-mixed-mutation-execution.md):
          // a new revision with identical consumed contracts may publish. Change
          // the actual consumed function while retaining its public permission
          // and schema, so revocation cannot mask the metadata conflict.
          const manifest = originalActive.basis.manifest;
          const consumed = manifest.functions.find(fn => fn.path === "users:create");
          expect(consumed).toMatchObject({ kind: "mutation", visibility: "public", args: { type: "any" } });
          await fixture.application.moveHead({ expectedActiveHead: originalActive.expectedActiveHead,
            manifest: { ...manifest, functions: manifest.functions.map(fn => fn.path !== "users:create" ? fn :
              { ...fn, args: { type: "string" as const } }) } });
        }
        expect(inspectLogicalParticipantCommitAuthoritySource(fixture.participantAuthority)).not.toBeNull();
        const publication = await fixture.prepareFrozenPublication(frozen);
        if (change === "unrelatedMetadata") {
          expect(await Effect.runPromise(publication)).toMatchObject({ kind: "published" });
          expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
        } else {
          const outcome = Effect.runPromise(publication);
          await expect(outcome).rejects.toBeInstanceOf(PointCommitConflictV1Error);
          await expect(outcome).rejects.toMatchObject({ conflict: { kind: "metadata", ...functionIdentity } });
          expect(await publicationState()).toEqual(original);
        }
        expect(inspectLogicalParticipantCommitAuthoritySource(fixture.participantAuthority)).not.toBeNull();
      } finally { await fixture.close(); }
      expect(inspectLogicalParticipantCommitAuthoritySource(fixture.participantAuthority)).toBeNull();
    }, 180_000);
});

describe.each(drivers)("native finite generation on %s", driver => {
  for (const race of [false, true]) it(`restages the entire source graph once and ${race ? "refuses a second race" : "enters business once"}`, async () => {
    const generations: MixedMutationFinalEntryTestContext[] = [];
    let entries = 0;
    let callbacks = 0;
    const construction = createMixedMutationProductFixture({ driver,
      suffix: `finite-native-generation-${race ? "race" : "refresh"}-${driver}`,
      hooks: {
        onFiniteEntryPrepared: () => { entries++; },
        beforeFiniteCallback: () => Effect.sync(() => { callbacks++; }),
        beforeFinalEntry: async context => {
          generations.push(context);
          if (generations.length > 1 && !race) return;
          if (driver === "postgres") {
            // The installed sanctioned writer advances the original guarded
            // target epoch without changing any selected semantic definition.
            await context.currency.testOwner.query("update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
          } else {
            const application = context.currency.application;
            const active = await Effect.runPromise(application.activation.readActive());
            const manifest = active.basis.manifest;
            const table = manifest.schema.tables.find(table => table.name === "users");
            if (table?.validator.type !== "object") throw new Error("Missing genuine users schema");
            const validator = table.validator;
            const candidate = await application.publishManagedSchemaCandidate(Result.getOrThrow(canonicalizeApplicationManifestV1({ ...manifest,
              schema: { ...manifest.schema, tables: manifest.schema.tables.map(member => member !== table ? member :
                { ...table, validator: { ...validator, value: { ...validator.value,
                  [`optionalGeneration${generations.length}`]: { fieldType: { type: "string" }, optional: true } } } }) } })).manifest);
            await Effect.runPromise(installAppSchemaCandidateValidationEffect(application.candidateValidation, {
              deploymentId: application.deploymentId, scopeId: application.authority.scopeId,
              schemaVersionId: candidate.schemaVersionId }));
          }
        },
      } });
    if (race) {
      const outcome = await Effect.runPromise(Effect.exit(Effect.tryPromise({ try: () => construction, catch: error => error })));
      expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isSuccess(outcome)) { await outcome.value.close(); throw new Error("A second native race entered business"); }
      const failure = outcome.cause.reasons;
      expect(failure).toHaveLength(1);
      const error = failure[0];
      if (!Cause.isFailReason(error)) throw new Error("Native refresh changed the failure channel");
      const transported = Cause.isCause(error.error) ? error.error.reasons : [error];
      expect(transported).toHaveLength(1);
      expect(transported[0]).toMatchObject({ error: expect.any(ApplicationActivationError) });
      expect(transported[0]).toMatchObject({ error: { reason: "concurrentHead" } });
      expect(callbacks).toBe(0);
    } else {
      const fixture = await construction;
      try {
        expect(fixture.logicalSourceCatalog).toBe(generations[1]?.sourceCatalog);
        expect(callbacks).toBe(1);
        const raw = await fixture.runExecution();
        const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
          result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
        const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
        expect(await fixture.publish(value)).toMatchObject({ kind: "published" });
        expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
      } finally { await fixture.close(); }
    }
    expect(entries).toBe(2);
    expect(generations).toHaveLength(2);
    expect(generations[0]?.sourceCatalog).not.toBe(generations[1]?.sourceCatalog);
    expect(generations[0]?.preparedFiniteApplication).not.toBe(generations[1]?.preparedFiniteApplication);
  }, 180_000);
});

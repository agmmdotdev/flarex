import { and, eq } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import {
  prepareLogicalSchemaCandidate,
  readPreparedLogicalSchemaCandidate,
  type PreparedLogicalSchemaCandidate,
} from "@flarex/analysis/internal/logical-schema-candidate";
import {
  decodeLogicalSchemaCandidate,
  logicalTableKey,
  QualifiedLogicalTableSchema,
  type LogicalSchemaCandidate,
} from "flarex-protocol/internal/logical-schema-candidate";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { SchemaManifestJsonSchema, type CatalogSchemaVersionId, type CatalogSchemaVersion } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { encodeCanonicalJson } from "flarex-protocol/json";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  hasCatalogControlSessionComposition,
  runCatalogControlEffect,
  runCatalogControlReadEffect,
  withCatalogRawControlSessionTransactionEffect,
  type CatalogControlSessionStarter,
  type CatalogControlReadInput,
  type RunCatalogControlInput,
} from "./catalogControlSession";
import { fxControlScopes } from "./schema";
import { lockSchemaManifestBindingDeploymentEffect } from "./schemaManifestTableBindings";
import {
  ensureStableTableIdentityInTransactionEffect,
  getStableTableIdentityByNameEffect,
} from "./stableTableCatalog";
import {
  prepareSchemaVersionArtifactEffect,
  ensureSchemaVersionArtifactInTransactionEffect,
  getSchemaVersionArtifactByIdEffect,
} from "./schemaVersionArtifacts";

export class LogicalSchemaAdmissionError extends Data.TaggedError("LogicalSchemaAdmissionError")<{
  readonly reason: "wrongTarget" | "missingCandidate" | "storedCorruption" | "resourceFailure";
  readonly cause?: unknown;
}> {}
const Binding = Schema.Struct({ table: QualifiedLogicalTableSchema, tableId: CatalogTableIdSchema });
const Admission = Schema.Struct({
  kind: Schema.Literal("logicalSchemaAdmission"),
  definitionVersion: Schema.Literal(1),
  candidate: SchemaManifestJsonSchema,
  tableBindings: Schema.Array(Binding).check(Schema.isMaxLength(10_000)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
type Binding = typeof Binding.Type;
type AdmissionFailure = LogicalSchemaAdmissionError
  | Effect.Error<ReturnType<typeof lockSchemaManifestBindingDeploymentEffect>>
  | Effect.Error<ReturnType<typeof ensureStableTableIdentityInTransactionEffect>>
  | Effect.Error<ReturnType<typeof getStableTableIdentityByNameEffect>>
  | Effect.Error<ReturnType<typeof prepareSchemaVersionArtifactEffect>>
  | Effect.Error<ReturnType<typeof ensureSchemaVersionArtifactInTransactionEffect>>
  | Effect.Error<ReturnType<typeof getSchemaVersionArtifactByIdEffect>>;

/**
 * Trusted control-plane composition only. Uses the existing identity/artifact
 * catalogs and physical settlement owner. Its output is inspectable metadata;
 * it is deliberately not an Application manifest or a commerce profile.
 */
export function makeLogicalSchemaAdmission(input: {
  readonly controlDb: FlarexMetadataDatabase;
  readonly session: CatalogControlSessionStarter;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
}) {
  if (!hasCatalogControlSessionComposition(input.session, input.controlDb)) {
    throw new Error("Logical schema admission needs the exact catalog session/database pair");
  }
  const requireTarget = (candidate: LogicalSchemaCandidate) =>
    candidate.deploymentId === input.deploymentId && candidate.scopeId === input.scopeId
      ? Effect.void
      : Effect.fail(new LogicalSchemaAdmissionError({ reason: "wrongTarget" }));

  const requireScope = Effect.fn("LogicalSchemaAdmission.requireScope")(function* (db: FlarexMetadataDatabase, lock = false) {
    const statement = db.select({ scopeId: fxControlScopes.scopeId }).from(fxControlScopes)
      .where(and(eq(fxControlScopes.scopeId, input.scopeId), eq(fxControlScopes.deploymentId, input.deploymentId))).limit(1);
    const rows = yield* query(() => lock ? statement.for("key share") : statement);
    if (rows.length !== 1) return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "wrongTarget" }));
  });

  const inspectInDatabase = Effect.fn("LogicalSchemaAdmission.inspectInDatabase")(function* (
    db: FlarexMetadataDatabase, schemaVersionId: CatalogSchemaVersionId,
  ) {
    yield* requireScope(db);
    const artifact = yield* getSchemaVersionArtifactByIdEffect(db, input.deploymentId, schemaVersionId);
    if (artifact === null) return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "missingCandidate" }));
    const admitted = yield* Schema.decodeUnknownEffect(Admission)(artifact.manifestJson).pipe(
      Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "storedCorruption", cause })),
    );
    const candidate = yield* Effect.fromResult(decodeLogicalSchemaCandidate(admitted.candidate)).pipe(
      Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "storedCorruption", cause })),
    );
    yield* requireTarget(candidate);
    yield* prepareLogicalSchemaCandidate(candidate).pipe(
      Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "storedCorruption", cause })),
    );
    const definitions = candidate.sources.flatMap(source => source.bindings.filter(binding => binding.kind === "definition"));
    if (admitted.tableBindings.length !== definitions.length ||
        new Set(admitted.tableBindings.map(binding => logicalTableKey(binding.table))).size !== definitions.length) {
      return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "storedCorruption" }));
    }
    for (const binding of admitted.tableBindings) {
      const identity = yield* getStableTableIdentityByNameEffect(db, { deploymentId: input.deploymentId, ...binding.table });
      if (identity?.tableId !== binding.tableId || !definitions.some(definition => logicalTableKey(definition.table) === logicalTableKey(binding.table))) {
        return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "storedCorruption" }));
      }
    }
    return Object.freeze({ state: "candidate" as const, artifact, candidate, tableBindings: admitted.tableBindings });
  });

  const admit = Effect.fn("LogicalSchemaAdmission.admit")(function* (
    prepared: PreparedLogicalSchemaCandidate,
    identity: { readonly schemaVersionId: CatalogSchemaVersionId; readonly version: CatalogSchemaVersion },
    budget: RunCatalogControlInput,
  ) {
    const candidate = yield* readPreparedLogicalSchemaCandidate(prepared);
    yield* requireTarget(candidate);
    return yield* runCatalogControlEffect<CatalogSchemaVersionId, AdmissionFailure>(input.session, budget, {
      runLockedEffect: transaction => withCatalogRawControlSessionTransactionEffect(transaction, input.session, tx => Effect.gen(function* () {
        yield* lockSchemaManifestBindingDeploymentEffect(tx, input.deploymentId);
        yield* requireScope(tx, true);
        const tableBindings: Binding[] = [];
        // One allocator and one settlement owner. Views never allocate identities.
        const definitions = candidate.sources.flatMap(source => source.bindings.filter(binding => binding.kind === "definition"))
          .toSorted((a, b) => logicalTableKey(a.table) < logicalTableKey(b.table) ? -1 : 1);
        for (const definition of definitions) {
          const allocated = yield* ensureStableTableIdentityInTransactionEffect(tx, { deploymentId: input.deploymentId, ...definition.table });
          tableBindings.push({ table: definition.table, tableId: allocated.table.tableId });
        }
        const manifest = yield* Schema.decodeUnknownEffect(SchemaManifestJsonSchema)({
          kind: "logicalSchemaAdmission", definitionVersion: 1, candidate, tableBindings,
        }).pipe(Effect.orDie);
        // Compilation is complete. Only bounded owned metadata and local digest
        // work run here; no user callbacks, model loading or remote effects.
        const artifact = yield* prepareSchemaVersionArtifactEffect({ deploymentId: input.deploymentId, ...identity, manifest });
        const result = yield* ensureSchemaVersionArtifactInTransactionEffect(tx, artifact);
        return { kind: result.status, value: identity.schemaVersionId };
      })),
      resolveExistingEffect: db => Effect.gen(function* () {
        const existing = yield* inspectInDatabase(db, identity.schemaVersionId);
        if (existing.artifact.version !== identity.version || candidateText(existing.candidate) !== candidateText(candidate)) {
          return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "storedCorruption" }));
        }
        return identity.schemaVersionId;
      }),
    });
  });

  return Object.freeze({
    admit,
    inspect: (schemaVersionId: CatalogSchemaVersionId, budget: CatalogControlReadInput) =>
      runCatalogControlReadEffect(input.session, budget, db => inspectInDatabase(db, schemaVersionId)),
  });
}

const query = <A>(run: () => PromiseLike<A>) => Effect.tryPromise({
  try: run,
  catch: cause => new LogicalSchemaAdmissionError({ reason: "resourceFailure", cause }),
});

function candidateText(candidate: LogicalSchemaCandidate): string {
  return encodeCanonicalJson(candidate, issue => { throw new Error(`Candidate JSON invariant: ${issue.reason}`); });
}

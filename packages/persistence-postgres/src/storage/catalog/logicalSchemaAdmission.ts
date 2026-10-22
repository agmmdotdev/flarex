import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import {
  readPreparedLogicalSchemaCandidate,
  type PreparedLogicalSchemaCandidate,
} from "@flarex/analysis/internal/logical-schema-candidate";
import {
  logicalTableKey,
  type LogicalSchemaCandidate,
} from "flarex-protocol/internal/logical-schema-candidate";
import { SchemaManifestJsonSchema, CatalogSchemaVersionIdSchema, CatalogSchemaVersionSchema,
  decodeSchemaManifestAppSchemaV1Result, type CatalogSchemaVersionId, type CatalogSchemaVersion } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { encodeCanonicalJson, isJson, isJsonObject } from "flarex-protocol/json";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import {
  hasCatalogControlSessionComposition,
  runCatalogControlEffect,
  runCatalogControlReadEffect,
  withCatalogRawControlSessionTransactionEffect,
  type CatalogControlSessionStarter,
  type CatalogControlReadInput,
  type RunCatalogControlInput,
} from "../../database/catalogControlSession";
import { fxControlScopes, fxControlSchemaVersions } from "../../database/schema";
import { locateApplicationRelationBindingForCommitEffect } from "../../application/relations/binding";
import { verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { ApplicationLogicalV3Evidence, prepareApplicationLogicalSource } from "@flarex/analysis/internal/logical-application-source";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { prepareApplicationWritePolicyBinding } from "../../application/ownership/applicationWritePolicyBinding";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { readLogicalSchemaAdmissionEvidence, isLogicalSchemaAdmissionManifest,
  MAX_LOGICAL_SCHEMA_HISTORY_RECORDS, MAX_LOGICAL_SCHEMA_HISTORY_BYTES,
  type LogicalSchemaAdmissionBinding as Binding } from "./logicalSchemaAdmissionEvidence";
import { lockSchemaManifestBindingDeploymentEffect } from "./schemaManifestTableBindings";
import {
  ensureStableTableIdentityInTransactionEffect,
  getStableTableIdentityByNameEffect,
} from "./stableTableCatalog";
import {
  prepareSchemaVersionArtifactEffect,
  getPreparedSchemaVersionArtifactEvidenceResult,
  ensureSchemaVersionArtifactInTransactionEffect,
  getSchemaVersionArtifactByIdEffect,
} from "./schemaVersionArtifacts";

export class LogicalSchemaAdmissionError extends Data.TaggedError("LogicalSchemaAdmissionError")<{
  readonly reason: "wrongTarget" | "missingCandidate" | "storedCorruption" | "resourceFailure" | "invalidIdentity"
    | "ownershipChanged" | "unsupportedOwnershipBaseline" | "historyLimit" | "identityConflict";
  readonly cause?: unknown;
}> {}
const decodeIdentity = Schema.decodeUnknownEffect(Schema.Struct({
  schemaVersionId: CatalogSchemaVersionIdSchema, version: CatalogSchemaVersionSchema,
}).annotate({ parseOptions: { onExcessProperty: "error" } }));
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
export function makeLogicalSchemaAdmission(configuration: {
  readonly controlDb: FlarexMetadataDatabase;
  readonly session: CatalogControlSessionStarter;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
}) {
  const input = Object.freeze({ controlDb: configuration.controlDb, session: configuration.session,
    deploymentId: configuration.deploymentId, scopeId: configuration.scopeId });
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
    const admitted = yield* readLogicalSchemaAdmissionEvidence(artifact.manifestJson, input.deploymentId).pipe(
      Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: cause.reason, cause })));
    const candidate = admitted.candidate;
    yield* requireTarget(candidate);
    for (const binding of admitted.tableBindings) {
      const identity = yield* getStableTableIdentityByNameEffect(db, { deploymentId: input.deploymentId, ...binding.table });
      if (identity?.tableId !== binding.tableId) {
        return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "storedCorruption" }));
      }
    }
    return Object.freeze({ state: "candidate" as const, artifact, candidate, tableBindings: admitted.tableBindings });
  });

  const admit = Effect.fn("LogicalSchemaAdmission.admit")(function* (
    prepared: PreparedLogicalSchemaCandidate,
    identityInput: { readonly schemaVersionId: CatalogSchemaVersionId; readonly version: CatalogSchemaVersion },
    budget: RunCatalogControlInput,
  ) {
    const identity = yield* Schema.decodeUnknownEffect(SchemaManifestJsonSchema)(identityInput).pipe(Effect.flatMap(decodeIdentity), Effect.mapError(cause =>
      new LogicalSchemaAdmissionError({ reason: "invalidIdentity", cause })));
    const candidate = yield* readPreparedLogicalSchemaCandidate(prepared);
    yield* requireTarget(candidate);
    return yield* runCatalogControlEffect<CatalogSchemaVersionId, AdmissionFailure>(input.session, budget, {
      runLockedEffect: transaction => withCatalogRawControlSessionTransactionEffect(transaction, input.session, tx => Effect.gen(function* () {
        yield* lockSchemaManifestBindingDeploymentEffect(tx, input.deploymentId);
        yield* requireScope(tx, true);
        const retained = yield* getSchemaVersionArtifactByIdEffect(tx, input.deploymentId, identity.schemaVersionId);
        if (retained !== null) {
          if (!isLogicalSchemaAdmissionManifest(retained.manifestJson)) {
            return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "identityConflict" }));
          }
          const existing = yield* inspectInDatabase(tx, identity.schemaVersionId);
          if (existing.artifact.version !== identity.version || candidateText(existing.candidate) !== candidateText(candidate)) {
            return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "identityConflict" }));
          }
          return { kind: "existing" as const, value: identity.schemaVersionId };
        }
        const retainedBytes = yield* requireRetainedOwners(tx, input.deploymentId, candidate);
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
        const artifact = yield* prepareSchemaVersionArtifactEffect({ deploymentId: input.deploymentId,
          schemaVersionId: identity.schemaVersionId, version: identity.version, manifest });
        const evidence = yield* Effect.fromResult(getPreparedSchemaVersionArtifactEvidenceResult(artifact));
        if (retainedBytes + evidence.manifestByteLength > MAX_LOGICAL_SCHEMA_HISTORY_BYTES) {
          return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "historyLimit" }));
        }
        const result = yield* ensureSchemaVersionArtifactInTransactionEffect(tx, artifact);
        return { kind: result.status, value: identity.schemaVersionId };
      })),
      resolveExistingEffect: db => Effect.gen(function* () {
        const existing = yield* inspectInDatabase(db, identity.schemaVersionId);
        if (existing.artifact.version !== identity.version || candidateText(existing.candidate) !== candidateText(candidate)) {
          return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "identityConflict" }));
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

/** Conservative candidate-only transition check, under the existing deployment
 * lock. This reads retained catalog evidence, not a second write-owner history.
 * Active V3 ownership needs its own connected cutover; never infer it from names.
 */
const requireRetainedOwners = Effect.fn("LogicalSchemaAdmission.requireRetainedOwners")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, candidate: LogicalSchemaCandidate,
) {
  const history = yield* query(() => db.select({ id: fxControlSchemaVersions.schemaVersionId,
    bytes: sql<number>`octet_length(${fxControlSchemaVersions.manifestBytes})` }).from(fxControlSchemaVersions)
    .where(eq(fxControlSchemaVersions.deploymentId, deploymentId)).limit(MAX_LOGICAL_SCHEMA_HISTORY_RECORDS));
  const retainedBytes = history.reduce((total, row) => total + row.bytes, 0);
  // Charge the new artifact too; refusal must leave retained history readable.
  if (history.length >= MAX_LOGICAL_SCHEMA_HISTORY_RECORDS || retainedBytes >= MAX_LOGICAL_SCHEMA_HISTORY_BYTES) {
    return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "historyLimit" }));
  }
  const proposed = new Map(candidate.sources.flatMap(source => source.bindings.filter(binding => binding.kind === "definition")
    .map(binding => [logicalTableKey(binding.table), { owner: source.owner, profile: source.writeProfile }] as const)));
  for (const row of history) {
    const artifact = yield* getSchemaVersionArtifactByIdEffect(db, deploymentId, row.id);
    if (artifact === null || artifact.manifestBytes.byteLength !== row.bytes) {
      return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "storedCorruption" }));
    }
    if (isLogicalSchemaAdmissionManifest(artifact.manifestJson)) {
      const previous = yield* readLogicalSchemaAdmissionEvidence(artifact.manifestJson, deploymentId).pipe(
        Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: cause.reason, cause })));
      for (const source of previous.candidate.sources) for (const binding of source.bindings) {
        if (binding.kind !== "definition") continue;
        const next = proposed.get(logicalTableKey(binding.table));
        if (next !== undefined && (next.owner !== source.owner || next.profile !== source.writeProfile)) {
          return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "ownershipChanged" }));
        }
      }
      continue;
    }
    const bound = yield* locateApplicationRelationBindingForCommitEffect(db, { deploymentId, schemaVersionId: row.id }).pipe(
      Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "storedCorruption", cause })));
    if (bound?.binding.version === 3) {
      const app = candidate.sources.filter(source => source.owner === "application");
      const payload = candidate.sources.filter(source => source.owner === "payload" && source.writeProfile !== "payload.readOnlyView");
      if (app.length !== 1 || payload.length !== 1 || app[0] === undefined || payload[0] === undefined)
        return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "ownershipChanged" }));
      const evidence = yield* Schema.decodeUnknownEffect(ApplicationLogicalV3Evidence)(app[0].evidence).pipe(
        Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "ownershipChanged", cause })));
      const verified = yield* verifyApplicationManifestV3(evidence.manifest).pipe(
        Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "ownershipChanged", cause })));
      const manifestData: unknown = verified.manifest;
      if (!isJson(manifestData) || !isJsonObject(manifestData)) return yield* Effect.die(new Error("Decoded V3 manifest lost JSON"));
      const digestPolicy = { invalidInput: () => new LogicalSchemaAdmissionError({ reason: "ownershipChanged" }),
        hashFailure: (cause: unknown) => new LogicalSchemaAdmissionError({ reason: "resourceFailure", cause }) };
      const manifest = yield* capturePrivateCanonicalValue(manifestData, 1_048_576, digestPolicy);
      const schema = yield* capturePrivateCanonicalValue({ format: "flarex.application-schema-publication", version: 3,
        schema: manifestData.schema! }, 1_048_576, digestPolicy);
      const policies = yield* prepareApplicationWritePolicyBinding(verified.manifest, bound.binding.tables).pipe(
        Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "ownershipChanged", cause })));
      const expected = yield* prepareApplicationLogicalSource(verified.manifest, evidence.manifestSha256, payload[0]).pipe(
        Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "ownershipChanged", cause })));
      if (manifest.sha256Hex !== evidence.manifestSha256 || candidate.applicationAnalysis.manifestSha256 !== evidence.manifestSha256 ||
        schema.sha256Hex !== encodeBytesToLowercaseHex(bound.applicationSchemaSha256) ||
        policies === null || canonical(policies.writePolicies) !== canonical(bound.binding.writePolicies) ||
        canonical(expected) !== canonical(app[0]))
        return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "ownershipChanged" }));
      // Qualified names reuse the existing stable catalog. No removed,
      // reclassified or renamed retained native table may enter this profile.
      for (const table of bound.binding.tables) {
        const identity = yield* getStableTableIdentityByNameEffect(db, { deploymentId, namespace: "app", logicalName: table.logicalName });
        const next = proposed.get(logicalTableKey({ namespace: "app", logicalName: table.logicalName }));
        const policy = bound.binding.writePolicies.find(member => member.tableId === table.tableId);
        if (identity?.tableId !== table.tableId || policy === undefined || next === undefined ||
          next.owner !== (policy.owner === "payload" ? "payload" : "application") ||
          next.profile !== (policy.owner === "payload" ? verified.manifest.schema.writePolicies.configuration.profile : "application.occ"))
          return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "ownershipChanged" }));
      }
      continue;
    }
    const previous = yield* Effect.fromResult(decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson)).pipe(
      Effect.mapError(cause => new LogicalSchemaAdmissionError({ reason: "unsupportedOwnershipBaseline", cause })));
    for (const table of previous.tableDefinitions.tables) {
      const next = proposed.get(logicalTableKey(table));
      if (next !== undefined && (next.owner !== "application" || next.profile !== "application.occ")) {
        return yield* Effect.fail(new LogicalSchemaAdmissionError({ reason: "ownershipChanged" }));
      }
    }
  }
  return retainedBytes;
});

const query = <A>(run: () => PromiseLike<A>) => Effect.tryPromise({
  try: run,
  catch: cause => new LogicalSchemaAdmissionError({ reason: "resourceFailure", cause }),
});

function candidateText(candidate: LogicalSchemaCandidate): string {
  return encodeCanonicalJson(candidate, issue => { throw new Error(`Candidate JSON invariant: ${issue.reason}`); });
}

const canonical = (value: Parameters<typeof encodeCanonicalJson>[0]) => encodeCanonicalJson(value, issue => {
  throw new Error(`Retained ownership JSON invariant: ${issue.reason}`);
});

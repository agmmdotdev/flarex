import { Data, Effect, Schema } from "effect";
import {
  captureLogicalSchemaSource,
  prepareLogicalSchemaCandidate,
} from "@flarex/analysis/internal/logical-schema-candidate";
import { compilePayloadCollections } from "@flarex/payload-adapter/internal/collections";
import { compileProductDefinition } from "@flarex/medusa-adapter/internal/product-definition";
import type {
  ApplicationAnalysisAuthority,
  ApplicationAnalysisRepository,
} from "@flarex/persistence-postgres/internal/application-analysis-registration";
import {
  LogicalSchemaExtensionSchema,
  QualifiedLogicalTableSchema,
  type LogicalSchemaSource,
} from "flarex-protocol/internal/logical-schema-candidate";
import {
  decodeSchemaManifestAppTableDeclarationsV1Result,
  decodeSchemaManifestAppIndexDeclarationsV1Result,
} from "flarex-protocol/schema-manifest";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const Request = Schema.Struct({
  applicationCandidateId: Schema.NonEmptyString,
  payloadCollections: Schema.Unknown,
  payloadViews: Schema.Array(Schema.Struct({
    collections: Schema.Unknown,
    bindings: Schema.Array(Schema.Struct({ localName: Schema.NonEmptyString, table: QualifiedLogicalTableSchema }).annotate(strict)),
  }).annotate(strict)).check(Schema.isMaxLength(16)),
  extensions: Schema.Array(LogicalSchemaExtensionSchema).check(Schema.isMaxLength(1024)),
}).annotate(strict);

export class SchemaCompositionError extends Data.TaggedError("SchemaCompositionError")<{
  readonly reason: "invalidRequest" | "unanalyzedApplication" | "mixedApplicationPolicy" | "unsupportedPlacement";
  readonly cause?: unknown;
}> {}

/**
 * Private construction-time backend composition. No HTTP/runtime route installs
 * this capability. Application metadata comes from the authenticated repository;
 * framework definitions come from their native compilers, never caller schemas
 * or claimed producer hashes. Deployment configuration authorizes dependencies.
 */
export function makeSchemaComposer(configuration: {
  readonly deploymentId: string;
  readonly authority: ApplicationAnalysisAuthority;
  readonly applicationAnalyses: ApplicationAnalysisRepository;
}) {
  const authority = Object.freeze({ scopeId: configuration.authority.scopeId, epoch: configuration.authority.epoch,
    storageGeneration: configuration.authority.storageGeneration, storageGenerationFence: configuration.authority.storageGenerationFence });
  const deploymentId = configuration.deploymentId;
  const repository = configuration.applicationAnalyses;
  const inspect = repository.inspect;
  return Effect.fn("SchemaComposition.compose")(function* (request: unknown) {
    const config = yield* Schema.decodeUnknownEffect(Request)(request).pipe(
      Effect.mapError(cause => new SchemaCompositionError({ reason: "invalidRequest", cause })),
    );
    const application = yield* inspect.call(repository, authority, config.applicationCandidateId);
    if (application.status !== "analyzed") return yield* Effect.fail(new SchemaCompositionError({ reason: "unanalyzedApplication" }));
    const manifest = application.manifest;
    // The shared path takes independently compiled Payload sources. The old V3
    // embedded policy bundle remains with its existing active runtime consumers.
    if (manifest.version === 3) return yield* Effect.fail(new SchemaCompositionError({ reason: "mixedApplicationPolicy" }));
    // Placement must not disappear when projecting a native schema. This first
    // candidate profile has no partition/colocation contract yet.
    if (manifest.schema.tables.some(table => table.placement.kind !== "global")) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "unsupportedPlacement" }));
    }
    const tables = yield* Effect.fromResult(decodeSchemaManifestAppTableDeclarationsV1Result(manifest.schema.tables.map(table => ({
      logicalName: table.name,
      definition: { kind: "appDocument", definitionVersion: 1, documentType: table.validator },
    }))));
    const indexes = yield* Effect.fromResult(decodeSchemaManifestAppIndexDeclarationsV1Result(manifest.schema.indexes.map(index => ({
      tableLogicalName: manifest.schema.tables.find(table => table.tableId === index.tableId)?.name,
      descriptor: index.name,
      fields: index.fields,
      ...(index.decimalFields === undefined ? {} : { decimalFields: [...index.decimalFields] }),
    }))));
    const applicationSource = yield* captureLogicalSchemaSource({
      key: "application", owner: "application", writeProfile: "application.occ",
      evidence: { sourceArtifact: manifest.sourceArtifact, manifestSha256: application.manifestSha256 },
      definition: { kind: "documents", tables, indexes, relations: manifest.version === 2 ? manifest.schema.relations.map(relation => relation.declaration) : [] },
      bindings: tables.map(table => ({ kind: "definition", localName: table.logicalName,
        table: { namespace: "app", logicalName: table.logicalName } })),
    });
    const payload = yield* compilePayloadCollections(config.payloadCollections);
    const payloadSource = yield* captureLogicalSchemaSource({
      key: "payload", owner: "payload", writeProfile: payload.configuration.profile,
      evidence: payload.schemaDefinition.writePolicies,
      definition: payload.logicalDefinition,
      bindings: payload.logicalDefinition.tables.map(table => ({ kind: "definition", localName: table.logicalName,
        table: { namespace: "app", logicalName: table.logicalName } })),
    });
    const product = yield* compileProductDefinition();
    const productSource = yield* captureLogicalSchemaSource({
      key: "medusa.product", owner: "medusa", writeProfile: "medusa.product",
      evidence: product.provenance,
      definition: { kind: "relational", schema: product.schema },
      bindings: product.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
        table: { namespace: "medusa", logicalName: `${product.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
    });
    const views: LogicalSchemaSource[] = [];
    for (const [position, view] of config.payloadViews.entries()) {
      const compiled = yield* compilePayloadCollections(view.collections);
      views.push(yield* captureLogicalSchemaSource({
        key: `payload.view.${position}`, owner: "payload", writeProfile: "payload.readOnlyView",
        evidence: compiled.schemaDefinition.writePolicies,
        definition: compiled.logicalDefinition,
        bindings: view.bindings.map(binding => ({ ...binding, kind: "view", mode: "readOnly" })),
      }));
    }
    return yield* prepareLogicalSchemaCandidate({
      kind: "logicalSchemaCandidate", definitionVersion: 1, state: "candidate",
      deploymentId, scopeId: authority.scopeId,
      applicationAnalysis: { candidateId: application.candidateId, analysisId: application.analysisId,
        manifestSha256: application.manifestSha256, sourceArtifactRootSha256: application.sourceArtifactRootSha256 },
      sources: [applicationSource, payloadSource, productSource, ...views],
      extensions: config.extensions,
    });
  });
}

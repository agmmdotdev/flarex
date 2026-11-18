import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Data, Effect, Schema } from "effect";
import type { Pool } from "pg";
import { getDeploymentMetadata, type DeploymentMetadataRecord } from "./deployments";
import { makeCorePostgresDriver, type CoreSqlConnection } from "../database/corePersistence/driver";
import { commits, deploymentPackages, deployments, documents, indexes, invokeSessionDocumentReads,
  invokeSessionDocumentWrites, invokeSessionIndexReads, invokeSessions, invokeSessionTableReads,
  leases, outbox, persistenceGlobals, readOnly, flarexSchema } from "../database/schema";

export class CoreApplicationLegacyDeploymentError extends Data.TaggedError("CoreApplicationLegacyDeploymentError")<{
  readonly reason: "legacyDeploymentExists" | "invalidLegacyCatalog" | "metadataReadFailed";
  readonly cause?: unknown;
}> {}

const legacyRelations: readonly string[] = [deployments, deploymentPackages, documents, indexes, leases, readOnly,
  persistenceGlobals, commits, outbox, invokeSessions, invokeSessionDocumentReads,
  invokeSessionTableReads, invokeSessionIndexReads, invokeSessionDocumentWrites].map(getTableName);
const Catalog = Schema.Tuple([Schema.Struct({ schemaPresent: Schema.Boolean, expectedSchema: Schema.Boolean,
  deploymentOid: Schema.NullOr(Schema.String), resolvedOid: Schema.NullOr(Schema.String), legacyRelations: Schema.Array(Schema.String) })]);
const decodeCatalog = Schema.decodeUnknownEffect(Catalog);
const decodePresence = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ present: Schema.Boolean })]));
const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const invalidCatalog = (cause?: unknown) => new CoreApplicationLegacyDeploymentError({
  reason: "invalidLegacyCatalog", ...(cause === undefined ? {} : { cause }),
});

/** Trusted read capability; neither this guard nor its caller settles application data. */
export interface CoreApplicationLegacyAdmissionReader {
  readonly query: CoreSqlConnection["query"];
  readonly getDeploymentMetadata: (deploymentId: string) => Effect.Effect<DeploymentMetadataRecord | null,
    CoreApplicationLegacyDeploymentError>;
}

/** The configured host owns public control metadata. An absent relation is accepted
 * only after an explicit catalog proof that the legacy installation is absent.
 * The host must fence legacy lifecycle entry and exclude external provisioners;
 * this read is not a storage-generation migration or an absent-row SQL lock. */
export function makeCoreApplicationLegacyAdmissionWithReader(reader: CoreApplicationLegacyAdmissionReader,
  controlNamespace = "public") {
  return Effect.fn("CoreApplication.assertNoLegacyDeployment")(function* (deploymentId: string) {
    const rows = yield* reader.query(`SELECT
      EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1) AS "schemaPresent",
      current_schema() = $1 AS "expectedSchema",
      pg_catalog.to_regclass(pg_catalog.quote_ident($1) || '.deployments')::oid::text AS "deploymentOid",
      pg_catalog.to_regclass('deployments')::oid::text AS "resolvedOid",
      ARRAY(SELECT c.relname::text FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname IN
         (SELECT json_array_elements_text($2::json))) AS "legacyRelations"`, [controlNamespace, JSON.stringify(legacyRelations)]);
    const [catalog] = yield* decodeCatalog(rows).pipe(Effect.mapError(invalidCatalog));
    if (!catalog.schemaPresent || !catalog.expectedSchema) return yield* invalidCatalog();
    if (catalog.deploymentOid === null) {
      if (catalog.legacyRelations.length !== 0 || catalog.resolvedOid !== null) return yield* invalidCatalog();
      return;
    }
    if (catalog.deploymentOid !== catalog.resolvedOid) return yield* invalidCatalog();
    if ((yield* reader.getDeploymentMetadata(deploymentId)) !== null)
      return yield* new CoreApplicationLegacyDeploymentError({ reason: "legacyDeploymentExists" });
    // These retained tables have no deployment FK. A removed control row must
    // not turn surviving sessions, revisions or outcomes into fresh admission.
    const relations = catalog.legacyRelations.filter(name => legacyRelations.includes(name));
    const statement = relations.map(name => `(SELECT 1 FROM ${quoteIdentifier(controlNamespace)}.${quoteIdentifier(name)}
      WHERE deployment_id = $1 LIMIT 1)`).join(" UNION ALL ");
    const [obligation] = yield* decodePresence(yield* reader.query(`SELECT EXISTS (${statement}) AS present`, [deploymentId]))
      .pipe(Effect.mapError(invalidCatalog));
    if (obligation.present) return yield* new CoreApplicationLegacyDeploymentError({ reason: "legacyDeploymentExists" });
  });
}

/** Reuses the actual retained pool and authoritative legacy metadata reader. */
export function makeCoreApplicationLegacyAdmission(pool: Pool, controlNamespace = "public") {
  const driver = makeCorePostgresDriver(pool);
  const database = drizzle(pool, { schema: flarexSchema });
  return makeCoreApplicationLegacyAdmissionWithReader({ query: driver.query,
    getDeploymentMetadata: deploymentId => Effect.uninterruptible(Effect.tryPromise({
      try: () => getDeploymentMetadata(database, deploymentId),
      catch: cause => new CoreApplicationLegacyDeploymentError({ reason: "metadataReadFailed", cause }),
    })),
  }, controlNamespace);
}

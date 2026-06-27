import { Context, Effect, Layer, Schema } from "effect";
import type { DeploymentRecord } from "flarex-protocol/registry";

const RegistrySqlOperation = Schema.Union([
  Schema.Literal("createDeployment"),
  Schema.Literal("listDeployments"),
]);

export class RegistrySqlError extends Schema.TaggedErrorClass<RegistrySqlError>()(
  "RegistrySqlError",
  {
    operation: RegistrySqlOperation,
    cause: Schema.Defect(),
  },
) {}

export interface CreateDeploymentStoreInput {
  readonly deploymentId: string;
  readonly slug?: string;
  readonly now: number;
}

export type RegistrySqlStorage = DurableObjectState["storage"]["sql"];

export class RegistryStore extends Context.Service<RegistryStore, {
  createDeployment(input: CreateDeploymentStoreInput): Effect.Effect<DeploymentRecord, RegistrySqlError>;
  readonly listDeployments: Effect.Effect<ReadonlyArray<DeploymentRecord>, RegistrySqlError>;
}>()("flarex-backend/registry/RegistryStore") {
  static layer(sql: RegistrySqlStorage) {
    return Layer.effect(
      RegistryStore,
      Effect.gen(function* () {
        const createDeployment = Effect.fn("RegistryStore.createDeployment")(
          function* (input: CreateDeploymentStoreInput): Effect.fn.Return<DeploymentRecord, RegistrySqlError> {
            return yield* Effect.try({
              try: () => {
                sql.exec(
                  `
                  INSERT INTO deployments (deployment_id, slug, created_at, updated_at, schema_version)
                  VALUES (?, ?, ?, ?, 0)
                  ON CONFLICT(deployment_id) DO UPDATE SET
                    slug = excluded.slug,
                    updated_at = excluded.updated_at
                  `,
                  input.deploymentId,
                  input.slug ?? null,
                  input.now,
                  input.now,
                );
                return {
                  deploymentId: input.deploymentId,
                  ...(input.slug === undefined ? {} : { slug: input.slug }),
                  createdAt: input.now,
                  updatedAt: input.now,
                  schemaVersion: 0,
                };
              },
              catch: cause => new RegistrySqlError({ operation: "createDeployment", cause }),
            });
          },
        );

        const listDeployments = Effect.try({
          try: () =>
            sql
              .exec<{
                deployment_id: string;
                slug: string | null;
                created_at: number;
                updated_at: number;
                schema_version: number;
              }>(
                `
                SELECT deployment_id, slug, created_at, updated_at, schema_version
                FROM deployments
                ORDER BY created_at DESC
                `,
              )
              .toArray()
              .map(row => {
                return {
                  deploymentId: row.deployment_id,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
                  schemaVersion: row.schema_version,
                  ...(row.slug === null ? {} : { slug: row.slug }),
                };
              }),
          catch: cause => new RegistrySqlError({ operation: "listDeployments", cause }),
        });

        return RegistryStore.of({
          createDeployment,
          listDeployments,
        });
      }),
    );
  }
}

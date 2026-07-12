import {
  type CatalogIndexDefinitionId,
} from "flarex-protocol/catalog";
import {
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
} from "flarex-protocol/index-definition";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

// @ts-expect-error D2b prepared tokens must remain absent from the package root.
import type { PreparedAppCreationTimeIndexDefinitionV1 as RootPreparedAppCreationTimeIndexDefinitionV1 } from "../src";
import type { FlarexPersistence } from "../src";
import {
  getPreparedAppSchemaCatalogPublicationV2State,
  InvalidPreparedAppSchemaCatalogPublicationV2Error,
  prepareAppSchemaCatalogPublicationV2,
} from "../src/appSchemaCatalogPublicationV2";
import {
  AppCreationTimeIndexDefinitionChecksumCollisionError,
  ensureAppCreationTimeIndexDefinitionV1InTransaction,
  InvalidPreparedAppCreationTimeIndexDefinitionError,
  prepareAppCreationTimeIndexDefinitionsV1,
  type EnsureAppCreationTimeIndexDefinitionV1Result,
  type PreparedAppCreationTimeIndexDefinitionV1,
} from "../src/appIndexDefinitions";
import { createPGlitePersistence } from "../src/pglite";
import {
  applySchemaManifestAppSchemaBindingsV1InTransaction,
} from "../src/schemaManifestAppSchemaBindings";

type PublicD2bMethod = Extract<
  keyof FlarexPersistence,
  | "prepareAppCreationTimeIndexDefinitionsV1"
  | "ensureAppCreationTimeIndexDefinitionV1InTransaction"
>;

type PublicD2bValueExport = Extract<
  keyof typeof import("../src"),
  | "prepareAppCreationTimeIndexDefinitionsV1"
  | "ensureAppCreationTimeIndexDefinitionV1InTransaction"
>;

type PreparedTokenStringKey = Extract<
  keyof PreparedAppCreationTimeIndexDefinitionV1,
  string
>;

describe("table-owned app creation-time index definitions", () => {
  it("keeps the derived row primitive package-internal and identity-only", () => {
    expectTypeOf<PublicD2bMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicD2bValueExport>().toEqualTypeOf<never>();
    expectTypeOf<PreparedTokenStringKey>().toEqualTypeOf<
      "deploymentId" | "tableId"
    >();
    expectTypeOf<
      EnsureAppCreationTimeIndexDefinitionV1Result["definition"]["access"]["kind"]
    >().toEqualTypeOf<"by_creation_time">();
    expectTypeOf<FlarexPersistence>()
      .not.toMatchTypeOf<
        Parameters<
          typeof ensureAppCreationTimeIndexDefinitionV1InTransaction
        >[0]
      >();
  });

  it("derives, creates, and exactly replays the complete intrinsic set", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_exact";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users"), appTable("posts")],
    );
    await applyTablePlan(persistence, fixture.publication);

    expect(Object.isFrozen(fixture.tokens)).toBe(true);
    expect(fixture.tokens.map((token) => token.tableId)).toEqual([1, 2]);
    for (const token of fixture.tokens) {
      expect(Object.isFrozen(token)).toBe(true);
      expect(Object.keys(token).sort()).toEqual(["deploymentId", "tableId"]);
    }

    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
      new Error("D2b must not hash while holding the deployment lock"),
    );
    try {
      const created: EnsureAppCreationTimeIndexDefinitionV1Result[] = [];
      for (const token of fixture.tokens) {
        created.push(await ensurePrepared(persistence, token));
      }
      const replayed: EnsureAppCreationTimeIndexDefinitionV1Result[] = [];
      for (const token of fixture.tokens) {
        replayed.push(await ensurePrepared(persistence, token));
      }

      expect(created.map((result) => result.definitionStatus)).toEqual([
        "created",
        "created",
      ]);
      expect(replayed.map((result) => result.definitionStatus)).toEqual([
        "existing",
        "existing",
      ]);
      expect(created.map((result) => result.definition.indexDefinitionId))
        .toEqual([1, 2]);
      expect(replayed.map((result) => result.definition.indexDefinitionId))
        .toEqual([1, 2]);
      for (const result of [...created, ...replayed]) {
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.definition)).toBe(true);
        expect(result.definition).toMatchObject({
          access: {
            kind: "by_creation_time",
          },
          physicalSpec: {
            accessPath: "by_creation_time",
            orderedFields: [{ kind: "systemCreationTime" }],
          },
        });
      }
    } finally {
      digest.mockRestore();
    }

    await expect(definitionRows(persistence, deploymentId)).resolves.toEqual([
      {
        index_definition_id: 1,
        access_kind: "by_creation_time",
        access_identity_id: 1,
        table_id: 1,
        logical_index_id: null,
      },
      {
        index_definition_id: 2,
        access_kind: "by_creation_time",
        access_identity_id: 2,
        table_id: 2,
        logical_index_id: null,
      },
    ]);
    await expect(nonDefinitionCounts(persistence)).resolves.toEqual({
      schemaBindings: 0,
      buildStates: 0,
    });

    expect(() =>
      Reflect.apply(
        prepareAppCreationTimeIndexDefinitionsV1,
        undefined,
        [{ ...fixture.publication }],
      )
    ).toThrow(InvalidPreparedAppSchemaCatalogPublicationV2Error);
    const forgedToken = { ...requiredToken(fixture.tokens, 0) };
    await expect(
      persistence.drizzle.transaction((tx) =>
        Reflect.apply(
          ensureAppCreationTimeIndexDefinitionV1InTransaction,
          undefined,
          [tx, forgedToken],
        )
      ),
    ).rejects.toBeInstanceOf(
      InvalidPreparedAppCreationTimeIndexDefinitionError,
    );
  });

  it("rejects missing and stale exact table parents before allocation", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_parent";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users")],
    );
    const token = requiredToken(fixture.tokens, 0);

    await expect(ensurePrepared(persistence, token)).rejects.toMatchObject({
      name: "AppCreationTimeIndexDefinitionParentError",
      issue: { reason: "tableNotFound" },
      expectedLogicalName: "users",
    });
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(0);

    await persistence.query(
      `
        insert into fx_control_table
          (deployment_id, table_id, namespace, logical_name)
        values ($1, $2, 'app', 'taken')
      `,
      [deploymentId, token.tableId],
    );
    await expect(ensurePrepared(persistence, token)).rejects.toMatchObject({
      name: "AppCreationTimeIndexDefinitionParentError",
      issue: {
        reason: "tableBindingChanged",
        currentNamespace: "app",
        currentLogicalName: "taken",
      },
      expectedLogicalName: "users",
    });
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(0);
  });

  it("fails closed on equal-digest unequal canonical evidence", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_collision";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users")],
    );
    await applyTablePlan(persistence, fixture.publication);
    const token = requiredToken(fixture.tokens, 0);
    const created = await ensurePrepared(persistence, token);
    const corrupted = canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
      created.definition.physicalSpecBytesHex,
    );
    const firstByte = corrupted[0];
    if (firstByte === undefined) {
      throw new Error("Expected nonempty canonical physical-spec bytes.");
    }
    corrupted[0] = firstByte === 0 ? 1 : 0;
    await persistence.query(
      `
        update fx_control_index_definition
        set physical_spec_bytes = $3
        where deployment_id = $1 and index_definition_id = $2
      `,
      [deploymentId, created.definition.indexDefinitionId, corrupted],
    );

    await expect(ensurePrepared(persistence, token)).rejects.toBeInstanceOf(
      AppCreationTimeIndexDefinitionChecksumCollisionError,
    );
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(1);
  });

  it("rolls allocation back and reuses the deployment-wide next identity", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_rollback";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users"), appTable("posts")],
    );
    await applyTablePlan(persistence, fixture.publication);
    const first = requiredToken(fixture.tokens, 0);
    const second = requiredToken(fixture.tokens, 1);
    await expect(ensurePrepared(persistence, first)).resolves.toMatchObject({
      definitionStatus: "created",
      definition: { indexDefinitionId: 1 },
    });

    let rolledBackId: CatalogIndexDefinitionId | undefined;
    await expect(
      persistence.drizzle.transaction(async (tx) => {
        const result =
          await ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, second);
        rolledBackId = result.definition.indexDefinitionId;
        throw new Error("injected creation-time definition rollback");
      }),
    ).rejects.toThrow("injected creation-time definition rollback");
    if (rolledBackId === undefined) {
      throw new Error("Rollback test did not observe an allocated identity.");
    }
    expect(rolledBackId).toBe(2);
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(1);

    await expect(ensurePrepared(persistence, second)).resolves.toMatchObject({
      definitionStatus: "created",
      definition: { indexDefinitionId: rolledBackId },
    });
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(2);
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPersistence(): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function prepareFixture(
  persistence: PGlitePersistence,
  deploymentId: string,
  tables: ReadonlyArray<SchemaManifestAppTableDeclarationInputV1>,
) {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  const publication = await prepareAppSchemaCatalogPublicationV2(
    persistence.drizzle,
    {
      deploymentId,
      schemaVersionId: CatalogSchemaVersionIdSchema.make(
        `schema_${deploymentId}`,
      ),
      version: CatalogSchemaVersionSchema.make(1),
      tables,
      indexes: [],
    },
  );
  return Object.freeze({
    publication,
    tokens: prepareAppCreationTimeIndexDefinitionsV1(publication),
  });
}

async function applyTablePlan(
  persistence: PGlitePersistence,
  publication: Parameters<
    typeof getPreparedAppSchemaCatalogPublicationV2State
  >[0],
): Promise<void> {
  const state = getPreparedAppSchemaCatalogPublicationV2State(publication);
  await persistence.drizzle.transaction((tx) =>
    applySchemaManifestAppSchemaBindingsV1InTransaction(
      tx,
      state.logicalBindings,
    )
  );
}

function ensurePrepared(
  persistence: PGlitePersistence,
  prepared: PreparedAppCreationTimeIndexDefinitionV1,
) {
  return persistence.drizzle.transaction((tx) =>
    ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, prepared)
  );
}

function requiredToken(
  tokens: ReadonlyArray<PreparedAppCreationTimeIndexDefinitionV1>,
  index: number,
): PreparedAppCreationTimeIndexDefinitionV1 {
  const token = tokens[index];
  if (token === undefined) throw new Error(`Missing token at index ${index}.`);
  return token;
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}

async function definitionRows(
  persistence: PGlitePersistence,
  deploymentId: string,
) {
  const result = await persistence.query<{
    index_definition_id: number;
    access_kind: string;
    access_identity_id: number;
    table_id: number;
    logical_index_id: number | null;
  }>(
    `
      select
        index_definition_id,
        access_kind,
        access_identity_id,
        table_id,
        logical_index_id
      from fx_control_index_definition
      where deployment_id = $1
      order by index_definition_id
    `,
    [deploymentId],
  );
  return result.rows;
}

async function definitionCount(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(
    `
      select count(*)::int as count
      from fx_control_index_definition
      where deployment_id = $1
    `,
    [deploymentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected physical-definition count.");
  return row.count;
}

async function nonDefinitionCounts(
  persistence: PGlitePersistence,
): Promise<{ readonly schemaBindings: number; readonly buildStates: number }> {
  const result = await persistence.query<{
    schema_bindings: number;
    build_states: number;
  }>(
    `
      select
        (select count(*)::int
          from fx_control_schema_version_index_binding) as schema_bindings,
        (select count(*)::int
          from fx_system_index_build_state) as build_states
    `,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected intrinsic side-effect counts.");
  return {
    schemaBindings: row.schema_bindings,
    buildStates: row.build_states,
  };
}

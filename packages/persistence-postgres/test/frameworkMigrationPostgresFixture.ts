import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Schema } from "effect";

import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  makePostgresFrameworkMigrationTargetEffect,
  type MakePostgresFrameworkMigrationTargetInput,
} from "../src/migrationCoordination/postgresTarget";
import { runEffect } from "./effectTestRuntime";
import type { FrameworkMigrationTarget } from "../src/migrationCoordination/targetSession";

interface InstallerFixture {
  readonly pool: Pool;
  readonly provisioning: Pool | undefined;
  readonly role: string;
  readonly ownerRole: string;
  readonly dispose: () => Promise<void>;
}
const installers = new WeakMap<
  PostgresFlarexPersistence,
  Promise<InstallerFixture>
>();
const restartCredentials = new Map<
  string,
  { role: string; password: string }
>();
const decodeOwnerCoordinates = Schema.decodeUnknownSync(
  Schema.Tuple([Schema.Struct({ name: Schema.String, owner: Schema.String })]),
);

/** Test provisioning only. The schema owner retains corruption/setup access;
 * the real migration driver receives a separate authenticated non-owner pool.
 * Both pools address the same catalog; the original Drizzle object remains the
 * target's placement identity, not its execution or settlement capability. */
export async function makePostgresFrameworkMigrationFixtureTarget(
  input: Omit<MakePostgresFrameworkMigrationTargetInput, "persistence"> & {
    readonly persistence: PostgresFlarexPersistence;
  },
): Promise<FrameworkMigrationTarget> {
  let pending = installers.get(input.persistence);
  if (pending === undefined) {
    pending = createInstaller(input.persistence);
    installers.set(input.persistence, pending);
  }
  const installer = await pending;
  const physical = quoteIdentifier(input.physicalLocator.schemaName);
  const role = quoteIdentifier(installer.role);
  // Physical structures, including the reference root, have one owner. A
  // REFERENCES grant on a setup-owned root could execute user casts as that
  // owner during referential-integrity checks.
  await input.persistence.query(
    `grant usage, create on schema ${physical} to ${role}`,
  );
  await ensurePhysicalReferenceRootOwnership(
    input.persistence,
    installer,
    physical,
  );
  // The installer owns its DDL; the fixture's application pool receives data
  // access, not membership in the installer role or ownership of its tables.
  await installer.pool.query(
    `alter default privileges in schema ${physical} grant select, insert, update, delete, truncate, references on tables to ${quoteIdentifier(installer.ownerRole)}`,
  );
  await installer.pool.query(
    `alter default privileges in schema ${physical} grant usage, select on sequences to ${quoteIdentifier(installer.ownerRole)}`,
  );
  return runEffect(
    makePostgresFrameworkMigrationTargetEffect({
      ...input,
      persistence: { drizzle: input.persistence.drizzle, pool: installer.pool },
    }),
  );
}

export async function closeFrameworkMigrationFixture(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const pending = installers.get(persistence);
  if (pending === undefined) return;
  installers.delete(persistence);
  await (await pending).dispose();
}

export function frameworkMigrationRestartEnvironment(schema: string): Readonly<{
  FLAREX_FRAMEWORK_INSTALLER_ROLE: string;
  FLAREX_FRAMEWORK_INSTALLER_PASSWORD: string;
}> {
  const credentials = restartCredentials.get(schema);
  if (credentials === undefined)
    throw new Error("Missing parent installer credentials");
  return {
    FLAREX_FRAMEWORK_INSTALLER_ROLE: credentials.role,
    FLAREX_FRAMEWORK_INSTALLER_PASSWORD: credentials.password,
  };
}

export async function frameworkMigrationFixturePool(
  persistence: PostgresFlarexPersistence,
): Promise<Pool> {
  const installer = await installers.get(persistence);
  if (installer === undefined) throw new Error("Missing fixture installer");
  return installer.pool;
}

export async function assertFrameworkMigrationFixtureIdle(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const installer = await installers.get(persistence);
  if (
    installer !== undefined &&
    (installer.pool.totalCount !== installer.pool.idleCount ||
      installer.pool.waitingCount !== 0)
  ) {
    throw new Error(
      "File-scoped Postgres test left a checked-out or waiting installer pool client.",
    );
  }
}

async function createInstaller(
  owner: PostgresFlarexPersistence,
): Promise<InstallerFixture> {
  const [coordinates] = decodeOwnerCoordinates(
    (
      await owner.query(
        "select current_schema() as name, current_user as owner",
      )
    ).rows,
  );
  const schema = coordinates.name;
  const inherited = process.env.FLAREX_FRAMEWORK_RESTART_SCHEMA === schema;
  const role = inherited
    ? process.env.FLAREX_FRAMEWORK_INSTALLER_ROLE
    : `fx_installer_${randomUUID().replaceAll("-", "")}`;
  const password = inherited
    ? process.env.FLAREX_FRAMEWORK_INSTALLER_PASSWORD
    : randomBytes(24).toString("hex");
  if (role === undefined || password === undefined)
    throw new Error("Missing restart installer credentials");
  const provisioningUrl = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
  if (!inherited && !provisioningUrl)
    throw new Error(
      "Native installer fixtures require FLAREX_POSTGRES_PROVISIONING_DATABASE_URL; owner execution is not a fallback.",
    );
  const admin = inherited
    ? undefined
    : new Pool({ connectionString: provisioningUrl });
  const config = { ...owner.pool.options, user: role, password };
  // Preserve host/port/database from the URL: Pool.options does not expand it.
  // node-postgres gives that URL precedence over individual credential fields.
  if (config.connectionString !== undefined) {
    const url = new URL(config.connectionString);
    url.username = role;
    url.password = password;
    config.connectionString = url.toString();
  }
  const pool = new Pool(config);
  let created = false;
  const dispose = async () => {
    try {
      await pool.end();
    } finally {
      try {
        if (created && admin !== undefined) {
          // Exact disposable role only. All its objects/grants belong to this fixture.
          // Shared Application fixtures retain FKs to their scope-clock root.
          // Return surviving physical objects to setup before removing the role;
          // the fixture's schema teardown remains the sole object-removal owner.
          await admin.query(
            `reassign owned by ${quoteIdentifier(role)} to ${quoteIdentifier(coordinates.owner)}`,
          );
          await admin.query(`drop owned by ${quoteIdentifier(role)} restrict`);
          await admin.query(`drop role ${quoteIdentifier(role)}`);
        }
      } finally {
        await admin?.end();
        restartCredentials.delete(schema);
      }
    }
  };
  try {
    if (admin !== undefined) {
      await admin.query(
        `create role ${quoteIdentifier(role)} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication`,
      );
      created = true;
      await owner.query(
        `grant usage on schema ${quoteIdentifier(schema)} to ${quoteIdentifier(role)}`,
      );
      await grantMetadataOperations(
        owner,
        quoteIdentifier(schema),
        quoteIdentifier(role),
      );
      restartCredentials.set(schema, { role, password });
    }
    return {
      pool,
      provisioning: admin,
      role,
      ownerRole: coordinates.owner,
      dispose,
    };
  } catch (primary) {
    try {
      await dispose();
    } catch (cleanup) {
      throw new AggregateError(
        [primary, cleanup],
        "Installer fixture provisioning and cleanup failed",
      );
    }
    throw primary;
  }
}

async function grantMetadataOperations(
  owner: PostgresFlarexPersistence,
  schema: string,
  role: string,
) {
  const privileges = "select, insert, update, delete, truncate";
  await owner.query(
    `grant ${privileges} on all tables in schema ${schema} to ${role}`,
  );
  await owner.query(
    `grant usage, select on all sequences in schema ${schema} to ${role}`,
  );
  await owner.query(
    `alter default privileges in schema ${schema} grant ${privileges} on tables to ${role}`,
  );
  await owner.query(
    `alter default privileges in schema ${schema} grant usage, select on sequences to ${role}`,
  );
}

async function ensurePhysicalReferenceRootOwnership(
  setup: PostgresFlarexPersistence,
  installer: InstallerFixture,
  physicalSchema: string,
): Promise<void> {
  const root = `${physicalSchema}.fx_system_scope_clock`;
  const owner = (
    await setup.query<{ name: string | null }>(
      "select pg_catalog.pg_get_userbyid(c.relowner) as name from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass($1)",
      [root],
    )
  ).rows[0]?.name;
  if (owner === null || owner === undefined)
    throw new Error("Missing physical scope-clock reference root");
  if (owner !== installer.role) {
    if (installer.provisioning === undefined)
      throw new Error(
        "Restarted installer does not own the physical reference root",
      );
    await installer.provisioning.query(
      `alter table ${root} owner to ${quoteIdentifier(installer.role)}`,
    );
  }
  await installer.pool.query(
    `grant select, insert, update, delete, truncate on ${root} to ${quoteIdentifier(installer.ownerRole)}`,
  );
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

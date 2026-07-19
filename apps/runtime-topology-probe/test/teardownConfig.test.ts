import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  decodeProbeState,
  hyperdriveAbsenceLookupAttempts,
  type ProbeProvisionPhase,
  type ProbeState,
  writeProbeStateAtomically,
} from "../scripts/postgresProbeState";

const packageRoot = new URL("../", import.meta.url);

describe("production teardown configuration", () => {
  it("keeps Postgres recovery state until retry-safe external cleanup completes", () => {
    const provision = readText("scripts/provisionPostgresProbe.ts");
    const teardown = readText("scripts/teardownPostgresProbe.ts");
    const localCleanup = readText("scripts/cleanupLocalProbeSecrets.ts");

    expect(provision).toContain('phase: "planned"');
    expect(provision).toContain('phase: "database-ready"');
    expect(provision).toContain('phase: "hyperdrive-create-attempted"');
    expect(provision).toContain('phase: "ready"');
    expect(teardown).toContain("hyperdriveDeleted: true");
    expect(teardown).toContain("DROP SCHEMA IF EXISTS");
    expect(teardown).toContain("DROP ROLE IF EXISTS");
    expect(teardown).toContain("findHyperdriveIdWithAbsenceProof");
    expect(teardown).toContain("readRuntimeConfigHyperdriveId");
    expect(localCleanup).not.toContain("p28-postgres.json");
  });

  it("decodes every recoverable provision phase and requires an id when ready", () => {
    for (const phase of [
      "planned",
      "database-ready",
      "hyperdrive-create-attempted",
    ] satisfies ReadonlyArray<ProbeProvisionPhase>) {
      expect(decodeProbeState(probeState(phase))).toMatchObject({
        phase,
        hyperdriveId: null,
      });
    }

    expect(() => decodeProbeState(probeState("ready"))).toThrow(
      "Incomplete P28 Postgres state.",
    );
    expect(decodeProbeState({
      ...probeState("ready"),
      hyperdriveId: "0123456789abcdef0123456789abcdef",
    })).toMatchObject({
      phase: "ready",
      hyperdriveId: "0123456789abcdef0123456789abcdef",
    });
  });

  it("strengthens absence proof after an attempted Hyperdrive create", () => {
    expect(hyperdriveAbsenceLookupAttempts("planned")).toBe(1);
    expect(hyperdriveAbsenceLookupAttempts("database-ready")).toBe(1);
    expect(hyperdriveAbsenceLookupAttempts("hyperdrive-create-attempted"))
      .toBe(3);
    expect(hyperdriveAbsenceLookupAttempts("ready")).toBe(1);
  });

  it("retains the last valid recovery state when atomic publication fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flarex-probe-state-"));
    const stateUrl = pathToFileURL(join(directory, "p28-postgres.json"));
    try {
      const planned = probeState("planned");
      await writeProbeStateAtomically(stateUrl, planned);
      await expect(
        writeProbeStateAtomically(
          stateUrl,
          {
            ...probeState("ready"),
            hyperdriveId: "0123456789abcdef0123456789abcdef",
          },
          {
            publish: async () => {
              throw new Error("injected publication failure");
            },
          },
        ),
      ).rejects.toThrow("injected publication failure");

      expect(
        decodeProbeState(JSON.parse(await readFile(stateUrl, "utf8"))),
      ).toEqual(planned);
      expect(await readdir(directory)).toEqual(["p28-postgres.json"]);

      await expect(
        writeProbeStateAtomically(
          stateUrl,
          {
            ...probeState("ready"),
            hyperdriveId: "0123456789abcdef0123456789abcdef",
          },
          {
            prepare: async (handle, contents) => {
              await handle.writeFile(contents.slice(0, 16), "utf8");
              throw new Error("injected preparation failure");
            },
          },
        ),
      ).rejects.toThrow("injected preparation failure");
      expect(
        decodeProbeState(JSON.parse(await readFile(stateUrl, "utf8"))),
      ).toEqual(planned);
      expect(await readdir(directory)).toEqual(["p28-postgres.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("removes every gateway binding before deleting its Durable Object classes", () => {
    expect(readJson("wrangler.gateway.teardown.jsonc")).toStrictEqual({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "flarex-runtime-topology-probe-gateway",
      main: "src/teardownWorker.ts",
      compatibility_date: "2026-06-14",
      workers_dev: false,
      preview_urls: false,
      migrations: [
        {
          tag: "v1",
          new_sqlite_classes: ["ProbeSessionDO"],
        },
        {
          tag: "v2",
          new_sqlite_classes: ["ProbeRunDO"],
        },
        {
          tag: "v3",
          new_sqlite_classes: ["ProbeCampaignDO"],
        },
        {
          tag: "v4-delete-probe-state",
          deleted_classes: [
            "ProbeSessionDO",
            "ProbeRunDO",
            "ProbeCampaignDO",
          ],
        },
      ],
    });
  });

  it("removes the sync binding before deleting its Durable Object class", () => {
    expect(readJson("wrangler.sync.teardown.jsonc")).toStrictEqual({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "flarex-runtime-topology-probe-sync",
      main: "src/teardownWorker.ts",
      compatibility_date: "2026-06-14",
      workers_dev: false,
      preview_urls: false,
      migrations: [
        {
          tag: "v1",
          new_sqlite_classes: ["ProbeSyncDO"],
        },
        {
          tag: "v2-delete-probe-state",
          deleted_classes: ["ProbeSyncDO"],
        },
      ],
    });
  });

  it("tracks every production migration and Durable Object binding", () => {
    expectTeardownTracksProduction(
      "wrangler.gateway.jsonc",
      "wrangler.gateway.teardown.jsonc",
    );
    expectTeardownTracksProduction(
      "wrangler.sync.jsonc",
      "wrangler.sync.teardown.jsonc",
    );
  });

  it("exposes the intentional teardown package scripts", () => {
    const scripts = readStringRecordProperty(
      readJson("package.json"),
      "scripts",
    );
    const teardownScripts = Object.entries(scripts)
      .filter(([name]) => name.includes("teardown"))
      .sort(([left], [right]) => compareUtf16Strings(left, right));

    expect(teardownScripts).toStrictEqual([
      [
        "deploy:gateway:teardown:dry-run",
        "tsx scripts/runWranglerDryRun.ts gateway-teardown",
      ],
      [
        "deploy:sync:teardown:dry-run",
        "tsx scripts/runWranglerDryRun.ts sync-teardown",
      ],
      [
        "postgres:teardown",
        "tsx scripts/teardownPostgresProbe.ts",
      ],
      [
        "teardown:gateway:delete:dry-run",
        "wrangler delete --dry-run --config wrangler.gateway.teardown.jsonc",
      ],
      [
        "teardown:mock:delete:dry-run",
        "wrangler delete --dry-run --config wrangler.mock.jsonc",
      ],
      [
        "teardown:postgres:delete:dry-run",
        "wrangler delete --dry-run --config wrangler.postgres.jsonc",
      ],
      [
        "teardown:sync:delete:dry-run",
        "wrangler delete --dry-run --config wrangler.sync.teardown.jsonc",
      ],
    ]);
  });
});

function readJson(path: string): unknown {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(path, packageRoot), "utf8"),
  );
  return parsed;
}

function probeState(phase: ProbeProvisionPhase): ProbeState {
  return {
    protocolVersion: 1,
    phase,
    schemaName: "flarex_runtime_topology_probe_p28",
    roleName: "flarex_runtime_topology_probe_p28_role",
    rolePassword: "0123456789abcdef",
    directHost: "example.invalid",
    database: "probe",
    port: 5432,
    hyperdriveId: null,
    hyperdriveName: "flarex-runtime-topology-probe-p28-0123456789",
    hyperdriveDeleted: false,
  };
}

function readText(path: string): string {
  return readFileSync(new URL(path, packageRoot), "utf8");
}

function expectTeardownTracksProduction(
  productionPath: string,
  teardownPath: string,
): void {
  const production = readRecord(productionPath);
  const teardown = readRecord(teardownPath);
  const productionMigrations = readRecordArrayProperty(
    production,
    "migrations",
  );
  const teardownMigrations = readRecordArrayProperty(teardown, "migrations");
  const deleteMigration = lastRecord(teardownMigrations, "migrations");

  expect(readStringProperty(teardown, "name")).toBe(
    readStringProperty(production, "name"),
  );
  expect(readStringProperty(teardown, "compatibility_date")).toBe(
    readStringProperty(production, "compatibility_date"),
  );
  expect(teardownMigrations.slice(0, -1)).toStrictEqual(productionMigrations);
  expect(
    [...readStringArrayProperty(deleteMigration, "deleted_classes")].sort(),
  ).toStrictEqual(readDurableObjectClassNames(production));
}

function readRecord(path: string): UnknownRecord {
  const value = readJson(path);
  if (!isNonArrayRecord(value)) {
    throw new Error(`Expected ${path} to contain a JSON object`);
  }
  return value;
}

function readDurableObjectClassNames(
  config: UnknownRecord,
): ReadonlyArray<string> {
  const durableObjects = readRecordProperty(config, "durable_objects");
  return readRecordArrayProperty(durableObjects, "bindings")
    .filter(binding => binding.script_name === undefined)
    .map(binding => readStringProperty(binding, "class_name"))
    .sort();
}

function readRecordProperty(
  value: UnknownRecord,
  property: string,
): UnknownRecord {
  const entry = value[property];
  if (!isNonArrayRecord(entry)) {
    throw new Error(`Expected ${property} to be an object`);
  }
  return entry;
}

function readRecordArrayProperty(
  value: UnknownRecord,
  property: string,
): ReadonlyArray<UnknownRecord> {
  const entries = value[property];
  if (!Array.isArray(entries)) {
    throw new Error(`Expected ${property} to be an array of objects`);
  }

  const records: Array<UnknownRecord> = [];
  for (const entry of entries) {
    const candidate: unknown = entry;
    if (!isNonArrayRecord(candidate)) {
      throw new Error(`Expected ${property} to be an array of objects`);
    }
    records.push(candidate);
  }
  return records;
}

function readStringArrayProperty(
  value: UnknownRecord,
  property: string,
): ReadonlyArray<string> {
  const entries = value[property];
  if (!Array.isArray(entries)) {
    throw new Error(`Expected ${property} to be an array of strings`);
  }

  const strings: Array<string> = [];
  for (const entry of entries) {
    const candidate: unknown = entry;
    if (!isString(candidate)) {
      throw new Error(`Expected ${property} to be an array of strings`);
    }
    strings.push(candidate);
  }
  return strings;
}

function readStringProperty(
  value: UnknownRecord,
  property: string,
): string {
  const entry = value[property];
  if (typeof entry !== "string") {
    throw new Error(`Expected ${property} to be a string`);
  }
  return entry;
}

function lastRecord(
  values: ReadonlyArray<UnknownRecord>,
  label: string,
): UnknownRecord {
  const value = values[values.length - 1];
  if (value === undefined) {
    throw new Error(`Expected ${label} to contain at least one object`);
  }
  return value;
}

function readStringRecordProperty(
  value: unknown,
  property: string,
): Readonly<Record<string, string>> {
  if (!isNonArrayRecord(value) || !isNonArrayRecord(value[property])) {
    throw new Error(`Expected ${property} to be an object`);
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value[property])) {
    if (typeof entry !== "string") {
      throw new Error(`Expected ${property}.${key} to be a string`);
    }
    result[key] = entry;
  }
  return result;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

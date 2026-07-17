import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const packageRoot = new URL("../", import.meta.url);

describe("production teardown configuration", () => {
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

  it("exposes only non-mutating teardown package scripts", () => {
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
        "teardown:gateway:delete:dry-run",
        "wrangler delete --dry-run --config wrangler.gateway.teardown.jsonc",
      ],
      [
        "teardown:mock:delete:dry-run",
        "wrangler delete --dry-run --config wrangler.mock.jsonc",
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

import { describe, expect, it } from "vitest";
import {
  initializeDeploymentStorage,
  type DeploymentSchemaSql,
} from "../src/deployment/StorageSchema";

describe("deployment storage schema initialization", () => {
  it("creates deployment tables, applies additive migrations, and seeds schema version", () => {
    const sql = new RecordingSql();

    initializeDeploymentStorage(sql);

    expect(sql.calls[0]?.statement).toContain("CREATE TABLE IF NOT EXISTS meta");
    expect(sql.calls[0]?.statement).toContain("CREATE TABLE IF NOT EXISTS pushes");
    expect(sql.calls[0]?.statement).toContain(
      "CREATE TABLE IF NOT EXISTS source_artifact_upload_attempts_v2",
    );
    expect(sql.calls.slice(1, 6).map(call => call.statement)).toEqual([
      "ALTER TABLE functions ADD COLUMN position_json TEXT",
      "ALTER TABLE functions ADD COLUMN route_json TEXT",
      "ALTER TABLE functions ADD COLUMN partition_json TEXT",
      "ALTER TABLE pushes ADD COLUMN codegen_analysis_json TEXT",
      "ALTER TABLE pushes ADD COLUMN diagnostics_json TEXT",
    ]);
    expect(sql.calls[6]).toEqual({
      statement: "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
      bindings: ["schema_version", "0"],
    });
    expect(sql.calls[7]).toEqual({
      statement: "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
      bindings: ["source_artifact_upload_v2_schema_version", "1"],
    });
  });

  it("continues initialization when additive migration columns already exist", () => {
    const sql = new RecordingSql({ failAlterStatements: true });

    initializeDeploymentStorage(sql);

    expect(sql.calls.filter(call => call.statement.startsWith("ALTER TABLE"))).toHaveLength(5);
    expect(sql.calls.at(-2)).toEqual({
      statement: "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
      bindings: ["schema_version", "0"],
    });
    expect(sql.calls.at(-1)).toEqual({
      statement: "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
      bindings: ["source_artifact_upload_v2_schema_version", "1"],
    });
  });
});

type Binding = string | number | null;

interface RecordingSqlOptions {
  readonly failAlterStatements?: boolean;
}

class RecordingSql implements DeploymentSchemaSql {
  readonly calls: Array<{
    readonly statement: string;
    readonly bindings: readonly Binding[];
  }> = [];

  constructor(private readonly options: RecordingSqlOptions = {}) {}

  exec(statement: string, ...bindings: Binding[]): unknown {
    this.calls.push({ statement, bindings });
    if (this.options.failAlterStatements === true && statement.startsWith("ALTER TABLE")) {
      throw new Error(`column already exists: ${statement}`);
    }
    return {};
  }
}

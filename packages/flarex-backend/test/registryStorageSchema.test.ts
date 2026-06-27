import { describe, expect, it } from "vitest";
import {
  initializeRegistryStorage,
  type RegistrySchemaSql,
} from "../src/registry/StorageSchema";

describe("registry storage schema initialization", () => {
  it("creates the deployments table and slug index", () => {
    const sql = new RecordingSql();

    initializeRegistryStorage(sql);

    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.statement).toContain("CREATE TABLE IF NOT EXISTS deployments");
    expect(sql.calls[0]?.statement).toContain("deployment_id TEXT PRIMARY KEY");
    expect(sql.calls[0]?.statement).toContain("slug TEXT UNIQUE");
    expect(sql.calls[0]?.statement).toContain("schema_version INTEGER NOT NULL");
    expect(sql.calls[0]?.statement).toContain("CREATE INDEX IF NOT EXISTS deployments_by_slug");
    expect(sql.calls[0]?.bindings).toEqual([]);
  });
});

type Binding = string | number | null;

class RecordingSql implements RegistrySchemaSql {
  readonly calls: Array<{
    readonly statement: string;
    readonly bindings: readonly Binding[];
  }> = [];

  exec(statement: string, ...bindings: Binding[]): unknown {
    this.calls.push({ statement, bindings });
    return {};
  }
}

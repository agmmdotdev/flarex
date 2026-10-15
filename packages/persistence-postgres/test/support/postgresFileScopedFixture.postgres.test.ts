import { describe, expect } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { registerFileScopedPersistenceTests } from "./fileScopedPersistenceScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgresPersistence = useFileScopedPostgresPersistence();

describePostgres("file-scoped Postgres test fixture", () => {
  registerFileScopedPersistenceTests(withPostgresPersistence, (previous, current) => {
    expect(current).toBe(previous);
  });
});

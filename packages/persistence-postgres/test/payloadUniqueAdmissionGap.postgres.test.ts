import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { payloadUniqueAdmissionCases, payloadUniqueAdmissionGapScenario } from "./payloadUniqueAdmissionGapScenario";

describe.skipIf(postgresUrl === null)("Payload unique admission (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it.each(payloadUniqueAdmissionCases)("checks unique admission: %s", mode =>
    withPersistence(async persistence => {
      expect((await persistence.query<{ superuser: boolean }>(
        "select rolsuper as superuser from pg_roles where rolname=current_user",
      )).rows[0]?.superuser).toBe(false);
      await payloadUniqueAdmissionGapScenario(persistence, mode);
    }), 180_000);
});

import { describe } from "vitest";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { registerCorePayloadNativeDurability } from "./core-payload-native-durability-scenarios";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("five-table native Payload durability (ordinary PostgreSQL)", () => {
  registerCorePayloadNativeDurability("postgres");
});

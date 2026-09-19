import { Socket } from "node:net";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { flarexSchema } from "../src/schema";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { verifyBoundedCurrentCapture } from "./boundedCurrentCaptureScenario";

describe.skipIf(postgresUrl === null)(
  "bounded current capture transport",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "withholds rejected bodies from the ordinary-role PostgreSQL client",
      () =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname=current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          const client = await persistence.pool.connect();
          try {
            if (
              !(client instanceof Client) ||
              !(client.connection.stream instanceof Socket)
            )
              throw new Error("Expected local pg socket transport");
            const socket = client.connection.stream;
            await verifyBoundedCurrentCapture(
              drizzle(client, { schema: flarexSchema }),
              async (kind, run) => {
                const before = socket.bytesRead;
                await run();
                const received = socket.bytesRead - before;
                // Success transfers the 80KB body. Every budget rejection must return
                // only bounded metadata, including the all-or-nothing aggregate case.
                if (kind === "accepted")
                  expect(received).toBeGreaterThan(80_000);
                else expect(received).toBeLessThan(16_384);
              },
            );
          } finally {
            client.release();
          }
          expect(persistence.pool.waitingCount).toBe(0);
          expect(persistence.pool.totalCount).toBe(persistence.pool.idleCount);
        }),
      120_000,
    );
  },
);

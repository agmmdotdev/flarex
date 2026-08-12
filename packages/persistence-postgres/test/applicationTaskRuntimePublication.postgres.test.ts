import { webcrypto } from "node:crypto";
import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeApplicationTaskRuntimePublicationRepository,
} from "../src/applicationTaskRuntimePublication";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  makeCompetingTaskRuntimePublication,
  makeTaskRuntimePublicationFixtureOnDatabase,
} from "./applicationTaskRuntimePublicationTestSupport";
import {
  insertSessionTestScope,
} from "./sessionAuthorityTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describePostgres("Application task-runtime publication - PostgreSQL", () => {
  it("converges identical two-connection publication", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await insertSessionTestScope(persistence);
      const fixture = await makeTaskRuntimePublicationFixtureOnDatabase(
        persistence.drizzle,
      );
      const repository = makeApplicationTaskRuntimePublicationRepository(
        persistence.drizzle,
        fixture.receiptAuthority,
      );
      const outcomes = await Promise.all([
        runEffect(repository.publish({ authority: fixture.authority, publication: fixture.publication })),
        runEffect(repository.publish({ authority: fixture.authority, publication: fixture.publication })),
      ]);
      expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual([
        "published",
        "replayed",
      ]);
      expect((await counts(persistence)).headers).toBe("1");
    });
  });

  it("serializes different receipts to one exact winner", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await insertSessionTestScope(persistence);
      const fixture = await makeTaskRuntimePublicationFixtureOnDatabase(
        persistence.drizzle,
      );
      const competing = await makeCompetingTaskRuntimePublication(
        fixture.publication,
      );
      const repository = makeApplicationTaskRuntimePublicationRepository(
        persistence.drizzle,
        fixture.receiptAuthority,
      );
      const outcomes = await Promise.all([
        runEffect(Effect.result(repository.publish({ authority: fixture.authority, publication: fixture.publication }))),
        runEffect(Effect.result(repository.publish({ authority: fixture.authority, publication: competing }))),
      ]);
      expect(outcomes.filter(Result.isSuccess)).toHaveLength(1);
      const failures = outcomes.filter(Result.isFailure);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.failure.reason).toBe("conflictingReplay");
    });
  });

  it("rolls back a header when a later membership insert fails", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await insertSessionTestScope(persistence);
      const fixture = await makeTaskRuntimePublicationFixtureOnDatabase(
        persistence.drizzle,
      );
      await persistence.query(`
        alter table fx_system_application_task_runtime_object_v1
        add constraint test_force_runtime_object_failure check (false) not valid
      `);
      const outcome = await runEffect(Effect.result(
        makeApplicationTaskRuntimePublicationRepository(
          persistence.drizzle,
          fixture.receiptAuthority,
        ).publish({
          authority: fixture.authority,
          publication: fixture.publication,
        }),
      ));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) {
        expect(outcome.failure.reason).toBe("resourceFailure");
      }
      expect(await counts(persistence)).toEqual({ headers: "0", objects: "0" });
    });
  });

  it("keeps a committed hidden response uncertain and cold-replays it", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await insertSessionTestScope(persistence);
      const fixture = await makeTaskRuntimePublicationFixtureOnDatabase(
        persistence.drizzle,
      );
      const uncertainDb = Object.create(
        persistence.drizzle,
      ) as FlarexMetadataDatabase;
      const transaction = persistence.drizzle.transaction.bind(
        persistence.drizzle,
      );
      Object.defineProperty(uncertainDb, "transaction", {
        configurable: true,
        value: async (callback: Parameters<typeof transaction>[0]) => {
          await transaction(callback);
          throw Object.assign(new Error("hidden committed response"), {
            code: "08007",
          });
        },
      });
      const uncertain = await runEffect(Effect.result(
        makeApplicationTaskRuntimePublicationRepository(
          uncertainDb,
          fixture.receiptAuthority,
        ).publish({
          authority: fixture.authority,
          publication: fixture.publication,
        }),
      ));
      expect(Result.isFailure(uncertain)).toBe(true);
      if (Result.isFailure(uncertain)) {
        expect(uncertain.failure).toMatchObject({
          reason: "settlementUncertain",
          retryable: true,
        });
      }
      const replay = await runEffect(
        makeApplicationTaskRuntimePublicationRepository(
          persistence.drizzle,
          fixture.receiptAuthority,
        ).publish({
          authority: fixture.authority,
          publication: fixture.publication,
        }),
      );
      expect(replay.disposition).toBe("replayed");
      expect(await counts(persistence)).toEqual({ headers: "1", objects: "7" });
    });
  });
});

async function counts(persistence: PostgresFlarexPersistence) {
  const result = await persistence.query(`
    select
      (select count(*)::text from fx_system_application_task_runtime_publication_v1) as headers,
      (select count(*)::text from fx_system_application_task_runtime_object_v1) as objects
  `);
  const row = result.rows[0];
  if (row === undefined || typeof row.headers !== "string" ||
    typeof row.objects !== "string") {
    throw new Error("Expected publication counts.");
  }
  return Object.freeze({ headers: row.headers, objects: row.objects });
}

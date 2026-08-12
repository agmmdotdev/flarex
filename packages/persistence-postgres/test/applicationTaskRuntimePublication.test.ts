import { webcrypto } from "node:crypto";
import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import {
  makeLiveStandardApplicationTaskSha256V1,
  makeTaskRuntimePublicationReceiptAuthorityV1,
} from
  "@flarex/standard-application-definition/internal/task-definition-v1";

import {
  makeApplicationTaskRuntimePublicationRepository,
} from "../src/applicationTaskRuntimePublication";
import { runEffect } from "./effectTestRuntime";
import {
  makeTaskRuntimePublicationFixture,
  makeCompetingTaskRuntimePublication,
} from "./applicationTaskRuntimePublicationTestSupport";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application task-runtime publication", () => {
  it("publishes a populated receipt and cold-replays it exactly", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    const repository = makeApplicationTaskRuntimePublicationRepository(
      fixture.db,
      fixture.receiptAuthority,
    );
    const first = await runEffect(repository.publish({
      authority: fixture.authority,
      publication: fixture.publication,
    }));
    const replay = await runEffect(
      makeApplicationTaskRuntimePublicationRepository(
        fixture.db,
        fixture.receiptAuthority,
      ).publish({
        authority: fixture.authority,
        publication: fixture.publication,
      }),
    );

    expect(first.disposition).toBe("published");
    expect(replay.disposition).toBe("replayed");
    expect(replay.receiptSha256).toBe(first.receiptSha256);
    expect(replay.readReceipt()).toEqual(first.readReceipt());
    expect(await counts(fixture.persistence)).toEqual({ headers: "1", objects: "7" });
  });

  it("persists an explicit empty receipt without child rows", async () => {
    const fixture = await makeTaskRuntimePublicationFixture(true);
    const result = await runEffect(
      makeApplicationTaskRuntimePublicationRepository(
        fixture.db,
        fixture.receiptAuthority,
      ).publish({
        authority: fixture.authority,
        publication: fixture.publication,
      }),
    );
    expect(result).toMatchObject({ disposition: "published", objectCount: 0 });
    expect(await counts(fixture.persistence)).toEqual({ headers: "1", objects: "0" });
  });

  it("converges exact concurrent publishers", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    const repository = makeApplicationTaskRuntimePublicationRepository(
      fixture.db,
      fixture.receiptAuthority,
    );
    const outcomes = await Promise.all([
      runEffect(repository.publish({ authority: fixture.authority, publication: fixture.publication })),
      runEffect(repository.publish({ authority: fixture.authority, publication: fixture.publication })),
    ]);
    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(["published", "replayed"]);
    expect(await counts(fixture.persistence)).toEqual({ headers: "1", objects: "7" });
  });

  it("serializes competing publications to one winner", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    const competing = await makeCompetingTaskRuntimePublication(
      fixture.publication,
    );
    const repository = makeApplicationTaskRuntimePublicationRepository(
      fixture.db,
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

  it("fails closed on stored membership corruption", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    const repository = makeApplicationTaskRuntimePublicationRepository(
      fixture.db,
      fixture.receiptAuthority,
    );
    await runEffect(repository.publish({ authority: fixture.authority, publication: fixture.publication }));
    await fixture.persistence.query(`
      alter table fx_system_application_task_runtime_object_v1
      drop constraint fx_application_task_runtime_obj_v1_shape_check
    `);
    await fixture.persistence.query(`
      update fx_system_application_task_runtime_object_v1
      set codec_identity = 'corrupt'
      where role = 'task_runtime_entry'
    `);
    const replay = await runEffect(Effect.result(repository.publish({
      authority: fixture.authority,
      publication: fixture.publication,
    })));
    expect(Result.isFailure(replay)).toBe(true);
    if (Result.isFailure(replay)) expect(replay.failure.reason).toBe("storedState");
  });

  it("rolls back the header when membership insertion fails", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    await fixture.persistence.query(`
      alter table fx_system_application_task_runtime_object_v1
      add constraint test_force_runtime_object_failure check (false) not valid
    `);
    const outcome = await runEffect(Effect.result(
      makeApplicationTaskRuntimePublicationRepository(
        fixture.db,
        fixture.receiptAuthority,
      ).publish({
        authority: fixture.authority,
        publication: fixture.publication,
      }),
    ));
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) expect(outcome.failure.reason).toBe("resourceFailure");
    expect(await counts(fixture.persistence)).toEqual({ headers: "0", objects: "0" });
  });

  it("rejects a current scope authority when the catalog candidate is stale", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    await fixture.persistence.query(`
      update fx_system_scope_clock
      set storage_generation_fence = 2
      where scope_id = '${fixture.authority.scopeId}'
    `);
    const outcome = await runEffect(Effect.result(
      makeApplicationTaskRuntimePublicationRepository(
        fixture.db,
        fixture.receiptAuthority,
      ).publish({
        authority: Object.freeze({
          ...fixture.authority,
          storageGenerationFence: StorageGenerationFenceSchema.make(2n),
        }),
        publication: fixture.publication,
      }),
    ));
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure.reason).toBe("authorityChanged");
    }
    expect(await counts(fixture.persistence)).toEqual({ headers: "0", objects: "0" });
  });

  it("rejects a receipt prepared by a different composition authority", async () => {
    const fixture = await makeTaskRuntimePublicationFixture();
    const foreign = makeTaskRuntimePublicationReceiptAuthorityV1(
      makeLiveStandardApplicationTaskSha256V1(),
    );
    const outcome = await runEffect(Effect.result(
      makeApplicationTaskRuntimePublicationRepository(
        fixture.db,
        foreign,
      ).publish({
        authority: fixture.authority,
        publication: fixture.publication,
      }),
    ));
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) {
      expect(outcome.failure.reason).toBe("invalidInput");
    }
    expect(await counts(fixture.persistence)).toEqual({ headers: "0", objects: "0" });
  });
});

async function counts(persistence: Awaited<ReturnType<typeof makeTaskRuntimePublicationFixture>>["persistence"]) {
  const result = await persistence.query<{ headers: string; objects: string }>(`
    select
      (select count(*)::text from fx_system_application_task_runtime_publication_v1) as headers,
      (select count(*)::text from fx_system_application_task_runtime_object_v1) as objects
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected publication counts.");
  return row;
}

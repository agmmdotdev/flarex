import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";

describe("DTE05-E2A Task repair scheduler schema", () => {
  it("migrates idempotently to exactly one inert idle row", async () => {
    const db = new PGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      await persistence.migrate();

      const result = await persistence.query<{
        scheduler_key: string;
        scheduler_state: string;
        run_fence: string;
        checkpoint_sequence: string;
        run_owner: string | null;
        claimed_at: Date | null;
        claim_expires_at: Date | null;
        continuation_codec_version: number | null;
        continuation_bytes: Uint8Array | null;
        continuation_sha256: Uint8Array | null;
      }>(`
        select
          scheduler_key,
          scheduler_state,
          run_fence::text as run_fence,
          checkpoint_sequence::text as checkpoint_sequence,
          run_owner,
          claimed_at,
          claim_expires_at,
          continuation_codec_version,
          continuation_bytes,
          continuation_sha256
        from fx_system_durable_task_repair_scheduler_v1
      `);

      expect(result.rows).toEqual([{
        scheduler_key: "durable_task_repair_v1",
        scheduler_state: "idle",
        run_fence: "0",
        checkpoint_sequence: "0",
        run_owner: null,
        claimed_at: null,
        claim_expires_at: null,
        continuation_codec_version: null,
        continuation_bytes: null,
        continuation_sha256: null,
      }]);
    } finally {
      await db.close();
    }
  });

  it("accepts one complete claimed checkpoint shape", async () => {
    const db = new PGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      await expect(persistence.query(`
        update fx_system_durable_task_repair_scheduler_v1
        set
          scheduler_state = 'claimed',
          run_fence = 1,
          checkpoint_sequence = 2,
          run_owner = '93000000-0000-4000-8000-000000000001',
          claimed_at = '2026-08-09T00:00:00.000Z',
          claim_expires_at = '2026-08-09T00:01:00.000Z',
          continuation_codec_version = 1,
          continuation_bytes = decode('7b7d', 'hex'),
          continuation_sha256 = decode(repeat('00', 32), 'hex'),
          updated_at = now()
        where scheduler_key = 'durable_task_repair_v1'
      `)).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("rejects invalid key, fence, claim, continuation, and timestamp shapes", async () => {
    const invalidStatements = [
      `insert into fx_system_durable_task_repair_scheduler_v1
        (scheduler_key, scheduler_state, run_fence, checkpoint_sequence)
       values ('wrong', 'idle', 0, 0)`,
      `update fx_system_durable_task_repair_scheduler_v1
       set scheduler_state = 'broken'`,
      `update fx_system_durable_task_repair_scheduler_v1 set run_fence = -1`,
      `update fx_system_durable_task_repair_scheduler_v1
       set checkpoint_sequence = -1`,
      `update fx_system_durable_task_repair_scheduler_v1
       set scheduler_state = 'claimed'`,
      `update fx_system_durable_task_repair_scheduler_v1
       set scheduler_state = 'claimed',
           run_owner = '93000000-0000-4000-8000-000000000001',
           claimed_at = '2026-08-09T00:00:00.000Z',
           claim_expires_at = '2026-08-09T00:00:00.000Z'`,
      `update fx_system_durable_task_repair_scheduler_v1
       set continuation_codec_version = 1`,
      `update fx_system_durable_task_repair_scheduler_v1
       set continuation_codec_version = 2,
           continuation_bytes = decode('7b7d', 'hex'),
           continuation_sha256 = decode(repeat('00', 32), 'hex')`,
      `update fx_system_durable_task_repair_scheduler_v1
       set continuation_codec_version = 1,
           continuation_bytes = decode('', 'hex'),
           continuation_sha256 = decode(repeat('00', 32), 'hex')`,
      `update fx_system_durable_task_repair_scheduler_v1
       set continuation_codec_version = 1,
           continuation_bytes = decode(repeat('00', 4194305), 'hex'),
           continuation_sha256 = decode(repeat('00', 32), 'hex')`,
      `update fx_system_durable_task_repair_scheduler_v1
       set continuation_codec_version = 1,
           continuation_bytes = decode('7b7d', 'hex'),
           continuation_sha256 = decode('00', 'hex')`,
      `update fx_system_durable_task_repair_scheduler_v1
       set next_run_at = 'infinity'::timestamptz`,
      `update fx_system_durable_task_repair_scheduler_v1
       set updated_at = created_at - interval '1 millisecond'`,
    ];

    for (const statement of invalidStatements) {
      const db = new PGlite();
      const persistence = await createPGlitePersistence({ db });
      try {
        await persistence.migrate();
        await expect(persistence.query(statement)).rejects.toThrow();
      } finally {
        await db.close();
      }
    }
  });
});

import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { createPostgresPersistence } from "../src/postgres";
import {
  captureBindingValue,
  isDataBindingSetFrame,
  isDataBindingActivationRequest,
} from "../src/frameworkSchema/binding/canonical";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import {
  reopenBindingHost,
  loseBindingCommitResponse,
} from "./frameworkDataBindingPostgresTestSupport";
import { runEffect } from "./effectTestRuntime";

describe.skipIf(process.env.FLAREX_BINDING_RESTART_MODE === undefined)(
  "binding OS-process restart worker",
  () => {
    it("reconstructs every owner and recovers the exact committed request", async () => {
      const controlSchema = process.env.FLAREX_BINDING_CONTROL_SCHEMA;
      const targetSchema = process.env.FLAREX_BINDING_TARGET_SCHEMA;
      const connectionString = process.env.FLAREX_POSTGRES_DATABASE_URL;
      if (
        controlSchema === undefined ||
        targetSchema === undefined ||
        connectionString === undefined ||
        !/^[a-z0-9_]+$/.test(controlSchema) ||
        !/^[a-z0-9_]+$/.test(targetSchema)
      )
        throw new Error("Invalid binding restart coordinates");
      const frame = (
        await runEffect(
          captureBindingValue(
            JSON.parse(process.env.FLAREX_BINDING_RESTART_FRAME ?? "null"),
            isDataBindingSetFrame,
          ),
        )
      ).frame;
      const request = (
        await runEffect(
          captureBindingValue(
            JSON.parse(process.env.FLAREX_BINDING_RESTART_REQUEST ?? "null"),
            isDataBindingActivationRequest,
          ),
        )
      ).frame;
      const control = await createPostgresPersistence({
        connectionString,
        poolConfig: {
          options: `-c search_path=${controlSchema}`,
          application_name: controlSchema,
        },
      });
      const target = await createPostgresPersistence({
        connectionString,
        poolConfig: {
          options: `-c search_path=${targetSchema}`,
          application_name: targetSchema,
        },
      });
      let armed = false;
      try {
        const host = await reopenBindingHost(
          control,
          target,
          frame,
          process.env.FLAREX_BINDING_RESTART_MODE === "commit-exit"
            ? {
                afterAcquire: (client) =>
                  loseBindingCommitResponse(
                    client,
                    () => armed,
                    () => process.exit(73),
                  ),
              }
            : {},
          () =>
            Effect.sync(() => {
              armed = true;
            }),
        );
        const recovered = await runEffect(host.recover(request));
        expect(Result.getOrThrow(recovered.current).selected).toBe(true);
        expect(recovered.receipt.frame.request).toEqual(request);
        expect(
          (await runEffect(host.withCurrent(readAdmittedDataBinding))).frame,
        ).toEqual(frame);
        if (process.env.FLAREX_BINDING_RESTART_MODE === "commit-exit")
          throw new Error("COMMIT exit fault was not reached");
      } finally {
        await target.close();
        await control.close();
      }
    }, 60_000);
  },
);

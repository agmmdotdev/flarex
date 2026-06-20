import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "@flarex/executor";
import { createFlarexNitroHandler } from "@flarex/executor-nitro";
import { createPGlitePersistence } from "@flarex/persistence-postgres/pglite";
import {
  executionArtifactRefForSourcePackage,
  type ArtifactSourcePackage,
} from "flarex/artifacts";
import { LocalMiniflareExecutionArtifactMaterializer } from "../packages/flarex-dev/src/runtimeMaterializer";

type SourcePackageWithSource = ArtifactSourcePackage & {
  modules: Array<ArtifactSourcePackage["modules"][number] & { source: string }>;
};

describe("execution artifact to Postgres executor integration", () => {
  it("runs materialized user code through the trusted executor invoke protocol", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    const sessionIds = ["session_create", "session_list", "session_fail"];
    let nowMs = 1781913600000;
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(nowMs) },
      ids: { nextId: () => sessionIds.shift() ?? `session_extra_${sessionIds.length}` },
      persistence,
    });
    const handler = createFlarexNitroHandler({
      executor,
      capabilityToken: "executor-secret",
    });
    const sourcePackage = executionSourcePackage();
    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_artifact_postgres",
      projectId: "project_artifact_postgres",
      sourcePackage,
      analysisJson: executionAnalysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_artifact_postgres",
      projectId: "project_artifact_postgres",
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    const materializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId: "project_artifact_postgres",
      executorToken: "executor-secret",
      backend: request => handler({ request }),
    });
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const payloadBase = {
      deploymentId: "deployment_artifact_postgres",
      ref,
      sourcePackage,
    };
    const artifact = await materializer.materialize({
      ...payloadBase,
      request: {
        path: "messages:create",
        kind: "mutation",
        args: { teamId: "1:team", text: "hello" },
        partitionKey: "1:team",
      },
    });

    try {
      const created = await artifact.invoke({
        ...payloadBase,
        request: {
          path: "messages:create",
          kind: "mutation",
          args: { teamId: "1:team", text: "hello" },
          partitionKey: "1:team",
        },
      });
      expect(created).toMatchObject({
        value: { id: expect.stringMatching(/^2:/) },
        committedTs: 1781913600001,
        writes: [
          expect.objectContaining({
            tableId: 2,
            value: { teamId: "1:team", text: "hello", count: 1 },
          }),
        ],
      });

      nowMs = 1781913600001;
      const listed = await artifact.invoke({
        ...payloadBase,
        request: {
          path: "messages:list",
          kind: "query",
          args: { teamId: "1:team", text: "hello" },
          partitionKey: "1:team",
        },
      });
      expect(listed).toMatchObject({
        value: [
          {
            _id: created.value.id,
            teamId: "1:team",
            text: "hello",
            count: 1,
          },
        ],
        readSet: {
          indexes: [expect.objectContaining({ indexId: 1 })],
        },
      });

      await expect(
        artifact.invoke({
          ...payloadBase,
          request: {
            path: "messages:failAfterInsert",
            kind: "mutation",
            args: { teamId: "1:team", text: "fail" },
            partitionKey: "1:team",
          },
        }),
      ).rejects.toThrow("fail after insert");
      await expect(
        persistence.getInvokeSessionMetadata(
          "deployment_artifact_postgres",
          "session_fail",
        ),
      ).resolves.toMatchObject({ state: "aborted" });
      await expect(
        persistence.listDocumentsInTableAtTs(
          "deployment_artifact_postgres",
          2,
          1781913609999,
        ),
      ).resolves.toMatchObject([
        expect.objectContaining({
          id: created.value.id,
          value: { teamId: "1:team", text: "hello", count: 1 },
        }),
      ]);
    } finally {
      await artifact.dispose?.();
    }
  });
});

function executionSourcePackage(): SourcePackageWithSource {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: `export default {
  messages: {
    create: {
      isMutation: true,
      _handler: async ({ db }, args) => {
        const id = await db.insert("messages", {
          teamId: args.teamId,
          text: args.text,
          count: 1,
        });
        return { id };
      },
    },
    list: {
      isQuery: true,
      _handler: async ({ db }, args) => {
        return await db
          .query("messages")
          .withIndex("by_team_text", q =>
            q.eq("teamId", args.teamId).eq("text", args.text)
          )
          .collect();
      },
    },
    failAfterInsert: {
      isMutation: true,
      _handler: async ({ db }, args) => {
        await db.insert("messages", {
          teamId: args.teamId,
          text: args.text,
          count: 1,
        });
        throw new Error("fail after insert");
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
}

function executionAnalysisJson(): Record<string, unknown> {
  return {
    schema: {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "_id" },
        },
        {
          tableId: 2,
          name: "messages",
          placement: { kind: "colocateWith", table: "teams", field: "teamId" },
          validator: {
            type: "object",
            value: {
              teamId: {
                fieldType: { type: "id", tableName: "teams" },
                optional: false,
              },
              text: { fieldType: { type: "string" }, optional: false },
              count: { fieldType: { type: "number" }, optional: false },
            },
          },
        },
      ],
      indexes: [
        {
          indexId: 1,
          tableId: 2,
          name: "by_team_text",
          fields: ["teamId", "text"],
          state: "enabled",
        },
      ],
    },
    functions: {
      functions: [
        {
          path: "messages:create",
          kind: "mutation",
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
        {
          path: "messages:list",
          kind: "query",
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
        {
          path: "messages:failAfterInsert",
          kind: "mutation",
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
      ],
    },
  };
}

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

    let generatedId = 0;
    let nowMs = 1781913600000;
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(nowMs) },
      ids: { nextId: () => `id_${++generatedId}` },
      persistence,
    });
    const handler = createFlarexNitroHandler({
      executor,
      capabilityToken: "executor-secret",
    });
    let conflictTeamId: string | undefined;
    let injectedConflict = false;
    const sessionPaths = new Map<string, string>();
    const sessionsByPath = new Map<string, string[]>();
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
      backend: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/invoke/start") {
          const body = await request.clone().json().catch(() => null);
          const path = typeof body === "object" && body !== null && "path" in body
            ? body.path
            : undefined;
          const response = await handler({ request });
          const responseBody = await response.clone().json().catch(() => null);
          const sessionId =
            typeof responseBody === "object" && responseBody !== null && "sessionId" in responseBody
              ? responseBody.sessionId
              : undefined;
          if (typeof path === "string" && typeof sessionId === "string") {
            sessionPaths.set(sessionId, path);
            sessionsByPath.set(path, [...(sessionsByPath.get(path) ?? []), sessionId]);
          }
          return response;
        }
        if (url.pathname === "/invoke/finish") {
          const body = await request.clone().json().catch(() => null);
          const sessionId = typeof body === "object" && body !== null && "sessionId" in body
            ? body.sessionId
            : undefined;
          if (
            typeof sessionId === "string" &&
            sessionPaths.get(sessionId) === "teams:bumpWithRead" &&
            conflictTeamId !== undefined &&
            !injectedConflict
          ) {
            injectedConflict = true;
            nowMs = 1781913600005;
            const concurrent = await executor.beginInvokeSession({
              deploymentId: "deployment_artifact_postgres",
              projectId: "project_artifact_postgres",
              path: "teams:concurrentSet",
              kind: "mutation",
              args: { teamId: conflictTeamId },
              partitionKey: conflictTeamId,
            });
            await executor.invokeSyscall({
              deploymentId: "deployment_artifact_postgres",
              projectId: "project_artifact_postgres",
              sessionId: concurrent.sessionId,
              syscall: { op: "get", id: conflictTeamId },
            });
            await executor.invokeSyscall({
              deploymentId: "deployment_artifact_postgres",
              projectId: "project_artifact_postgres",
              sessionId: concurrent.sessionId,
              syscall: { op: "patch", id: conflictTeamId, value: { count: 100 } },
            });
            await executor.finishInvokeSession({
              deploymentId: "deployment_artifact_postgres",
              projectId: "project_artifact_postgres",
              sessionId: concurrent.sessionId,
              value: { ok: true },
            });
            nowMs = 1781913600007;
          }
        }
        return await handler({ request });
      },
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
          sessionsByPath.get("messages:failAfterInsert")?.[0] ?? "",
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

      nowMs = 1781913600003;
      const teamCreated = await artifact.invoke({
        ...payloadBase,
        request: {
          path: "teams:create",
          kind: "mutation",
          args: { name: "Ada" },
        },
      });
      expect(teamCreated).toMatchObject({
        value: { id: expect.stringMatching(/^1:/) },
      });
      conflictTeamId = teamCreated.value.id;

      nowMs = 1781913600004;
      const bumped = await artifact.invoke({
        ...payloadBase,
        request: {
          path: "teams:bumpWithRead",
          kind: "mutation",
          args: { teamId: conflictTeamId },
          partitionKey: conflictTeamId,
        },
      });
      expect(bumped).toMatchObject({
        value: { count: 101 },
        writes: [
          expect.objectContaining({
            tableId: 1,
            id: conflictTeamId,
            value: { name: "Ada", count: 101 },
          }),
        ],
      });
      await expect(
        persistence.getInvokeSessionMetadata(
          "deployment_artifact_postgres",
          sessionsByPath.get("teams:bumpWithRead")?.[0] ?? "",
        ),
      ).resolves.toMatchObject({ state: "aborted" });
      await expect(
        persistence.getInvokeSessionMetadata(
          "deployment_artifact_postgres",
          sessionsByPath.get("teams:bumpWithRead")?.[1] ?? "",
        ),
      ).resolves.toMatchObject({ state: "finished" });
      await expect(
        persistence.listDocumentsInTableAtTs(
          "deployment_artifact_postgres",
          1,
          1781913609999,
        ),
      ).resolves.toContainEqual(
        expect.objectContaining({
          id: conflictTeamId,
          value: { name: "Ada", count: 101 },
        }),
      );
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
  teams: {
    create: {
      isMutation: true,
      _handler: async ({ db }, args) => {
        const id = await db.insert("teams", {
          name: args.name,
          count: 0,
        });
        return { id };
      },
    },
    bumpWithRead: {
      isMutation: true,
      _handler: async ({ db }, args) => {
        const team = await db.get(args.teamId);
        const count = (team?.count ?? 0) + 1;
        await db.patch(args.teamId, { count });
        return { count };
      },
    },
    concurrentSet: {
      isMutation: true,
      _handler: async () => {
        throw new Error("concurrentSet is executed by trusted executor syscalls");
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
          validator: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
              count: { fieldType: { type: "number" }, optional: false },
            },
          },
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
        {
          path: "teams:create",
          kind: "mutation",
          partition: {
            type: "partitionCreateRoot",
            table: "teams",
            partitionField: "_id",
          },
        },
        {
          path: "teams:bumpWithRead",
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
          path: "teams:concurrentSet",
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

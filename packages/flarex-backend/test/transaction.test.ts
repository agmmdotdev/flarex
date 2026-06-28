import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PartitionRequestError,
  SingleShardTransaction,
} from "../src/transaction";
import { partitionObjectName } from "../src/routing";
import type { DeploymentSchema, Env } from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;
let env: Env;

beforeAll(async () => {
  harness = await createBackendHarness();
  env = await harness.mf.getBindings<Env>();
});

afterAll(async () => {
  await harness.dispose();
});

describe("SingleShardTransaction", () => {
  it("rejects malformed partition schema-cache JSON at the route boundary", async () => {
    const partition = env.PARTITIONS.getByName(
      partitionObjectName("schema-cache-boundary-deployment", "user:ada"),
    );

    const response = await partition.fetch("https://flarex.internal/schema-cache", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });
  });

  it("rejects non-object partition schema-cache JSON at the route boundary", async () => {
    const partition = env.PARTITIONS.getByName(
      partitionObjectName("schema-cache-envelope-boundary-deployment", "user:ada"),
    );

    const response = await partition.fetch("https://flarex.internal/schema-cache", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify("schema"),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "schema-cache request body must be an object.",
    });
  });

  it("rejects malformed partition subscription registration JSON at the route boundary", async () => {
    const partition = env.PARTITIONS.getByName(
      partitionObjectName("subscription-register-boundary-deployment", "user:ada"),
    );

    const response = await partition.fetch("https://flarex.internal/subscriptions/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });
  });

  it("rejects invalid partition subscription unregister-connection envelopes at the route boundary", async () => {
    const partition = env.PARTITIONS.getByName(
      partitionObjectName("subscription-unregister-boundary-deployment", "user:ada"),
    );

    const response = await partition.fetch("https://flarex.internal/subscriptions/unregister-connection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionName: "" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "connectionName must be a non-empty string.",
    });
  });

  it("rejects invalid partition subscription unregister targets at the route boundary", async () => {
    const partition = env.PARTITIONS.getByName(
      partitionObjectName("subscription-unregister-target-boundary-deployment", "user:ada"),
    );

    const response = await partition.fetch("https://flarex.internal/subscriptions/unregister", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionName: "connection-a",
        queryId: 1.5,
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "queryId must be an integer.",
    });
  });

  it("rejects malformed partition commit JSON at the route boundary", async () => {
    const partition = env.PARTITIONS.getByName(
      partitionObjectName("commit-boundary-deployment", "user:ada"),
    );

    const response = await partition.fetch("https://flarex.internal/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });
  });

  it("rejects invalid public partition commit envelopes at the route boundary", async () => {
    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/commit-public-boundary/partitions/user%3Aada/commit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beginTs: 0,
          writes: [{ tableId: 1 }],
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "writes[0].value must be a JSON value.",
    });
  });

  it("commits through the public partition route boundary", async () => {
    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/commit-public-success-boundary/partitions/user%3Aada/commit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beginTs: 0,
          writes: [],
        }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      committedTs: 1,
      writes: [],
    });
  });

  it("generates ids, exposes read-your-writes, and coalesces document writes", async () => {
    const tx = await SingleShardTransaction.begin(env, "tx-deployment", "user:u1");

    const id = tx.insert(1, { title: "Intro", progress: 0 });
    await expect(tx.get(1, id)).resolves.toMatchObject({
      id,
      value: { title: "Intro", progress: 0 },
    });

    await tx.patch(1, id, { progress: 1 });

    expect(tx.currentReadSet()).toEqual({});
    expect(tx.pendingWrites()).toEqual([
      {
        tableId: 1,
        id,
        value: { title: "Intro", progress: 1 },
      },
    ]);

    const commit = await tx.commit({ source: "test:mutation" });
    expect(commit.writes).toHaveLength(1);
    expect(commit.writes[0]).toMatchObject({
      tableId: 1,
      id,
      value: { title: "Intro", progress: 1 },
    });

    const readBack = await SingleShardTransaction.begin(env, "tx-deployment", "user:u1");
    await expect(readBack.get(1, id)).resolves.toMatchObject({
      id,
      value: { title: "Intro", progress: 1 },
    });
  });

  it("surfaces OCC conflicts from the partition commit path", async () => {
    const seed = await SingleShardTransaction.begin(env, "conflict-deployment", "user:u1");
    seed.insert(1, { title: "Intro", progress: 0 }, "1:lesson");
    await seed.commit({ source: "seed" });

    const stale = await SingleShardTransaction.begin(env, "conflict-deployment", "user:u1");
    await expect(stale.get(1, "1:lesson")).resolves.toMatchObject({
      value: { title: "Intro", progress: 0 },
    });

    const concurrent = await SingleShardTransaction.begin(env, "conflict-deployment", "user:u1");
    concurrent.replace(1, "1:lesson", { title: "Intro", progress: 1 });
    const concurrentCommit = await concurrent.commit({ source: "concurrent" });

    stale.replace(1, "1:other", { title: "Other" });
    await expect(stale.commit({ source: "stale" })).rejects.toMatchObject({
      status: 409,
      body: {
        code: "OCC_CONFLICT",
        conflictingTs: concurrentCommit.committedTs,
      },
    } satisfies Partial<PartitionRequestError>);
  });

  it("rejects colocated writes at the partition commit boundary", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "scores",
          placement: { kind: "colocateWith", table: "users", field: "userId" },
        },
      ],
      indexes: [],
    };
    await SingleShardTransaction.ensureSchema(env, "placement-commit-deployment", "u1", schema);

    const wrongInsert = await SingleShardTransaction.begin(
      env,
      "placement-commit-deployment",
      "u1",
    );
    wrongInsert.insert(1, { userId: "u2", score: 1 }, "1:wrong");
    await expect(wrongInsert.commit({ source: "wrong-insert" })).rejects.toMatchObject({
      status: 400,
      body: {
        error: "PlacementValidationError: $document(scores).userId must match partitionKey u1.",
      },
    } satisfies Partial<PartitionRequestError>);

    const valid = await SingleShardTransaction.begin(env, "placement-commit-deployment", "u1");
    valid.insert(1, { userId: "u1", score: 1 }, "1:score");
    await valid.commit({ source: "valid" });

    const wrongReplace = await SingleShardTransaction.begin(
      env,
      "placement-commit-deployment",
      "u1",
    );
    wrongReplace.replace(1, "1:score", { userId: "u2", score: 2 });
    await expect(wrongReplace.commit({ source: "wrong-replace" })).rejects.toMatchObject({
      status: 400,
      body: {
        error: "PlacementValidationError: $document(scores).userId must match partitionKey u1.",
      },
    } satisfies Partial<PartitionRequestError>);
  });

  it("rejects partitionBy field writes at the partition commit boundary", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "cartItems",
          placement: { kind: "partitionBy", field: "cartId" },
        },
      ],
      indexes: [],
    };
    await SingleShardTransaction.ensureSchema(env, "partition-field-commit-deployment", "cart:1", schema);

    const wrongInsert = await SingleShardTransaction.begin(
      env,
      "partition-field-commit-deployment",
      "cart:1",
    );
    wrongInsert.insert(1, { cartId: "cart:2", sku: "coffee" }, "1:coffee");
    await expect(wrongInsert.commit({ source: "wrong-insert" })).rejects.toMatchObject({
      status: 400,
      body: {
        error: "PlacementValidationError: $document(cartItems).cartId must match partitionKey cart:1.",
      },
    } satisfies Partial<PartitionRequestError>);

    const valid = await SingleShardTransaction.begin(
      env,
      "partition-field-commit-deployment",
      "cart:1",
    );
    valid.insert(1, { cartId: "cart:1", sku: "tea" }, "1:tea");
    await valid.commit({ source: "valid" });

    const wrongReplace = await SingleShardTransaction.begin(
      env,
      "partition-field-commit-deployment",
      "cart:1",
    );
    wrongReplace.replace(1, "1:tea", { cartId: "cart:2", sku: "tea" });
    await expect(wrongReplace.commit({ source: "wrong-replace" })).rejects.toMatchObject({
      status: 400,
      body: {
        error: "PlacementValidationError: $document(cartItems).cartId must match partitionKey cart:1.",
      },
    } satisfies Partial<PartitionRequestError>);
  });

  it("enforces partitionBy field owner uniqueness at the partition commit boundary", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "slug" },
        },
        {
          tableId: 2,
          name: "projects",
          placement: { kind: "colocateWith", table: "teams", field: "teamSlug" },
        },
      ],
      indexes: [],
    };
    await SingleShardTransaction.ensureSchema(env, "partition-owner-deployment", "acme", schema);

    const first = await SingleShardTransaction.begin(env, "partition-owner-deployment", "acme");
    first.insert(1, { slug: "acme", name: "Acme" }, "1:team-a");
    await first.commit({ source: "first-team" });

    const duplicate = await SingleShardTransaction.begin(env, "partition-owner-deployment", "acme");
    duplicate.insert(1, { slug: "acme", name: "Other Acme" }, "1:team-b");
    await expect(duplicate.commit({ source: "duplicate-team" })).rejects.toMatchObject({
      status: 400,
      body: {
        error: 'UniquePartitionOwnerError: teams.slug "acme" already belongs to document 1:team-a.',
      },
    } satisfies Partial<PartitionRequestError>);

    const updateSame = await SingleShardTransaction.begin(env, "partition-owner-deployment", "acme");
    updateSame.replace(1, "1:team-a", { slug: "acme", name: "Acme Updated" });
    await updateSame.commit({ source: "update-team" });

    const colocatedChildren = await SingleShardTransaction.begin(
      env,
      "partition-owner-deployment",
      "acme",
    );
    colocatedChildren.insert(2, { teamSlug: "acme", name: "Website" }, "2:website");
    colocatedChildren.insert(2, { teamSlug: "acme", name: "Docs" }, "2:docs");
    await colocatedChildren.commit({ source: "children" });

    const release = await SingleShardTransaction.begin(env, "partition-owner-deployment", "acme");
    release.delete(1, "1:team-a");
    await release.commit({ source: "delete-team" });

    const recreate = await SingleShardTransaction.begin(env, "partition-owner-deployment", "acme");
    recreate.insert(1, { slug: "acme", name: "Acme Recreated" }, "1:team-c");
    await recreate.commit({ source: "recreate-team" });
  });

  it("rejects multiple partitionBy field owner claims in one commit", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "slug" },
        },
      ],
      indexes: [],
    };
    await SingleShardTransaction.ensureSchema(env, "partition-owner-batch-deployment", "acme", schema);

    const duplicate = await SingleShardTransaction.begin(
      env,
      "partition-owner-batch-deployment",
      "acme",
    );
    duplicate.insert(1, { slug: "acme", name: "Acme" }, "1:team-a");
    duplicate.insert(1, { slug: "acme", name: "Other Acme" }, "1:team-b");
    await expect(duplicate.commit({ source: "duplicate-team-batch" })).rejects.toMatchObject({
      status: 400,
      body: {
        error: 'UniquePartitionOwnerError: teams.slug "acme" is claimed by multiple documents in this commit.',
      },
    } satisfies Partial<PartitionRequestError>);
  });
});

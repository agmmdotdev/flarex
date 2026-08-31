import { isNonArrayRecord } from "@flarex/utils/records";
import { Result } from "effect";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  makeFrameworkSchemaArtifactControlSessionStarter,
} from "../src/frameworkSchema/artifact/controlSession";
import { listFrameworkSchemaArtifactIdentitiesEffect } from
  "../src/frameworkSchema/artifact/list";
import type {
  FrameworkSchemaArtifactOwner,
  ListFrameworkSchemaArtifactIdentitiesInput,
} from "../src/frameworkSchema/artifact/model";
import { decodeFrameworkSchemaArtifactListInputResult } from
  "../src/frameworkSchema/artifact/policy";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from
  "../src/frameworkSchema/artifact/postgresControlSession";
import { makeFrameworkSchemaArtifactRepository } from
  "../src/frameworkSchema/artifact/repository";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
} from "./frameworkSchemaArtifactStorageTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const PLAN_ARTIFACT_COUNT = 20_000;

type ArtifactControlPool = Parameters<
  typeof makePostgresFrameworkSchemaArtifactControlSessionDriver
>[0];

interface ExecutedArtifactListQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

describePostgres(
  "private framework schema artifact identity listing - PostgreSQL",
  () => {
    it("paginates in native bytea order with exact coordinate isolation and lookahead", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await insertDeployments(persistence);
        const orderedDigests = [
          `00${"ff".repeat(31)}`,
          `7f${"00".repeat(31)}`,
          `80${"00".repeat(31)}`,
          `ff${"00".repeat(31)}`,
        ] as const;
        for (const digest of orderedDigests) {
          await insertRawArtifact(persistence, {
            lineageId: "lineage-native-order",
            digest,
          });
        }
        await insertRawArtifact(persistence, {
          deploymentId: "deployment-other",
          lineageId: "lineage-native-order",
          digest: orderedDigests[0],
        });
        await insertRawArtifact(persistence, {
          owner: "medusa",
          lineageId: "lineage-native-order",
          digest: orderedDigests[0],
        });
        await insertRawArtifact(persistence, {
          lineageId: "lineage-other",
          digest: orderedDigests[0],
        });
        await insertRawArtifactRange(
          persistence,
          "lineage-native-101",
          0,
          100,
        );
        await insertRawArtifactRange(
          persistence,
          "lineage-native-100",
          0,
          99,
        );
        const repository = makePostgresListRepository(persistence);

        const first = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-order",
              limit: 2,
            }),
          ),
        );
        expect(first.items.map(item => item.artifactSha256)).toEqual(
          orderedDigests.slice(0, 2),
        );
        expect(first.nextAfterArtifactSha256).toBe(orderedDigests[1]);

        const resumed = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-order",
              afterArtifactSha256: first.nextAfterArtifactSha256,
              limit: 2,
            }),
          ),
        );
        expect(resumed.items.map(item => item.artifactSha256)).toEqual(
          orderedDigests.slice(2),
        );
        expect(resumed.nextAfterArtifactSha256).toBeNull();

        const gap = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-order",
              afterArtifactSha256: `81${"00".repeat(31)}`,
              limit: 2,
            }),
          ),
        );
        expect(gap.items.map(item => item.artifactSha256)).toEqual([
          orderedDigests[3],
        ]);
        expect(gap.nextAfterArtifactSha256).toBeNull();

        const terminal = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-order",
              afterArtifactSha256: orderedDigests[3],
              limit: 2,
            }),
          ),
        );
        expect(terminal).toEqual({
          items: [],
          nextAfterArtifactSha256: null,
        });

        const lookahead = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-101",
              limit: 100,
            }),
          ),
        );
        expect(lookahead.items).toHaveLength(100);
        expect(lookahead.items[0]?.artifactSha256).toBe(digestForInteger(0));
        expect(lookahead.items.at(-1)?.artifactSha256).toBe(
          digestForInteger(99),
        );
        expect(lookahead.nextAfterArtifactSha256).toBe(digestForInteger(99));

        const finalLookaheadPage = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-101",
              afterArtifactSha256: lookahead.nextAfterArtifactSha256,
              limit: 100,
            }),
          ),
        );
        expect(finalLookaheadPage.items.map(item => item.artifactSha256))
          .toEqual([digestForInteger(100)]);
        expect(finalLookaheadPage.nextAfterArtifactSha256).toBeNull();

        const exact = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-100",
              limit: 100,
            }),
          ),
        );
        expect(exact.items).toHaveLength(100);
        expect(exact.nextAfterArtifactSha256).toBeNull();
      });
    }, 180_000);

    it("uses the natural identity index for the exact initial and resumed list statements", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await insertDeployments(persistence);
        await insertRawArtifactRange(
          persistence,
          "lineage-native-plan",
          0,
          PLAN_ARTIFACT_COUNT - 1,
        );
        await persistence.query(`analyze ${ARTIFACT_TABLE}`);
        const observations: ExecutedArtifactListQuery[] = [];
        const repository = makePostgresListRepository(
          persistence,
          observations,
        );

        const initial = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-plan",
              limit: 100,
            }),
          ),
        );
        expect(initial.items).toHaveLength(100);
        expect(initial.items[0]?.artifactSha256).toBe(digestForInteger(0));
        expect(initial.items.at(-1)?.artifactSha256).toBe(
          digestForInteger(99),
        );
        expect(initial.nextAfterArtifactSha256).toBe(digestForInteger(99));

        const resumed = await runEffect(
          listFrameworkSchemaArtifactIdentitiesEffect(
            repository,
            makeListInput({
              lineageId: "lineage-native-plan",
              afterArtifactSha256: digestForInteger(9_999),
              limit: 100,
            }),
          ),
        );
        expect(resumed.items).toHaveLength(100);
        expect(resumed.items[0]?.artifactSha256).toBe(
          digestForInteger(10_000),
        );
        expect(resumed.items.at(-1)?.artifactSha256).toBe(
          digestForInteger(10_099),
        );
        expect(resumed.nextAfterArtifactSha256).toBe(
          digestForInteger(10_099),
        );

        expect(observations).toHaveLength(2);
        const initialQuery = requireObservation(observations, 0);
        const resumedQuery = requireObservation(observations, 1);
        expectIdentityOnlyListSql(initialQuery.sql);
        expectIdentityOnlyListSql(resumedQuery.sql);
        expect(initialQuery.params).toHaveLength(4);
        expect(resumedQuery.params).toHaveLength(5);
        expect(initialQuery.params.at(-1)).toBe(101);
        expect(resumedQuery.params.at(-1)).toBe(101);

        const planClient = await persistence.pool.connect();
        try {
          const sequentialScans = await planClient.query<{
            enable_seqscan: string;
          }>("show enable_seqscan");
          expect(sequentialScans.rows).toEqual([{ enable_seqscan: "on" }]);

          const initialPlan = await explainExecutedQuery(
            planClient,
            initialQuery,
          );
          const resumedPlan = await explainExecutedQuery(
            planClient,
            resumedQuery,
          );
          expectArtifactIdentityListPlan(initialPlan, false);
          expectArtifactIdentityListPlan(resumedPlan, true);
        } finally {
          planClient.release();
        }
      });
    }, 180_000);
  },
);

function makePostgresListRepository(
  persistence: PostgresFlarexPersistence,
  observations?: ExecutedArtifactListQuery[],
) {
  const controlDb: FlarexMetadataDatabase = persistence.drizzle;
  const pool = observations === undefined
    ? persistence.pool
    : makeObservedArtifactControlPool(persistence, observations);
  return Result.getOrThrow(makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(pool),
    }),
    readTimeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
    attemptTimeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
    recoveryTimeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
    lockTimeoutMilliseconds: 1_000,
  }));
}

function makeObservedArtifactControlPool(
  persistence: PostgresFlarexPersistence,
  observations: ExecutedArtifactListQuery[],
): ArtifactControlPool {
  return Object.freeze({
    options: persistence.pool.options,
    connect(callback) {
      persistence.pool.connect((error, client, release) => {
        callback(error, client === undefined
          ? undefined
          : makeObservedArtifactControlClient(client, observations), release);
      });
    },
  } satisfies ArtifactControlPool);
}

function makeObservedArtifactControlClient(
  client: PoolClient,
  observations: ExecutedArtifactListQuery[],
): PoolClient {
  const observedQuery = new Proxy(client.query, {
    apply(target, _thisArgument, argumentsList) {
      captureArtifactListQuery(argumentsList, observations);
      return Reflect.apply(target, client, argumentsList);
    },
  });
  return new Proxy(client, {
    get(target, property) {
      if (property === "query") return observedQuery;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function captureArtifactListQuery(
  args: readonly unknown[],
  observations: ExecutedArtifactListQuery[],
): void {
  const query = args[0];
  const params = args[1];
  if (
    !isNonArrayRecord(query) ||
    typeof query.text !== "string" ||
    !query.text.includes(`from "${ARTIFACT_TABLE}"`) ||
    !Array.isArray(params)
  ) {
    return;
  }
  observations.push(Object.freeze({
    sql: query.text,
    params: Object.freeze(params.map(copyPostgresParameter)),
  }));
}

function copyPostgresParameter(value: unknown): unknown {
  return value instanceof Uint8Array ? Uint8Array.from(value) : value;
}

function requireObservation(
  observations: readonly ExecutedArtifactListQuery[],
  index: number,
): ExecutedArtifactListQuery {
  const observation = observations[index];
  if (observation === undefined) {
    throw new Error(`Expected artifact list query observation ${index}.`);
  }
  return observation;
}

function expectIdentityOnlyListSql(sql: string): void {
  const normalized = sql.replaceAll(/\s+/g, " ");
  expect(normalized).toContain(
    `select "deployment_id", "owner", "lineage_id", "artifact_sha256" from "${ARTIFACT_TABLE}"`,
  );
  expect(normalized).toContain(
    `order by "${ARTIFACT_TABLE}"."artifact_sha256" asc limit $`,
  );
  expect(normalized).not.toContain("canonical_bytes");
  expect(normalized).not.toContain(DEPENDENCY_TABLE);
}

async function explainExecutedQuery(
  client: PoolClient,
  query: ExecutedArtifactListQuery,
): Promise<unknown> {
  const result = await client.query<{ "QUERY PLAN": unknown }>(
    `explain (analyze, buffers, format json) ${query.sql}`,
    [...query.params],
  );
  const plan = result.rows[0]?.["QUERY PLAN"];
  if (plan === undefined) throw new Error("PostgreSQL returned no query plan.");
  return plan;
}

function expectArtifactIdentityListPlan(
  plan: unknown,
  resumed: boolean,
): void {
  const nodes = collectPlanNodes(plan);
  expect(nodes.some(node =>
    typeof node["Node Type"] === "string" &&
    node["Node Type"].endsWith("Sort")
  )).toBe(false);

  const artifactAccessNodes = nodes.filter(node =>
    node["Relation Name"] === ARTIFACT_TABLE
  );
  expect(artifactAccessNodes).toHaveLength(1);
  const accessNode = artifactAccessNodes[0];
  if (accessNode === undefined) return;
  expect(["Index Scan", "Index Only Scan"]).toContain(
    accessNode["Node Type"],
  );
  expect(accessNode["Index Name"]).toBe(
    "fx_framework_artifact_identity_unique",
  );
  expect(accessNode["Scan Direction"]).toBe("Forward");
  expect(accessNode["Actual Rows"]).toBe(101);
  expect(accessNode["Actual Loops"]).toBe(1);
  expect(accessNode["Filter"]).toBeUndefined();
  const rowsRemovedByFilter = accessNode["Rows Removed by Filter"];
  expect(rowsRemovedByFilter === undefined || rowsRemovedByFilter === 0)
    .toBe(true);
  const indexCondition = accessNode["Index Cond"];
  expect(typeof indexCondition).toBe("string");
  if (typeof indexCondition !== "string") return;
  expect(indexCondition).toContain("deployment_id =");
  expect(indexCondition).toContain("owner =");
  expect(indexCondition).toContain("lineage_id =");
  if (resumed) {
    expect(indexCondition).toContain("artifact_sha256 >");
  } else {
    expect(indexCondition).not.toContain("artifact_sha256 >");
  }

  const limitNodes = nodes.filter(node => node["Node Type"] === "Limit");
  expect(limitNodes).toHaveLength(1);
  expect(limitNodes[0]?.["Actual Rows"]).toBe(101);
  expect(limitNodes[0]?.["Actual Loops"]).toBe(1);
}

function collectPlanNodes(plan: unknown): readonly Readonly<Record<
  string,
  unknown
>>[] {
  const nodes: Readonly<Record<string, unknown>>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isNonArrayRecord(value)) return;
    if (typeof value["Node Type"] === "string") nodes.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(plan);
  return Object.freeze(nodes);
}

function makeListInput(
  overrides: Readonly<{
    deploymentId?: string;
    owner?: FrameworkSchemaArtifactOwner;
    lineageId: string;
    afterArtifactSha256?: string | null;
    limit: number;
  }>,
): ListFrameworkSchemaArtifactIdentitiesInput {
  const decoded = Result.getOrThrow(
    decodeFrameworkSchemaArtifactListInputResult({
      deploymentId: overrides.deploymentId ?? "deployment-main",
      owner: overrides.owner ?? "payload",
      lineageId: overrides.lineageId,
      afterArtifactSha256: overrides.afterArtifactSha256 ?? null,
      limit: overrides.limit,
    }),
  );
  return Object.freeze({
    ...decoded.coordinate,
    afterArtifactSha256: decoded.afterArtifactSha256,
    limit: decoded.limit,
  });
}

function digestForInteger(value: number): string {
  return value.toString(16).padStart(64, "0");
}

async function insertDeployments(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    insert into deployments (deployment_id, project_id)
    values
      ('deployment-main', 'project-main'),
      ('deployment-other', 'project-other')
  `);
}

async function insertRawArtifact(
  persistence: PostgresFlarexPersistence,
  input: Readonly<{
    deploymentId?: string;
    owner?: FrameworkSchemaArtifactOwner;
    lineageId: string;
    digest: string;
  }>,
): Promise<void> {
  await persistence.query(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length, canonical_bytes)
    values ($1, $2, $3, decode($4, 'hex'),
      'flarex.framework-schema-artifact', 1, 1, decode('ff', 'hex'))
  `, [
    input.deploymentId ?? "deployment-main",
    input.owner ?? "payload",
    input.lineageId,
    input.digest,
  ]);
}

async function insertRawArtifactRange(
  persistence: PostgresFlarexPersistence,
  lineageId: string,
  start: number,
  end: number,
): Promise<void> {
  await persistence.query(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length, canonical_bytes)
    select 'deployment-main', 'payload', $1,
      decode(lpad(to_hex(value), 64, '0'), 'hex'),
      'flarex.framework-schema-artifact', 1, 1, decode('ff', 'hex')
    from generate_series($2::integer, $3::integer) as values(value)
  `, [lineageId, start, end]);
}

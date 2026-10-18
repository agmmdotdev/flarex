import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { bindingMaintenanceCaptureSql, bindingMaintenanceSelectionSql } from "../../../src/installation/frameworkSchema/binding/maintenanceSelectionSql";
import { useFileScopedPersistence } from "../../support/fileScopedPersistenceFixture";

const scope = "scope_binding_native_capture";
const generation = "flarexdb_v1";
const encoded = (frame: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(frame));
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
};
const candidate = encoded({ format: "flarex.data-binding-set", application: { deploymentId: "deployment_binding" },
  logicalSchema: { schemaVersionId: "schema_binding", manifestSha256: "ab".repeat(32) } });
const activation = encoded({ format: "flarex.data-binding-activation", version: 3, sequence: "1",
  request: { format: "flarex.data-binding-activation-request", version: 1, requestId: "binding-request", scopeId: scope, storageGeneration: generation, candidateSha256: candidate.digest } });
const head = encoded({ format: "flarex.data-binding-head", version: 2, scopeId: scope,
  storageGeneration: generation, sequence: "1", candidateSha256: candidate.digest, activationSha256: activation.digest });
const capture = (database: PGlite) => database.query(`select * from (${bindingMaintenanceCaptureSql("", "$1", "$2")}) selected`, [scope, generation]);

// The unconstrained tables intentionally admit corrupt row/canonical projections.
const withDatabase = useFileScopedPersistence(async () => {
  const database = await PGlite.create();
  try {
    await database.exec(`create table fx_system_data_binding_candidate(scope_id text,storage_generation text,sha256 text,canonical_bytes bytea,canonical_byte_length integer);
      create table fx_system_data_binding_activation(scope_id text,storage_generation text,sequence bigint,sha256 text,candidate_sha256 text,request_id text,canonical_bytes bytea,canonical_byte_length integer);
      create table fx_system_data_binding_head(scope_id text,storage_generation text,sequence bigint,sha256 text,candidate_sha256 text,activation_sha256 text,canonical_bytes bytea,canonical_byte_length integer);`);
    const reset = () => database.transaction(async transaction => {
      await transaction.exec(`delete from fx_system_data_binding_head;
        delete from fx_system_data_binding_activation;
        delete from fx_system_data_binding_candidate;`);
      await transaction.query("insert into fx_system_data_binding_candidate values ($1,$2,$3,$4,$5)", [scope,generation,candidate.digest,candidate.bytes,candidate.bytes.byteLength]);
      await transaction.query("insert into fx_system_data_binding_activation values ($1,$2,1,$3,$4,'binding-request',$5,$6)", [scope,generation,activation.digest,candidate.digest,activation.bytes,activation.bytes.byteLength]);
      await transaction.query("insert into fx_system_data_binding_head values ($1,$2,1,$3,$4,$5,$6,$7)", [scope,generation,head.digest,candidate.digest,activation.digest,head.bytes,head.bytes.byteLength]);
    });
    await reset();
    return { persistence: database, reset, dispose: () => database.close() };
  } catch (error: unknown) {
    await database.close();
    throw error;
  }
});

it("captures selected immutable pins once and rejects another head with the same sequence", () => withDatabase(async database => {
  expect((await capture(database)).rows).toMatchObject([{ deployment_id: "deployment_binding", schema_version_id: "schema_binding" }]);
  const matches = async (expectedHead: string) => database.query(`with binding_selection as materialized (
      ${bindingMaintenanceCaptureSql("", "$1", "$2")}), expected as (
      select 1::bigint as activation_sequence,decode($3,'hex') as head_sha256,decode($4,'hex') as activation_sha256,
        decode($5,'hex') as candidate_sha256,'deployment_binding'::text as deployment_id,'schema_binding'::text as schema_version_id,
        decode($6,'hex') as schema_manifest_sha256)
    select (${bindingMaintenanceSelectionSql("expected")}) as matches from binding_selection cross join expected`,
    [scope,generation,expectedHead,activation.digest,candidate.digest,"ab".repeat(32)]);
  expect((await matches(head.digest)).rows).toEqual([{ matches: true }]);
  expect((await matches("cc".repeat(32))).rows).toEqual([{ matches: false }]);
}));

it("rejects digest-valid bytes whose canonical head disagrees with row projections", () => withDatabase(async database => {
  expect((await capture(database)).rows).toMatchObject([{ deployment_id: "deployment_binding", schema_version_id: "schema_binding" }]);
  const wrong = encoded({ format: "flarex.data-binding-head", version: 2, scopeId: scope,
    storageGeneration: generation, sequence: "2", candidateSha256: candidate.digest, activationSha256: activation.digest });
  await database.query("update fx_system_data_binding_head set sha256=$1,canonical_bytes=$2,canonical_byte_length=$3", [wrong.digest,wrong.bytes,wrong.bytes.byteLength]);
  expect((await capture(database)).rows).toEqual([]);
}));

it("rejects canonical activation projection corruption and candidate-byte corruption", () => withDatabase(async database => {
  expect((await capture(database)).rows).toMatchObject([{ deployment_id: "deployment_binding", schema_version_id: "schema_binding" }]);
  const wrong = encoded({ format: "flarex.data-binding-activation", version: 3, sequence: "2",
    request: { format: "flarex.data-binding-activation-request", version: 1, requestId: "binding-request", scopeId: scope, storageGeneration: generation, candidateSha256: candidate.digest } });
  const matchingHead = encoded({ format: "flarex.data-binding-head", version: 2, scopeId: scope,
    storageGeneration: generation, sequence: "1", candidateSha256: candidate.digest, activationSha256: wrong.digest });
  await database.query("update fx_system_data_binding_activation set canonical_bytes=$1,sha256=$2,canonical_byte_length=$3",
    [wrong.bytes,wrong.digest,wrong.bytes.byteLength]);
  await database.query("update fx_system_data_binding_head set canonical_bytes=$1,sha256=$2,canonical_byte_length=$3,activation_sha256=$4",
    [matchingHead.bytes,matchingHead.digest,matchingHead.bytes.byteLength,wrong.digest]);
  expect((await capture(database)).rows).toEqual([]);
  await database.query("update fx_system_data_binding_activation set canonical_bytes=$1,sha256=$2,canonical_byte_length=$3",
    [activation.bytes,activation.digest,activation.bytes.byteLength]);
  await database.query("update fx_system_data_binding_head set canonical_bytes=$1,sha256=$2,canonical_byte_length=$3,activation_sha256=$4",
    [head.bytes,head.digest,head.bytes.byteLength,activation.digest]);
  await database.query("update fx_system_data_binding_candidate set canonical_bytes=$1", [new TextEncoder().encode("{}")]);
  expect((await capture(database)).rows).toEqual([]);
}));

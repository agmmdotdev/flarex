import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { createPostgresStorageLeasePool, type PostgresStorageSchema } from "./postgresStorageLeasePool";
import { decodeStorageRequest, type PostgresStorageSessionEndpoint } from "./postgresStorageProtocol";

function quoted(name: string): string { return `"${name.replaceAll('"', '""')}"`; }

/** Main-process Node/Vitest boundary. Workers borrow identifiers only; SQL work
 * still goes directly through their real driver. This owner retains schemas,
 * never worker pools, runtimes, prepared statements or transaction handles. */
export async function startPostgresStorageSession(connectionString: string, maximumSchemas: number) {
  // pg connects lazily: even a PostgreSQL-enabled pure-only selection opens no SQL connection.
  const admin = new Pool({ connectionString, max: 1 });
  const transaction = async (statement: string) => {
    const client = await admin.connect();
    let destroy = false;
    try { await client.query("begin"); await client.query(statement); await client.query("commit"); }
    catch (cause: unknown) {
      try { await client.query("rollback"); }
      catch (cleanup: unknown) { destroy = true; throw new AggregateError([cause, cleanup], "Schema transaction rollback failed"); }
      throw cause;
    } finally { client.release(destroy); }
  };
  const leases = createPostgresStorageLeasePool({ maximumSchemas,
    create: schema => transaction(`create schema ${quoted(schema.schemaName)}; create schema ${quoted(schema.migrationsSchema)}`),
    destroy: schema => transaction(`drop schema if exists ${quoted(schema.schemaName)} cascade;
      drop schema if exists ${quoted(schema.migrationsSchema)} cascade`),
    assertDisconnected: async (schema: PostgresStorageSchema) => {
      const clients = await admin.query<{ count: string }>(`select count(*)::text as count from pg_stat_activity
        where datname = current_database() and application_name = $1`, [schema.schemaName]);
      if (clients.rows[0]?.count !== "0") throw new Error(`Postgres storage schema still has connected clients: ${schema.schemaName}`);
    },
  });
  const token = randomUUID();
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || request.url !== "/" || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end(); return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const value of request) {
      const chunk: unknown = value;
      if (!Buffer.isBuffer(chunk)) throw new Error("Invalid storage-session request body");
      length += chunk.length;
      if (length > 8192) throw new Error("Storage-session request body is too large");
      chunks.push(chunk);
    }
    const command = decodeStorageRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (command.operation === "acquire") {
      const lease = await leases.acquire(command.key);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, lease }));
    } else {
      await leases.release(command.leaseId, command.healthy, command.seal);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    }
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch((cause: unknown) => {
      response.statusCode = 500;
      response.end(JSON.stringify({ ok: false,
        error: cause instanceof Error ? cause.message : "Postgres storage-session request failed" }));
    });
  });
  server.listen(0, "127.0.0.1");
  try { await once(server, "listening"); }
  catch (cause: unknown) { await admin.end(); throw cause; }
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No storage-session address");
  const endpoint: PostgresStorageSessionEndpoint = { url: `http://127.0.0.1:${address.port}/`, token,
    connectionKey: createHash("sha256").update(connectionString).digest("hex") };
  let closing: Promise<void> | undefined;
  return { endpoint, statistics: leases.statistics,
    close(): Promise<void> {
      closing ??= (async () => {
        const failures: unknown[] = [];
        try { await new Promise<void>((resolve, reject) => server.close(cause => cause === undefined ? resolve() : reject(cause))); }
        catch (cause: unknown) { failures.push(cause); }
        try { await leases.close(); } catch (cause: unknown) { failures.push(cause); }
        try { await admin.end(); } catch (cause: unknown) { failures.push(cause); }
        if (failures.length > 0) throw new AggregateError(failures, "Postgres storage-session shutdown failed");
      })();
      return closing;
    },
  };
}

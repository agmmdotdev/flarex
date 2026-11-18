import { observePostgresClientLifetime } from
  "@flarex/persistence-postgres/internal/postgres-client-lifetime";
import { Cause, Effect, Exit, Schema } from "effect";
import { Client } from "pg";
import { CloudflareSocket } from "pg-cloudflare";

import { createExecutorClientLifetime } from "../src/requestLifecycle";
import { PostgresTlsRow } from "./support/pgCloudflarePostgresProtocol";

interface FixtureEnv {
  readonly DATABASE_URL: string;
  readonly APPLICATION_NAME: string;
}

export default {
  async fetch(_request: Request, env: FixtureEnv): Promise<Response> {
    const state = {
      actualDriver: false, sslResponses: 0, sslConnectEvents: 0,
      queriesStarted: 0, endCalls: 0, nativeEndFulfilled: false,
      streamCloses: 0, clientEnds: 0, clientErrors: new Array<string>(),
      errorsAfterEnd: 0, errorListenersAfterEnd: -1,
    };
    let observedClient: Client | undefined;
    class ObservedClient extends Client {
      override emit(event: string | symbol, ...args: unknown[]): boolean {
        if (event === "end") state.clientEnds++;
        if (event === "error") {
          const cause = args[0];
          state.clientErrors.push(cause instanceof Error ? cause.message : String(cause));
          if (state.nativeEndFulfilled) state.errorsAfterEnd++;
        }
        // Observation never adds an error listener or replaces native emission.
        return super.emit(event, ...args);
      }
      override async end(): Promise<void> {
        state.endCalls++;
        await super.end();
        state.nativeEndFulfilled = true;
      }
    }

    const program = Effect.scoped(Effect.gen(function* () {
      const owner = yield* Effect.acquireRelease(Effect.sync(() => {
        const url = new URL(env.DATABASE_URL);
        for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
        const client = new ObservedClient({
          connectionString: url.href, ssl: true,
          application_name: env.APPLICATION_NAME, connectionTimeoutMillis: 5_000,
        });
        observedClient = client;
        const observation = observePostgresClientLifetime(client);
        const lifetime = createExecutorClientLifetime(client);
        return { client, observation, lifetime };
      }), owner => Effect.tryPromise(() => owner.observation.finish(owner.lifetime.release)).pipe(Effect.orDie));

      yield* Effect.sync(() => {
        // pg's Node declaration says Duplex; its workerd branch returns the
        // foreign CloudflareSocket value instead. Validate that actual value.
        const stream: unknown = owner.client.connection.stream;
        if (!(stream instanceof CloudflareSocket)) throw new Error("PostgreSQL fixture did not select the actual pg-used CloudflareSocket.");
        state.actualDriver = true;
        stream.once("data", (bytes: unknown) => {
          if (Buffer.isBuffer(bytes) && bytes.length === 1 && bytes[0] === 83) state.sslResponses++;
        });
        stream.on("close", () => { state.streamCloses++; });
        owner.client.connection.on("sslconnect", () => { state.sslConnectEvents++; });
      });
      yield* Effect.tryPromise(() => owner.client.connect());
      const result = yield* Effect.tryPromise(() => {
        state.queriesStarted++;
        return owner.client.query(`
          select 1 as value, s.pid, s.ssl, s.version as "tlsVersion", s.cipher,
                 r.rolsuper as superuser, r.rolbypassrls as bypass,
                 current_setting('application_name') as "applicationName"
          from pg_stat_ssl s cross join pg_roles r
          where s.pid=pg_backend_pid() and r.rolname=current_user
        `);
      });
      return yield* Schema.decodeUnknownEffect(PostgresTlsRow)(result.rows[0]);
    }));
    const exit = await Effect.runPromiseExit(program);
    if (observedClient !== undefined) state.errorListenersAfterEnd = observedClient.listenerCount("error");
    return Response.json({
      ok: Exit.isSuccess(exit),
      cause: Exit.isFailure(exit) ? Cause.pretty(exit.cause) : null,
      row: Exit.isSuccess(exit) ? exit.value : null,
      ...state,
    });
  },
};

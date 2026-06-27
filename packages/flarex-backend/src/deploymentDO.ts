import { DurableObject } from "cloudflare:workers";
import { Effect, ManagedRuntime } from "effect";
import {
  parseAnalyzedStartPushRequest,
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
} from "flarex-protocol/deployment";
import { makeDeploymentLayer } from "./deployment/Layer";
import {
  deploymentFailureToHttpError,
  type DeploymentServiceFailure,
} from "./deployment/HttpBoundary";
import {
  DeploymentService,
  type DeploymentServiceApi,
} from "./deployment/Service";
import {
  analyzedStartPushRequest,
  startAnalyzedPushInput,
} from "./deployment/Validation";
import { errorResponse, json, readJson } from "./http";
import type {
  Env,
  FinishPushRequest,
} from "./types";

export class DeploymentDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly deploymentRuntime = ManagedRuntime.make(
    makeDeploymentLayer(
      this.ctx.storage,
      this.sql,
    ),
  );

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tables (
        table_id INTEGER PRIMARY KEY,
        table_name TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        schema_json TEXT,
        partition_rule_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexes (
        index_id INTEGER PRIMARY KEY,
        table_id INTEGER NOT NULL,
        index_name TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        state TEXT NOT NULL,
        UNIQUE(table_id, index_name)
      );
      CREATE TABLE IF NOT EXISTS functions (
        function_path TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        visibility TEXT NOT NULL,
        args_json TEXT,
        returns_json TEXT,
        route_json TEXT,
        partition_json TEXT,
        position_json TEXT
      );
      CREATE TABLE IF NOT EXISTS pushes (
        push_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        source_package_json TEXT NOT NULL,
        schema_json TEXT,
        functions_json TEXT,
        codegen_analysis_json TEXT,
        error TEXT,
        diagnostics_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.ensureFunctionPositionColumn();
    this.ensureFunctionRouteColumn();
    this.ensureFunctionPartitionColumn();
    this.ensurePushCodegenAnalysisColumn();
    this.ensurePushDiagnosticsColumn();
    this.setMetaIfMissing("schema_version", "0");
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return json({ service: "flarex-deployment", status: "ok" });
      }
      if (url.pathname === "/deployment" && request.method === "GET") {
        return json(await this.runDeploymentService(service => service.getActiveDeployment()));
      }
      if (url.pathname === "/push/start-analyzed" && request.method === "POST") {
        const body = parseAnalyzedStartPushRequest(await readJson(request));
        return json(await this.runDeploymentService(service =>
          service.startAnalyzedPush(startAnalyzedPushInput(analyzedStartPushRequest(body)))
        ));
      }
      const pushMatch = url.pathname.match(/^\/push\/([^/]+)(?:\/([^/]+))?$/);
      if (pushMatch) {
        const pushId = decodeURIComponent(pushMatch[1]!);
        const action = pushMatch[2];
        if (action === undefined && request.method === "GET") {
          return json(await this.runDeploymentService(service => service.getPush(pushId)));
        }
        if (action === "finish" && request.method === "POST") {
          await readJson<FinishPushRequest>(request);
          const response = await this.runDeploymentService(service => service.finishPush(pushId));
          return json(response, { status: response.result === "rejected" ? 409 : 200 });
        }
        if (action === "abandon" && request.method === "POST") {
          const body = parseAbandonPushRequest(await readJson(request));
          return json(await this.runDeploymentService(service =>
            service.abandonPush(pushId, body.reason === undefined ? {} : { reason: body.reason })
          ));
        }
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      if (error instanceof DeploymentProtocolValidationError) {
        return json({ error: error.message }, { status: 400 });
      }
      return errorResponse(error);
    }
  }

  private async runDeploymentService<A>(
    use: (service: DeploymentServiceApi) => Effect.Effect<A, DeploymentServiceFailure>,
  ): Promise<A> {
    return this.runDeployment(DeploymentService.use(use));
  }

  private async runDeployment<A>(
    effect: Effect.Effect<
      A,
      DeploymentServiceFailure,
      DeploymentService
    >,
  ): Promise<A> {
    const result = await this.deploymentRuntime.runPromise(
      effect.pipe(
        Effect.match({
          onFailure: error => ({ ok: false as const, error }),
          onSuccess: value => ({ ok: true as const, value }),
        }),
      ),
    );
    if (!result.ok) {
      throw deploymentFailureToHttpError(result.error);
    }
    return result.value;
  }

  private setMetaIfMissing(key: string, value: string): void {
    this.sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  private ensurePushDiagnosticsColumn(): void {
    try {
      this.sql.exec("ALTER TABLE pushes ADD COLUMN diagnostics_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN. Existing
      // deployments created after the column was added will raise here.
    }
  }

  private ensurePushCodegenAnalysisColumn(): void {
    try {
      this.sql.exec("ALTER TABLE pushes ADD COLUMN codegen_analysis_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN. Existing
      // deployments created after the column was added will raise here.
    }
  }

  private ensureFunctionPositionColumn(): void {
    try {
      this.sql.exec("ALTER TABLE functions ADD COLUMN position_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN.
    }
  }

  private ensureFunctionRouteColumn(): void {
    try {
      this.sql.exec("ALTER TABLE functions ADD COLUMN route_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN.
    }
  }

  private ensureFunctionPartitionColumn(): void {
    try {
      this.sql.exec("ALTER TABLE functions ADD COLUMN partition_json TEXT");
    } catch {
      // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN.
    }
  }
}

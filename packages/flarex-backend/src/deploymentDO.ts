import { DurableObject } from "cloudflare:workers";
import { Effect, ManagedRuntime } from "effect";
import {
  parseAnalyzedStartPushRequest,
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
} from "flarex-protocol/deployment";
import { makeDeploymentLayer } from "./deployment/Layer";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
} from "./deployment/Errors";
import { DeploymentService } from "./deployment/Service";
import type { DeploymentSqlError } from "./deployment/Store";
import {
  analyzedStartPushRequest,
  codegenAnalysisFromDeploymentAnalysis,
  validateAnalysis,
  validateCodegenAnalysis,
  validateDiagnostics,
  validateSourcePackage,
} from "./deployment/Validation";
import { errorResponse, HttpError, json, readJson } from "./http";
import type {
  ActiveDeploymentStatus,
  AbandonPushRequest,
  AnalyzedStartPushRequest,
  Env,
  FinishPushResponse,
  FinishPushRequest,
  PushStatus,
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
        return json(await this.activeDeployment());
      }
      if (url.pathname === "/push/start-analyzed" && request.method === "POST") {
        const body = parseAnalyzedStartPushRequest(await readJson(request));
        return json(await this.startPush(analyzedStartPushRequest(body)));
      }
      const pushMatch = url.pathname.match(/^\/push\/([^/]+)(?:\/([^/]+))?$/);
      if (pushMatch) {
        const pushId = decodeURIComponent(pushMatch[1]!);
        const action = pushMatch[2];
        if (action === undefined && request.method === "GET") {
          return json(await this.pushStatus(pushId));
        }
        if (action === "finish" && request.method === "POST") {
          const response = await this.finishPush(pushId, await readJson<FinishPushRequest>(request));
          return json(response, { status: response.result === "rejected" ? 409 : 200 });
        }
        if (action === "abandon" && request.method === "POST") {
          const body = parseAbandonPushRequest(await readJson(request));
          return json(await this.abandonPush(
            pushId,
            body.reason === undefined ? {} : { reason: body.reason },
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

  private async startPush(request: AnalyzedStartPushRequest): Promise<PushStatus> {
    const sourcePackage = validateSourcePackage(request.sourcePackage);
    const error = request.error;
    const analysis = request.analysis === undefined ? undefined : validateAnalysis(request.analysis);
    const diagnostics = validateDiagnostics(request.diagnostics);
    if (analysis === undefined) {
      if (typeof error !== "string" || error.length === 0) {
        throw new HttpError(400, "A push without analysis must include an error message.");
      }
      return this.runDeployment(
        DeploymentService.use(service =>
          service.startAnalyzedPush({
            sourcePackage,
            error,
            diagnostics,
          })
        ),
      );
    }
    const hasCodegenAnalysis = Object.prototype.hasOwnProperty.call(request, "codegenAnalysis");
    const codegenAnalysis = validateCodegenAnalysis(
      hasCodegenAnalysis ? request.codegenAnalysis : codegenAnalysisFromDeploymentAnalysis(analysis),
      analysis,
    );
    return this.runDeployment(
      DeploymentService.use(service =>
        service.startAnalyzedPush({
          sourcePackage,
          analysis,
          codegenAnalysis,
          diagnostics,
        })
      ),
    );
  }

  private async runDeployment<A>(
    effect: Effect.Effect<
      A,
      | DeploymentActiveDeploymentNotFoundError
      | DeploymentPushInvalidStateError
      | DeploymentPushNotFoundError
      | DeploymentSqlError
      | HttpError,
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
      if (result.error instanceof DeploymentActiveDeploymentNotFoundError) {
        throw new HttpError(404, "No active deployment.");
      }
      if (result.error instanceof DeploymentPushNotFoundError) {
        throw new HttpError(404, `Unknown push: ${result.error.pushId}`);
      }
      if (result.error instanceof DeploymentPushInvalidStateError) {
        if (result.error.action === "abandon") {
          throw new HttpError(409, `Cannot abandon push ${result.error.pushId} in state ${result.error.state}.`);
        }
      }
      if (result.error instanceof HttpError) {
        throw result.error;
      }
      throw new HttpError(500, "Deployment storage error.");
    }
    return result.value;
  }

  private async activeDeployment(): Promise<ActiveDeploymentStatus> {
    return this.runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()),
    );
  }

  private async pushStatus(pushId: string): Promise<PushStatus> {
    return this.runDeployment(
      DeploymentService.use(service => service.getPush(pushId)),
    );
  }

  private async finishPush(pushId: string, _request: FinishPushRequest): Promise<FinishPushResponse> {
    return this.runDeployment(
      DeploymentService.use(service => service.finishPush(pushId)),
    );
  }

  private async abandonPush(pushId: string, request: AbandonPushRequest): Promise<PushStatus> {
    return this.runDeployment(
      DeploymentService.use(service => service.abandonPush(pushId, request)),
    );
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

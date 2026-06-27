import { DurableObject } from "cloudflare:workers";
import {
  parseCreateDeploymentRequest,
  ProtocolValidationError,
  type CreateDeploymentRequest,
  type DeploymentRecord,
  type ListDeploymentsResponse,
} from "flarex-protocol/registry";
import { errorResponse, json, readJson } from "./http";
import type { Env } from "./types";

export class RegistryDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS deployments (
        deployment_id TEXT PRIMARY KEY,
        slug TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        schema_version INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS deployments_by_slug ON deployments(slug);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return json({ service: "flarex-registry", status: "ok" });
      }
      if (url.pathname === "/deployments" && request.method === "POST") {
        const body = parseCreateDeploymentRequest(await readJson(request));
        return json(await this.createDeployment(body));
      }
      if (url.pathname === "/deployments" && request.method === "GET") {
        return json({ deployments: this.listDeployments() } satisfies ListDeploymentsResponse);
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      if (error instanceof ProtocolValidationError) {
        return json({ error: error.message }, { status: 400 });
      }
      return errorResponse(error);
    }
  }

  private createDeployment(request: CreateDeploymentRequest): DeploymentRecord {
    const now = Date.now();
    const deploymentId = request.deploymentId ?? crypto.randomUUID();
    this.sql.exec(
      `
      INSERT INTO deployments (deployment_id, slug, created_at, updated_at, schema_version)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(deployment_id) DO UPDATE SET
        slug = excluded.slug,
        updated_at = excluded.updated_at
      `,
      deploymentId,
      request.slug ?? null,
      now,
      now,
    );
    return {
      deploymentId,
      ...(request.slug === undefined ? {} : { slug: request.slug }),
      createdAt: now,
      updatedAt: now,
      schemaVersion: 0,
    };
  }

  private listDeployments(): DeploymentRecord[] {
    return this.sql
      .exec<{
        deployment_id: string;
        slug: string | null;
        created_at: number;
        updated_at: number;
        schema_version: number;
      }>(
        `
        SELECT deployment_id, slug, created_at, updated_at, schema_version
        FROM deployments
        ORDER BY created_at DESC
        `,
      )
      .toArray()
      .map(row => {
        return {
          deploymentId: row.deployment_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          schemaVersion: row.schema_version,
          ...(row.slug === null ? {} : { slug: row.slug }),
        };
      });
  }
}

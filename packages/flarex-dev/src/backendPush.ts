import type { Miniflare } from "miniflare";
import type { ValidatorJSON } from "flarex/values";
import type {
  DeploymentAnalysis as BackendDeploymentAnalysis,
  DeploymentFunctionMetadata,
  FunctionPartitionMetadata,
  ValidatorJson as BackendValidatorJson,
} from "flarex-backend/types";
import type { DeploymentAnalysis as CodegenDeploymentAnalysis } from "./analyze.ts";
import {
  ExecutionArtifactAnalysisError,
  LocalMiniflareExecutionArtifactAdapter,
  type AnalyzerDiagnostic,
  type ExecutionArtifactAdapter,
} from "./executionArtifact.ts";
import type { SourcePackage } from "./sourcePackage.ts";

export type DevPushStatus = {
  pushId: string;
  state: "pending" | "analyzed" | "failed" | "activated" | "superseded";
  analysis?: BackendDeploymentAnalysis;
  codegenAnalysis?: CodegenDeploymentAnalysis;
  error?: string;
  diagnostics?: AnalyzerDiagnostic[];
};

export interface BackendPushCoordinator {
  start(sourcePackage: SourcePackage): Promise<DevPushStatus>;
  finish(pushId: string): Promise<DevPushStatus>;
}

export interface BackendSourceAnalyzer {
  analyze(sourcePackage: SourcePackage): Promise<BackendSourceAnalysisResult>;
}

export type BackendSourceAnalysisResult = {
  analysis: CodegenDeploymentAnalysis;
  diagnostics?: AnalyzerDiagnostic[];
};

const NONDETERMINISTIC_ANALYSIS_ERROR =
  "Flarex analysis is nondeterministic across cold isolates.";

export class LocalExecutionArtifactBackendAnalyzer implements BackendSourceAnalyzer {
  private readonly executionArtifact: ExecutionArtifactAdapter;

  constructor(executionArtifact: ExecutionArtifactAdapter = new LocalMiniflareExecutionArtifactAdapter()) {
    this.executionArtifact = executionArtifact;
  }

  async analyze(sourcePackage: SourcePackage): Promise<BackendSourceAnalysisResult> {
    const first = await this.analyzeOnce(sourcePackage);
    const second = await this.analyzeOnce(sourcePackage);
    const diagnostics = [...(first.diagnostics ?? []), ...(second.diagnostics ?? [])];
    if (stableAnalysisJson(first.analysis) !== stableAnalysisJson(second.analysis)) {
      throw new ExecutionArtifactAnalysisError(NONDETERMINISTIC_ANALYSIS_ERROR, [
        ...diagnostics,
        { level: "error", message: NONDETERMINISTIC_ANALYSIS_ERROR },
      ]);
    }
    return {
      analysis: first.analysis,
      diagnostics,
    };
  }

  private async analyzeOnce(sourcePackage: SourcePackage): Promise<BackendSourceAnalysisResult> {
    if (this.executionArtifact.analyzeWithDiagnostics !== undefined) {
      return this.executionArtifact.analyzeWithDiagnostics(sourcePackage);
    }
    return {
      analysis: await this.executionArtifact.analyze(sourcePackage),
      diagnostics: [],
    };
  }
}

export class LocalBackendPushCoordinator implements BackendPushCoordinator {
  private readonly backend: Miniflare;
  private readonly deploymentId: string;

  constructor(backend: Miniflare, deploymentId: string) {
    this.backend = backend;
    this.deploymentId = deploymentId;
  }

  async start(sourcePackage: SourcePackage): Promise<DevPushStatus> {
    return postBackend<DevPushStatus>(
      this.backend,
      `/deployments/${this.deploymentId}/push/start`,
      {
        sourcePackage,
      },
    );
  }

  finish(pushId: string): Promise<DevPushStatus> {
    return postBackend<DevPushStatus>(
      this.backend,
      `/deployments/${this.deploymentId}/push/${pushId}/finish`,
      {},
    );
  }
}

export function createLocalAnalyzerService(
  analyzer: BackendSourceAnalyzer = new LocalExecutionArtifactBackendAnalyzer(),
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/analyze" || request.method !== "POST") {
      return Response.json({ error: "Analyzer route not found." }, { status: 404 });
    }
    try {
      const body = await request.json() as { sourcePackage?: SourcePackage };
      if (body.sourcePackage === undefined) {
        return Response.json({ error: "Analyzer request missing sourcePackage." }, { status: 400 });
      }
      const result = await analyzer.analyze(body.sourcePackage);
      return Response.json({
        analysis: backendAnalysisFromCodegenAnalysis(result.analysis),
        diagnostics: result.diagnostics ?? [],
      });
    } catch (error) {
      return Response.json(
        { error: errorMessage(error), diagnostics: diagnosticsFromError(error) },
        { status: 400 },
      );
    }
  };
}

export function backendAnalysisFromCodegenAnalysis(
  analysis: CodegenDeploymentAnalysis,
): BackendDeploymentAnalysis {
  return {
    schema: {
      version: analysis.schema.version,
      tables: analysis.schema.tables.map(table => ({
        tableId: table.tableId,
        name: table.name,
        validator: backendValidatorJson(table.validator),
        placement: table.placement,
      })),
      indexes: analysis.schema.indexes.map(index => ({
        indexId: index.indexId,
        tableId: index.tableId,
        name: index.name,
        fields: [...index.fields],
      })),
    },
    functions: {
      functions: analysis.functions.flatMap(module =>
        module.functions.map((fn): DeploymentFunctionMetadata => ({
          path: fn.exportName === "default" ? fn.moduleName : `${fn.moduleName}:${fn.exportName}`,
          kind: fn.kind,
          visibility: fn.visibility,
          args: backendValidatorJson(fn.args),
          returns: backendValidatorJson(fn.returns),
          route: null,
          partition: backendFunctionPartition(fn.partition ?? null),
          ...(fn.position === undefined ? {} : { position: fn.position }),
        })),
      ),
    },
  };
}

function backendFunctionPartition(
  partition: CodegenDeploymentAnalysis["functions"][number]["functions"][number]["partition"] | null,
): FunctionPartitionMetadata | null {
  if (partition === null || partition === undefined) return null;
  switch (partition.type) {
    case "partition":
      return {
        type: "partition",
        table: partition.table,
        selector: partition.selector,
        partitionField: partition.partitionField,
        argField: partition.argField,
      };
    case "partitionCreateRoot":
      return {
        type: "partitionCreateRoot",
        table: partition.table,
        partitionField: partition.partitionField,
      };
    case "partitionRoot":
      throw new Error(
        `partitionRoot metadata for table ${partition.table} is not executable backend metadata.`,
      );
    default:
      partition satisfies never;
      return null;
  }
}

function backendValidatorJson(value: ValidatorJSON | null): BackendValidatorJson | null {
  if (value === null) return null;
  switch (value.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return { type: value.type };
    case "id":
      return { type: "id", tableName: value.tableName };
    case "literal": {
      if (typeof value.value === "bigint") {
        throw new Error("BigInt literal validators are not supported by backend deployment metadata.");
      }
      return { type: "literal", value: value.value };
    }
    case "array":
      return { type: "array", value: backendRequiredValidatorJson(value.value) };
    case "object": {
      const fields: Record<string, { fieldType: BackendValidatorJson; optional: boolean }> = {};
      for (const [name, field] of Object.entries(value.value)) {
        fields[name] = {
          fieldType: backendRequiredValidatorJson(field.fieldType),
          optional: field.optional,
        };
      }
      return { type: "object", value: fields };
    }
    case "record":
      return {
        type: "record",
        keys: backendRequiredValidatorJson(value.keys),
        values: backendRequiredValidatorJson(value.values),
      };
    case "union":
      return {
        type: "union",
        value: value.value.map(member => backendRequiredValidatorJson(member)),
      };
    default:
      value satisfies never;
      throw new Error("Unsupported validator metadata.");
  }
}

function backendRequiredValidatorJson(value: ValidatorJSON): BackendValidatorJson {
  const validator = backendValidatorJson(value);
  if (validator === null) {
    throw new Error("Required backend validator cannot be null.");
  }
  return validator;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticsFromError(error: unknown): AnalyzerDiagnostic[] {
  return error instanceof ExecutionArtifactAnalysisError ? error.diagnostics : [];
}

function stableAnalysisJson(analysis: CodegenDeploymentAnalysis): string {
  return JSON.stringify(analysis);
}

async function postBackend<T>(backend: Miniflare, path: string, body: unknown): Promise<T> {
  const response = await backend.dispatchFetch(`http://flarex.backend${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend request ${path} failed with status ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

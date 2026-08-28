/// <reference types="@cloudflare/workers-types" />

import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import {
  produceApplicationSource,
  type ApplicationSource,
  type PreparedApplication,
} from "@flarex/application-definition";
import {
  produceStandardApplicationSource,
} from "@flarex/standard-application-definition/application-source";
import {
  applicationAnalysisHostEffectWithCapabilities,
} from "@flarex/source-analyzer-v2/internal/application-analysis-host";
import {
  makeApplicationAnalysisContext,
} from "@flarex/source-analyzer-v2/internal/application-analysis-composition";
import { produceInternalStandardApplicationSourceWithRelations } from
  "@flarex/standard-application-definition/internal/relation-definition";
import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import type {
  ApplicationNativeMutationAnalysis,
  ApplicationNativeMutationSourceBundle,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  ApplicationAnalysisSourceReadError,
  type ApplicationAnalysisSourceBundle,
} from "flarex-backend/internal/application-analysis-source-reader";
import { Effect, Result } from "effect";
import { Miniflare } from "miniflare";

const COMPATIBILITY_DATE = "2026-06-14";
const SOURCE_UTF8 = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

export function decodeStandardApplicationCurrentSourceTextV1(
  sourceBytes: Uint8Array,
): string {
  return SOURCE_UTF8.decode(sourceBytes);
}

export async function produceApplicationCurrentSourceBundle(
  definition: PreparedApplication,
): Promise<ApplicationNativeMutationSourceBundle> {
  const produced = Result.getOrThrow(produceApplicationSource(definition));
  return sourceBundleFromProduced(produced);
}

export async function produceStandardApplicationCurrentSourceBundleV1(
  definition: PreparedStandardApplicationDefinitionV1,
): Promise<ApplicationNativeMutationSourceBundle> {
  const produced = Result.getOrThrow(
    produceStandardApplicationSource(definition),
  );
  return sourceBundleFromProduced(produced);
}

export async function produceStandardApplicationCurrentRelationSourceBundleV1(
  definition: PreparedStandardApplicationDefinitionV1,
  relationDeclarationInputs: unknown,
): Promise<ApplicationNativeMutationSourceBundle> {
  const produced = Result.getOrThrow(
    produceInternalStandardApplicationSourceWithRelations(
      definition,
      relationDeclarationInputs,
    ),
  );
  return sourceBundleFromProduced(produced);
}

async function sourceBundleFromProduced(
  produced: ApplicationSource,
): Promise<ApplicationNativeMutationSourceBundle> {
  const modules = Object.freeze(await Promise.all(produced.modules.map(
    async module => Object.freeze({
      path: module.path,
      roles: module.roles,
      sourceSha256: await sha256Hex(module.sourceBytes),
      sourceByteLength: module.sourceBytes.byteLength,
      source: decodeStandardApplicationCurrentSourceTextV1(module.sourceBytes),
    }),
  )));
  const rootSha256 = await sha256Hex(new TextEncoder().encode(
    modules.map(module => `${module.path}:${module.sourceSha256}`).join("\n"),
  ));
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256,
      executionModulePath: produced.executionPath,
      schemaModulePath: produced.schemaPath,
      modules: Object.freeze(modules.map(module => Object.freeze({
        path: module.path,
        roles: module.roles,
        sourceSha256: module.sourceSha256,
        sourceByteLength: module.sourceByteLength,
      }))),
    }),
    modules,
  });
}

export function makeStandardApplicationCurrentAnalysisV1(
  source: ApplicationNativeMutationSourceBundle,
  loader: WorkerLoader,
  applicationId: string,
): ApplicationNativeMutationAnalysis {
  const run: ApplicationNativeMutationAnalysis["run"] = async input => {
    const context = makeApplicationAnalysisContext({
      authority: input.authority,
      repository: input.repository,
      host: {
        analyze: request => applicationAnalysisHostEffectWithCapabilities({
          source: {
            read: rootSha256 => rootSha256 === input.sourceArtifactRootSha256
              ? Effect.succeed(source satisfies ApplicationAnalysisSourceBundle)
              : Effect.fail(new ApplicationAnalysisSourceReadError({
                operation: "read",
                reason: "invalidRoot",
              })),
          },
          loader,
        }, request),
      },
    });
    const analyzed = await Effect.runPromise(context.analyze({
      requestKey: input.requestKey,
      sourceArtifactRootSha256: input.sourceArtifactRootSha256,
    }));
    if (analyzed.kind !== "analyzed") {
      throw new Error(
        `Standard Application simulation ${applicationId} was rejected by Application Analysis.`,
        { cause: analyzed.receipt },
      );
    }
    return Effect.runPromise(input.repository.inspect(
      input.authority,
      analyzed.receipt.candidateId,
    ));
  };
  return Object.freeze({ source, run });
}

export class MiniflareApplicationAnalysisWorkerLoader implements WorkerLoader {
  loads = 0;
  readonly #disposals: Array<Promise<void>> = [];
  readonly #runtimes = new Set<Miniflare>();

  get(): WorkerStub {
    throw new Error("Application analysis forbids cached Worker loading.");
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new MiniflareApplicationAnalysisWorkerStub(this, code);
  }

  attach(runtime: Miniflare): void {
    this.#runtimes.add(runtime);
  }

  release(runtime: Miniflare): void {
    if (!this.#runtimes.delete(runtime)) return;
    this.#disposals.push(runtime.dispose());
  }

  async dispose(): Promise<void> {
    const runtimes = [...this.#runtimes];
    this.#runtimes.clear();
    await Promise.all([
      ...this.#disposals.splice(0),
      ...runtimes.map(runtime => runtime.dispose()),
    ]);
  }
}

class MiniflareApplicationAnalysisWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: MiniflareApplicationAnalysisWorkerLoader,
    private readonly code: WorkerLoaderWorkerCode,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    const entrypoint = {
      analyze: () => this.analyze(name),
      fetch: async () => new Response(null, { status: 501 }),
      connect: () => {
        throw new Error("Application analysis forbids sockets.");
      },
    };
    // SAFETY: the test adapter implements the exact analyze RPC used by the
    // Application Analysis host plus Cloudflare's declared Fetcher surface.
    return entrypoint as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Application analysis forbids Durable Objects.");
  }

  private async analyze(name: string | undefined): Promise<unknown> {
    if (name === undefined) {
      throw new Error("Application analysis omitted its Worker entrypoint.");
    }
    const script = `export default {
  async fetch(_request, env) {
    const worker = env.LOADER.load(${JSON.stringify(this.code)});
    const stub = worker.getEntrypoint(${JSON.stringify(name)});
    const result = await stub.analyze();
    try { return Response.json(result); }
    finally { result?.[Symbol.dispose]?.(); }
  },
};`;
    const runtime = new Miniflare({
      compatibilityDate: COMPATIBILITY_DATE,
      modules: true,
      script,
      workerLoaders: { LOADER: {} },
    });
    this.owner.attach(runtime);
    try {
      const response = await runtime.dispatchFetch(
        "https://standard-application-analysis.invalid/",
      );
      return await response.json();
    } finally {
      this.owner.release(runtime);
    }
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  ))]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

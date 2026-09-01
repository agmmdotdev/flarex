import {
  defineMedusaFetchHttpRuntime,
  type MedusaFetchHttpAdditionalManifestInput,
  type MedusaFetchHttpCommitSession,
  type MedusaFetchHttpCreateRequestScope,
  type MedusaFetchHttpCreateSession,
  type MedusaFetchHttpPrepareRequest,
  type MedusaFetchHttpRuntimeOptions,
} from "@medusajs/medusa/static/fetch-http-handler"
import type {
  HttpResourceSet,
  StaticHttpResourceSetInput,
} from "@medusajs/framework/http/static"
import type { CommerceModulesRuntime } from "./commerce-modules"
import { createMedusaCloudflareRequestScopeFactory } from "./cloudflare-http-request-scope"

export type MedusaCloudflareHttpRuntimeHooks = {
  createRequestScope: MedusaFetchHttpCreateRequestScope
  createSession?: MedusaFetchHttpCreateSession
  commitSession?: MedusaFetchHttpCommitSession
  prepareRequest?: MedusaFetchHttpPrepareRequest
}

export type MedusaCloudflareHttpRuntimeComposition = {
  additionalManifests?: MedusaFetchHttpAdditionalManifestInput
  resources?: HttpResourceSet
  resourcesBeforeManifest?: readonly StaticHttpResourceSetInput[]
  resourcesAfterManifest?: readonly StaticHttpResourceSetInput[]
}

export type MedusaCloudflareHttpRuntimeOptionsInput =
  MedusaCloudflareHttpRuntimeHooks & MedusaCloudflareHttpRuntimeComposition

export type MedusaCloudflareHttpModuleRuntime = Pick<
  CommerceModulesRuntime,
  "container"
>

export type MedusaCloudflareHttpModuleRuntimeOptionsInput =
  Omit<MedusaCloudflareHttpRuntimeHooks, "createRequestScope"> &
    MedusaCloudflareHttpRuntimeComposition & {
      runtime: MedusaCloudflareHttpModuleRuntime
    }

export function createMedusaCloudflareHttpRuntimeOptions(
  input: MedusaCloudflareHttpRuntimeOptionsInput
): MedusaFetchHttpRuntimeOptions {
  return defineMedusaFetchHttpRuntime(input)
}

export function createMedusaCloudflareHttpRuntimeOptionsFromModuleRuntime({
  runtime,
  ...input
}: MedusaCloudflareHttpModuleRuntimeOptionsInput): MedusaFetchHttpRuntimeOptions {
  return createMedusaCloudflareHttpRuntimeOptions({
    ...input,
    createRequestScope: createMedusaCloudflareRequestScopeFactory(
      runtime.container
    ),
  })
}

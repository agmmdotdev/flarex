import {
  createFetchHttpStaticHandler,
  type CreateFetchHttpStaticHandlerOptions,
  type FetchHttpStaticHandler,
} from "@medusajs/framework/http/fetch"
import type { StaticHttpResourceManifest } from "@medusajs/framework/http/static"
import { medusaStaticHttpManifest } from "./http-manifest"

export type MedusaFetchHttpCreateRequestScope =
  NonNullable<CreateFetchHttpStaticHandlerOptions["createRequestScope"]>

export type MedusaFetchHttpPrepareRequest =
  NonNullable<CreateFetchHttpStaticHandlerOptions["prepareRequest"]>

export type MedusaFetchHttpCreateSession =
  NonNullable<CreateFetchHttpStaticHandlerOptions["createSession"]>

export type MedusaFetchHttpCommitSession =
  NonNullable<CreateFetchHttpStaticHandlerOptions["commitSession"]>

export type MedusaFetchHttpHandleSetupRequest =
  NonNullable<CreateFetchHttpStaticHandlerOptions["handleSetupRequest"]>

export type MedusaFetchHttpIsSetupPath =
  NonNullable<CreateFetchHttpStaticHandlerOptions["isSetupPath"]>

export type MedusaFetchHttpRuntimeHooks = Pick<
  CreateFetchHttpStaticHandlerOptions,
  | "createRequestScope"
  | "createSession"
  | "commitSession"
  | "prepareRequest"
  | "handleSetupRequest"
  | "isSetupPath"
  | "resources"
  | "resourcesBeforeManifest"
  | "resourcesAfterManifest"
>

export type MedusaFetchHttpAdditionalManifestInput =
  | StaticHttpResourceManifest
  | readonly StaticHttpResourceManifest[]

export type MedusaFetchHttpRuntimeOptions = MedusaFetchHttpRuntimeHooks & {
  additionalManifests?: MedusaFetchHttpAdditionalManifestInput
}

export type CreateMedusaFetchHttpHandlerOptions =
  MedusaFetchHttpRuntimeOptions

export interface LazyMedusaFetchHttpHandler {
  handle(request: Request): Promise<Response>
  tryHandle(request: Request): Promise<Response | undefined>
  isPathHandled(pathname: string): boolean
}

export function defineMedusaFetchHttpRuntime<
  TOptions extends MedusaFetchHttpRuntimeOptions
>(options: TOptions): TOptions {
  return options
}

export function createMedusaFetchHttpHandler({
  additionalManifests,
  ...options
}: MedusaFetchHttpRuntimeOptions): FetchHttpStaticHandler {
  return createFetchHttpStaticHandler({
    ...options,
    manifest: [
      ...normalizeAdditionalManifests(additionalManifests),
      medusaStaticHttpManifest,
    ],
  })
}

export function createLazyMedusaFetchHttpHandler(
  options: MedusaFetchHttpRuntimeOptions
): LazyMedusaFetchHttpHandler {
  let handler: FetchHttpStaticHandler | undefined
  const getHandler = () => {
    handler ??= createMedusaFetchHttpHandler(options)
    return handler
  }

  return {
    async handle(request: Request): Promise<Response> {
      return await getHandler().handle(request)
    },

    async tryHandle(request: Request): Promise<Response | undefined> {
      return await getHandler().tryHandle(request)
    },

    isPathHandled(pathname: string): boolean {
      return getHandler().isPathHandled(pathname)
    },
  }
}

function normalizeAdditionalManifests(
  manifests: MedusaFetchHttpAdditionalManifestInput | undefined
): StaticHttpResourceManifest[] {
  if (!manifests) {
    return []
  }

  return isStaticHttpResourceManifestArray(manifests)
    ? [...manifests]
    : [manifests]
}

function isStaticHttpResourceManifestArray(
  manifests: MedusaFetchHttpAdditionalManifestInput
): manifests is readonly StaticHttpResourceManifest[] {
  return Array.isArray(manifests)
}

import type { z } from "@medusajs/deps/zod"
import type { FindConfig } from "@medusajs/types"
import type { RequestQueryFields } from "@medusajs/types/common/common"

// Native Zod optional properties can be present with undefined after decoding.
export type DecodedQueryFields = { [Key in keyof RequestQueryFields]: RequestQueryFields[Key] | undefined }

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const
export type RouteVerb = (typeof HTTP_METHODS)[number]
export type MiddlewareVerb = "USE" | "ALL" | RouteVerb
export type HttpPathMatching = "exact" | "prefix"
export type AuthContext = {
  actor_id: string
  actor_type: string
  auth_identity_id: string
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
}
export type PublishableKeyContext = { key: string; sales_channel_ids: string[] }
export type PolicyAction = { resource: string; operation: string | readonly string[] }
export interface MedusaRequest<Body = unknown, QueryFields = Record<string, unknown>> {
  method: string
  url: string
  originalUrl: string
  path: string
  protocol: string
  params: Record<string, string>
  query: Record<string, unknown>
  headers: Record<string, string>
  get(name: string): string | undefined
  scope: { resolve<T = unknown>(key: string): T; createScope(): MedusaRequest["scope"] }
  body?: Body
  validatedBody: Body
  validatedQuery: DecodedQueryFields & Record<string, unknown> & QueryFields
  filterableFields: QueryFields
  listConfig?: FindConfig<unknown>
  retrieveConfig?: FindConfig<unknown>
  queryConfig: { fields: string[]; pagination: { skip?: number; take?: number; order?: Record<string, unknown> }; withDeleted?: boolean }
  remoteQueryConfig: MedusaRequest["queryConfig"]
  allowedProperties: string[]
  allowed?: string[]
  errors: string[]
  locale?: string
  context?: Record<string, unknown>
  requestId?: string
  auth_context?: AuthContext
  publishable_key_context?: PublishableKeyContext
  session?: Record<string, unknown> & { auth_context?: AuthContext }
  restrictedFields?: { list(): string[] }
  policies?: readonly PolicyAction[]
  additionalDataValidator?: AdditionalDataValidator
}
export type AuthenticatedMedusaRequest<Body = unknown, QueryFields = Record<string, unknown>> = MedusaRequest<Body, QueryFields> & { auth_context: AuthContext }
export type MedusaStoreRequest<Body = unknown, QueryFields = Record<string, unknown>> = MedusaRequest<Body, QueryFields>
export interface MedusaResponse<Body = unknown> {
  status(code: number): MedusaResponse<Body>
  json(body: Body): MedusaResponse<Body>
  setHeader(name: string, value: string): void
  getHeader(name: string): string | null
}
export type MedusaNextFunction = (error?: unknown) => void
export type MiddlewareFunction = (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => void | Promise<void>
export type MedusaRequestHandler = MiddlewareFunction
export type MedusaErrorHandlerFunction = (error: unknown, req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => void | Promise<void>
export type RouteHandler = (req: MedusaRequest, res: MedusaResponse) => void | Promise<void>
export type MiddlewareRoute = {
  method?: MiddlewareVerb | MiddlewareVerb[]
  methods?: MiddlewareVerb[]
  matcher: string
  middlewares?: MiddlewareFunction[]
  bodyParser?: false
  policies?: PolicyAction | PolicyAction[]
}
export type MiddlewaresConfig = { routes?: MiddlewareRoute[]; errorHandler?: MedusaErrorHandlerFunction | false }
export type RouteDescriptor = {
  matcher: string
  method: RouteVerb
  handler: RouteHandler
  optedOutOfAuth: boolean
  isRoute: true
  absolutePath?: string
  relativePath?: string
  shouldAppendAdminCors: boolean
  shouldAppendAuthCors: boolean
  shouldAppendStoreCors: boolean
}
export type MiddlewareDescriptor = {
  matcher: string
  methods?: MiddlewareVerb | MiddlewareVerb[]
  pathMatching?: HttpPathMatching
  handler: MiddlewareFunction
  policies?: PolicyAction | PolicyAction[]
}
export type QueryConfig = { defaults?: string[]; allowed?: string[]; defaultLimit?: number; isList?: boolean; entity?: string }
export type QuerySchema = z.ZodType<DecodedQueryFields & Record<string, unknown>>
export type BodySchema = z.ZodType<Record<string, unknown>>
export type AdditionalDataValidator = z.ZodOptional<z.ZodNullable<z.ZodObject<z.ZodRawShape>>>

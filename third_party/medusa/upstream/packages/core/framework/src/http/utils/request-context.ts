import type {
  AuthContext,
  MedusaRequest,
  PublishableKeyContext,
} from "../types"

type AuthContextRequest = MedusaRequest & {
  auth_context?: AuthContext
}

type ValidatedTokenPayloadRequest = MedusaRequest & {
  validated_token_payload?: ValidatedTokenPayload
}

type PublishableKeyContextRequest = MedusaRequest & {
  publishable_key_context?: PublishableKeyContext
}

export type MedusaRequestContext = {
  ip_address?: string
}

export type MedusaRequestSetupTarget = Partial<
  Pick<MedusaRequest, "requestId" | "scope">
> & {
  request_context?: MedusaRequestContext
}

type SessionRecord = Record<string, unknown>

export type ValidatedTokenPayload = Record<string, unknown>

export type SetMedusaRequestAuthContextOptions = {
  persistSession?: boolean
}

export type SetupMedusaHttpRequestOptions = {
  container: MedusaRequest["scope"]
  requestId: string
  ipAddress?: string
}

export function createMedusaRequestScope(
  container: MedusaRequest["scope"]
): MedusaRequest["scope"] {
  return container.createScope() as MedusaRequest["scope"]
}

export function setupMedusaHttpRequest(
  req: MedusaRequestSetupTarget,
  options: SetupMedusaHttpRequestOptions
): void {
  req.scope = createMedusaRequestScope(options.container)
  req.requestId = options.requestId
  setMedusaRequestContext(req, {
    ip_address: options.ipAddress,
  })
}

export function setMedusaRequestContext(
  req: MedusaRequestSetupTarget,
  context: MedusaRequestContext
): void {
  req.request_context = {
    ...req.request_context,
    ...removeUndefinedRequestContextValues(context),
  }
}

export function getMedusaRequestAuthContext(
  req: MedusaRequest
): AuthContext | undefined {
  return (req as AuthContextRequest).auth_context
}

export function setMedusaRequestAuthContext(
  req: MedusaRequest,
  authContext: AuthContext,
  options: SetMedusaRequestAuthContextOptions = {}
): void {
  ;(req as AuthContextRequest).auth_context = authContext

  if (options.persistSession) {
    const currentSession: unknown = req.session
    req.session = {
      ...(isSessionRecord(currentSession) ? currentSession : {}),
      auth_context: authContext,
    }
  }
}

export function getMedusaRequestValidatedTokenPayload(
  req: MedusaRequest
): ValidatedTokenPayload | undefined {
  return (req as ValidatedTokenPayloadRequest).validated_token_payload
}

export function setMedusaRequestValidatedTokenPayload(
  req: MedusaRequest,
  payload: ValidatedTokenPayload
): void {
  ;(req as ValidatedTokenPayloadRequest).validated_token_payload = payload
}

export function getMedusaRequestPublishableKeyContext(
  req: MedusaRequest
): PublishableKeyContext | undefined {
  return (req as PublishableKeyContextRequest).publishable_key_context
}

export function setMedusaRequestPublishableKeyContext(
  req: MedusaRequest,
  publishableKeyContext: PublishableKeyContext
): void {
  ;(req as PublishableKeyContextRequest).publishable_key_context =
    publishableKeyContext
}

function isSessionRecord(value: unknown): value is SessionRecord {
  return typeof value === "object" && value !== null
}

function removeUndefinedRequestContextValues(
  context: MedusaRequestContext
): MedusaRequestContext {
  const cleanContext: MedusaRequestContext = {}

  if (context.ip_address !== undefined) {
    cleanContext.ip_address = context.ip_address
  }

  return cleanContext
}

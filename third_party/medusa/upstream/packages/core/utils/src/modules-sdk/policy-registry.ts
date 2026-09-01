import { toSnakeCase } from "../common/to-snake-case"

export type DefaultPolicyResources = Record<string, string>

const defaultPolicyResources: Record<string, string> = {
  workflow_execution: "workflow_execution",
}

declare global {
  // eslint-disable-next-line no-var
  var PolicyResource: Record<string, string> | undefined
  // eslint-disable-next-line no-var
  var PolicyOperation:
    | (Record<string, string> & {
        readonly read: "read"
        readonly create: "create"
        readonly update: "update"
        readonly delete: "delete"
        readonly "*": "*"
        readonly ALL: "*"
      })
    | undefined
  // eslint-disable-next-line no-var
  var Policy:
    | Record<string, { resource: string; operation: string; description?: string }>
    | undefined
}

export const PolicyResource: DefaultPolicyResources & Record<string, string> =
  globalThis.PolicyResource ?? { ...defaultPolicyResources }

for (const [resourceKey, resource] of Object.entries(defaultPolicyResources)) {
  PolicyResource[resourceKey] = resource
}

globalThis.PolicyResource ??= PolicyResource

const defaultOperations = ["read", "create", "update", "delete", "*"]

const defaultPolicyOperation: Record<string, string> & {
  readonly read: "read"
  readonly create: "create"
  readonly update: "update"
  readonly delete: "delete"
  readonly "*": "*"
  readonly ALL: "*"
} = {
  read: "read",
  create: "create",
  update: "update",
  delete: "delete",
  "*": "*",
  ALL: "*",
}

export const PolicyOperation: Record<string, string> & {
  readonly read: "read"
  readonly create: "create"
  readonly update: "update"
  readonly delete: "delete"
  readonly "*": "*"
  readonly ALL: "*"
} = globalThis.PolicyOperation ?? defaultPolicyOperation

for (const operation of defaultOperations) {
  const operationKey = operation === "*" ? "*" : toSnakeCase(operation)
  PolicyOperation[operationKey] = operation
}

globalThis.PolicyOperation ??= PolicyOperation

export const Policy: Record<
  string,
  { resource: string; operation: string; description?: string }
> = globalThis.Policy ?? {}

globalThis.Policy ??= Policy

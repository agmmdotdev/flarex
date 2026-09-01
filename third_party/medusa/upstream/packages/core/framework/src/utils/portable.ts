import { makeExecutableSchema } from "@graphql-tools/schema"
import {
  Kind,
  type GraphQLSchema as GraphQLSchemaType,
  type ObjectTypeDefinitionNode as ObjectTypeDefinitionNodeType,
} from "graphql"
import type { ModuleExports } from "@medusajs/types"
import { cleanGraphQLSchema } from "@medusajs/utils/graphql/clean-graphql"
import { gqlGetFieldsAndRelations } from "@medusajs/utils/graphql/get-fields-and-relations"

export { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
export { isDefined } from "@medusajs/utils/common/is-defined"
export { kebabCase } from "@medusajs/utils/common/to-kebab-case"
export { lowerCaseFirst } from "@medusajs/utils/common/lower-case-first"
export { promiseAll } from "@medusajs/utils/common/promise-all"
export { CommonEvents } from "@medusajs/utils/event-bus/common-events"
export { buildModuleResourceEventName } from "@medusajs/utils/event-bus/utils"
export { LINKS } from "@medusajs/utils/link/links"
export { Modules } from "@medusajs/utils/modules-sdk/definition"
export { model } from "@medusajs/utils/dml/model"
export * as ProductUtils from "@medusajs/utils/product/enums"
export { PricingRuleOperator } from "@medusajs/utils/pricing/enums"
export {
  PriceListStatus,
  PriceListType,
} from "@medusajs/utils/pricing/price-list"

export function Module<const ServiceName extends string, Service>(
  _serviceName: ServiceName,
  moduleExports: ModuleExports<Service>
): ModuleExports<Service> & { linkable: Record<string, never> } {
  return {
    ...moduleExports,
    linkable: {},
  }
}

export function InjectManager(): MethodDecorator {
  return () => {}
}

export function MedusaContext(): ParameterDecorator {
  return () => {}
}

export const ModulesSdkUtils = {
  MedusaService(_models?: unknown) {
    return class {
      constructor(..._args: unknown[]) {}
    }
  },
}

export const GraphQLUtils = {
  Kind,
  cleanGraphQLSchema,
  gqlGetFieldsAndRelations,
  makeExecutableSchema,
}

export namespace GraphQLUtils {
  export type GraphQLSchema = GraphQLSchemaType
  export type ObjectTypeDefinitionNode = ObjectTypeDefinitionNodeType
}

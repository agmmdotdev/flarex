import type {
  AdditionalDataValidatorRoute,
  BodyParserConfigRoute,
  MedusaErrorHandlerFunction,
  MiddlewareDescriptor,
  RouteDescriptor,
} from "../types"

export type HttpResourceSet = {
  routes: RouteDescriptor[]
  middlewares: MiddlewareDescriptor[]
  errorHandler?: MedusaErrorHandlerFunction
  bodyParserConfigRoutes: BodyParserConfigRoute[]
  additionalDataValidatorRoutes: AdditionalDataValidatorRoute[]
}

export type StaticHttpResourceSetInput = Partial<HttpResourceSet>

export interface HttpResourceResolver {
  resolve(): Promise<HttpResourceSet>
}

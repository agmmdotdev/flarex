import { transform } from "../transform.js"
import { WorkflowData } from "../type.js"

export function proxify<T>(obj: WorkflowData<any>): T {
  return new Proxy(obj, {
    get(target: any, prop: string | symbol): any {
      if (prop in target) {
        return target[prop]
      }

      const transformer = transform({ target }, function (data) {
        return data.target?.[prop]
      })

      return transformer
    },
  }) as unknown as T
}

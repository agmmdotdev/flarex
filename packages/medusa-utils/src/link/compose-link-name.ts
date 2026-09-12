import { toPascalCase } from "../common/to-pascal-case"
import { upperCaseFirst } from "../common/upper-case-first"

export const composeLinkName = (...args) => {
  return upperCaseFirst(toPascalCase(composeTableName(...args.concat("link"))))
}

export const composeTableName = (...args) => {
  return args.map((name) => name.replace(/(_id|Service)$/gi, "")).join("_")
}

// useful in cases where presence of undefined is not desired (eg. in microORM operations)
type WithoutUndefined<T> = {
  [Key in keyof T as undefined extends T[Key] ? never : Key]: T[Key]
} & {
  [Key in keyof T as undefined extends T[Key] ? Key : never]?: Exclude<T[Key], undefined>
}

export const removeUndefined = <T extends Record<string, any>>(obj: T): WithoutUndefined<T> => {
  return JSON.parse(JSON.stringify(obj)) as WithoutUndefined<T>
}

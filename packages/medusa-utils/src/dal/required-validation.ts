/** Selected MikroORM 6.4.16 required-property first-line message.
 * Copyright (c) 2018 Martin Adámek; MIT notice: ../../LICENSE.mikro-orm.
 * Frozen source: third_party/medusa/runtime-dependencies/
 * mikro-orm-core-6.4.16-required-validation. The caller already established a
 * missing/null required property. ORM entity inspection and instance identity
 * are outside this approved portable presentation seam.
 */
export const formatRequiredPropertyMessage = (
  entityName: string,
  propertyName: string,
  value: null | undefined,
): string => `Value for ${entityName}.${propertyName} is required, '${value}' found`

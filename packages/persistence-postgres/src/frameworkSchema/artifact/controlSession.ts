declare const frameworkSchemaArtifactControlSessionStarterBrand: unique symbol;

/**
 * Package-private nominal dependency retained by the artifact repository.
 * Executable session lifecycle behavior is owned by a later checkpoint.
 */
export interface FrameworkSchemaArtifactControlSessionStarter {
  readonly [frameworkSchemaArtifactControlSessionStarterBrand]: true;
}

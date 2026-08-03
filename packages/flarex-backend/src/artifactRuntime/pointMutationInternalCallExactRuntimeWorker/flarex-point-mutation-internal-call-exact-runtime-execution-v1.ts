/**
 * Typechecking placeholder only.
 *
 * The build externalizes this module, and the trusted host supplies the
 * literal authenticated application execution-module import.
 */
const executionModules: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> = Object.freeze({});

export default executionModules;

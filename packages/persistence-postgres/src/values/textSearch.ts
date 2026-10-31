export interface RelationalSearchPattern { readonly column: string; readonly pattern: string }
export const foldSearchAscii = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** A required three-character word run gives pg_trgm a selective key. A
 * wildcard-only or shorter pattern must use a different indexed anchor. */
export const hasMandatorySearchTrigram = (pattern: string) => /[a-z0-9]{3,}/.test(foldSearchAscii(pattern));

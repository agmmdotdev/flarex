import{databaseReplace}from"flarex:platform";export async function replace(_,{id,fields}){await databaseReplace(id,fields);return null}

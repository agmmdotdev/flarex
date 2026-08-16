import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope } from "@oxlint/plugins";

function referencedAliasIdentifier(type: ESTree.TSType): ESTree.IdentifierReference | null {
	if (type.type === "TSParenthesizedType")
		return referencedAliasIdentifier(type.typeAnnotation);
	if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return null;
	return type.typeArguments === null ||
		type.typeArguments === undefined ||
		type.typeArguments.params.length === 0
		? type.typeName
		: null;
}

/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.",
		},
		messages: {
			unknownAlias:
				"Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
		},
	},
	create(context) {
		const aliases: ESTree.TSTypeAliasDeclaration[] = [];

		const resolveAlias = (
			identifier: ESTree.IdentifierReference,
		): ESTree.TSTypeAliasDeclaration | null => {
			let scope: Scope | null = context.sourceCode.getScope(identifier);
			while (scope !== null) {
				const variable = scope.set.get(identifier.name);
				const definition = variable?.defs.find(
					(candidate) => candidate.node.type === "TSTypeAliasDeclaration",
				);
				if (definition?.node.type === "TSTypeAliasDeclaration") {
					return definition.node;
				}
				scope = scope.upper;
			}
			return null;
		};

		const resolvesToUnknown = (
			type: ESTree.TSType,
			visited = new Set<ESTree.TSTypeAliasDeclaration>(),
		): boolean => {
			if (type.type === "TSUnknownKeyword") return true;
			if (type.type === "TSParenthesizedType")
				return resolvesToUnknown(type.typeAnnotation, visited);
			const identifier = referencedAliasIdentifier(type);
			if (identifier === null) return false;
			const alias = resolveAlias(identifier);
			if (
				alias === null ||
				visited.has(alias) ||
				(alias.typeParameters !== null && alias.typeParameters !== undefined)
			) {
				return false;
			}
			const nextVisited = new Set(visited);
			nextVisited.add(alias);
			return resolvesToUnknown(alias.typeAnnotation, nextVisited);
		};

		return {
			TSTypeAliasDeclaration(node) {
				aliases.push(node);
			},
			"Program:exit"() {
				for (const alias of aliases) {
					if (!resolvesToUnknown(alias.typeAnnotation, new Set([alias]))) continue;
					context.report({
						node: alias.id,
						messageId: "unknownAlias",
						data: { alias: alias.id.name },
					});
				}
			},
		};
	},
});

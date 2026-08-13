import { defineRule } from "@oxlint/plugins";

import type {
	Definition,
	ESTree,
	Scope,
	SourceCode,
	Variable,
} from "@oxlint/plugins";

type Parameter = ESTree.ParamPattern;
type ParameterOwner =
	| ESTree.ArrowFunctionExpression
	| ESTree.Function
	| ESTree.TSCallSignatureDeclaration
	| ESTree.TSConstructSignatureDeclaration
	| ESTree.TSConstructorType
	| ESTree.TSFunctionType
	| ESTree.TSMethodSignature;

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
	if (parameter.type === "TSParameterProperty") {
		return parameterAnnotation(parameter.parameter);
	}
	if (parameter.type === "RestElement") {
		return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
	}
	if (parameter.type === "AssignmentPattern") {
		return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
	}
	return parameter.typeAnnotation;
}

function parameterName(parameter: Parameter, sourceCode: SourceCode): string {
	return parameter.type === "Identifier"
		? parameter.name
		: sourceCode.getText(parameter).replace(/\s*:\s*object\s*$/u, "");
}

function definesTypeName(definition: Definition): boolean {
	if (definition.type === "ImportBinding" || definition.type === "ClassName") {
		return true;
	}
	return definition.node.type === "TSTypeAliasDeclaration" ||
		definition.node.type === "TSInterfaceDeclaration" ||
		definition.node.type === "TSTypeParameter" ||
		definition.node.type === "TSInferType" ||
		definition.node.type === "TSMappedType" ||
		definition.node.type === "TSEnumDeclaration" ||
		definition.node.type === "TSModuleDeclaration" ||
		definition.node.type === "TSImportEqualsDeclaration";
}

/** Ban the broad object type on function inputs, including local aliases to object. */
export const noObjectParametersRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow object function parameters; inputs must use an owner-provided type and be parsed at their boundary.",
		},
		messages: {
			objectParameter:
				"Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.",
		},
	},
	create(context) {
		const resolveTypeVariable = (
			identifier: ESTree.IdentifierReference,
		): Variable | null => {
			let scope: Scope | null = context.sourceCode.getScope(identifier);
			while (scope !== null) {
				const variable = scope.set.get(identifier.name);
				if (variable?.defs.some(definesTypeName) === true) return variable;
				scope = scope.upper;
			}
			return null;
		};

		const resolveAlias = (
			identifier: ESTree.IdentifierReference,
		): ESTree.TSTypeAliasDeclaration | null => {
			const variable = resolveTypeVariable(identifier);
			const definition = variable?.defs.find(
				(candidate) => candidate.node.type === "TSTypeAliasDeclaration",
			);
			return definition?.node.type === "TSTypeAliasDeclaration"
				? definition.node
				: null;
		};

		const resolvesToObject = (
			type: ESTree.TSType,
			visited = new Set<ESTree.TSTypeAliasDeclaration>(),
		): boolean => {
			if (type.type === "TSObjectKeyword") return true;
			if (type.type === "TSParenthesizedType")
				return resolvesToObject(type.typeAnnotation, visited);
			if (type.type === "TSUnionType") {
				return type.types.some((member) => resolvesToObject(member, visited));
			}
			if (
				type.type !== "TSTypeReference" ||
				type.typeName.type !== "Identifier" ||
				(type.typeArguments !== null &&
					type.typeArguments !== undefined &&
					type.typeArguments.params.length > 0)
			) {
				return false;
			}
			const alias = resolveAlias(type.typeName);
			if (
				alias === null ||
				visited.has(alias) ||
				(alias.typeParameters !== null && alias.typeParameters !== undefined)
			) {
				return false;
			}
			const nextVisited = new Set(visited);
			nextVisited.add(alias);
			return resolvesToObject(alias.typeAnnotation, nextVisited);
		};

		const checkParameters = (node: ParameterOwner) => {
			const restContainsObject = (
				type: ESTree.TSType | ESTree.TSTupleType["elementTypes"][number],
				visited = new Set<ESTree.TSTypeAliasDeclaration>(),
			): boolean => {
				if (type.type === "TSNamedTupleMember") {
					return restContainsObject(type.elementType, visited);
				}
				if (type.type === "TSOptionalType" || type.type === "TSRestType") {
					return restContainsObject(type.typeAnnotation, visited);
				}
				if (type.type === "TSParenthesizedType") {
					return restContainsObject(type.typeAnnotation, visited);
				}
				if (type.type === "TSArrayType") {
					return resolvesToObject(type.elementType);
				}
				if (type.type === "TSTypeOperator" && type.operator === "readonly") {
					return restContainsObject(type.typeAnnotation, visited);
				}
				if (type.type === "TSTupleType") {
					return type.elementTypes.some((element) =>
						restContainsObject(element, visited)
					);
				}
				if (type.type === "TSUnionType") {
					return type.types.some((member) => restContainsObject(member, visited));
				}
				if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") {
					return resolvesToObject(type);
				}
				const name = type.typeName.name;
				const parameters = type.typeArguments?.params ?? [];
				const variable = resolveTypeVariable(type.typeName);
				if (
					(name === "Array" || name === "ReadonlyArray") &&
					(variable === null || variable.defs.length === 0) &&
					parameters.length === 1
				) {
					return parameters[0] !== undefined &&
						resolvesToObject(parameters[0]);
				}
				if (parameters.length > 0) {
					return false;
				}
				const alias = resolveAlias(type.typeName);
				if (
					alias === null ||
					visited.has(alias) ||
					(alias.typeParameters !== null && alias.typeParameters !== undefined)
				) {
					return false;
				}
				const nextVisited = new Set(visited);
				nextVisited.add(alias);
				return restContainsObject(alias.typeAnnotation, nextVisited);
			};
			for (const parameter of node.params) {
				const annotation = parameterAnnotation(parameter);
				if (annotation === null || annotation === undefined) continue;
				const inspectedType = annotation.typeAnnotation;
				const hasObject = parameter.type === "RestElement"
					? restContainsObject(inspectedType)
					: resolvesToObject(inspectedType);
				if (!hasObject) continue;
				context.report({
					node: inspectedType,
					messageId: "objectParameter",
					data: { parameter: parameterName(parameter, context.sourceCode) },
				});
			}
		};

		return {
			ArrowFunctionExpression: checkParameters,
			FunctionDeclaration: checkParameters,
			FunctionExpression: checkParameters,
			TSCallSignatureDeclaration: checkParameters,
			TSConstructSignatureDeclaration: checkParameters,
			TSConstructorType: checkParameters,
			TSDeclareFunction: checkParameters,
			TSEmptyBodyFunctionExpression: checkParameters,
			TSFunctionType: checkParameters,
			TSMethodSignature: checkParameters,
		};
	},
});

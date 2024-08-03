import ts from "typescript";
import {
	getAncestorOfType,
	getChildOfType,
	getGetterSetterDeclarations,
	isChildOfNode,
} from "./util";

export type TransformerConfig = {
	customPrefix?: string;
};

const DEFAULT_PREFIX = "__";
const SETTER_PREFIX = "set";
const GETTER_PREFIX = "get";

export class TransformContext {
	public factory: ts.NodeFactory;

	constructor(
		public program: ts.Program,
		public context: ts.TransformationContext,
		public config: TransformerConfig,
	) {
		this.factory = context.factory;
	}

	transform<T extends ts.Node>(node: T): T {
		return ts.visitEachChild(
			node,
			(node) => visitNode(this, node),
			this.context,
		);
	}
}

function visitPropertyAccessExpression(
	context: TransformContext,
	node: ts.PropertyAccessExpression,
) {
	const { factory, program, config } = context;
	const [getterDeclaration, setterDeclaration] =
		getGetterSetterDeclarations(program, node);
	const isGetterOrSetter =
		(getterDeclaration || setterDeclaration) !== undefined;
	if (!isGetterOrSetter) return context.transform(node);

	const assignmentExpression = getAncestorOfType(
		node,
		ts.isAssignmentExpression,
	);
	const isSetter =
		setterDeclaration !== undefined &&
		assignmentExpression !== undefined &&
		(node === assignmentExpression.left ||
			isChildOfNode(assignmentExpression.left, node));

	if (!isSetter) {
		return factory.createCallChain(
			factory.updatePropertyAccessExpression(
				node,
				context.transform(node.expression),
				factory.createIdentifier(
					`${config.customPrefix ?? DEFAULT_PREFIX}${GETTER_PREFIX}${node.name.getText()}`,
				),
			),
			node.questionDotToken,
			[],
			[],
		);
	}

	return factory.updatePropertyAccessExpression(
		node,
		context.transform(node.expression),
		factory.createIdentifier(
			`${config.customPrefix ?? DEFAULT_PREFIX}${SETTER_PREFIX}${node.name.getText()}`,
		),
	);
}

const assignmentTokenLookup: Record<
	ts.CompoundAssignmentOperator,
	ts.BinaryOperator
> = {
	[ts.SyntaxKind.PlusEqualsToken]: ts.SyntaxKind.PlusToken,
	[ts.SyntaxKind.MinusEqualsToken]: ts.SyntaxKind.MinusToken,
	[ts.SyntaxKind.AsteriskEqualsToken]: ts.SyntaxKind.AsteriskToken,
	[ts.SyntaxKind.AsteriskAsteriskEqualsToken]:
		ts.SyntaxKind.AsteriskAsteriskToken,
	[ts.SyntaxKind.SlashEqualsToken]: ts.SyntaxKind.SlashToken,
	[ts.SyntaxKind.PercentEqualsToken]: ts.SyntaxKind.PercentToken,
	[ts.SyntaxKind.LessThanLessThanEqualsToken]:
		ts.SyntaxKind.LessThanLessThanToken,
	[ts.SyntaxKind.GreaterThanGreaterThanEqualsToken]:
		ts.SyntaxKind.GreaterThanGreaterThanToken,
	[ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken]:
		ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
	[ts.SyntaxKind.AmpersandEqualsToken]: ts.SyntaxKind.AmpersandToken,
	[ts.SyntaxKind.BarEqualsToken]: ts.SyntaxKind.BarToken,
	[ts.SyntaxKind.BarBarEqualsToken]: ts.SyntaxKind.BarBarToken,
	[ts.SyntaxKind.AmpersandAmpersandEqualsToken]:
		ts.SyntaxKind.AmpersandAmpersandToken,
	[ts.SyntaxKind.QuestionQuestionEqualsToken]:
		ts.SyntaxKind.QuestionQuestionToken,
	[ts.SyntaxKind.CaretEqualsToken]: ts.SyntaxKind.CaretToken,
};

function visitBinaryExpression(
	context: TransformContext,
	node: ts.BinaryExpression,
) {
	const { factory, program, config } = context;

	const propertyAccessExpression = getChildOfType(
		node,
		ts.isPropertyAccessExpression,
	);
	if (!propertyAccessExpression) return context.transform(node);

	const [getterDeclaration, setterDeclaration] = getGetterSetterDeclarations(
		program,
		propertyAccessExpression,
	);

	const isSetter = setterDeclaration !== undefined;
	if (!isSetter) return context.transform(node);

	const original = propertyAccessExpression;
	if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
		return factory.createCallExpression(
			factory.createPropertyAccessExpression(
				original.expression,
				factory.createIdentifier(
					`${config.customPrefix ?? DEFAULT_PREFIX}${SETTER_PREFIX}${original.name.getText()}`,
				),
			),
			undefined,
			[context.transform(node).right],
		);
	}

	if (
		ts.isAssignmentExpression(node, false) &&
		ts.isCompoundAssignment(node.operatorToken.kind)
	) {
		console.assert(
			getterDeclaration !== undefined,
			`Required getter declaration for compound assignment: ${node.getText()}`,
		);

		return factory.createCallExpression(
			factory.createPropertyAccessExpression(
				original.expression,
				factory.createIdentifier(
					`${config.customPrefix ?? DEFAULT_PREFIX}${SETTER_PREFIX}${original.name.getText()}`,
				),
			),
			undefined,
			[
				factory.createBinaryExpression(
					factory.createCallExpression(
						factory.createPropertyAccessExpression(
							original.expression,
							factory.createIdentifier(
								`${config.customPrefix ?? DEFAULT_PREFIX}${GETTER_PREFIX}${original.name.getText()}`,
							),
						),
						undefined,
						undefined,
					),
					assignmentTokenLookup[node.operatorToken.kind],
					node.right,
				),
			],
		);
	}

	return context.transform(node);
}

const postfixUnaryOperatorLookup: Record<ts.PostfixUnaryOperator, ts.BinaryOperator> = {
	[ts.SyntaxKind.PlusPlusToken]: ts.SyntaxKind.PlusToken,
	[ts.SyntaxKind.MinusMinusToken]: ts.SyntaxKind.MinusToken
}

function visitPostfixUnaryExpression(
	context: TransformContext,
	node: ts.PostfixUnaryExpression,
) {
	const { factory, program, config } = context;
	const propertyAccessExpression = getChildOfType(
		node,
		ts.isPropertyAccessExpression,
	);
	if (!propertyAccessExpression) return context.transform(node);

	const [getterDeclaration, setterDeclaration] = getGetterSetterDeclarations(
		program,
		propertyAccessExpression,
	);

	const isSetter = setterDeclaration !== undefined;
	if (!isSetter) return context.transform(node);

	const original = propertyAccessExpression;

	return factory.createCallExpression(
		factory.createPropertyAccessExpression(
			original.expression,
			factory.createIdentifier(
				`${config.customPrefix ?? DEFAULT_PREFIX}${SETTER_PREFIX}${original.name.getText()}`,
			),
		),
		undefined,
		[
			factory.createBinaryExpression(
				factory.createCallExpression(
					factory.createPropertyAccessExpression(
						original.expression,
						factory.createIdentifier(
							`${config.customPrefix ?? DEFAULT_PREFIX}${GETTER_PREFIX}${original.name.getText()}`,
						),
					),
					undefined,
					undefined,
				),
				postfixUnaryOperatorLookup[node.operator],
				factory.createNumericLiteral(1),
			),
		],
	);
}

function visitSetAccessor(
	context: TransformContext,
	node: ts.SetAccessorDeclaration,
) {
	const { factory, config } = context;
	return context.transform(
		factory.createMethodDeclaration(
			node.modifiers,
			node.asteriskToken,
			factory.createIdentifier(
				`${config.customPrefix ?? DEFAULT_PREFIX}${SETTER_PREFIX}${node.name.getText()}`,
			),
			node.questionToken,
			node.typeParameters,
			node.parameters,
			node.type,
			node.body,
		),
	);
}

function visitGetAccessor(
	context: TransformContext,
	node: ts.GetAccessorDeclaration,
) {
	const { factory, config } = context;
	return context.transform(
		factory.createMethodDeclaration(
			node.modifiers,
			node.asteriskToken,
			factory.createIdentifier(
				`${config.customPrefix ?? DEFAULT_PREFIX}${GETTER_PREFIX}${node.name.getText()}`,
			),
			node.questionToken,
			node.typeParameters,
			node.parameters,
			node.type,
			node.body,
		),
	);
}

function visitExpression(context: TransformContext, node: ts.Expression) {
	if (ts.isPropertyAccessExpression(node)) {
		return visitPropertyAccessExpression(context, node);
	}

	if (ts.isBinaryExpression(node)) {
		return visitBinaryExpression(context, node);
	}

	if (ts.isPostfixUnaryExpression(node)) {
		return visitPostfixUnaryExpression(context, node);
	}

	return context.transform(node);
}

function visitNode(
	context: TransformContext,
	node: ts.Node,
): ts.Node | ts.Node[] {
	if (ts.isGetAccessor(node)) {
		return visitGetAccessor(context, node);
	}

	if (ts.isSetAccessor(node)) {
		return visitSetAccessor(context, node);
	}

	if (ts.isExpression(node)) {
		return visitExpression(context, node);
	}

	return context.transform(node);
}

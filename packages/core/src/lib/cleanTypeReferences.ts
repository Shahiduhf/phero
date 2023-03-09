import ts from "typescript"

export default function cleanTypeReferences<TNode extends ts.Node>(
  rootNode: TNode,
  typeChecker: ts.TypeChecker,
): TNode {
  const transformer =
    <T extends ts.Node>(context: ts.TransformationContext) =>
    (rootNode: T) => {
      function visit(node: ts.Node): ts.Node {
        if (ts.isTypeReferenceNode(node)) {
          return cleanTypeNames(node, typeChecker)
        }
        return ts.visitEachChild(node, visit, context)
      }
      return ts.visitNode(rootNode, visit)
    }

  return ts.transform<TNode>(rootNode, [transformer]).transformed[0]
}

function cleanTypeNames(
  typeNode: ts.TypeNode,
  typeChecker: ts.TypeChecker,
): ts.TypeNode {
  if (!ts.isTypeReferenceNode(typeNode)) {
    return typeNode
  }

  const type = typeChecker.getTypeAtLocation(typeNode.typeName)
  const declr = (type.aliasSymbol ?? type.symbol)?.declarations?.[0]
  if (!declr || ts.isEnumMember(declr)) {
    return typeNode
  }

  return ts.factory.createTypeReferenceNode(
    ts.isQualifiedName(typeNode.typeName)
      ? typeNode.typeName.right
      : typeNode.typeName,
    typeNode.typeArguments?.map((typeArg) =>
      cleanTypeNames(typeArg, typeChecker),
    ),
  )
}

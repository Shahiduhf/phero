import ts from "typescript"
import { ParseError } from "./errors"
import { Model, ParsedSamenFunctionDefinition } from "./parseSamenApp"
import { isExternalDeclaration, isExternalTypeNode } from "./tsUtils"

const IGNORE_SYNTAX_KIND = [
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.ImportSpecifier,
]

export default function extractModels(
  funcs: ParsedSamenFunctionDefinition[],
  typeChecker: ts.TypeChecker,
): Model[] {
  const models: Model[] = []
  const addedSymbols: ts.Symbol[] = []

  for (const param of funcs.flatMap((func) => func.parameters)) {
    doType(param.type)
  }

  for (const returnType of funcs.flatMap((func) => func.returnType)) {
    doType(returnType)
  }

  function doType(typeNode: ts.TypeNode | undefined): void {
    if (!typeNode) {
      return
    } else if (ts.isTypeReferenceNode(typeNode)) {
      for (const typeArgument of typeNode.typeArguments ?? []) {
        doType(typeArgument)
      }

      if (isExternalTypeNode(typeNode)) {
        return
      }

      const type = typeChecker.getTypeFromTypeNode(typeNode)
      const symbol = type.aliasSymbol ?? type.symbol

      // NOTE this happens in two occasions:
      // 1. we got a `type X = Y` where Y itself is also a type alias
      // 2. we got a `type X = [A, B]`, X is a tuple
      if (!type.symbol) {
        const typeNameSymbol = typeChecker.getSymbolAtLocation(
          typeNode.typeName,
        )
        if (typeNameSymbol?.declarations?.length) {
          for (const declr of typeNameSymbol.declarations) {
            doDeclaration(declr)
          }
        }
      }

      if (addedSymbols.includes(symbol)) {
        return
      }

      addedSymbols.push(symbol)

      for (const declaration of symbol.declarations ?? []) {
        // prevent that we include TS lib types
        if (isExternalDeclaration(declaration)) {
          declaration
          continue
        }

        doDeclaration(declaration)
      }
    } else if (ts.isTypeLiteralNode(typeNode)) {
      for (const member of typeNode.members) {
        if (ts.isPropertySignature(member)) {
          doType(member.type)
        } else if (ts.isIndexSignatureDeclaration(member)) {
          // TODO name, but could be computed property
          doType(member.type)
        }
      }
    } else if (ts.isUnionTypeNode(typeNode)) {
      for (const unionElementType of typeNode.types) {
        doType(unionElementType)
      }
    } else if (ts.isIntersectionTypeNode(typeNode)) {
      for (const intersectionElementType of typeNode.types) {
        doType(intersectionElementType)
      }
    } else if (ts.isArrayTypeNode(typeNode)) {
      doType(typeNode.elementType)
    } else if (ts.isExpressionWithTypeArguments(typeNode)) {
      const extendedType = typeChecker.getTypeFromTypeNode(typeNode)
      for (const declr of extendedType.symbol.declarations ?? []) {
        doDeclaration(declr)
      }
    } else if (ts.isIndexedAccessTypeNode(typeNode)) {
      doType(typeNode.objectType)
      doType(typeNode.indexType)
    } else if (ts.isTupleTypeNode(typeNode)) {
      for (const el of typeNode.elements) {
        doType(el)
      }
    } else if (!IGNORE_SYNTAX_KIND.includes(typeNode.kind)) {
      throw new ParseError("Model extracting not possible for node", typeNode)
    }
  }

  function doDeclaration(declaration: ts.Declaration | undefined): void {
    if (!declaration) {
      return
    }

    if (ts.isInterfaceDeclaration(declaration)) {
      for (const member of declaration.members) {
        if (ts.isPropertySignature(member)) {
          doType(member.type)
        }
      }
      for (const heritageClause of declaration.heritageClauses ?? []) {
        for (const type of heritageClause.types) {
          doType(type)
        }
      }
      for (const typeParam of declaration.typeParameters ?? []) {
        doDeclaration(typeParam)
      }

      models.push(declaration)
    } else if (ts.isTypeAliasDeclaration(declaration)) {
      doType(declaration.type)

      for (const typeParam of declaration.typeParameters ?? []) {
        doDeclaration(typeParam)
      }

      models.push(declaration)
    } else if (ts.isEnumDeclaration(declaration)) {
      models.push(declaration)
    } else if (ts.isEnumMember(declaration)) {
      doDeclaration(declaration.parent)
    } else if (ts.isTypeParameterDeclaration(declaration)) {
      doType(declaration.constraint)
      doType(declaration.default)
    } else if (!IGNORE_SYNTAX_KIND.includes(declaration.kind)) {
      throw new ParseError(
        "Model extracting not possible for node",
        declaration,
      )
    }
  }

  return models
}

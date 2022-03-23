import React from "react"
import ts from "typescript"
import { generateStatement, TSStatementElement } from "./ts-statement"

export interface TSSourceFile {
  children?: TSStatementElement | TSStatementElement[]
}

export type TSSourceFileElement = React.ReactElement<
  TSSourceFile,
  "ts-source-file"
>

export function generateSourceFile(
  element: TSSourceFileElement,
): ts.SourceFile {
  const statements = element.props.children
    ? React.Children.map<ts.Statement, TSStatementElement>(
        element.props.children,
        generateStatement,
      )
    : []
  return ts.factory.createSourceFile(
    statements,
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None,
  )
}

import ts from "typescript"
import generateAppDeclarationFile from "./generateAppDeclarationFile"

import { parseSamenApp } from "./parseSamenApp"
import { createTestProgram } from "./tsTestUtils"

function generate(prog: ts.Program): string {
  // if (prog.getSemanticDiagnostics().length) {
  //   // console.log("OEPS COMPILE ERRORS DETECTED")
  //   console.error(prog.getSemanticDiagnostics())
  //   throw new Error("Compile error")
  // }
  const typeChecker = prog.getTypeChecker()
  const samenFile = prog.getSourceFile("samen.ts")
  if (!samenFile) {
    throw new Error("No samen file")
  }
  const parsedApp = parseSamenApp(samenFile, typeChecker)
  const dts = generateAppDeclarationFile(parsedApp, typeChecker)
  return dts
}

describe("generateAppDeclarationFile", () => {
  describe("middleware", () => {
    test("should parse middleware", () => {
      const parsedApp = generate(
        createTestProgram(`
        type SamenNextFunction<T = void> = T extends void
          ? () => Promise<void>
          : (ctx: T) => Promise<void>
        type SamenContext<T = {}> = T
        type SamenParams<T = {}> = Partial<T>

        async function getArticle(ctx: SamenContext<{ user: User }>, aap: string): Promise<string> {
          return "ok"
        }

        interface User { uid: string }

        async function requireUID(params: SamenParams, ctx: SamenContext<{ uid: string }>, next: SamenNextFunction<{ uid: string, x: string }>) {
          // valideer id token
          await next({ uid, x })
        }
        
        async function requireCmsUser(params: SamenParams, ctx: SamenContext<{ uid: string, x: string }>, next: SamenNextFunction<{ user: User }>) {
          // zet om naar user, of het cms user is
          await next({ user: { uid } })
        }

        export const articleService = createService({
          getArticle,
        }, {
          middleware: [requireUID, requireCmsUser],
        })
      `),
      )

      // EXPECT function getArticle(aap: string): Promise<string>;
      // because x:number is provided implicitly by middleware
      expect(parsedApp).toMatchSnapshot()
    })
  })
  describe("errors", () => {
    test("should generate service error", () => {
      const parsedApp = generate(
        createTestProgram(`
          class ArticleError extends Error {
          }

          async function getArticle(): Promise<string> {
            throw new ArticleError()
          }

          export const articleService = createService({
            getArticle,
          })
        `),
      )

      expect(parsedApp).toMatchSnapshot()
    })

    test("should generate multi-service multi-error", () => {
      const parsedApp = generate(
        createTestProgram(`
          class HamburgerError extends Error {
          }

          async function getHamburger(): Promise<string> {
            throw new HamburgerError()
          }
          

          export const hamburgerService = createService({
            getHamburger,
          })
          
          class ArticleError extends Error {
          }

          async function getArticle(): Promise<string> {
            throw new ArticleError()
          }

          export const articleService = createService({
            getArticle,
          })
        `),
      )

      expect(parsedApp).toMatchSnapshot()
    })

    test("should generate common errors in domain", () => {
      const parsedApp = generate(
        createTestProgram(`
          class CommonError extends Error {
          }

          class HamburgerError extends Error {
          }

          async function getHamburger(): Promise<string> {
            throw new HamburgerError()
          }

          async function setHamburger(): Promise<string> {
            throw new CommonError()
          }
          
          export const hamburgerService = createService({
            getHamburger,
            setHamburger,
          })
          
          class ArticleError extends Error {
          }

          async function getArticle(): Promise<string> {
            throw new ArticleError()
          }

          async function setArticle(): Promise<string> {
            throw new CommonError()
          }

          export const articleService = createService({
            getArticle,
            setArticle,
          })
        `),
      )

      expect(parsedApp).toMatchSnapshot()
    })

    test("should generate properties on generated error classes", () => {
      const parsedApp = generate(
        createTestProgram(`
          class GenericError extends Error {
            constructor(test: number) {
              super(\`Test \${test}\`)
            }
          }

          class ArticleError extends GenericError {
            public myPublicProp: number
            
            constructor(public myProp: number, myParam: string) {
              super(myProp + 1)
              this.myPublicProp = myProp + 2
            }
          }

          async function getArticle(): Promise<string> {
            throw new ArticleError(123)
          }

          export const articleService = createService({
            getArticle,
          })
        `),
      )

      expect(parsedApp).toMatchSnapshot()
    })
  })

  describe("typeAliases", () => {
    test("type aliases which are aliases of aliases", () => {
      const parsedApp = generate(
        createTestProgram({
          routine: `
          export async function getRoutine(versionId: string): Promise<Result> {
            return {x: 1}
          }

          export type Result = TypeRef

          export type TypeRef = TypeReal

          export type TypeReal = {x: number}
          `,

          samen: `
          import {getRoutine} from './routine'
          
          export const workoutRoutineService = createService({
            getRoutine,
          })
        `,
        }),
      )

      expect(parsedApp).toMatchSnapshot()
    })
    test("type aliases to native types", () => {
      const parsedApp = generate(
        createTestProgram({
          aad: `
          export type AadReturnType2 = boolean
          export async function Aad2(): Promise<{
            aad: AadReturnType2
          }> {
            return {
              aad: true,
            }
          }
          `,

          samen: `
          import {Aad2} from "./aad"

          export const articleService = createService({
            getArticle: Aad2,
          })
        `,
        }),
      )

      expect(parsedApp).toMatchSnapshot()
    })
    test("type aliases to native array types", () => {
      const parsedApp = generate(
        createTestProgram({
          aad: `
          export type AadReturnType1 = string[]
          export async function Aad1(): Promise<AadReturnType1> {
            return []
          }
          `,

          samen: `
          import {Aad1} from "./aad"

          export const articleService = createService({
            getArticle: Aad1,
          })
        `,
        }),
      )

      expect(parsedApp).toMatchSnapshot()
    })
    test("jasper", () => {
      const parsedApp = generate(
        createTestProgram({
          other: `
          export interface X {
            type: 'x'
          }

          export interface Y {
            type: 'y'
          }

          export type Z = X | Y

          export interface A {
            b: B
          }

          export interface B {
            [key: string]: Z
          }

          export async function example(a: A): Promise<void> {}
          `,

          samen: `
          import {example} from "./other"

          export const articleService = createService({
            example,
          })
        `,
        }),
      )

      expect(parsedApp).toMatchSnapshot()
    })
  })
})

import {
  generateAppDeclarationFile,
  generateRPCProxy,
  MissingPheroFileError,
  MissingTSConfigFile,
  parsePheroApp,
} from "@phero/core"
import { ServerCommandExport, ServerExportFlavor } from "@phero/dev"
import fs from "fs"
import child_process from "child_process"
import path from "path"
import ts, { CompilerOptions } from "typescript"
import { Export, ExportBundle, MetaExportFiles } from "./domain"
import generateGCloudFunctionsExport from "./gcloud-functions"
import generateNodeJSExport from "./nodejs"
import generateVercelExport from "./vercel"

export default function exportCommand(command: ServerCommandExport) {
  const projectPath = process.cwd()

  const tsConfigFilePath = ts.findConfigFile(
    projectPath,
    ts.sys.fileExists,
    "tsconfig.json",
  )

  if (!tsConfigFilePath) {
    throw new MissingTSConfigFile(projectPath)
  }

  const tsConfig: ts.ParsedCommandLine | undefined =
    ts.getParsedCommandLineOfConfigFile(
      tsConfigFilePath,
      undefined,
      ts.sys as any,
    )

  if (!tsConfig) {
    throw new Error("Can't parse tsconfig.json")
  }

  const hasES2015 = tsConfig.options.lib?.some((lib: string) =>
    /(es2015$)|(es2015\.d\.ts)|(es2015.promise$)|(es2015\.promise\.d\.ts)/.test(
      lib.toLowerCase(),
    ),
  )
  const hasES5 = tsConfig.options.lib?.some((lib: string) =>
    /(es5$)|(es5\.d\.ts)/.test(lib.toLowerCase()),
  )

  const compilerOpts: CompilerOptions = {
    ...tsConfig.options,
    // declaration: true,
    // NOTE: we need Promise support in our declaration file. In a normal TS project you would add
    // the "es2015". Because we're implementing a file system here, sort of, we need to set the file
    // name more explicitly. (Implementing our own fileExists makes compilation much much faster.)
    lib: [
      ...(tsConfig.options.lib ?? []),
      // support for Promise
      ...(hasES2015 ? [] : ["lib.es2015.d.ts"]),
      // support for Pick, Omit, and other TS utilities
      ...(hasES5 ? [] : ["lib.es5.d.ts"]),
    ],
    // target: ts.ScriptTarget.ES5,
    // module: ts.ModuleKind.CommonJS,
  }

  const compilerHost = ts.createCompilerHost(compilerOpts)

  const program = ts.createProgram({
    host: compilerHost,
    options: compilerOpts,
    rootNames: [`${projectPath}/src/phero.ts`],
  })

  const tsOutDir = program.getCompilerOptions().outDir

  if (!tsOutDir) {
    throw new Error(
      'Please provide a "outDir" option in your tsconfig.json file.',
    )
  }

  const exportPath = path.join(projectPath, ".phero")

  rimRafExport(exportPath)
  rimRafExport(tsOutDir)

  program.emit()

  const pheroSourceFile = program.getSourceFile(`${projectPath}/src/phero.ts`)

  if (!pheroSourceFile) {
    throw new MissingPheroFileError(projectPath)
  }

  const typeChecker = program.getTypeChecker()
  const app = parsePheroApp(pheroSourceFile, typeChecker)
  const dts = generateAppDeclarationFile(app, typeChecker)
  const pheroExecution = generateRPCProxy(app, typeChecker)

  const readFile = (filePath: string): string =>
    fs.readFileSync(filePath, {
      encoding: "utf-8",
    })

  function findLockFilePath(): string | undefined {
    const maxDepth = 5

    let currentPath = projectPath

    for (let i = 0; i < maxDepth; i++) {
      const lockFilePath = path.join(currentPath, "package-lock.json")
      if (fs.existsSync(lockFilePath)) {
        return lockFilePath
      }

      const yarnLockFilePath = path.join(currentPath, "yarn.lock")
      if (fs.existsSync(yarnLockFilePath)) {
        return yarnLockFilePath
      }

      const pnpmLockFilePath = path.join(currentPath, "pnpm-lock.yaml")
      if (fs.existsSync(pnpmLockFilePath)) {
        return pnpmLockFilePath
      }

      currentPath = path.join(currentPath, "..")
    }

    return undefined
  }

  const lockFilePath = findLockFilePath()

  if (!lockFilePath) {
    throw new Error(
      "Can't find a package-lock.json or yarn.lock file in the current directory or any of its parents.",
    )
  }

  const metaExportFiles: MetaExportFiles = {
    "phero-manifest.d.ts": dts,
    "phero-execution.js": pheroExecution.js,
    "phero.js": readFile(path.join(tsOutDir, "phero.js")),
    "package.json": readFile(path.join(projectPath, "package.json")),
    [path.basename(lockFilePath)]: readFile(lockFilePath),
  }

  switch (command.flavor) {
    case ServerExportFlavor.NodeJS: {
      const nodejsExport = generateNodeJSExport(app, metaExportFiles)

      copyTsOutToBundles(
        tsOutDir,
        nodejsExport.bundles.map((b) => path.join(exportPath, b.name)),
      )
      writeToDisk(exportPath, nodejsExport)

      console.log("Done exporting to .phero, to run all your services:")
      console.log("(cd .phero && npm i && node ./index.js)")
      console.log(
        `To run one specific services, e.g. "${app.services[0].name}":`,
      )
      console.log(
        `(cd .phero && npm i && node ./${app.services[0].name}/index.js)`,
      )
      break
    }
    case ServerExportFlavor.GCloudFunctions: {
      const gcloudFunctionsExport = generateGCloudFunctionsExport(
        app,
        metaExportFiles,
      )

      copyTsOutToBundles(
        tsOutDir,
        gcloudFunctionsExport.bundles.map((b) => path.join(exportPath, b.name)),
      )
      writeToDisk(exportPath, gcloudFunctionsExport)

      console.log(
        `Done exporting ${
          gcloudFunctionsExport.bundles.length === 1
            ? "1 service"
            : `${gcloudFunctionsExport.bundles.length} services`
        } to .phero`,
      )
      break
    }
    case ServerExportFlavor.Vercel: {
      const vercelPath = path.join(projectPath, ".vercel")

      rimRafExport(path.join(vercelPath, "output"))

      const vercelExport = generateVercelExport(app, metaExportFiles)

      copyTsOutToBundles(
        tsOutDir,
        vercelExport.bundles.map((b) => path.join(projectPath, b.name)),
      )

      writeToDisk(projectPath, vercelExport)

      for (const bundle of vercelExport.bundles) {
        child_process.execSync(`npm ci`, {
          cwd: path.join(projectPath, bundle.name),
        })
      }

      console.log(
        `Done exporting ${
          vercelExport.bundles.length === 1
            ? "1 service"
            : `${vercelExport.bundles.length} services`
        } to .vercel`,
      )
      console.log(`Now deploy with "npx vercel@latest deploy --prebuilt"`)
      break
    }
  }
}

function writeToDisk(
  exportPath: string,
  { bundles, otherFiles }: Export,
): void {
  for (const bundle of bundles) {
    const bundlePath = path.join(exportPath, bundle.name)
    fs.mkdirSync(bundlePath, { recursive: true })

    for (const exportFile of bundle.files) {
      const exportFilePath = path.join(bundlePath, exportFile.name)
      fs.writeFileSync(exportFilePath, exportFile.content)
    }
  }

  for (const otherFile of otherFiles ?? []) {
    const exportFilePath = path.join(exportPath, otherFile.name)
    fs.writeFileSync(exportFilePath, otherFile.content)
  }
}

function rimRafExport(exportPath: string): void {
  if (!fs.existsSync(exportPath)) {
    return
  }

  rimRafDir(exportPath)

  function rimRafDir(dirPath: string): void {
    const fileNames = fs.readdirSync(dirPath)
    for (const fileName of fileNames) {
      const subPath = path.join(dirPath, fileName)
      const lstat = fs.lstatSync(subPath)
      if (lstat.isDirectory()) {
        rimRafDir(subPath)
      } else if (lstat.isFile()) {
        fs.unlinkSync(subPath)
      } else if (lstat.isSymbolicLink()) {
        fs.unlinkSync(subPath)
      }
    }
    fs.rmdirSync(dirPath)
  }
}

function copyTsOutToBundles(exportPath: string, bundlePaths: string[]) {
  if (!fs.existsSync(exportPath)) {
    return
  }

  recursiveCopy("")

  function copyFile(relativeFilePath: string): void {
    const srcPath = path.join(exportPath, relativeFilePath)
    for (const bundlePath of bundlePaths) {
      const destPath = path.join(bundlePath, relativeFilePath)
      fs.copyFileSync(srcPath, destPath)
    }
  }

  function copyDir(relativeDirPath: string): void {
    for (const bundlePath of bundlePaths) {
      const destPath = path.join(bundlePath, relativeDirPath)
      fs.mkdirSync(destPath, { recursive: true })
    }
  }

  function recursiveCopy(relativeDirPath: string): void {
    const fileNames = fs.readdirSync(path.join(exportPath, relativeDirPath))
    copyDir(relativeDirPath)
    for (const fileName of fileNames) {
      const relativeFilePath = path.join(relativeDirPath, fileName)
      const lstat = fs.lstatSync(path.join(exportPath, relativeFilePath))
      if (lstat.isDirectory()) {
        recursiveCopy(relativeFilePath)
      } else if (lstat.isFile()) {
        copyFile(relativeFilePath)
      } else if (lstat.isSymbolicLink()) {
        copyFile(relativeFilePath)
      }
    }
  }
}

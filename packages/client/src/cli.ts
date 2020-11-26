#!/usr/bin/env node

import path from "path";
import { buildClientSDK } from "@samen/core";

switch (process.argv[2]) {
  case "build":
    build();
    break;

  default:
    throw new Error(`Unknown command: process.argv[2]`);
}

async function build(): Promise<void> {
  const cwd = process.cwd();
  const manifestPath = path.join(cwd, "samen-manifest.json");
  const sdkPath = path.join(cwd, "node_modules/@samen/client/build/sdk");

  console.log("Building Samen SDK...");
  await buildClientSDK(manifestPath, sdkPath);
  console.log("Done!");
}

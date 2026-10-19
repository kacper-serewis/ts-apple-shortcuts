import ts from "typescript";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readCatalog } from "../catalog.js";
import type { CompileHost } from "./host.js";

// Runtime layout is lib/src/hosts/node-host.js; the declarations also serve editors.
export const nodeHost: CompileHost = {
  resolve: path => resolve(path),
  apiPath: fileURLToPath(new URL("../../../api/ios.d.ts", import.meta.url)),
  createCompilerHost: options => ts.createCompilerHost(options),
  catalog: readCatalog,
};

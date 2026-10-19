import type ts from "typescript";
import type { Catalog } from "../catalog.js";

/** Environment the compiler reads declarations and catalog metadata from. */
export interface CompileHost {
  resolve(path: string): string;
  /** Absolute path of api/ios.d.ts as seen by the TypeScript compiler host. */
  apiPath: string;
  createCompilerHost(options: ts.CompilerOptions): ts.CompilerHost;
  catalog(): Catalog;
}

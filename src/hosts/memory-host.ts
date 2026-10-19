import ts from "typescript";
import type { Catalog } from "../catalog.js";
import type { CompileHost } from "./host.js";

/**
 * In-memory host for environments without a file system, such as the browser.
 * `files` maps absolute paths to contents: TypeScript lib files under /lib/ and
 * the API declarations under /api/.
 */
export function memoryHost(files: Record<string, string>, catalog: Catalog): CompileHost {
  // Declaration files never change, so parse each once and share it between compilations.
  const parsed = new Map<string, ts.SourceFile>();
  const resolve = (path: string) => {
    const segments: string[] = [];
    for (const segment of path.split("/")) {
      if (segment === "..") segments.pop();
      else if (segment && segment !== ".") segments.push(segment);
    }
    return `/${segments.join("/")}`;
  };
  return {
    resolve,
    apiPath: "/api/ios.d.ts",
    catalog: () => catalog,
    createCompilerHost: () => ({
      getSourceFile(path, languageVersion) {
        const key = resolve(path);
        const text = files[key];
        if (text === undefined) return undefined;
        let file = parsed.get(key);
        if (!file) parsed.set(key, file = ts.createSourceFile(key, text, languageVersion, true));
        return file;
      },
      getDefaultLibFileName: options => `/lib/${ts.getDefaultLibFileName(options)}`,
      getDefaultLibLocation: () => "/lib",
      writeFile: () => {},
      getCurrentDirectory: () => "/",
      getCanonicalFileName: path => path,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: path => files[resolve(path)] !== undefined,
      readFile: path => files[resolve(path)],
      directoryExists: path => Object.keys(files).some(file => file.startsWith(`${resolve(path)}/`)),
    }),
  };
}

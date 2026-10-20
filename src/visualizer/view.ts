import { compile, CompileError } from "../compiler.js";
import type { AppMetadata } from "../app-metadata.js";
import type { Catalog } from "../catalog.js";
import type { CompileHost } from "../hosts/host.js";
import { buildPlist } from "../plist-codec.js";
import { workflowBlocks } from "./blocks.js";

const filename = "shortcut.ts";

/** Compile editor source into everything the visualizer page displays. */
export function visualize(source: string, name: string, catalog: Catalog, host?: CompileHost, apps?: AppMetadata[]) {
  try {
    const { workflow, ir, sourceMap } = compile(source, { filename, name, host, apps });
    return {
      ok: true as const, name, blocks: workflowBlocks(workflow, sourceMap, catalog.actions),
      workflow, ir, plist: buildPlist(workflow),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only point into the editor when the error belongs to the editor's source.
    const position = error instanceof CompileError && message.startsWith(`${filename}:`) ? error.position : undefined;
    return { ok: false as const, error: message, position };
  }
}

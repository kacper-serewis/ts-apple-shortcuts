import type { Catalog } from "../catalog.js";
import { memoryHost } from "../hosts/memory-host.js";
import { visualize } from "./view.js";

// Browser entry, bundled by scripts/build-site.mjs. Assets come from assets.json.
export interface SiteAssets { files: Record<string, string>; catalog: Catalog; examples: Record<string, string> }

export function createVisualizer({ files, catalog }: SiteAssets) {
  const host = memoryHost(files, catalog);
  return (source: string, name: string) => visualize(source, name, catalog, host);
}

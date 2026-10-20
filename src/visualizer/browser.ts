import type { AppMetadata } from "../app-metadata.js";
import type { Catalog } from "../catalog.js";
import { memoryHost } from "../hosts/memory-host.js";
import { visualize } from "./view.js";

// Browser entry, bundled by scripts/build-site.mjs. Assets come from assets.json.
export interface SiteAssets { files: Record<string, string>; catalog: Catalog; apps: Record<string, AppMetadata>; examples: Record<string, string> }

export function createVisualizer({ files, catalog, apps }: SiteAssets) {
  const host = memoryHost(files, catalog);
  return (source: string, name: string) => visualize(source, name, catalog, host, referencedApps(source, apps));
}

/** The browser has no --app flag: `/// <reference path=".../api/apps/<name>.d.ts" />` selects <name>.json. */
export function referencedApps(source: string, apps: Record<string, AppMetadata>): AppMetadata[] {
  const names = [...source.matchAll(/^\/\/\/\s*<reference\s+path="(?:[^"]*\/)?api\/apps\/([\w.-]+)\.d\.ts"\s*\/>/gm)].map(match => match[1]);
  return [...new Set(names)].filter(name => Object.hasOwn(apps, name)).map(name => apps[name]);
}

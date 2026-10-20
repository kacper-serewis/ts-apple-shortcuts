// Builds the static visualizer into site/: the compiler bundle, the page and
// assets.json (TypeScript lib + API declarations, catalog, app manifests and examples).
import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = new URL("../", import.meta.url);
const out = new URL("site/", root);
const at = path => new URL(path, root);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// The compiler targets lib.es2023.d.ts; include it and every lib it references.
const libDir = dirname(createRequire(import.meta.url).resolve("typescript/lib/lib.es2023.d.ts"));
const files = {};
async function addLib(name) {
  if (files[`/lib/${name}`] !== undefined) return;
  const text = await readFile(join(libDir, name), "utf8");
  files[`/lib/${name}`] = text;
  for (const [, lib] of text.matchAll(/<reference lib="([^"]+)"/g)) await addLib(`lib.${lib.toLowerCase()}.d.ts`);
}
await addLib("lib.es2023.d.ts");
for (const dir of ["api/", "api/apps/"]) {
  for (const name of (await readdir(at(dir))).filter(file => file.endsWith(".d.ts"))) files[`/${dir}${name}`] = await readFile(at(`${dir}${name}`), "utf8");
}
// Imported apps, keyed by name: a source referencing api/apps/<name>.d.ts compiles with <name>.json.
const apps = {};
for (const name of (await readdir(at("api/apps/"))).filter(file => file.endsWith(".json"))) {
  apps[name.replace(/\.json$/, "")] = JSON.parse(await readFile(at(`api/apps/${name}`), "utf8"));
}

const { actions } = JSON.parse(await readFile(at("data/actions.json"), "utf8"));
// Platforms are unused by the compiler and the page.
const catalog = { actions: actions.map(action => ({ ...action, platforms: [] })) };
const examples = {};
for (const name of (await readdir(at("examples/"), { recursive: true })).filter(file => file.endsWith(".ts")).sort()) {
  examples[name] = await readFile(at(`examples/${name}`), "utf8");
}
await writeFile(new URL("assets.json", out), JSON.stringify({ files, catalog, apps, examples }));

await build({
  entryPoints: [new URL("src/visualizer/browser.ts", root).pathname],
  outfile: new URL("compiler.js", out).pathname,
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
  logLevel: "warning",
  plugins: [{
    // The browser always passes a memory host; keep Node-only modules out of the bundle.
    name: "browser-host",
    setup(build) {
      build.onResolve({ filter: /\/node-host\.js$/ }, () => ({ path: "node-host", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const nodeHost = undefined;" }));
    },
  }],
});
for (const name of ["index.html", "style.css", "app.js"]) await cp(at(`web/${name}`), new URL(name, out));
console.log(`Built site → ${out.pathname}`);

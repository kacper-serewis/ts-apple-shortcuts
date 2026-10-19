#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseArgs } from "node:util";

// Serves the static site built by scripts/build-site.mjs; compilation runs in the browser.
const { values } = parseArgs({ options: { port: { type: "string", default: "5173" } } });
const site = new URL("../../../site/", import.meta.url);
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const asset = path === "/" ? "index.html" : path.slice(1);
  const type = types[extname(asset)];
  if (!/^[\w.-]+$/.test(asset) || !type) return response.writeHead(404).end("Not found");
  try {
    const body = await readFile(new URL(asset, site));
    response.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" }).end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(Number(values.port), "127.0.0.1", () => console.log(`Visualizer → http://localhost:${values.port}`));

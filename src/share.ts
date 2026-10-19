import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";

export function selectShareHost(interfaces = networkInterfaces()): string {
  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses ?? []).filter(a => a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."))
      .map(a => ({ name, address: a.address })));
  // Prefer ordinary Wi-Fi/Ethernet adapters over VPNs and virtual interfaces.
  const preferred = candidates.find(a => /^(en\d|eth\d|wl)/.test(a.name)) ?? candidates[0];
  if (!preferred) throw new Error("No network IPv4 address found. Connect to Wi-Fi or specify --host <your Mac's IPv4 address>.");
  return preferred.address;
}

export function parseSharePort(value = "0"): number {
  if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error("--port must be an integer from 0 to 65535 (0 chooses a free port).");
  return Number(value);
}

export function validateShareHost(host: string): string {
  if (!isIPv4(host) || host === "0.0.0.0") throw new Error("--host must be a concrete IPv4 address on this computer, not 0.0.0.0 or a hostname.");
  return host;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export interface ShareServer {
  /** Stable download URL for the currently published signed file. */
  url: string;
  pageUrl: string;
  /** JSON endpoint reporting the published build: {"build": "..."}. */
  versionUrl: string;
  html: string;
  terminalQR: string;
  /** Replace what the stable URL serves. The previous file stays served until this is called. */
  publish(content: Buffer, build?: string): void;
  close(): Promise<void>;
}
export type ShortcutShare = ShareServer;

/** Serve one in-memory signed file, never a directory of project files. */
export async function createShareServer(name: string, { host, port = 0, token = randomBytes(12).toString("hex") }: { host: string; port?: number; token?: string }): Promise<ShareServer> {
  validateShareHost(host);
  parseSharePort(String(port));
  if (!/^[0-9a-f]{24}$/.test(token)) throw new Error("Share token must be 24 lowercase hex characters.");
  const encodedName = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const base = `/${token}/`;
  const downloadPath = `${base}${encodedName}`;
  const versionPath = `${base}version.json`;
  let content: Buffer | undefined;
  let version: Buffer | undefined;
  let html = "";
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let body: Buffer;
    if (request.url === downloadPath && content) {
      body = content;
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Disposition", `attachment; filename="shortcut.shortcut"; filename*=UTF-8''${encodedName}`);
    } else if (request.url === versionPath && version) {
      body = version;
      response.setHeader("Content-Type", "application/json");
    } else if (request.url === base && html) {
      body = Buffer.from(html);
      response.setHeader("Content-Type", "text/html; charset=utf-8");
    } else {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Length", body.length);
    response.end(request.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
  const close = () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not determine the share server's port.");
    const origin = `http://${host}:${address.port}`;
    const url = origin + downloadPath;
    const pageUrl = origin + base;
    const [svg, terminalQR] = await Promise.all([
      QRCode.toString(url, { type: "svg", margin: 4, errorCorrectionLevel: "M" }),
      QRCode.toString(url, { type: "terminal", small: true, errorCorrectionLevel: "M" }),
    ]);
    html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — Shortcuts</title>
<style>body{font:16px system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 24px;line-height:1.5;color:#17202a;background:white}svg{display:block;width:100%;max-width:320px}a{color:#075dcc}h1{overflow-wrap:anywhere}.download{display:inline-block;background:#075dcc;color:white;padding:12px 20px;border-radius:10px;text-decoration:none}</style>
<h1>${escapeHtml(name)}</h1>${svg}<p><a class="download" href="${escapeHtml(url)}">Download shortcut</a></p>
<ol><li>Connect your iPhone to the same Wi-Fi network as this computer.</li><li>Scan the QR code or tap Download shortcut.</li><li>Open the downloaded file from Safari Downloads or Files to add it to Shortcuts.</li></ol>
<p>Keep the sharing command running. Press Ctrl+C in the terminal to stop sharing.</p></html>`;
    const publish = (next: Buffer, build?: string) => {
      content = Buffer.from(next);
      version = build === undefined ? undefined : Buffer.from(JSON.stringify({ build }));
    };
    return { url, pageUrl, versionUrl: origin + versionPath, html, terminalQR, publish, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Serve an immutable copy of one signed file. */
export async function shareShortcut(file: string, options: { host: string; port?: number; token?: string }): Promise<ShortcutShare> {
  validateShareHost(options.host);
  parseSharePort(String(options.port ?? 0));
  const content = await readFile(file);
  const share = await createShareServer(basename(file), options);
  share.publish(content);
  return share;
}

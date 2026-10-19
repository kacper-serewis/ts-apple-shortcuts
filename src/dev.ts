import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "./compiler.js";
import type { Compilation } from "./model.js";

export interface DevUpdate {
  /** Build identifier embedded in the shortcut and reported by versionUrl. */
  build: string;
  versionUrl: string;
  downloadUrl: string;
  /** Only check for updates on this Wi-Fi network. Without it, every run checks. */
  ssid?: string;
}

/** Identifies a build by its inputs, so restarting --dev on unchanged source does not prompt an update. */
export function devBuildId(...inputs: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 12);
}

export function devPrologueSource({ build, versionUrl, downloadUrl, ssid }: DevUpdate): string {
  const check = `
    const status = await getJson<{ build: string }>(${JSON.stringify(versionUrl)});
    if (status.build !== ${JSON.stringify(build)}) {
      await openURL(${JSON.stringify(downloadUrl)});
      await native("is.workflow.actions.exit", {});
    }`;
  return `import { getJson, openURL, native } from "@js-shortcuts/ios";
export default async function main(): Promise<void> {${ssid === undefined ? check : `
  const network = await native<string>("is.workflow.actions.getwifi", { WFWiFiDetail: "Network Name" });
  if (network === ${JSON.stringify(ssid)}) {${check}
  }`}
}
`;
}

/** Prepends the dev update check to a compiled shortcut. Action UUIDs are random, so the two compilations cannot collide. */
export function injectDevUpdate(compilation: Compilation, update: DevUpdate): Compilation {
  const prologue = compile(devPrologueSource(update), { filename: "dev-update.ts" }).workflow.WFWorkflowActions;
  const { workflow, sourceMap } = compilation;
  return {
    ...compilation,
    workflow: { ...workflow, WFWorkflowActions: [...prologue, ...workflow.WFWorkflowActions] },
    sourceMap: sourceMap.map(location => ({ ...location, actionIndex: location.actionIndex + prologue.length })),
  };
}

export interface DevState { token: string; port: number }

/** The URLs are baked into the installed shortcut, so keep token and port stable across --dev restarts. */
export async function loadDevState(file: string): Promise<DevState | undefined> {
  try {
    const state = JSON.parse(await readFile(file, "utf8"));
    if (typeof state?.token === "string" && /^[0-9a-f]{24}$/.test(state.token) && Number.isInteger(state.port) && state.port > 0 && state.port <= 65535) return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return undefined;
}

export async function saveDevState(file: string, state: DevState): Promise<void> {
  await writeFile(file, JSON.stringify(state, null, 2) + "\n");
}

export const newDevToken = () => randomBytes(12).toString("hex");

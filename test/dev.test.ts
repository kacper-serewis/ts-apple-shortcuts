import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { compile } from "../src/compiler.js";
import { devBuildId, injectDevUpdate, loadDevState, newDevToken, saveDevState } from "../src/dev.js";
import { createShareServer } from "../src/share.js";

const source = 'import { showResult } from "@js-shortcuts/ios"; export default async function main() { await showResult("Hi"); }';
const update = { build: "abc123", versionUrl: "http://192.168.1.10:8765/t/version.json", downloadUrl: "http://192.168.1.10:8765/t/x.shortcut" };
const ids = (actions: { WFWorkflowActionIdentifier: string }[]) => actions.map(action => action.WFWorkflowActionIdentifier.replace("is.workflow.actions.", ""));

test("dev update check runs before the shortcut and stops after opening a newer build", () => {
  const compilation = compile(source, { name: "Hi" });
  const injected = injectDevUpdate(compilation, update);
  const actions = injected.workflow.WFWorkflowActions;
  const original = compilation.workflow.WFWorkflowActions.length;
  assert.deepEqual(ids(actions.slice(0, -original)), ["downloadurl", "getvalueforkey", "gettext", "text.replace", "conditional", "openurl", "exit", "conditional"]);
  assert.deepEqual(actions.slice(-original), compilation.workflow.WFWorkflowActions);
  assert.equal(injected.workflow.WFWorkflowName, "Hi");
  const json = JSON.stringify(actions);
  assert.ok(json.includes(update.versionUrl) && json.includes(update.downloadUrl) && json.includes("abc123"));
  assert.deepEqual(injected.sourceMap.map(l => l.actionIndex), compilation.sourceMap.map(l => l.actionIndex + actions.length - original));
});

test("dev update check can be limited to one Wi-Fi network", () => {
  const actions = injectDevUpdate(compile(source), { ...update, ssid: 'Home "5G"' }).workflow.WFWorkflowActions;
  assert.deepEqual(ids(actions.slice(0, 4)), ["getwifi", "gettext", "text.replace", "conditional"]);
  assert.ok(JSON.stringify(actions).includes('Home \\"5G\\"'));
});

test("dev build ids depend on every input", () => {
  assert.equal(devBuildId(source, "Hi", update), devBuildId(source, "Hi", update));
  assert.notEqual(devBuildId(source, "Hi", update), devBuildId(source + " ", "Hi", update));
  assert.notEqual(devBuildId(source, "Hi", update), devBuildId(source, "Hi", { ...update, ssid: "Home" }));
});

test("dev state survives restarts and ignores corrupt files", async () => {
  const folder = await mkdtemp(join(tmpdir(), "shortcut-dev-state-"));
  try {
    const file = join(folder, "x.dev.json");
    assert.equal(await loadDevState(file), undefined);
    const state = { token: newDevToken(), port: 8765 };
    await saveDevState(file, state);
    assert.deepEqual(await loadDevState(file), state);
    for (const corrupt of ["{", '{"token":"nope","port":1}', '{"token":"' + state.token + '","port":0}']) {
      await writeFile(file, corrupt);
      assert.equal(await loadDevState(file), undefined);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("share server republishes on a stable URL and reports the build", async () => {
  const token = newDevToken();
  const share = await createShareServer("x.shortcut", { host: "127.0.0.1", token });
  try {
    assert.ok(share.url.includes(`/${token}/`));
    assert.equal((await fetch(share.url)).status, 404);
    assert.equal((await fetch(share.versionUrl)).status, 404);
    share.publish(Buffer.from("one"), "b1");
    assert.equal(await (await fetch(share.url)).text(), "one");
    assert.deepEqual(await (await fetch(share.versionUrl)).json(), { build: "b1" });
    share.publish(Buffer.from("two"), "b2");
    assert.equal(await (await fetch(share.url)).text(), "two");
    assert.deepEqual(await (await fetch(share.versionUrl)).json(), { build: "b2" });
  } finally {
    await share.close();
  }
  await assert.rejects(createShareServer("x.shortcut", { host: "127.0.0.1", token: "../etc" }), /token/);
});

test("--dev rebuilds on save, publishes the new build and reuses its URL after a restart", { skip: process.platform !== "darwin" }, async () => {
  const folder = await mkdtemp(join(tmpdir(), "shortcut-dev-cli-"));
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const bin = join(folder, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "plutil"), "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });
    // Fake signer: "signed" output is the unsigned plist, so the test can inspect the injected check.
    await writeFile(join(bin, "shortcuts"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.copyFileSync(args[args.indexOf("--input") + 1], args[args.indexOf("--output") + 1]);
`, { mode: 0o755 });
    const file = join(folder, "app.ts");
    const output = join(folder, "out", "app");
    await writeFile(file, source);
    const start = () => {
      const child = spawn(process.execPath, ["lib/src/cli.js", file, "--out", output, "--dev", "--host", "127.0.0.1"],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] });
      children.push(child);
      let log = "";
      child.stdout!.on("data", data => { log += data; });
      child.stderr!.on("data", data => { log += data; });
      const waitFor = (pattern: RegExp, from = 0) => new Promise<RegExpMatchArray>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}:\n${log}`)), 10000);
        const check = () => {
          const match = log.slice(from).match(pattern);
          if (match) { clearTimeout(timeout); child.stdout!.off("data", check); resolve(match); }
        };
        child.stdout!.on("data", check);
        check();
      });
      return { child, waitFor, length: () => log.length };
    };
    const first = start();
    await first.waitFor(/Press Ctrl\+C/);
    const url = (await first.waitFor(/Download → (\S+)/))[1];
    const versionUrl = new URL("version.json", url).href;
    const build1 = (await (await fetch(versionUrl)).json() as { build: string }).build;
    const served1 = await (await fetch(url)).text();
    assert.ok(served1.includes(versionUrl) && served1.includes(build1));

    const mark = first.length();
    await writeFile(file, source.replace('"Hi"', '"Changed"'));
    const build2 = (await first.waitFor(/Published build (\w+)/, mark))[1];
    assert.notEqual(build2, build1);
    assert.equal((await (await fetch(versionUrl)).json() as { build: string }).build, build2);
    assert.ok((await (await fetch(url)).text()).includes("Changed"));

    first.child.kill("SIGINT");
    await first.waitFor(/Sharing stopped/);
    const state = JSON.parse(await readFile(`${output}.dev.json`, "utf8"));
    assert.equal(String(state.port), new URL(url).port);

    const second = start();
    assert.equal((await second.waitFor(/Download → (\S+)/))[1], url);
    assert.equal((await (await fetch(versionUrl)).json() as { build: string }).build, build2);
    second.child.kill("SIGINT");
    await second.waitFor(/Sharing stopped/);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(folder, { recursive: true, force: true });
  }
});

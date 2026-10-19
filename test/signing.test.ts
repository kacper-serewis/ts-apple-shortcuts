import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

async function runShare(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const finished = new Promise<number | null>(resolve => child.once("close", code => resolve(code)));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Share CLI did not become ready: ${stderr}`)); }, 10000);
      child.once("close", () => { clearTimeout(timeout); reject(new Error(`Share CLI exited early: ${stdout}${stderr}`)); });
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.stderr.on("data", data => { stderr += data; });
      child.stdout.on("data", data => {
        stdout += data;
        if (stdout.includes("Press Ctrl+C to stop sharing.")) { clearTimeout(timeout); resolve(); }
      });
    });
    const url = stdout.match(/Download → (http:\/\/\S+)/)?.[1];
    assert.ok(url, stdout);
    assert.equal(await (await fetch(url)).text(), "new signed output");
    child.kill("SIGINT");
    const status = await finished;
    assert.match(stdout, /Sharing stopped\./);
    await assert.rejects(fetch(url));
    return { status, stdout, stderr };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await finished;
  }
}

for (const sharing of [false, true]) for (const fails of [false, true]) {
  test(`${sharing ? "sharing" : "signing"} uses system temporary storage and ${fails ? "preserves previous output on failure" : "publishes successful output"}`, { skip: process.platform !== "darwin" }, async () => {
    const folder = await mkdtemp(join(tmpdir(), "shortcut-sign-test-"));
    try {
      const bin = join(folder, "bin");
      const temporary = join(folder, "system-temp");
      const target = join(folder, "project-output");
      for (const path of [bin, temporary, target]) await mkdir(path);
      const source = join(folder, "shortcut.ts");
      await writeFile(source, 'import { showResult } from "@js-shortcuts/ios"; export default async function main() { await showResult("Hi"); }');
      const output = join(target, "test");
      await writeFile(`${output}.shortcut`, "previous signed output");
      await writeFile(join(bin, "plutil"), "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });
      await writeFile(join(bin, "shortcuts"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.TEST_SIGN_ARGS, JSON.stringify(args));
const input = args[args.indexOf("--input") + 1];
const output = args[args.indexOf("--output") + 1];
if (!input.startsWith(process.env.TMPDIR + path.sep) || !output.startsWith(process.env.TMPDIR + path.sep)) {
  console.error("Signer paths must use system temporary storage"); process.exit(2);
}
fs.writeFileSync(output, "new signed output");
if (process.env.TEST_SIGN_FAIL === "yes") { console.error("Simulated signing failure"); process.exit(1); }
`, { mode: 0o755 });
      const args = ["lib/src/cli.js", source, "--out", output, ...(sharing ? ["--share", "--host", "127.0.0.1"] : ["--sign"])];
      const signArgsFile = join(folder, "sign-args.json");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: temporary, TEST_SIGN_FAIL: fails ? "yes" : "no", TEST_SIGN_ARGS: signArgsFile };
      const result = sharing && !fails ? await runShare(args, env) : spawnSync(process.execPath, args, { encoding: "utf8", env, timeout: 10000 });
      assert.equal(result.status, fails ? 1 : 0, result.stdout + result.stderr);
      if (fails) assert.match(result.stderr, /Simulated signing failure/);
      const signArgs: string[] = JSON.parse(await readFile(signArgsFile, "utf8"));
      assert.equal(signArgs[signArgs.indexOf("--mode") + 1], sharing ? "people-who-know-me" : "anyone");
      assert.equal(await readFile(`${output}.shortcut`, "utf8"), fails ? "previous signed output" : "new signed output");
      assert.deepEqual(await readdir(temporary), []);
      assert.deepEqual((await readdir(target)).sort(), ["test.json", ...(sharing && !fails ? ["test.share.html"] : []), "test.shortcut", "test.unsigned.plist"]);
      if (fails) assert.doesNotMatch(result.stdout, /Download →/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
}

#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm, rename, copyFile } from "node:fs/promises";
import { basename, dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { buildPlist, stringifyInspection } from "./plist-codec.js";
import { compile } from "./compiler.js";
import { readWorkflow, workflowToTypeScript } from "./importer.js";
import { searchActions } from "./catalog.js";
import { parseSharePort, selectShareHost, shareShortcut, validateShareHost } from "./share.js";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      sign: { type: "boolean" }, share: { type: "boolean" }, mode: { type: "string" },
      host: { type: "string" }, port: { type: "string" },
      name: { type: "string" }, out: { type: "string" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log('Usage: node lib/src/cli.js input.ts [--name "Name"] [--out dist/name] [--sign] [--mode anyone|people-who-know-me]');
    console.log('       node lib/src/cli.js input.ts --share [--host LAN_IP] [--port 0] [--mode people-who-know-me|anyone]');
    console.log('       --share signs, prints a QR code and serves the shortcut until Ctrl+C. Defaults to private sharing and a free port.');
    console.log('       node lib/src/cli.js import workflow.plist --out examples/imported.ts');
    console.log('       node lib/src/cli.js actions [search words]');
    console.log('       node lib/src/cli.js action full.native.identifier');
  } else if (positionals[0] === "import") {
    if (positionals.length !== 2 || !values.out || !/\.ts$/.test(values.out)) throw new Error("Use import workflow.plist --out example.ts");
    const output = resolve(values.out);
    const source = workflowToTypeScript(await readWorkflow(resolve(positionals[1])));
    // Validate before publishing the generated source. Never overwrite an existing file.
    compile(source, { filename: output });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, source, { flag: "wx" });
    console.log(`Imported → ${output}`);
  } else if (positionals[0] === "actions") {
    const matches = searchActions(positionals.slice(1).join(" "));
    for (const item of matches) console.log(`${item.category}.${item.functionName}\t${item.id}\t${item.name}\t${item.platforms.join(", ")}`);
    console.log(`${matches.length} catalog entries (metadata, not device verification).`);
  } else if (positionals[0] === "action") {
    if (positionals.length !== 2) throw new Error("Use action full.native.identifier");
    const action = searchActions(positionals[1]).find(action => action.id === positionals[1]);
    if (!action) throw new Error("Action is not in this catalog; native() can still use identifiers from an exported shortcut.");
    console.log(JSON.stringify(action, null, 2));
  } else {
    if (positionals.length !== 1 || !/\.(ts|js|mts|mjs)$/i.test(positionals[0])) throw new Error("Provide exactly one input .ts or .js file. Use --help for usage.");
    const mode = values.mode ?? (values.share ? "people-who-know-me" : "anyone");
    if (!["anyone", "people-who-know-me"].includes(mode)) throw new Error("Invalid signing mode.");
    if (!values.share && (values.host !== undefined || values.port !== undefined)) throw new Error("--host and --port require --share.");
    const shareOptions = values.share ? {
      host: validateShareHost(values.host ?? selectShareHost()), port: parseSharePort(values.port),
    } : undefined;
    const filename = resolve(positionals[0]);
    const stem = basename(filename).replace(/\.(ts|js|mts|mjs)$/i, "");
    const output = resolve(values.out ?? `dist/${stem}`);
    const { workflow, ir, sourceMap } = compile(await readFile(filename, "utf8"), { filename, name: values.name ?? stem });
    if (values.name) workflow.WFWorkflowName = values.name;
    await mkdir(dirname(output), { recursive: true });
    const xml = buildPlist(workflow);
    await writeFile(`${output}.unsigned.plist`, xml);
    await writeFile(`${output}.json`, stringifyInspection({ workflow, ir, sourceMap }));
    console.log(`Compiled ${workflow.WFWorkflowActions.length} actions → ${output}.unsigned.plist`);
    if (values.sign || values.share) {
      if (process.platform !== "darwin") throw new Error("Signing requires macOS. The unsigned plist was generated successfully.");
      console.log(`Signing (${mode}) with Apple's shortcuts CLI…`);
      // The signer requires a .shortcut extension even for the unsigned plist.
      // Apple's signing service can fail to save on external/project volumes.
      // Sign on the system volume, then publish atomically on the target volume.
      const temp = await mkdtemp(join(tmpdir(), "ts-shortcuts-sign-"));
      try {
        const input = `${temp}/${basename(output)}.shortcut`;
        const signed = `${temp}/signed.shortcut`;
        await writeFile(input, xml);
        const conversion = spawnSync("plutil", ["-convert", "binary1", input], { encoding: "utf8", timeout: 10000 });
        if (conversion.status !== 0) throw new Error(conversion.error?.message || conversion.stderr || "Binary plist conversion failed.");
        const result = spawnSync("shortcuts", ["sign", "--mode", mode, "--input", input, "--output", signed], { encoding: "utf8", timeout: 60000 });
        if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || "Signing failed.");
        const publish = await mkdtemp(`${output}-publish-`);
        try {
          const staged = join(publish, "signed.shortcut");
          await copyFile(signed, staged);
          await rename(staged, `${output}.shortcut`);
        } finally {
          await rm(publish, { recursive: true, force: true });
        }
        console.log(`Signed → ${output}.shortcut`);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    if (shareOptions) {
      const share = await shareShortcut(`${output}.shortcut`, shareOptions);
      try {
        const page = `${output}.share.html`;
        await writeFile(page, share.html);
        console.log(share.terminalQR);
        console.log(`Download → ${share.url}`);
        console.log(`QR page → ${share.pageUrl}`);
        console.log(`Saved QR page → ${page}`);
        console.log("Scan with your iPhone on the same Wi-Fi. Open the downloaded file in Shortcuts.");
        if (mode === "people-who-know-me") console.log("Signed for private sharing; the receiving device may need Allow Private Sharing enabled in Shortcuts settings.");
        console.log("Keep this command running. Press Ctrl+C to stop sharing.");
        await new Promise<void>(resolve => {
          const stop = () => {
            process.off("SIGINT", stop);
            process.off("SIGTERM", stop);
            resolve();
          };
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
        });
      } finally {
        await share.close();
      }
      console.log("Sharing stopped.");
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

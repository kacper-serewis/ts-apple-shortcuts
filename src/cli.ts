#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm, rename, copyFile } from "node:fs/promises";
import { basename, dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { buildPlist, stringifyInspection } from "./plist-codec.js";
import { compile } from "./compiler.js";
import { appDeclarations } from "./app-metadata.js";
import { importAppBundle, bindAppWorkflow, readAppManifest } from "./app-importer.js";
import { readWorkflow, workflowToTypeScript } from "./importer.js";
import { searchActions } from "./catalog.js";
import { createShareServer, parseSharePort, selectShareHost, shareShortcut, validateShareHost, type ShareServer } from "./share.js";
import { devBuildId, injectDevUpdate, loadDevState, newDevToken, saveDevState, type DevUpdate } from "./dev.js";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      app: { type: "string", multiple: true }, reference: { type: "string" },
      sign: { type: "boolean" }, share: { type: "boolean" }, dev: { type: "boolean" }, mode: { type: "string" },
      host: { type: "string" }, port: { type: "string" }, ssid: { type: "string" },
      name: { type: "string" }, out: { type: "string" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log('Usage: node lib/src/cli.js input.ts [--name "Name"] [--out dist/name] [--sign] [--mode anyone|people-who-know-me]');
    console.log('       node lib/src/cli.js input.ts --share [--host LAN_IP] [--port 0] [--mode people-who-know-me|anyone]');
    console.log('       --share signs, prints a QR code and serves the shortcut until Ctrl+C. Defaults to private sharing and a free port.');
    console.log('       node lib/src/cli.js input.ts --dev [--ssid "Wi-Fi name"] [--host LAN_IP] [--port N]');
    console.log('       --dev is --share plus rebuild on save; the shortcut checks this server on each run and offers the new build.');
    console.log('       node lib/src/cli.js import workflow.plist --out examples/imported.ts');
    console.log('       node lib/src/cli.js actions [search words]');
    console.log('       node lib/src/cli.js action full.native.identifier');
    console.log('       node lib/src/cli.js apps import App.app --name HomeAssistant --out api/apps/home-assistant [--reference workflow.plist]');
    console.log('       node lib/src/cli.js input.ts --app api/apps/home-assistant.json');
  } else if (positionals[0] === "apps") {
    if (positionals[1] !== "import" || positionals.length !== 3 || !values.name || !values.out) throw new Error("Use apps import App.app --name HomeAssistant --out api/apps/home-assistant [--reference workflow.plist]");
    let app = await importAppBundle(resolve(positionals[2]), values.name);
    if (values.reference) app = bindAppWorkflow(app, await readWorkflow(resolve(values.reference)));
    const output = resolve(values.out);
    const declarations = appDeclarations(app);
    await mkdir(dirname(output), { recursive: true });
    // Exclusive creation: importing a different app version must not silently replace existing bindings.
    await writeFile(`${output}.json`, JSON.stringify(app, null, 2) + "\n", { flag: "wx" });
    try { await writeFile(`${output}.d.ts`, declarations, { flag: "wx" }); }
    catch (error) { await rm(`${output}.json`); throw error; }
    console.log(`Imported ${Object.keys(app.metadata.actions as object).length} actions; ${Object.keys(app.bindings).length} native export bindings → ${output}.{json,d.ts}`);
    console.log(`Compile with --app ${output}.json. Include ${output}.d.ts for editor types.`);
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
    const sharing = values.share || values.dev;
    const mode = values.mode ?? (sharing ? "people-who-know-me" : "anyone");
    if (!["anyone", "people-who-know-me"].includes(mode)) throw new Error("Invalid signing mode.");
    if (!sharing && (values.host !== undefined || values.port !== undefined)) throw new Error("--host and --port require --share or --dev.");
    if (!values.dev && values.ssid !== undefined) throw new Error("--ssid requires --dev.");
    const shareOptions = sharing ? {
      host: validateShareHost(values.host ?? selectShareHost()), port: parseSharePort(values.port),
    } : undefined;
    const filename = resolve(positionals[0]);
    const stem = basename(filename).replace(/\.(ts|js|mts|mjs)$/i, "");
    const output = resolve(values.out ?? `dist/${stem}`);
    const name = values.name ?? stem;
    const apps = await Promise.all((values.app ?? []).map(readAppManifest));
    const build = async (source: string, update?: DevUpdate) => {
      let compilation = compile(source, { filename, name, apps });
      if (values.name) compilation.workflow.WFWorkflowName = values.name;
      if (update) compilation = injectDevUpdate(compilation, update);
      const { workflow, ir, sourceMap } = compilation;
      await mkdir(dirname(output), { recursive: true });
      const xml = buildPlist(workflow);
      await writeFile(`${output}.unsigned.plist`, xml);
      await writeFile(`${output}.json`, stringifyInspection({ workflow, ir, sourceMap }));
      console.log(`Compiled ${workflow.WFWorkflowActions.length} actions → ${output}.unsigned.plist`);
      if (values.sign || sharing) {
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
    };
    const printShare = async (share: ShareServer) => {
      const page = `${output}.share.html`;
      await writeFile(page, share.html);
      console.log(share.terminalQR);
      console.log(`Download → ${share.url}`);
      console.log(`QR page → ${share.pageUrl}`);
      console.log(`Saved QR page → ${page}`);
      console.log("Scan with your iPhone on the same Wi-Fi. Open the downloaded file in Shortcuts.");
      if (mode === "people-who-know-me") console.log("Signed for private sharing; the receiving device may need Allow Private Sharing enabled in Shortcuts settings.");
    };
    if (values.dev && shareOptions) {
      // The installed shortcut calls back to this exact URL, so reuse the token and port between runs.
      const statePath = `${output}.dev.json`;
      const saved = await loadDevState(statePath);
      const token = saved?.token ?? newDevToken();
      const port = values.port !== undefined ? shareOptions.port : saved?.port ?? 0;
      await mkdir(dirname(output), { recursive: true });
      const share = await createShareServer(`${basename(output)}.shortcut`, { host: shareOptions.host, port, token }).catch(error => {
        if (error?.code === "EADDRINUSE") throw new Error(`Port ${port} is in use. Stop the other --dev run, or pass --port and reinstall the shortcut on your phone.`);
        throw error;
      });
      let watcher: FSWatcher | undefined;
      try {
        await saveDevState(statePath, { token, port: Number(new URL(share.url).port) });
        let published: string | undefined;
        const rebuild = async () => {
          try {
            const source = await readFile(filename, "utf8");
            const urls = { versionUrl: share.versionUrl, downloadUrl: share.url, ssid: values.ssid };
            const update = { ...urls, build: devBuildId(source, name, mode, urls) };
            if (update.build === published) return;
            await build(source, update);
            share.publish(await readFile(`${output}.shortcut`), update.build);
            console.log(`Published build ${update.build}.${published ? " The next run on your phone offers the update." : ""}`);
            published = update.build;
          } catch (error) {
            console.error(`Build failed; still serving ${published ? `build ${published}` : "nothing"}.`);
            console.error(error instanceof Error ? error.message : String(error));
          }
        };
        let queue = rebuild();
        await queue;
        await printShare(share);
        if (values.ssid === undefined) console.log("Tip: pass --ssid \"Your Wi-Fi\" so the shortcut only checks for updates on that network. Without it, runs fail while this server is unreachable.");
        let timer: NodeJS.Timeout | undefined;
        // Watch the folder: editors often save by replacing the file, which ends a file watch.
        watcher = watch(dirname(filename), (_event, file) => {
          if (file !== basename(filename)) return;
          clearTimeout(timer);
          timer = setTimeout(() => { queue = queue.then(rebuild); }, 150);
        });
        console.log(`Watching ${filename}. Press Ctrl+C to stop sharing.`);
        await waitForStop();
        clearTimeout(timer);
        await queue;
      } finally {
        watcher?.close();
        await share.close();
      }
      console.log("Sharing stopped.");
    } else {
      await build(await readFile(filename, "utf8"));
      if (shareOptions) {
        const share = await shareShortcut(`${output}.shortcut`, shareOptions);
        try {
          await printShare(share);
          console.log("Keep this command running. Press Ctrl+C to stop sharing.");
          await waitForStop();
        } finally {
          await share.close();
        }
        console.log("Sharing stopped.");
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function waitForStop(): Promise<void> {
  return new Promise<void>(resolve => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

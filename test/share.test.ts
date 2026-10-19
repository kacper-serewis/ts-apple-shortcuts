import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, type NetworkInterfaceInfo } from "node:os";
import { join } from "node:path";
import { parseSharePort, selectShareHost, shareShortcut, validateShareHost } from "../src/share.js";

const address = (ip: string, internal = false): NetworkInterfaceInfo => ({
  address: ip, internal, family: "IPv4", netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${ip}/24`,
});

test("sharing prefers Wi-Fi/Ethernet over loopback, link-local and VPN interfaces", () => {
  assert.equal(selectShareHost({ lo0: [address("127.0.0.1", true)], utun0: [address("10.0.0.1")], en0: [address("192.168.1.10")] }), "192.168.1.10");
  assert.equal(selectShareHost({ custom: [address("10.1.2.3")] }), "10.1.2.3");
  assert.throws(() => selectShareHost({ lo0: [address("127.0.0.1", true)], en0: [address("169.254.1.2")] }), /No network IPv4/);
});

test("sharing validates host and port before opening a server", () => {
  for (const value of ["", "-1", "1.2", "65536", "abc", "Infinity"]) assert.throws(() => parseSharePort(value), /--port/);
  assert.equal(parseSharePort(), 0);
  assert.equal(parseSharePort("8765"), 8765);
  for (const value of ["0.0.0.0", "localhost", "::1", "192.168.0.999"]) assert.throws(() => validateShareHost(value), /--host/);
  assert.equal(validateShareHost("192.168.1.10"), "192.168.1.10");
});

test("share server serves exactly one immutable file and a QR page, then closes", async () => {
  const folder = await mkdtemp(join(tmpdir(), "shortcut-share-test-"));
  const file = join(folder, "résumé & <script>.shortcut");
  const content = Buffer.from([0, 1, 2, 255, 10, 13]);
  await writeFile(file, content);
  const share = await shareShortcut(file, { host: "127.0.0.1" });
  try {
    assert.notEqual(new URL(share.url).port, "0");
    assert.match(share.terminalQR, /[▀▄█]/);
    assert.match(share.html, /<svg/);
    assert.match(share.html, /résumé &amp; &lt;script&gt;\.shortcut/);
    assert.ok(share.html.includes(share.url));
    assert.ok(!share.html.includes("<script>"));
    const response = await fetch(share.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition")!, /filename\*=UTF-8''r%C3%A9sum%C3%A9/);
    assert.equal(response.headers.get("content-length"), String(content.length));
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
    // Recompiling a file while sharing must not change what this QR serves.
    await writeFile(file, "replacement");
    assert.deepEqual(Buffer.from(await (await fetch(share.url)).arrayBuffer()), content);
    const head = await fetch(share.url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(await (await fetch(share.pageUrl)).text(), share.html);
    for (const path of ["/", "/api/ios.d.ts", "/../package.json", "/%2e%2e/package.json"]) {
      assert.equal((await fetch(new URL(path, share.url))).status, 404);
    }
    const post = await fetch(share.url, { method: "POST", body: "ignored" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    await assert.rejects(shareShortcut(file, { host: "127.0.0.1", port: Number(new URL(share.url).port) }), /EADDRINUSE/);
  } finally {
    await share.close();
    await rm(folder, { recursive: true, force: true });
  }
  await assert.rejects(fetch(share.url));
});

test("sharing a missing file does not start a listener", async () => {
  const folder = await mkdtemp(join(tmpdir(), "shortcut-share-missing-"));
  try {
    await assert.rejects(shareShortcut(join(folder, "missing.shortcut"), { host: "127.0.0.1" }), /ENOENT/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

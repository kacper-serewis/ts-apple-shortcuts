import { requestJson, showResult, stringifyJson } from "@js-shortcuts/ios";

interface Echo { method: string; accept: string; contentType: string; marker: string }
interface Payload { person: { name: string; score: number }; tags: string[]; enabled: boolean }
interface PostEcho extends Echo { received: Payload }
interface ArrayEcho extends Echo { received: number[] }
interface TextEcho extends Echo { received: string }
function person(): Payload["person"] { return { name: "Ada", score: 7 }; }

// Start the local fixture: python3 scripts/http-echo.py
export default async function main(): Promise<void> {
  const base = "http://127.0.0.1:8765";
  const first = await requestJson<Echo>(`${base}/echo?case=get`);
  await showResult(`${first.method}: ${first.accept}`);

  const marker = `ts-${1 + 1}`;
  const headers = { "X-Toolkit-Test": marker };
  const payload = { person: person(), tags: ["ts", "ios"].filter(tag => tag !== "ios"), enabled: false };
  const post = await requestJson<PostEcho>(`${base}/echo?case=post`, { method: "POST", headers, json: payload });
  await showResult(`${post.method}: ${post.marker}; ${post.received.person.name}/${post.received.tags.length}/${post.received.enabled ? "Y" : "N"}`);

  const put = await requestJson<ArrayEcho>(`${base}/echo?case=put`, { method: "PUT", json: [] });
  await showResult(`${put.method}: ${stringifyJson(put.received)}; ${put.contentType}`);

  const patch = await requestJson<ArrayEcho>(`${base}/echo?case=patch`, {
    json: [42], method: "PATCH", headers: { accept: "application/json; profile=test", "content-type": "application/vnd.test+json" },
  });
  await showResult(`${patch.method}: ${stringifyJson(patch.received)}; ${patch.accept}; ${patch.contentType}`);

  const deleted = await requestJson<TextEcho>(`${base}/echo?case=delete`, { method: "DELETE", json: 'quote"\\\n😀' });
  await showResult(`${deleted.method}: ${stringifyJson(deleted.received)}`);

  const rows = await requestJson<{ n: number }[]>(`${base}/array`, {});
  await showResult(`Array: ${rows.length}; som: ${rows[0].n + rows[1].n}`);
}

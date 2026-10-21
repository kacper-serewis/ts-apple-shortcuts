import { getJson } from "@js-shortcuts/ios";

// The local harness chooses a depth before each run. Keep per-iteration work
// minimal: only the compiler's state transport, comparison and increment.
export default async function main() {
  const config = await getJson<{ limit: number; run: string }>("http://127.0.0.1:8770/config");
  const limit = config.limit;
  let n = 0;
  while (n < limit) {
    n++;
  }
  await getJson<{ ok: boolean }>(`http://127.0.0.1:8770/done?run=${config.run}&limit=${limit}&n=${n}`);
}

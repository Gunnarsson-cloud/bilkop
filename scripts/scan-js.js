// Letar i en sidas JavaScript-filer efter ett mönster, t.ex. vilket API en sida hämtar data från.
//   node scripts/scan-js.js <sidans URL> <regex>
import { USER_AGENT } from "../server/fetcher.js";

const [pageUrl, pattern] = process.argv.slice(2);
if (!pageUrl || !pattern) { console.error("användning: scan-js.js <url> <regex>"); process.exit(1); }
const re = new RegExp(pattern, "g");
const get = async url => (await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) })).text();

const html = await get(pageUrl);
const scripts = [...new Set([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => new URL(m[1], pageUrl).href))];
console.log(`${scripts.length} skript`);
const seen = new Set();
for (const src of [pageUrl, ...scripts]) {
  const body = src === pageUrl ? html : await get(src).catch(() => "");
  for (const m of body.matchAll(re)) {
    const ctx = body.slice(Math.max(0, m.index - 200), m.index + 250).replace(/\s+/g, " ");
    if (seen.has(ctx)) continue;
    seen.add(ctx);
    console.log(`\n--- ${src.split("/").pop()} @${m.index}\n${ctx}`);
    if (seen.size >= 40) process.exit(0);
  }
}

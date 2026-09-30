// Letar i en sidas JavaScript-filer efter ett mönster, t.ex. vilket API en sida hämtar data från.
//   node scripts/scan-js.js <sidans URL> <regex>
import { USER_AGENT } from "../server/fetcher.js";

// Utan mönster och med en URL som svarar JSON: visar svarets struktur och första posten i varje lista.
//   node scripts/scan-js.js <api-URL>
const [pageUrl, pattern] = process.argv.slice(2);
if (!pageUrl) { console.error("användning: scan-js.js <url> [regex]"); process.exit(1); }
if (!pattern) {
  const u = new URL(pageUrl);
  const robots = await fetch(u.origin + "/robots.txt").then(r => r.status + " " + r.text()).catch(e => e.message);
  console.log("robots.txt:", String(await robots).slice(0, 400));
  const r = await fetch(pageUrl, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  console.log(r.status, r.headers.get("content-type"), text.length, "B");
  let data;
  try { data = JSON.parse(text); } catch { console.log(text.slice(0, 1500)); process.exit(0); }
  const shape = (o, d = 0) => d > 3 || o === null || typeof o !== "object" ? typeof o
    : Array.isArray(o) ? [`${o.length} st`, shape(o[0], d + 1)] : Object.fromEntries(Object.entries(o).slice(0, 40).map(([k, v]) => [k, shape(v, d + 1)]));
  console.log(JSON.stringify(shape(data), null, 1).slice(0, 4000));
  const firstList = (o, d = 0) => { if (!o || typeof o !== "object" || d > 4) return null;
    if (Array.isArray(o) && o.length && typeof o[0] === "object") return o;
    for (const v of Object.values(o)) { const f = firstList(v, d + 1); if (f) return f; } return null; };
  const list = firstList(data);
  if (list) console.log("\nFÖRSTA POSTEN:", JSON.stringify(list[0]).slice(0, 5000));
  process.exit(0);
}
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

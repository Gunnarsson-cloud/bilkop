// Provar alla källor i server/sources.json mot de riktiga sajterna och skriver ut
// vad som fungerar. Körs i GitHub Actions (se .github/workflows/probe.yml) eller lokalt:
//   node scripts/probe.js [käll-id ...]
import { USER_AGENT, parseRobots, isAllowed } from "../server/fetcher.js";
import { extractCars, extractLoanTerms } from "../server/extract.js";
import { SOURCES, fill } from "../server/search.js";

const only = process.argv.slice(2);
const pick = list => list.filter(s => !only.length || only.includes(s.id));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEARCH = { q: "", minPrice: 150000, maxPrice: 300000, yearFrom: "", maxMil: "" };

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "sv-SE,sv;q=0.9", Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(20000), redirect: "follow",
  });
  return { status: res.status, url: res.url, type: res.headers.get("content-type"), body: await res.text() };
}

const robotsCache = new Map();
async function allowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    try {
      const r = await get(u.origin + "/robots.txt");
      robotsCache.set(u.origin, r.status === 200 ? parseRobots(r.body) : []);
    } catch { robotsCache.set(u.origin, []); }
  }
  return isAllowed(robotsCache.get(u.origin), u.pathname + u.search);
}

function describe(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].trim().slice(0, 100);
  const scripts = [...html.matchAll(/<script([^>]*)>/gi)].map(m => m[1])
    .filter(a => /json|id=/i.test(a)).map(a => a.trim().replace(/\s+/g, " ").slice(0, 80));
  const ldTypes = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(m => { try { return [].concat(JSON.parse(m[1])).map(o => o["@type"]); } catch { return ["(trasig)"]; } });
  const priceKeys = [...new Set([...html.matchAll(/"([A-Za-z]*[Pp]rice[A-Za-z]*)"\s*:/g)].map(m => m[1]))].slice(0, 10);
  return { title, bytes: html.length, ldTypes, scripts: [...new Set(scripts)].slice(0, 12), priceKeys };
}

function searchLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/(?:href|action)="([^"#]+)"/gi)) {
    if (!/s[oö]k|search|bilar|begagnad|annonser|car/i.test(m[1])) continue;
    try { out.add(new URL(m[1].replace(/&amp;/g, "&"), base).href); } catch { /* ogiltig länk */ }
    if (out.size >= 12) break;
  }
  return [...out];
}

function snippets(html, word, n = 4) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  return [...text.matchAll(new RegExp(`.{0,70}${word}.{0,70}`, "gi"))].slice(0, n).map(m => m[0].trim());
}

async function probe(kind, s, url) {
  console.log(`\n=== ${kind} ${s.id}: ${url}`);
  try {
    if (!(await allowed(url))) { console.log("robots.txt: FÖRBJUDET – hämtas inte"); return { id: s.id, ok: false, why: "robots" }; }
    const r = await get(url);
    console.log(`status ${r.status}  ${r.type}  -> ${r.url}`);
    const d = describe(r.body);
    console.log(JSON.stringify(d));
    if (kind === "BIL") {
      const cars = extractCars(r.body, r.url, s.name);
      console.log(`bilar hittade: ${cars.length}`);
      for (const c of cars.slice(0, 3)) console.log("  ", JSON.stringify(c));
      if (!cars.length) {
        const home = await get(new URL(url).origin + "/");
        console.log("sökrelaterade länkar på startsidan:", JSON.stringify(searchLinks(home.body, home.url)));
      }
      return { id: s.id, ok: r.status === 200 && cars.length > 0, found: cars.length, status: r.status };
    }
    const terms = extractLoanTerms(r.body);
    console.log("villkor:", JSON.stringify(terms));
    for (const t of snippets(r.body, "ränta")) console.log("   »", t);
    return { id: s.id, ok: r.status === 200 && (terms.nominal != null || terms.effective != null), status: r.status, ...terms };
  } catch (e) {
    console.log("FEL:", e.cause?.code ?? e.message);
    return { id: s.id, ok: false, why: e.cause?.code ?? e.message };
  }
}

const summary = [];
for (const s of pick(SOURCES.cars)) { summary.push(await probe("BIL", s, fill(s.search, SEARCH))); await sleep(1500); }
for (const s of pick(SOURCES.loans)) { summary.push(await probe("LÅN", s, s.url)); await sleep(1500); }

console.log("\n=== SAMMANFATTNING");
for (const r of summary) console.log(`${r.ok ? "OK  " : "MISS"} ${JSON.stringify(r)}`);

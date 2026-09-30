// Provar alla källor i server/sources.json mot de riktiga sajterna och skriver ut
// vad som fungerar. Körs i GitHub Actions (se .github/workflows/probe.yml) eller lokalt:
//   node scripts/probe.js [käll-id ...]
import { USER_AGENT, parseRobots, isAllowed } from "../server/fetcher.js";
import { extractCars, extractLoanTerms, embeddedJson } from "../server/extract.js";
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

// Visar var på sidan annonsdatan ligger: JSON-block, inline-skript och HTML runt första priset.
function deep(html) {
  const out = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1].trim().replace(/\s+/g, " ").slice(0, 70), body = m[2];
    const i = body.search(/"(?:price|Price|priceValue)"\s*:/);
    if (i < 0 || body.length < 200) continue;
    out.push(`SCRIPT [${attrs}] ${body.length} B, början: ${body.slice(0, 90).replace(/\s+/g, " ")}`);
    out.push(`   runt pris: ${body.slice(Math.max(0, i - 500), i + 250).replace(/\s+/g, " ")}`);
    if (out.length >= 10) break;
  }
  const t = html.search(/\d{2,3}[\s\u00a0]\d{3}(?:&nbsp;|[\s\u00a0])?kr/);
  if (t > 0) out.push(`HTML runt första pris: ${html.slice(Math.max(0, t - 1500), t + 300).replace(/\s+/g, " ")}`);
  return out;
}

// Hittar första objekt som ser ut som en annons (id + pris någonstans under sig + text) och visar det helt.
function sampleListings(html) {
  const hasPrice = (o, d = 0) => d < 4 && o && typeof o === "object" &&
    Object.entries(o).some(([k, v]) => (/price|pris/i.test(k) && v != null && v !== 0) || hasPrice(v, d + 1));
  const found = [];
  const walk = (o, d = 0) => {
    if (found.length >= 2 || !o || typeof o !== "object" || d > 30) return;
    if (Array.isArray(o)) {
      if (o.length >= 3 && o.slice(0, 3).every(x => x && typeof x === "object" && !Array.isArray(x) &&
          ("id" in x || "adId" in x || "slug" in x) && hasPrice(x))) {
        found.push(`lista med ${o.length} st, exempel: ${JSON.stringify(o[0]).slice(0, 3500)}`);
        return;
      }
      return o.forEach(x => walk(x, d + 1));
    }
    Object.values(o).forEach(v => walk(v, d + 1));
  };
  const blobs = embeddedJson(html);
  blobs.forEach(b => walk(b));
  return [`${blobs.length} JSON-block`, ...found];
}

function adLinkHtml(html) {
  const i = html.search(/href="\/[^"]*-\d{6,}"/);
  return i < 0 ? null : html.slice(i - 200, i + 3000).replace(/\s+/g, " ");
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
        for (const line of sampleListings(r.body)) console.log("PROV:", line);
        const ad = adLinkHtml(r.body);
        if (ad) console.log("ANNONS-HTML:", ad);
        const home = await get(new URL(url).origin + "/");
        console.log("sökrelaterade länkar på startsidan:", JSON.stringify(searchLinks(home.body, home.url)));
      }
      return { id: s.id, ok: r.status === 200 && cars.length > 0, found: cars.length, status: r.status };
    }
    if (r.status === 404) {
      const home = await get(new URL(url).origin + "/");
      const links = new Set();
      for (const m of home.body.matchAll(/href="([^"#]*bill[aå]n[^"#]*)"/gi)) {
        try { links.add(new URL(m[1].replace(/&amp;/g, "&"), home.url).href); } catch { /* ogiltig länk */ }
      }
      console.log("billånslänkar på startsidan:", JSON.stringify([...links].slice(0, 8)));
      for (const map of ["/sitemap.xml", "/sitemap_index.xml"]) {
        try {
          const sm = await get(new URL(url).origin + map);
          const locs = [...sm.body.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
          console.log(`${map}: ${sm.status}, ${locs.length} adresser, billån:`, JSON.stringify(locs.filter(l => /bil-?l[aå]n|billan|bilfinans/i.test(l)).slice(0, 8)),
            "undersitemaps:", JSON.stringify(locs.filter(l => /\.xml/.test(l)).slice(0, 8)));
        } catch (e) { console.log(map, "FEL", e.message); }
      }
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

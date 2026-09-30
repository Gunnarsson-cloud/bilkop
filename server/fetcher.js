// Artig hämtning: följer robots.txt, begränsar takten per värd och cachar svar.

export const USER_AGENT = "BilkopBot/1.0 (+https://github.com/gunnarsson-cloud/bilkop)";

const cache = new Map();      // url -> { t, body }
const lastHit = new Map();    // värd -> tidsstämpel
const robots = new Map();     // origin -> Promise<regler>

const MIN_INTERVAL_MS = Number(process.env.CRAWL_INTERVAL_MS ?? 2000);
const CACHE_TTL_MS = Number(process.env.CRAWL_CACHE_MS ?? 15 * 60 * 1000);
const TIMEOUT_MS = 15000;

export class FetchError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// Tolkar robots.txt och returnerar Allow/Disallow-regler för vår bot eller "*".
export function parseRobots(text, agent = "BilkopBot") {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push(cur = { agents: [], rules: [] });
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val });
    }
  }
  const mine = groups.filter(g => g.agents.some(a => a !== "*" && agent.toLowerCase().includes(a)));
  const chosen = mine.length ? mine : groups.filter(g => g.agents.includes("*"));
  return chosen.flatMap(g => g.rules).filter(r => r.path !== "" || !r.allow);
}

function ruleMatches(rulePath, path) {
  if (rulePath === "") return false;
  const re = "^" + rulePath.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
  return new RegExp(re).test(path);
}

// Längsta matchande regel vinner; Allow vinner vid lika längd.
export function isAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!ruleMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

async function rawFetch(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "sv-SE,sv;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  return res;
}

async function robotsFor(origin) {
  if (!robots.has(origin)) {
    robots.set(origin, rawFetch(origin + "/robots.txt")
      .then(async r => (r.ok ? parseRobots(await r.text()) : []))
      .catch(() => []));
  }
  return robots.get(origin);
}

async function throttle(host) {
  const wait = (lastHit.get(host) ?? 0) + MIN_INTERVAL_MS - Date.now();
  lastHit.set(host, Math.max(Date.now(), (lastHit.get(host) ?? 0) + MIN_INTERVAL_MS));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

export async function politeFetch(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.body;

  const u = new URL(url);
  const rules = await robotsFor(u.origin);
  if (!isAllowed(rules, u.pathname + u.search)) throw new FetchError(`robots.txt tillåter inte ${u.pathname}`, "robots");

  await throttle(u.host);
  let res;
  try { res = await rawFetch(url); }
  catch (e) { throw new FetchError(`kunde inte nå ${u.host}: ${e.cause?.code ?? e.message}`, "network"); }
  if (!res.ok) throw new FetchError(`${u.host} svarade ${res.status}`, "http");
  const body = await res.text();
  cache.set(url, { t: Date.now(), body });
  return body;
}

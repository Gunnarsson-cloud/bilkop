// Plockar ut bilannonser ur HTML. Försöker i tur och ordning:
// 1. schema.org-data i <script type="application/ld+json"> (Car, Vehicle, Product, ItemList)
// 2. inbäddad appdata (__NEXT_DATA__ m.fl.) där objekt med pris + märke/rubrik letas upp.

const num = v => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const cleaned = v.replace(/[\s ]/g, "").replace(/kr|sek|:-/gi, "").replace(",", ".");
  return cleaned === "" ? NaN : Number(cleaned);
};
const str = v => (typeof v === "string" ? v : v?.name ?? "").trim();
const typesOf = o => [].concat(o?.["@type"] ?? []).map(t => String(t).toLowerCase());

function jsonScripts(html, selector) {
  const out = [];
  const re = new RegExp(`<script[^>]*${selector}[^>]*>([\\s\\S]*?)</script>`, "gi");
  for (const m of html.matchAll(re)) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* trasig JSON hoppas över */ }
  }
  return out;
}

// Läser ut ett balanserat JSON-objekt/-array som börjar vid index start.
function balancedJson(s, start) {
  const open = s[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

// All JSON som sidan bäddar in: <script type="application/json"> samt tilldelningar och
// push-anrop i inline-skript, t.ex. window.INITIAL_REDUX_STATE = {...} eller x.push({...}).
export function embeddedJson(html) {
  const out = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1], body = m[2];
    if (/src=/i.test(attrs) || body.length < 50) continue;
    if (/application\/(?:ld\+)?json/i.test(attrs)) {
      try { out.push(JSON.parse(body.trim())); } catch { /* trasig JSON hoppas över */ }
      continue;
    }
    for (const a of body.matchAll(/(?:=|\.push\()\s*([{[])/g)) {
      const start = a.index + a[0].length - 1;
      const text = balancedJson(body, start);
      if (!text || text.length < 50) continue;
      try { out.push(JSON.parse(text)); } catch { /* inte ren JSON */ }
    }
  }
  return out;
}

// Kilometer -> mil. Svenska sajter anger oftast mil direkt.
function mileageMil(o) {
  const m = o.mileageFromOdometer ?? o.mileage ?? o.milage ?? o.odometer;
  if (m == null) return null;
  if (typeof m === "object") {
    const v = num(m.value);
    if (isNaN(v)) return null;
    const unit = String(m.unitCode ?? m.unitText ?? "").toUpperCase();
    return unit === "KMT" || unit === "KM" ? Math.round(v / 10) : Math.round(v);
  }
  const v = num(m);
  return isNaN(v) ? null : Math.round(v);
}

function yearOf(o) {
  for (const k of ["vehicleModelDate", "modelDate", "productionDate", "modelYear", "year", "dateVehicleFirstRegistered"]) {
    const y = parseInt(String(o[k] ?? "").slice(0, 4), 10);
    if (y > 1950 && y < 2100) return y;
  }
  return null;
}

function priceOf(o) {
  const offers = [].concat(o.offers ?? []);
  for (const off of offers) {
    const p = num(off.price ?? off.lowPrice);
    if (p > 0) return p;
  }
  for (const k of ["price", "priceValue", "amount", "salePrice", "currentPrice"]) {
    const v = o[k];
    const p = typeof v === "object" && v ? num(v.amount ?? v.value) : num(v);
    if (p > 0) return p;
  }
  return null;
}

// Försäljarens finansieringserbjudande i annonsen, t.ex. "0 % ränta" eller "räntefritt".
export function dealerRateOf(o) {
  const text = (typeof o === "string" ? o : JSON.stringify(o)).replace(/\\u00a0| /g, " ");
  if (/räntefri|ränta\s*:?\s*0\s?%/i.test(text)) return 0;
  const m = text.match(/(\d{1,2}(?:[,.]\d{1,2})?)\s?%\s*(?:i\s)?(?:ränta|kampanjränta|finansiering)/i);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

function normalize(o, baseUrl, source) {
  const make = str(o.brand ?? o.manufacturer ?? o.make);
  const model = str(o.model);
  const title = str(o.name ?? o.title ?? o.heading) || [make, model].filter(Boolean).join(" ");
  const price = priceOf(o);
  if (!title || !price) return null;
  let url = o.url ?? o.offers?.url ?? o.link ?? o.href ?? o.shareUrl ?? "";
  try { url = url ? new URL(url, baseUrl).href : baseUrl; } catch { url = baseUrl; }
  const image = [].concat(o.image ?? o.images ?? [])[0];
  const cond = String(o.itemCondition ?? o.offers?.itemCondition ?? o.condition ?? "").toLowerCase();
  return {
    dealerRate: dealerRateOf(o),
    title, make: make || null, model: model || null, price,
    year: yearOf(o), mileageMil: mileageMil(o),
    fuel: str(o.fuelType ?? o.fuel) || null,
    condition: /new|ny/.test(cond) ? "new" : /used|beg/.test(cond) ? "used" : null,
    image: typeof image === "string" ? image : image?.url ?? null,
    url, source,
  };
}

function walkJsonLd(node, visit) {
  if (Array.isArray(node)) return node.forEach(n => walkJsonLd(n, visit));
  if (!node || typeof node !== "object") return;
  const t = typesOf(node);
  if (t.some(x => ["car", "vehicle", "motorizedbicycle", "product"].includes(x))) visit(node);
  if (node["@graph"]) walkJsonLd(node["@graph"], visit);
  if (node.itemListElement) walkJsonLd([].concat(node.itemListElement).map(e => e.item ?? e), visit);
}

// Letar objekt i godtycklig JSON som ser ut som en bilannons.
function walkAppData(node, visit, depth = 0, seen = new Set()) {
  if (!node || typeof node !== "object" || depth > 25 || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) return node.forEach(n => walkAppData(n, visit, depth + 1, seen));
  const hasPrice = priceOf(node) > 0;
  const hasName = ["make", "brand", "model", "title", "heading", "name"].some(k => typeof node[k] === "string" || typeof node[k]?.name === "string");
  const carish = ["mileage", "milage", "modelYear", "year", "fuel", "fuelType", "gearbox", "regNo", "registrationNumber", "make"].some(k => k in node);
  if (hasPrice && hasName && carish) return visit(node);
  for (const v of Object.values(node)) walkAppData(v, visit, depth + 1, seen);
}

export function extractCars(html, baseUrl, source) {
  const found = [];
  const push = o => { const c = normalize(o, baseUrl, source); if (c) found.push(c); };

  for (const data of jsonScripts(html, `type=["']application/ld\\+json["']`)) walkJsonLd(data, push);
  if (!found.length) {
    for (const data of jsonScripts(html, `id=["'](?:__NEXT_DATA__|__NUXT_DATA__|__APOLLO_STATE__)["']`)) walkAppData(data, push);
  }
  // Samma annons kan förekomma flera gånger.
  const uniq = new Map();
  for (const c of found) uniq.set(c.url !== baseUrl ? c.url : `${c.title}|${c.price}|${c.year}`, c);
  return [...uniq.values()];
}

// Gör om HTML till ren text, inklusive teckenreferenser som &#228; och &aring;.
export function htmlText(html) {
  const named = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', aring: "å", auml: "ä", ouml: "ö", Aring: "Å", Auml: "Ä", Ouml: "Ö", ndash: "–", mdash: "—" };
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => named[n] ?? m)
    .replace(/\s+/g, " ");
}

// Meningen/stycket runt kampanjen, avgränsad av citattecken från inbäddad JSON.
function exampleText(text, at) {
  const q = text.lastIndexOf('"', at);
  const start = q >= 0 && at - q < 300 ? q + 1 : Math.max(0, at - 120);
  const e = text.indexOf('"', at);
  return text.slice(start, e > 0 && e - at < 700 ? e : at + 420).trim();
}

// Kampanjränta hos bilhandlarnas finansbolag, t.ex. "kampanjränta 0,00 % (ord. rörlig ränta 6,25%),
// 30 % kontant/inbyte ... 45% garanterat återköpsvärde ... Effektiv ränta 0,33 %. ... gäller tom 2026-09-30".
// Texten ligger ofta i sidans inbäddade JSON, så även skriptinnehåll söks igenom.
export function findCampaign(html) {
  const raw = html.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, " ");
  // Klipp ut ett fönster runt ordet innan HTML rensas; skriptkod med "<" kan annars äta upp texten.
  const at = raw.search(/kampanjränta/i);
  if (at < 0) return null;
  const text = htmlText(raw.slice(Math.max(0, at - 600), at + 1500).replace(/<\/?script[^>]*>/gi, " "));
  const pct = s => (s == null ? null : parseFloat(s.replace(",", ".")));
  const m = text.match(/kampanjränta\s*(\d{1,2}(?:[,.]\d{1,2})?)\s?%(?:\s*\(ord(?:inarie|\.)?\s*(?:rörlig\s*)?ränta\s*(\d{1,2}(?:[,.]\d{1,2})?)\s?%\))?/i);
  if (!m) return null;
  const sentence = text.slice(m.index, m.index + 800);
  const until = sentence.match(/gäller\s*(?:t\.?\s?o\.?\s?m\.?|till och med|fram till)\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
  return {
    rate: pct(m[1]),
    ordinaryRate: pct(m[2]),
    effective: pct(sentence.match(/effektiv ränta\s*(\d{1,2}(?:[,.]\d{1,2})?)\s?%/i)?.[1]),
    months: Number(text.slice(Math.max(0, m.index - 80), m.index).match(/(\d{2,3})\s*mån/)?.[1]) || null,
    downPct: pct(sentence.match(/(\d{1,2})\s?%\s*(?:i\s)?kontant/i)?.[1]),
    balloonPct: pct(sentence.match(/(\d{1,2})\s?%\s*(?:garanterat\s)?(?:återköpsvärde|restvärde|slutbetalning)/i)?.[1]),
    validUntil: until,
    feesExtra: /(?:uppläggnings|avi)avgift[^.]{0,20}tillkommer/i.test(sentence),
    text: exampleText(text, m.index),
  };
}

// Plockar räntor och avgifter ur en bankssida om billån. Varje procentsats bedöms utifrån
// texten runt den, så att t.ex. "20 % i kontantinsats" eller "80 % av värdet" inte tas för ränta.
// Vid intervall ("5,49 %–5,99 %") används den lägsta nivån, som banken annonserar.
export function extractLoanTerms(html) {
  // "6,20–13,65 %" -> "6,20 %–13,65 %" så att båda ändarna av ett intervall hittas.
  const text = htmlText(html).replace(/(\d{1,2}[,.]\d{1,2})\s?([–-])\s?(\d{1,2}[,.]\d{1,2})\s?%/g, "$1 %$2$3 %");
  const nominal = [], effective = [];
  for (const m of text.matchAll(/(\d{1,2}(?:[,.]\d{1,2})?)\s?%/g)) {
    const v = parseFloat(m[1].replace(",", "."));
    if (!(v > 0 && v < 30)) continue;
    const before = text.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 35).toLowerCase();
    if (/^\s*(?:i\s)?(?:kontantinsats|insats|av\s|rabatt|lägre|amorter|procent|av bilens)/.test(after)) continue;
    if (/(?:rabatt|kontantinsats|insats på|belåna|låna upp till|minst|högst)[^%]{0,15}$/.test(before)) continue;
    const eff = before.lastIndexOf("effektiv");
    const sinceEff = eff >= 0 ? before.slice(eff) : "";
    const pcts = (sinceEff.match(/%/g) ?? []).length;
    if (eff >= 0 && (pcts === 0 || (pcts === 1 && /%\s*(?:–|-|till)\s*$/.test(sinceEff)))) effective.push(v);
    else if (/ränta/.test(before.slice(-50)) || /^\s*(?:–|-)?\s*(?:\d{1,2}(?:[,.]\d{1,2})?\s?%\s*)?(?:i\s)?(?:ränta|rörlig|nominell)/.test(after)) nominal.push(v);
  }
  const krNum = s => parseInt(s.replace(/[\s.]/g, ""), 10);
  const K = "(\\d{1,3}(?:[\\s.]?\\d{3})*|\\d+)\\s?(?:kr|:-)";
  const find = re => { const m = text.match(re); return m ? krNum(m[1]) : null; };
  return {
    campaign: findCampaign(html),
    effective: effective.length ? Math.min(...effective) : null,
    nominal: nominal.length ? Math.min(...nominal) : null,
    setupFee: find(new RegExp(`uppläggnings(?:avgift|kostnad)[^\\d]{0,30}?${K}`, "i")),
    monthlyFee: find(new RegExp(`(?:avi|avierings|administrations)avgift[^\\d]{0,30}?${K}`, "i")),
  };
}

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

// Plockar räntor och avgifter ur en bankssida om billån.
export function extractLoanTerms(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const pct = s => parseFloat(s.replace(",", "."));
  const krNum = s => parseInt(s.replace(/[\s .]/g, ""), 10);
  const find = (re, conv) => { const m = text.match(re); return m ? conv(m[1]) : null; };
  const P = "(\\d{1,2}(?:[,.]\\d{1,2})?)\\s?%";
  const K = "(\\d{1,3}(?:[\\s\\u00a0.]?\\d{3})*|\\d+)\\s?(?:kr|:-)";
  return {
    effective: find(new RegExp(`effektiv(?:a)? ränta[^%\\d]{0,40}?(?:från\\s)?${P}`, "i"), pct),
    nominal: find(new RegExp(`(?:nominell|rörlig|lånets|ordinarie)?\\s?ränta[^%\\d]{0,40}?(?:från\\s)?${P}`, "i"), pct),
    setupFee: find(new RegExp(`uppläggnings(?:avgift|kostnad)[^\\d]{0,30}?${K}`, "i"), krNum),
    monthlyFee: find(new RegExp(`(?:avi|avierings|administrations)avgift[^\\d]{0,30}?${K}`, "i"), krNum),
  };
}

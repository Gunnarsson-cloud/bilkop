// Tolkare för sajter som inte har strukturerad data för annonserna utan bara HTML eller egen JSON.
import { htmlText, dealerRateOf, embeddedJson } from "./extract.js";

const text = s => htmlText(s ?? "").trim();
const price = s => { const m = text(s).match(/(\d{1,3}(?:[\s ]\d{3})+|\d{4,})\s*kr/); return m ? Number(m[1].replace(/\D/g, "")) : null; };
const milOf = s => { const m = s.match(/(\d{1,3}(?:[\s ]\d{3})*|\d+)\s*mil\b/); return m ? Number(m[1].replace(/\D/g, "")) : null; };
const yearOf = s => { const m = s.match(/\b(19[5-9]\d|20\d\d)\b/); return m ? Number(m[1]) : null; };
const abs = (href, base) => { try { return new URL(href, base).href; } catch { return base; } };

// Delar HTML i block som börjar vid varje träff på startRe.
function blocks(html, startRe) {
  const idx = [...html.matchAll(startRe)].map(m => m.index);
  return idx.map((s, i) => html.slice(s, idx[i + 1] ?? s + 8000));
}

// Bytbil: <li class="result-list-item ..."> med rubrik, "2023 | 1 794 mil | ORT" och car-price-main.
function bytbil(html, base, source) {
  return blocks(html, /<li class="result-list-item/g).map(b => {
    const a = b.match(/<h3[^>]*car-list-header[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const meta = text(b.match(/<p class="uk-text-truncate">([\s\S]*?)<\/p>/)?.[1]);
    const p = price(b.match(/class="car-price-main"[^>]*>([\s\S]*?)<\/span>/)?.[1]);
    if (!a || !p) return null;
    const img = b.match(/background-image:\s*url\(([^)]+)\)/)?.[1] ?? null;
    return {
      title: text(a[2]), make: null, model: null, price: p,
      year: yearOf(meta), mileageMil: milOf(meta), fuel: null, condition: null,
      dealerRate: dealerRateOf(text(b)), image: img, url: abs(a[1], base), source,
    };
  }).filter(Boolean);
}

// KVD: <a data-testid="product-card" href=...> med Title, Subtitle, Properties (år, mil, bränsle) och pris.
function kvd(html, base, source) {
  return blocks(html, /<a data-testid="product-card"/g).map(b => {
    const href = b.match(/href="([^"]+)"/)?.[1];
    const title = text(b.match(/class="Title__Container[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
    const sub = text(b.match(/class="Subtitle__Container[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
    const props = [...(b.match(/data-testid="properties"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "").matchAll(/<span>([\s\S]*?)<\/span>/g)].map(m => text(m[1]));
    const priceHtml = b.match(/PriceValue[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? b.match(/PriceValue[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const p = price(priceHtml);
    if (!href || !title || !p) return null;
    const make = title.split(" ")[0] || null;
    const priceLabel = text(b.match(/FinanceRowTitle[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1]);
    const model = title.slice(make.length).trim();
    return {
      // "Tesla Model Y" + "Model Y Performance" -> "Tesla Model Y Performance"
      title: sub ? (model && sub.startsWith(model) ? `${make} ${sub}` : `${title} ${sub}`) : title,
      make, model: model || null, price: p, priceType: priceLabel || null,
      auction: /\/auktioner\//.test(href),
      year: yearOf(props.join(" ")), mileageMil: milOf(props.join(" ")),
      fuel: props.find(x => !/\d/.test(x)) ?? null, condition: "used",
      dealerRate: dealerRateOf(text(b)), image: null, url: abs(href, base), source,
    };
  }).filter(Boolean);
}

// Mil eller kilometer beroende på enhet.
const toMil = (value, unit) => {
  const v = Number(value);
  if (!isFinite(v)) return null;
  return /KILOMET|KM/i.test(unit ?? "") ? Math.round(v / 10) : Math.round(v);
};

// Blocket: sökresultatet ligger som base64-kodad JSON (React Query) i <script data-react-query-state>.
function blocket(html, base, source) {
  const m = html.match(/<script[^>]*data-react-query-state[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let state;
  try {
    const raw = m[1].trim();
    state = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  } catch { return []; }
  const docs = (state.queries ?? []).flatMap(q => [
    ...(q.state?.data?.docs ?? []),
    ...(q.state?.data?.results ?? []).map(r => r.searchEntry).filter(Boolean),
  ]);
  const seen = new Set();
  return docs.filter(d => d?.price?.amount && !seen.has(d.id) && seen.add(d.id)).map(d => ({
    title: [d.heading, d.model_specification].filter(Boolean).join(" "),
    make: d.make ?? null, model: d.model ?? null, price: d.price.amount,
    year: d.year ?? null, mileageMil: d.mileage != null ? toMil(d.mileage, d.mileage_unit) : null,
    fuel: d.fuel ?? null, condition: /NEW/i.test(d.main_search_key ?? "") ? "new" : "used",
    seller: d.dealer_segment ?? null,
    dealerRate: dealerRateOf([d.heading, ...(d.labels ?? []).map(l => l.text ?? l)].join(" ")),
    image: d.image?.url ?? d.image_urls?.[0] ?? null,
    url: d.canonical_url ?? abs(`/mobility/item/${d.id}`, base), source,
  }));
}

// Wayke: React Query-data i window["__RQ..."].push({...}); annonserna ligger i queries[].state.data.hits.
function wayke(html, base, source) {
  const hits = embeddedJson(html).flatMap(b => (b.queries ?? []).flatMap(q => q.state?.data?.hits ?? []));
  const seen = new Set();
  return hits.filter(h => h?.ad?.id && !seen.has(h.ad.id) && seen.add(h.ad.id)).map(({ ad, iteration }) => {
    const v = iteration?.item ?? {};
    const cash = Number(ad.pricing?.cash?.price?.amount);
    if (!(cash > 0)) return null;
    const make = v.manufacturer?.stringValue ?? null;
    const odo = iteration?.logistics?.odometerReading;
    return {
      title: [v.displayName, ad.salesDescription?.title].filter(Boolean).join(" – ") || ad.salesDescription?.title,
      make, model: v.modelName?.stringValue ?? null, price: cash,
      year: v.modelYear?.intValue ?? null, mileageMil: odo ? toMil(odo.value, odo.unit) : null,
      fuel: v.driveline?.fuelTypesString?.stringValue ?? null, condition: null,
      seller: ad.branch?.displayName ?? null,
      dealerRate: dealerRateOf(ad.salesDescription?.title ?? ""),
      image: ad.media?.items?.[0]?.url ?? null,
      url: abs(`/objekt/${ad.id}`, base), source,
    };
  }).filter(Boolean);
}

export const SITE_PARSERS = { blocket, bytbil, kvd, wayke };

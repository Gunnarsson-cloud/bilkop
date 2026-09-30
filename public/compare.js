// Filtrering av bilar och prissättning av lån. Delas av servern och den statiska sidan
// (GitHub Pages), där data hämtas i förväg av GitHub Actions.
import { loanCost, MIN_DOWN_PCT } from "./loanmath.js";

// Filtrerar, sorterar och slår ihop samma bil från flera sajter.
export function filterCars(allCars, params = {}) {
  const minP = Number(params.minPrice) || 0, maxP = Number(params.maxPrice) || Infinity;
  const yFrom = Number(params.yearFrom) || 0, maxMil = Number(params.maxMil) || Infinity;
  const zeroOnly = params.zeroRateOnly === true || params.zeroRateOnly === "1";
  const q = String(params.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const cars = allCars.filter(c =>
    c.price >= minP && c.price <= maxP &&
    (c.year == null || c.year >= yFrom) &&
    (c.mileageMil == null || c.mileageMil <= maxMil) &&
    (!zeroOnly || c.dealerRate === 0) &&
    q.every(w => `${c.title} ${c.make ?? ""} ${c.model ?? ""}`.toLowerCase().includes(w)));
  cars.sort((a, b) => a.price - b.price);

  // Samma bil ligger ofta på flera sajter; slå ihop annonser med samma år, miltal och pris.
  const byKey = new Map();
  for (const c of cars) {
    const key = c.year && c.mileageMil ? `${c.year}|${c.mileageMil}|${c.price}` : c.url;
    const first = byKey.get(key);
    if (first) byKey.set(key, { ...first, alsoOn: [...(first.alsoOn ?? []), { source: c.source, url: c.url }] });
    else byKey.set(key, c);
  }
  return [...byKey.values()];
}

// Gör om hämtade långivarvillkor till rader (vanligt lån + ev. kampanj).
export function loanRows(source, terms, today = new Date().toISOString().slice(0, 10)) {
  const { campaign, ...t } = terms;
  // Finansbolagen anger ofta bara ordinarie ränta i kampanjtexten.
  if (t.nominal == null && campaign?.ordinaryRate != null) t.nominal = campaign.ordinaryRate;
  const rows = [];
  if (t.nominal != null || t.effective != null) rows.push({ ...source, ...t });
  if (campaign && !(campaign.validUntil && campaign.validUntil < today)) {
    rows.push({
      ...source, id: `${source.id}-kampanj`, name: `${source.name} – kampanj`, kind: "campaign",
      nominal: campaign.rate, effective: null, publishedEffective: campaign.effective,
      setupFee: t.setupFee, monthlyFee: t.monthlyFee, campaign,
    });
  }
  return rows;
}

// Räknar ut kostnaden för varje erbjudande för just det här lånet och sorterar billigast först.
export function priceLoans(rows, { amount, months, price, manual = [] }) {
  const principal = Number(amount) || 0;
  const n = Number(months) || 36;
  const carPrice = Number(price) || 0;
  const offers = [...rows, ...manual.map(m => ({ kind: "manual", ...m }))].map(o => {
    if (o.error) return o;
    // Om bara effektiv ränta hittades används den som nominell (avgifterna ingår då redan).
    const rate = o.nominal ?? o.effective;
    // Kampanjlån har ofta en slutbetalning (garanterat återköpsvärde) i procent av bilens pris.
    const balloon = o.campaign?.balloonPct && carPrice ? Math.min(principal, carPrice * o.campaign.balloonPct / 100) : 0;
    const cost = loanCost({ principal, rate, months: n, setupFee: o.setupFee ?? 0, monthlyFee: o.monthlyFee ?? 0, balloon });
    return { ...o, rate, ...cost };
  });
  offers.sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0) || a.total - b.total);

  const downPct = carPrice ? (1 - principal / carPrice) * 100 : null;
  return {
    principal, months: n, offers,
    warnings: downPct != null && Math.round(downPct * 10) / 10 < MIN_DOWN_PCT
      ? [`Kontantinsatsen är ${downPct.toFixed(0)} %. Billån kräver normalt minst ${MIN_DOWN_PCT} %.`] : [],
  };
}

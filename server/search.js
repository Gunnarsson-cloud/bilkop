import { readFileSync } from "node:fs";
import { politeFetch } from "./fetcher.js";
import { extractCars, extractLoanTerms } from "./extract.js";
import { loanCost, MIN_DOWN_PCT } from "../public/loanmath.js";

const SOURCES = JSON.parse(readFileSync(new URL("./sources.json", import.meta.url), "utf8"));

const fill = (tpl, params) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params[k] ?? ""))
     // Ta bort tomma query-parametrar så att sajterna inte får konstiga filter.
     .replace(/([?&])[^=&]+=(?=&|$)/g, "$1").replace(/[?&]+$/, "").replace(/&{2,}/g, "&").replace("?&", "?");

// Söker i alla aktiva källor parallellt. Fel per källa rapporteras men stoppar inte övriga.
export async function searchCars(params, { fetchPage = politeFetch } = {}) {
  const f = {
    q: params.q ?? "",
    minPrice: params.minPrice ?? "",
    maxPrice: params.maxPrice ?? "",
    yearFrom: params.yearFrom ?? "",
    maxMil: params.maxMil ?? "",
  };
  const sources = SOURCES.cars.filter(s => s.enabled && (!params.sources || params.sources.includes(s.id)));
  const results = await Promise.all(sources.map(async s => {
    const url = fill(s.search, f);
    try {
      const html = await fetchPage(url);
      return { source: s.id, name: s.name, url, cars: extractCars(html, url, s.name) };
    } catch (e) {
      return { source: s.id, name: s.name, url, error: e.message, cars: [] };
    }
  }));

  // Källorna filtrerar inte alltid som vi bett om, så filtret körs även här.
  const minP = Number(f.minPrice) || 0, maxP = Number(f.maxPrice) || Infinity;
  const yFrom = Number(f.yearFrom) || 0, maxMil = Number(f.maxMil) || Infinity;
  const q = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const cars = results.flatMap(r => r.cars).filter(c =>
    c.price >= minP && c.price <= maxP &&
    (c.year == null || c.year >= yFrom) &&
    (c.mileageMil == null || c.mileageMil <= maxMil) &&
    (params.zeroRateOnly !== true || c.dealerRate === 0) &&
    q.every(w => `${c.title} ${c.make ?? ""} ${c.model ?? ""}`.toLowerCase().includes(w)));
  cars.sort((a, b) => a.price - b.price);

  return {
    cars,
    sources: results.map(({ cars: list, ...r }) => ({ ...r, found: list.length })),
  };
}

// Hämtar aktuella villkor från långivarnas sidor och räknar ut kostnaden för det aktuella lånet.
// Manuella erbjudanden (t.ex. en bilhandlares 0 %-kampanj) räknas på samma sätt.
export async function researchLoans(params, { fetchPage = politeFetch } = {}) {
  const principal = Number(params.amount) || 0;
  const months = Number(params.months) || 36;
  const fetched = await Promise.all(SOURCES.loans.map(async s => {
    try {
      const terms = extractLoanTerms(await fetchPage(s.url));
      if (terms.nominal == null && terms.effective == null) throw new Error("hittade ingen ränta på sidan");
      return { ...s, ...terms };
    } catch (e) {
      return { ...s, error: e.message };
    }
  }));

  const offers = [...fetched, ...(params.manual ?? []).map(m => ({ kind: "manual", ...m }))].map(o => {
    if (o.error) return o;
    // Om bara effektiv ränta hittades används den som nominell (avgifterna ingår då redan).
    const rate = o.nominal ?? o.effective;
    const cost = loanCost({ principal, rate, months, setupFee: o.setupFee ?? 0, monthlyFee: o.monthlyFee ?? 0 });
    return { ...o, rate, ...cost };
  });
  offers.sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0) || a.total - b.total);

  const price = Number(params.price) || 0;
  const downPct = price ? (1 - principal / price) * 100 : null;
  return {
    principal, months, offers,
    warnings: downPct != null && Math.round(downPct * 10) / 10 < MIN_DOWN_PCT
      ? [`Kontantinsatsen är ${downPct.toFixed(0)} %. Billån kräver normalt minst ${MIN_DOWN_PCT} %.`] : [],
  };
}

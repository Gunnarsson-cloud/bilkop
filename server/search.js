import { readFileSync } from "node:fs";
import { politeFetch } from "./fetcher.js";
import { extractCars, extractLoanTerms } from "./extract.js";
import { SITE_PARSERS } from "./sites.js";
import { filterCars, loanRows, priceLoans } from "../public/compare.js";

export const SOURCES = JSON.parse(readFileSync(new URL("./sources.json", import.meta.url), "utf8"));

export const fill = (tpl, params) =>
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
      const site = SITE_PARSERS[s.id]?.(html, url, s.name) ?? [];
      return { source: s.id, name: s.name, url, cars: site.length ? site : extractCars(html, url, s.name) };
    } catch (e) {
      return { source: s.id, name: s.name, url, error: e.message, cars: [] };
    }
  }));

  return {
    cars: filterCars(results.flatMap(r => r.cars), { ...f, zeroRateOnly: params.zeroRateOnly }),
    sources: results.map(({ cars: list, ...r }) => ({ ...r, found: list.length })),
  };
}

// Hämtar villkoren från alla långivare; fel per långivare blir en rad med error.
export async function fetchLoanTerms({ fetchPage = politeFetch } = {}) {
  return (await Promise.all(SOURCES.loans.map(async s => {
    try {
      const rows = loanRows(s, extractLoanTerms(await fetchPage(s.url)));
      if (!rows.length) throw new Error("hittade ingen ränta på sidan");
      return rows;
    } catch (e) {
      return [{ ...s, error: e.message }];
    }
  }))).flat();
}

// Hämtar aktuella villkor från långivarnas sidor och räknar ut kostnaden för det aktuella lånet.
// Manuella erbjudanden (t.ex. en bilhandlares 0 %-kampanj) räknas på samma sätt.
export async function researchLoans(params, opts = {}) {
  return priceLoans(await fetchLoanTerms(opts), params);
}

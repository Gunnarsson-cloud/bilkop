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

const MAX_PAGES = 10;

// Sökadressen för sida nr page, eller null om källan saknar sidparameter.
export function withPage(url, param, page) {
  if (!param) return null;
  const u = new URL(url);
  u.searchParams.set(param, String(page));
  return u.href;
}

// Söker i alla aktiva källor parallellt. Fel per källa rapporteras men stoppar inte övriga.
export async function searchCars(params, { fetchPage = politeFetch } = {}) {
  const f = {
    q: params.q ?? "",
    minPrice: params.minPrice ?? "",
    maxPrice: params.maxPrice ?? "",
    yearFrom: params.yearFrom ?? "",
    maxMil: params.maxMil ?? "",
  };
  const maxPages = Math.max(1, Math.min(Number(params.pages) || 1, MAX_PAGES));
  const sources = SOURCES.cars.filter(s => s.enabled && (!params.sources || params.sources.includes(s.id)));
  // Sajterna hämtas parallellt, sidorna inom en sajt i tur och ordning (fetchern håller takten per värd).
  const results = await Promise.all(sources.map(async s => {
    const url = fill(s.search, f);
    const cars = [], seen = new Set();
    let pages = 0;
    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = page === 1 ? url : withPage(url, s.pageParam, page);
      if (!pageUrl) break;
      try {
        const html = await fetchPage(pageUrl);
        const site = SITE_PARSERS[s.id]?.(html, pageUrl, s.name) ?? [];
        const found = site.length ? site : extractCars(html, pageUrl, s.name);
        // Sajter som inte bläddrar via URL:en visar samma annonser igen; sluta då.
        const fresh = found.filter(c => !seen.has(c.url) && seen.add(c.url));
        if (!fresh.length) break;
        cars.push(...fresh);
        pages = page;
      } catch (e) {
        // Fel på en senare sida: behåll det som redan hämtats.
        if (page === 1) return { source: s.id, name: s.name, url, error: e.message, cars: [], pages: 0 };
        break;
      }
    }
    return { source: s.id, name: s.name, url, cars, pages };
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

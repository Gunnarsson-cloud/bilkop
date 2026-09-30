// Bygger den statiska sajten (GitHub Pages): kopierar public/ och hämtar aktuella bilar
// och lånevillkor till data/*.json. Körs av .github/workflows/publish.yml.
//   node scripts/build-site.js [utkatalog]
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { searchCars, fetchLoanTerms } from "../server/search.js";

const out = process.argv[2] ?? "site";
mkdirSync(`${out}/data`, { recursive: true });
cpSync(new URL("../public/", import.meta.url), out, { recursive: true });

const fetchedAt = new Date().toISOString();
// Brett urval; sidan filtrerar sedan efter besökarens val.
const cars = await searchCars({ minPrice: "50000", maxPrice: "600000", pages: process.env.PAGES ?? "15" });
writeFileSync(`${out}/data/cars.json`, JSON.stringify({ fetchedAt, ...cars }));
const loans = await fetchLoanTerms();
writeFileSync(`${out}/data/loans.json`, JSON.stringify({ fetchedAt, rows: loans }));

console.log(`bilar: ${cars.cars.length}`);
for (const s of cars.sources) console.log(`  ${s.name}: ${s.error ?? `${s.found} annonser från ${s.pages} sidor`}`);
console.log(`lån: ${loans.filter(r => !r.error).length} rader`);
for (const r of loans) console.log(`  ${r.name}: ${r.error ?? `${r.nominal ?? "–"} % (eff ${r.effective ?? r.publishedEffective ?? "–"} %)`}`);

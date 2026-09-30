import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchCars, researchLoans } from "../server/search.js";

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("bilsök filtrerar på pris och slår ihop källor", async () => {
  const pages = { blocket: "jsonld-list.html", bytbil: "nextdata.html" };
  const fetchPage = async url => {
    const hit = Object.entries(pages).find(([k]) => url.includes(k));
    if (!hit) throw new Error("blockerad");
    return fixture(hit[1]);
  };
  const r = await searchCars({ minPrice: "150000" }, { fetchPage });
  assert.ok(r.cars.every(c => c.price >= 150000));
  assert.deepEqual(r.cars.map(c => c.price), [165000, 189500, 199000, 289900]);
  assert.equal(r.sources.find(s => s.source === "wayke").error, "blockerad");
  assert.ok(!r.sources[0].url.includes("price_to="), "tomma parametrar tas bort");
  assert.ok(r.sources[0].url.includes("price_from=150000"));

  const zero = await searchCars({ minPrice: "150000", zeroRateOnly: true }, { fetchPage });
  assert.deepEqual(zero.cars.map(c => c.price), [189500, 289900]);
});

test("lånejämförelse räknar bank- och försäljarerbjudanden", async () => {
  const fetchPage = async url => url.includes("santander") ? fixture("bank.html") : Promise.reject(new Error("blockerad"));
  const r = await researchLoans({
    amount: 150000, months: 36, price: 200000,
    manual: [{ name: "Bilhandlarens kampanj", nominal: 0, setupFee: 995, monthlyFee: 59 }],
  }, { fetchPage });
  assert.equal(r.offers[0].name, "Bilhandlarens kampanj");
  assert.equal(r.offers[1].id, "santander");
  assert.ok(r.offers[1].total > r.offers[0].total);
  assert.ok(r.offers.slice(2).every(o => o.error));
  assert.equal(r.warnings.length, 0);

  const exact = await researchLoans({ amount: 151600, months: 36, price: 189500 }, { fetchPage });
  assert.equal(exact.warnings.length, 0, "exakt 20 % ska inte varna");

  const low = await researchLoans({ amount: 180000, months: 36, price: 200000 }, { fetchPage });
  assert.equal(low.warnings.length, 1);
});

test("kampanjlån med slutbetalning blir en egen rad", async () => {
  const campaignPage = `<script>x={"t":"exempel med Easy Billån, 36 månader, kampanjränta 0,00\\u0026nbsp;% (ord. rörlig ränta 6,25%),  30\\u0026nbsp;% kontant/inbyte, 45% garanterat återköpsvärde. Effektiv ränta 0,33 %. Uppläggningsavgift och aviavgift tillkommer. Kampanjränta 0,00 % gäller tom 2099-12-31."}</script>`;
  const fetchPage = async url => url.includes("toyota") ? campaignPage : Promise.reject(new Error("blockerad"));
  const r = await researchLoans({ amount: 140000, months: 36, price: 200000 }, { fetchPage });
  const camp = r.offers.find(o => o.kind === "campaign");
  const ord = r.offers.find(o => o.id === "toyotafinans");
  assert.equal(camp.rate, 0);
  assert.equal(camp.balloon, 90000);           // 45 % av 200 000
  assert.equal(camp.interest, 0);
  assert.equal(ord.rate, 6.25);
  assert.ok(Math.abs(camp.monthly - 50000 / 36) < 0.01);
});

test("bilsök bläddrar tills en sida inte ger nya annonser", async () => {
  const listing = n => `<script type="application/ld+json">${JSON.stringify({ "@type": "ItemList", itemListElement:
    Array.from({ length: 3 }, (_, i) => ({ item: { "@type": "Car", name: `Bil ${n}-${i}`, vehicleModelDate: "2020",
      offers: { price: 150000 + n * 1000 + i }, url: `/annons/${n}-${i}` } })) })}</script>`;
  const asked = [];
  const fetchPage = async url => {
    asked.push(url);
    if (!url.includes("wayke")) throw new Error("blockerad");
    const page = Number(new URL(url).searchParams.get("page") ?? 1);
    return listing(Math.min(page, 3));   // sida 4 visar samma som sida 3
  };
  const r = await searchCars({ pages: "6" }, { fetchPage });
  const wayke = r.sources.find(s => s.source === "wayke");
  assert.equal(wayke.pages, 3);
  assert.equal(wayke.found, 9);
  assert.equal(asked.filter(u => u.includes("wayke")).length, 4);
  assert.ok(asked.some(u => u.includes("wayke") && u.includes("page=2")));
});

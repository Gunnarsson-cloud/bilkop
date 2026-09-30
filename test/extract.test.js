import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCars, extractLoanTerms, dealerRateOf } from "../server/extract.js";

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("läser bilar ur schema.org JSON-LD", () => {
  const cars = extractCars(fixture("jsonld-list.html"), "https://example.se/sok", "Exempel");
  assert.equal(cars.length, 3);
  const volvo = cars.find(c => c.make === "Volvo");
  assert.equal(volvo.price, 289900);
  assert.equal(volvo.year, 2022);
  assert.equal(volvo.mileageMil, 4500); // 45 000 km
  assert.equal(volvo.condition, "used");
  assert.equal(volvo.url, "https://example.se/annons/1");
  assert.equal(volvo.dealerRate, 0);
  const golf = cars.find(c => c.make === "Volkswagen");
  assert.equal(golf.mileageMil, 7200);
  assert.equal(golf.dealerRate, null);
});

test("läser bilar ur __NEXT_DATA__", () => {
  const cars = extractCars(fixture("nextdata.html"), "https://example.se/sok", "Exempel");
  assert.deepEqual(cars.map(c => c.price).sort(), [165000, 189500]);
  const toyota = cars.find(c => c.make === "Toyota");
  assert.equal(toyota.url, "https://example.se/bil/a1");
  assert.equal(toyota.dealerRate, 0);
});

test("känner igen försäljarens ränteerbjudanden", () => {
  assert.equal(dealerRateOf("Kampanj: 0% ränta"), 0);
  assert.equal(dealerRateOf("Nu 1,95 % ränta på alla bilar"), 1.95);
  assert.equal(dealerRateOf("Ränta: 0 %"), 0);
  assert.equal(dealerRateOf("Nybesiktigad, 2 ägare"), null);
});

test("läser räntor och avgifter från en bankssida", () => {
  assert.deepEqual(extractLoanTerms(fixture("bank.html")), {
    campaign: null, effective: 6.49, nominal: 5.95, setupFee: 595, monthlyFee: 45,
  });
});

test("räntor: procentsatser som inte är räntor ignoreras", () => {
  const t = html => extractLoanTerms(`<p>${html}</p>`);
  // Nordea-liknande text med intervall
  assert.deepEqual(t("Du lägger 20 % i kontantinsats (pengar eller inbytesbil). 5,49 %–5,99 % i ränta (effektiv ränta 6,65 %–7,18 %)*. Köper du elbil får du 0,5 % rabatt på räntan. Uppläggningsavgift 525 kr, aviavgift 35 kr."),
    { campaign: null, nominal: 5.49, effective: 6.65, setupFee: 525, monthlyFee: 35 });
  // Swedbank-liknande: 80 % av värdet är ingen ränta
  assert.equal(t("Låna upp till 80 % av bilens värde. Räntan är avdragsgill.").nominal, null);
  assert.equal(t("Köp ny bil – låna 80 % av värdet").nominal, null);
  // Toyota-liknande
  assert.equal(t("beräknas utifrån skulden och räntan. Du betalar minst 20 % i kontantinsats").nominal, null);
  // Ikano med teckenreferenser
  assert.deepEqual(t("Individuell r&#228;nta mellan 6,22 % och 18,87 % … 6,22 % Vår lägsta ränta just nu Effektiv ränta: 6,49 % 18,87 % Vår högsta ränta just nu Effektiv ränta: 20,48 %"),
    { campaign: null, nominal: 6.22, effective: 6.49, setupFee: null, monthlyFee: null });
});

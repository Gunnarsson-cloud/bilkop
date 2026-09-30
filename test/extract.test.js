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
    effective: 6.49, nominal: 5.95, setupFee: 595, monthlyFee: 45,
  });
});

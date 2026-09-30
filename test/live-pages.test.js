// Tester mot riktiga sidor i probe-output/ (ignoreras av git), sparade med scripts/probe.js --save.
// Hoppas över om sidorna saknas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { SITE_PARSERS } from "../server/sites.js";
import { extractLoanTerms } from "../server/extract.js";

const page = id => {
  const f = new URL(`../probe-output/${id}.html.gz`, import.meta.url);
  return existsSync(f) ? gunzipSync(readFileSync(f)).toString("utf8") : null;
};

for (const [id, base] of [
  ["blocket", "https://www.blocket.se/mobility/search/car"],
  ["bytbil", "https://www.bytbil.com/bil"],
  ["wayke", "https://www.wayke.se/sok"],
  ["kvd", "https://www.kvd.se/begagnade-bilar"],
]) {
  const html = page(id);
  test(`${id}: annonser tolkas från riktig sida`, { skip: !html && "sidan är inte sparad" }, () => {
    const cars = SITE_PARSERS[id](html, base, id);
    assert.ok(cars.length >= 10, `bara ${cars.length} bilar`);
    for (const c of cars) {
      assert.ok(c.title && c.price > 10000 && c.price < 5e6, JSON.stringify(c));
      assert.ok(c.year > 1900 && c.year <= new Date().getFullYear() + 1, JSON.stringify(c));
      assert.ok(c.mileageMil >= 0 && c.mileageMil < 100000, JSON.stringify(c));
      assert.match(c.url, /^https:\/\//);
    }
  });
}

test("billånssidor: räntor och kampanjer", { skip: !page("nordea") && "sidorna är inte sparade" }, () => {
  assert.ok(extractLoanTerms(page("seb")).nominal < 10, "SEB: lägsta räntan i intervallet");
  const nordea = extractLoanTerms(page("nordea"));
  assert.ok(nordea.nominal < nordea.effective, JSON.stringify(nordea));
  for (const id of ["ikano", "swedbank"]) {
    const t = extractLoanTerms(page(id));
    assert.ok(t.nominal > 1 && t.nominal < 20, `${id}: ${JSON.stringify(t)}`);
  }
  const toyota = extractLoanTerms(page("toyotafinans")).campaign;
  assert.equal(toyota.rate, 0);
  assert.ok(toyota.ordinaryRate > 0 && toyota.balloonPct > 0 && toyota.effective > 0, JSON.stringify(toyota));
});

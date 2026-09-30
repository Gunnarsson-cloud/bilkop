import { test } from "node:test";
import assert from "node:assert/strict";
import { annuity, effectiveRate, loanCost } from "../public/loanmath.js";

test("annuitet", () => {
  assert.ok(Math.abs(annuity(100000, 6, 36) - 3042.19) < 0.01);
  assert.equal(annuity(120000, 0, 36), 120000 / 36);
});

test("effektiv ränta utan avgifter är nominell ränta omräknad till årsbasis", () => {
  assert.ok(Math.abs(effectiveRate(100000, 6, 36) - 6.168) < 0.01);
  assert.equal(effectiveRate(100000, 0, 36), 0);
});

test("0 % ränta med avgifter blir inte gratis", () => {
  const c = loanCost({ principal: 150000, rate: 0, months: 36, setupFee: 995, monthlyFee: 59 });
  assert.equal(c.interest, 0);
  assert.equal(c.fees, 995 + 59 * 36);
  assert.ok(c.effective > 1.3 && c.effective < 1.4, `effektiv ränta ${c.effective}`);
});

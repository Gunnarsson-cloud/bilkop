// Lånematematik som delas av servern och webbsidan.

// Månadsbetalning för ett annuitetslån (exklusive avgifter).
export function annuity(principal, yearlyRatePct, months) {
  if (principal <= 0 || months <= 0) return 0;
  const r = yearlyRatePct / 100 / 12;
  if (r === 0) return principal / months;
  return principal * r / (1 - Math.pow(1 + r, -months));
}

// Effektiv ränta enligt konsumentkreditlagens princip: den årsränta där
// utbetalt belopp (minus uppläggningsavgift) är lika med nuvärdet av alla
// månadsbetalningar inklusive aviavgifter.
export function effectiveRate(principal, yearlyRatePct, months, setupFee = 0, monthlyFee = 0) {
  if (principal <= 0 || months <= 0) return 0;
  const pay = annuity(principal, yearlyRatePct, months) + monthlyFee;
  const received = principal - setupFee;
  if (received <= 0) return Infinity;
  const pv = i => {
    let s = 0;
    for (let k = 1; k <= months; k++) s += pay / Math.pow(1 + i, k);
    return s;
  };
  // Bisektion på månadsräntan; nuvärdet sjunker när räntan stiger.
  let lo = 0, hi = 1;
  if (pv(lo) <= received) return 0;
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > received) lo = mid; else hi = mid;
  }
  return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
}

// Hela lånekostnaden för ett erbjudande.
export function loanCost({ principal, rate, months, setupFee = 0, monthlyFee = 0 }) {
  const pay = annuity(principal, rate, months);
  const interest = pay * months - principal;
  const fees = setupFee + monthlyFee * months;
  return {
    monthly: pay + monthlyFee,
    interest,
    fees,
    total: interest + fees,
    effective: effectiveRate(principal, rate, months, setupFee, monthlyFee),
  };
}

// Kontantinsatsen för billån ska enligt Konsumentverkets allmänna råd vara minst 20 %.
export const MIN_DOWN_PCT = 20;

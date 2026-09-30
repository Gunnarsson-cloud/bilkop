# Bilköp – leasa eller köpa?

Jämför den totala kostnaden för att **köpa eller leasa en ny eller begagnad bil**, med
bilsök mot svenska annonssajter och jämförelse av billån (inklusive räntefria kampanjer).

```sh
npm start        # http://localhost:3000
npm test
```

Kräver Node 20 eller senare, inga beroenden.

## Publicerad sida
`.github/workflows/publish.yml` hämtar bilar och lånevillkor tre gånger per dag med GitHub Actions
och publicerar sidan på GitHub Pages: https://gunnarsson-cloud.github.io/bilkop/

## Statisk sida
Sidan fungerar även utan server. Den läser då `data/cars.json` och `data/loans.json` och filtrerar
och räknar i webbläsaren. `node scripts/build-site.js site` hämtar aktuell data och bygger en
sådan sida i `site/`, klar att lägga ut på valfritt webbhotell.

`.github/workflows/probe.yml` provar alla källor och skriver ut vad som fungerar. Med valet
“save” sparas sidorna i `probe-output/`, som testerna i `test/live-pages.test.js` använder.

## Delar

| Del | Fil | Vad den gör |
|---|---|---|
| Kalkylator | `public/index.html` | Total kostnad över perioden för fyra alternativ: värdeminskning, ränta och låneavgifter, utebliven avkastning, löpande kostnader, leasinghyra, övermil och återlämning. |
| Bilsök | `server/search.js` → `GET /api/cars` | Söker parallellt i Blocket, Bytbil, Wayke och KVD. Filter: fritext, pris från/till (förvalt från 150 000 kr), årsmodell, miltal och “bara 0 % ränta”. |
| Billån | `server/search.js` → `POST /api/loans` | Hämtar räntor och avgifter från bankers och finansbolags billånssidor, lägger till säljarens egna erbjudande och räknar ut effektiv ränta, månadskostnad och total lånekostnad. |
| Lånematte | `public/loanmath.js` | Annuitet och effektiv ränta (konsumentkreditlagens princip). Delas av server och sida. |

### Så läses sidorna
`server/extract.js` läser i första hand schema.org-data (`application/ld+json`: Car, Vehicle,
Product, ItemList) och annars inbäddad appdata som `__NEXT_DATA__`. Annonser som nämner
“0 % ränta” eller “räntefritt” får `dealerRate: 0`. På banksidor letas nominell och effektiv ränta,
uppläggningsavgift och aviavgift upp i texten.

### Artig crawling
`server/fetcher.js` följer robots.txt, väntar minst 2 s mellan anrop till samma sajt och cachar svar
i 15 minuter (`CRAWL_INTERVAL_MS`, `CRAWL_CACHE_MS`). Kontrollera ändå varje sajts användarvillkor
innan en källa används. Flera annonssajter förbjuder automatisk insamling och erbjuder i stället
API:er eller partneravtal. Källor slås av och på i `server/sources.json`.

## Kända begränsningar
- Varje sajt har sin egen tolkare i `server/sites.js`. Ändrar en sajt sin sidstruktur slutar den
  fungera tills tolkaren uppdateras; kör “Prova källor live” för att se vilka som fungerar.
- Bara första sidan med sökträffar hämtas per sajt.
- Santander, SEB, Handelsbanken och Volkswagen Finans visar inte sin ränta på ett sätt som går att läsa ut.
- Räntor på bankernas sidor är oftast “från”-räntor. Den faktiska räntan sätts efter kreditprövning.
- Räntefritt är inte kostnadsfritt: avgifter räknas in i den effektiva räntan, och en 0 %-kampanj
  ersätter ofta en prisrabatt.

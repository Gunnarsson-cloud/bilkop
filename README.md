# Bilköp – leasa eller köpa?

Jämför den totala kostnaden för att **köpa eller leasa en ny eller begagnad bil**, med
bilsök mot svenska annonssajter och jämförelse av billån (inklusive räntefria kampanjer).

```sh
npm start        # http://localhost:3000
npm test
```

Kräver Node 20 eller senare, inga beroenden.

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
- Sök-URL:erna och banksidornas adresser i `server/sources.json` har inte kunnat provas mot de riktiga
  sajterna, eftersom utvecklingsmiljön inte når dem. Tolkningen är testad mot exempelsidor i
  `test/fixtures/`. Justera URL:er och parametrar när du kör mot de riktiga sajterna.
- Räntor på bankernas sidor är oftast “från”-räntor. Den faktiska räntan sätts efter kreditprövning.
- Räntefritt är inte kostnadsfritt: avgifter räknas in i den effektiva räntan, och en 0 %-kampanj
  ersätter ofta en prisrabatt.

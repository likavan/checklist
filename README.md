# Checklist Auditor

Pre-launch web audit tool. Vložíš URL, nástroj prejde checklist pred spustením
webu a streamuje výsledky naživo. Hlavná „killer feature" je **reálny test
cookie lišty** — headless Chromium overí, či cookies sú naozaj blokované pred
consentom a aktivujú sa až po kliknutí "Súhlasím".

Postavené na Next.js 16 (App Router) + Playwright + cheerio.

---

## Čo nástroj kontroluje

### Statické kontroly (HTML + HTTP hlavičky)
- **SSL** — HTTPS dostupnosť, HTTP → HTTPS redirect
- **301 redirecty** — konzistencia `apex` ↔ `www`
- **Basic auth** — detekcia `401 + WWW-Authenticate: Basic` (pre-launch staging vs. produkcia)
- **Nadpisy** — počet H1, prítomnosť H2, hierarchia bez preskakovania úrovní
- **SEO meta** — Title, Meta Description, dĺžky, canonical
- **OG tagy** — `og:title/description/image/url/type` + overenie dostupnosti `og:image`
- **Twitter / X / LinkedIn** — `twitter:card` + fallbacky cez OG
- **robots.txt + meta robots** — detekuje nebezpečné `Disallow: /` a `noindex`
- **sitemap.xml** — `/sitemap.xml`, `/sitemap_index.xml`, hreflang pre multijazyčné weby
- **Tracking** — GTM, GA4, GA UA, Meta Pixel, LinkedIn Insight, TikTok, Hotjar, Clarity
- **E-commerce eventy** — `view_item`, `add_to_cart`, `purchase`, … (len ak je detekovaný e-shop)
- **Favicon set** — `icon`, `apple-touch-icon`, `manifest`, `theme-color`, `/favicon.ico`
- **Obrázky** — vzorka prvých 10 `<img>`: veľkosť, content-type (webp/avif), `loading="lazy"`
- **Cachovanie** — `Cache-Control`, `Expires`, `Age`, detekcia Cloudflare

### Headless browser test (Playwright)
- **Cookie consent** — detekuje 14+ platforiem (cookieconsent.sk, Cookiebot,
  CookieYes, OneTrust, Iubenda, Klaro, Borlabs, Complianz, Didomi, Termly,
  Quantcast, Usercentrics, …) a heuristicky aj neznáme bannery
- Spúšťa **dva nezávislé browser kontexty**:
  1. Před consentom — kontroluje, či sú tracking cookies (\_ga, \_fbp, \_hj…) **blokované**
  2. Po kliknutí "Accept all" — overí, či sa tracking cookies **aktivujú**
  3. Vo fresh kontexte klikne "Odmietnuť / iba nevyhnutné" — overí, že tracking **ostane blokovaný**
- Klasifikuje cookies podľa vendora (Google Analytics, Facebook Pixel, Hotjar, Clarity, LinkedIn, TikTok, Yandex, Pinterest, …)

### Externé API
- **Google PageSpeed Insights** (Lighthouse + Core Web Vitals z CrUX)
  - Performance / Accessibility / Best Practices / SEO skóre
  - Lab metriky: LCP, CLS, TBT, FCP, Speed Index
  - Real-user metriky (LCP, CLS, INP) ak má web dosť návštevnosti pre CrUX
- **Mozilla HTTP Observatory** — security headers grade A+ až F (HSTS, CSP, X-Frame-Options, …)
- **SSL Labs** (voliteľné, ~1–2 min) — TLS/SSL grade A+ až F per endpoint

### Manuálne odkazy
Pre body, ktoré sa automaticky overiť nedajú (UptimeRobot, Search Console,
Wordfence, FTP/admin prístupy, klientske prístupy), nástroj zobrazí pripomienku
a deep-link na príslušný nástroj.

---

## Spustenie lokálne

```bash
git clone git@github.com:likavan/checklist.git
cd checklist
npm install
npx playwright install chromium     # ~150 MB, jednorazovo
npm run dev
```

Otvor http://localhost:3000.

### Voliteľné: PageSpeed API key
Bez kľúča má Google denný limit pre anonymné requesty. Pre vlastný kľúč
(zadarmo, 25k queries/deň):

1. Získaj kľúč: https://developers.google.com/speed/docs/insights/v5/get-started → "Get a Key"
2. Vytvor `.env.local`:
   ```
   PAGESPEED_API_KEY=AIzaSy...
   ```
3. Reštartuj dev server.

---

## Použitie

1. Vlož URL webu
2. (Voliteľne) Pridaj basic auth, ak je staging za 401-kou
3. Vyber, ktoré kontroly spustiť:
   - **Cookie test** — Playwright, +10–20 s
   - **PageSpeed** — Google API, +15–30 s
   - **Security headers** — Mozilla Observatory, +2–5 s
   - **SSL Labs** — vypnuté default (~1–2 min)
4. Klikni **Spustiť audit**
5. Karty pribúdajú naživo so stavom **OK / Pozor / Chýba / Info / N/A**

### Zdieľanie auditu
Tlačidlo **"Zdieľať"** skopíruje link `?url=…` do clipboardu. Druhá strana
otvorí link, URL sa automaticky vyplní.

> ⚠️ **Basic auth credentials sa do share linku neukladajú zámerne.** Heslá v
> URL nie sú bezpečné (history, server logy, Referer hlavičky, screenshoty,
> exportované záložky). Ak má web basic auth, druhá strana si user/heslo zadá
> sama lokálne.

---

## Architektúra

```
src/
├── app/
│   ├── api/audit/route.ts          # Streaming NDJSON endpoint, Node runtime, maxDuration 300s
│   ├── page.tsx                    # UI: form, share, options, výsledky
│   └── layout.tsx, globals.css
├── components/
│   └── CheckCard.tsx               # Rozbaliteľná karta s detailmi a stavom
└── lib/
    ├── utils.ts                    # cn(), normalizeUrl()
    └── audit/
        ├── types.ts                # CheckResult, BasicAuth, StreamEvent
        ├── fetcher.ts              # fetch wrapper s podporou Basic auth
        ├── checks.ts               # 13 statických kontrol (cheerio + fetch)
        ├── cookies.ts              # Playwright cookie consent test (2 kontexty: accept / reject)
        ├── external.ts             # PageSpeed, Mozilla Observatory, SSL Labs
        └── checklist-questions.ts  # 26 otázok pre úvodný prehľad
```

API endpoint streamuje výsledky cez `ReadableStream` ako NDJSON. PageSpeed a
Observatory sa **kickujú na začiatku** ako Promise a awaitnú sa na konci, takže
bežia paralelne so statickými kontrolami a neblokujú celkový čas.

Cookie test používa **dva nezávislé browser kontexty** (čisté cookies), aby sa
nemiešali stavy „po Accept" a „po Reject".

---

## Limitácie

- **Audituje len úvodnú stránku.** Pre archív / článok / produkt zadaj URL
  konkrétnej podstránky samostatne.
- **Cookie test je heuristika.** Pre úplne neznámu implementáciu sa banner
  nemusí podariť detekovať. V takom prípade sa dá overiť aspoň pre-consent stav
  cookies (žiadny tracking → správne).
- **PageSpeed bez API key** môže vrátiť 429 (rate limit). Riešenie: vlastný kľúč
  alebo odškrtnúť checkbox.
- **Playwright vyžaduje Chromium binárku** (~150 MB). Na Vercel deploye treba
  použiť `@sparticuz/chromium` alebo Vercel Sandbox — default `playwright`
  package na klasickom Vercel Function nezbeha.

---

## Stack

- Next.js 16 (App Router, Turbopack)
- React 19
- Tailwind CSS v4
- Playwright (Chromium)
- cheerio
- TypeScript

## Licencia

Pre interné použitie. Ak ti to pomohlo, prevezmi a uprav podľa potreby.

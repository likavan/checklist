import * as cheerio from "cheerio";
import { BasicAuth, CheckResult, CheckStatus } from "./types";
import {
  fetchPage,
  fetchText,
  followRedirectsManually,
  headRequest,
  probeBasicAuth,
  FetchedPage,
} from "./fetcher";
import { normalizeUrl } from "../utils";

function pickStatus(...statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  if (statuses.includes("pass")) return "pass";
  return "info";
}

export async function checkSslAndRedirects(
  originalInput: string,
  auth?: BasicAuth
): Promise<CheckResult[]> {
  const start = Date.now();
  const url = normalizeUrl(originalInput);
  const u = new URL(url);
  const httpsUrl = `https://${u.host}`;
  const httpUrl = `http://${u.host}`;

  const httpsRes = await headRequest(httpsUrl, auth);
  const sslOk = !!httpsRes && httpsRes.status < 500;

  const httpFollow = await followRedirectsManually(httpUrl, 5, auth).catch(() => null);
  const httpRedirectsToHttps =
    !!httpFollow &&
    httpFollow.chain.some(
      (h) => h.status >= 300 && h.status < 400 && (h.location ?? "").startsWith("https://")
    );

  const wwwHost = u.host.startsWith("www.") ? u.host : "www." + u.host;
  const apexHost = u.host.startsWith("www.") ? u.host.replace(/^www\./, "") : u.host;
  const wwwFollow = await followRedirectsManually(`https://${wwwHost}`, 5, auth).catch(() => null);
  const apexFollow = await followRedirectsManually(`https://${apexHost}`, 5, auth).catch(() => null);
  const wwwFinal = wwwFollow?.finalUrl;
  const apexFinal = apexFollow?.finalUrl;
  const consistent = !!wwwFinal && !!apexFinal && new URL(wwwFinal).host === new URL(apexFinal).host;

  const ssl: CheckResult = {
    id: "ssl",
    title: "SSL certifikát na produkcii",
    status: sslOk ? "pass" : "fail",
    summary: sslOk
      ? `HTTPS odpovedá so stavom ${httpsRes!.status}.`
      : `HTTPS nedostupné na ${httpsUrl}.`,
    details: [
      { label: "HTTPS URL", value: httpsUrl, status: sslOk ? "pass" : "fail" },
      {
        label: "HTTP → HTTPS redirect",
        value: httpRedirectsToHttps ? "Áno" : "Nie / nepodarilo sa overiť",
        status: httpRedirectsToHttps ? "pass" : "warn",
      },
    ],
    durationMs: Date.now() - start,
  };

  const redirects: CheckResult = {
    id: "redirects",
    title: "301 redirecty (www / apex konzistencia)",
    status: consistent ? "pass" : "warn",
    summary: consistent
      ? `Apex aj www smerujú na rovnaký host (${new URL(wwwFinal!).host}).`
      : "Apex a www nesmerujú na rovnaký host – skontroluj redirecty.",
    details: [
      { label: `https://${apexHost}`, value: apexFinal ?? "—" },
      { label: `https://${wwwHost}`, value: wwwFinal ?? "—" },
      {
        label: "Pripomienka",
        value: "Pri preklápaní starého webu pripravte 301 redirecty pre staré URL.",
        status: "info",
      },
    ],
    durationMs: Date.now() - start,
  };

  return [ssl, redirects];
}

export async function checkBasicAuthStatus(
  originalInput: string,
  auth?: BasicAuth
): Promise<CheckResult> {
  const url = normalizeUrl(originalInput);
  const probe = await probeBasicAuth(url);

  if (!probe) {
    return {
      id: "basic-auth",
      title: "Basic auth na produkcii",
      status: "warn",
      summary: "Web sa nepodarilo dosiahnuť pre overenie basic auth.",
      details: [{ label: "URL", value: url }],
    };
  }

  if (probe.required) {
    const haveCreds = !!auth?.user;
    return {
      id: "basic-auth",
      title: "Basic auth na produkcii",
      status: haveCreds ? "warn" : "fail",
      summary: haveCreds
        ? "Basic auth je aktívny – audit beží s poskytnutými prihlasovacími údajmi. Pred launch ho vypnite."
        : "Basic auth je aktívny a neboli zadané prihlasovacie údaje – väčšina kontrol zlyhá.",
      details: [
        { label: "401 Unauthorized", value: "Áno", status: "warn" },
        { label: "Realm", value: probe.realm ?? "—" },
        {
          label: "Pre pre-launch",
          value: "Toto je očakávané. Pred launch musí byť VYPNUTÝ.",
          status: "info",
        },
        {
          label: "Pre produkčný launch",
          value: "Tento check by mal byť „pass“ – t.j. žiadne 401.",
          status: "info",
        },
        ...(haveCreds
          ? [{ label: "Auth použitý", value: auth!.user, status: "info" as const }]
          : [
              {
                label: "Tip",
                value: "Zadajte user/pass hore aby audit prešiel cez basic auth.",
                status: "warn" as const,
              },
            ]),
      ],
    };
  }

  return {
    id: "basic-auth",
    title: "Basic auth na produkcii",
    status: "pass",
    summary: "Basic auth nie je aktívny (správne pre produkciu).",
    details: [
      { label: "Status bez auth", value: String(probe.status), status: "pass" },
      {
        label: "Pripomienka",
        value: "Ak ide o pre-launch staging, basic auth tam patrí – tu testujete produkciu.",
        status: "info",
      },
    ],
  };
}

export function checkHeadings(page: FetchedPage): CheckResult {
  const $ = cheerio.load(page.html);
  const h1 = $("h1").map((_, e) => $(e).text().trim()).get();
  const h2Count = $("h2").length;
  const h3Count = $("h3").length;

  const issues: string[] = [];
  if (h1.length === 0) issues.push("Chýba H1.");
  if (h1.length > 1) issues.push(`Viac ako jedno H1 (${h1.length}).`);
  if (h2Count === 0) issues.push("Chýba H2 – štruktúra obsahu môže byť plochá.");

  const order: number[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    order.push(parseInt(el.tagName.substring(1), 10));
  });
  let skipped = false;
  for (let i = 1; i < order.length; i++) {
    if (order[i] - order[i - 1] > 1) skipped = true;
  }
  if (skipped) issues.push("Hierarchia preskakuje úrovne (napr. H2 → H4).");

  const status: CheckStatus =
    h1.length === 1 && !skipped ? (issues.length === 0 ? "pass" : "warn") : "fail";

  return {
    id: "headings",
    title: "Nadpisy (H1/H2 hierarchia)",
    status,
    summary:
      issues.length === 0
        ? `1× H1, ${h2Count}× H2, ${h3Count}× H3.`
        : issues.join(" "),
    details: [
      { label: "H1", value: h1[0] ?? "—", status: h1.length === 1 ? "pass" : "fail" },
      { label: "Počet H1", value: String(h1.length), status: h1.length === 1 ? "pass" : "fail" },
      { label: "Počet H2", value: String(h2Count) },
      { label: "Počet H3", value: String(h3Count) },
      {
        label: "Archív / články",
        value: "Skontrolujte aj kategóriu/archív a detail článku samostatne (zadajte URL).",
        status: "info",
      },
    ],
  };
}

export function checkSeoMeta(page: FetchedPage): CheckResult {
  const $ = cheerio.load(page.html);
  const title = $("head > title").first().text().trim();
  const desc = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() ?? "";

  const titleStatus: CheckStatus =
    !title ? "fail" : title.length < 20 || title.length > 65 ? "warn" : "pass";
  const descStatus: CheckStatus =
    !desc ? "fail" : desc.length < 70 || desc.length > 165 ? "warn" : "pass";

  return {
    id: "seo-meta",
    title: "SEO – Title + Meta Description",
    status: pickStatus(titleStatus, descStatus),
    summary: !title || !desc
      ? "Chýbajú základné SEO meta tagy."
      : `Title ${title.length} zn., Description ${desc.length} zn.`,
    details: [
      { label: "Title", value: title || "—", status: titleStatus },
      { label: "Title dĺžka", value: `${title.length} zn. (odporúčané 30–60)`, status: titleStatus },
      { label: "Description", value: desc || "—", status: descStatus },
      {
        label: "Description dĺžka",
        value: `${desc.length} zn. (odporúčané 70–160)`,
        status: descStatus,
      },
      { label: "Canonical", value: canonical || "—", status: canonical ? "pass" : "warn" },
    ],
  };
}

export function checkOgTags(page: FetchedPage): CheckResult {
  const $ = cheerio.load(page.html);
  const og: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const k = $(el).attr("property")!;
    const v = $(el).attr("content") ?? "";
    og[k] = v;
  });

  const required = ["og:title", "og:description", "og:image", "og:url", "og:type"];
  const missing = required.filter((k) => !og[k]);

  const details = required.map((k) => ({
    label: k,
    value: og[k] || "—",
    status: og[k] ? ("pass" as const) : ("fail" as const),
  }));

  const imageStatus: CheckStatus = og["og:image"] ? "warn" : "fail";
  const imageNote = og["og:image"]
    ? "Skontrolujte rozmer 1200×630 px (overujem...)"
    : "Chýba og:image.";

  return {
    id: "og-tags",
    title: "OG (Facebook) tagy + share image 1200×630",
    status: missing.length === 0 ? "pass" : missing.length <= 2 ? "warn" : "fail",
    summary:
      missing.length === 0
        ? "Všetky základné OG tagy sú nastavené."
        : `Chýbajú: ${missing.join(", ")}`,
    details: [
      ...details,
      { label: "og:image overenie", value: imageNote, status: imageStatus },
      {
        label: "Tip",
        value: "Pri článkoch overte automatické generovanie OG image.",
        status: "info",
      },
    ],
  };
}

export async function verifyOgImage(
  page: FetchedPage,
  auth?: BasicAuth
): Promise<CheckResult | null> {
  const $ = cheerio.load(page.html);
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (!ogImage) return null;
  const absolute = new URL(ogImage, page.finalUrl).toString();
  const head = await headRequest(absolute, auth);
  if (!head) {
    return {
      id: "og-tags",
      title: "Overenie og:image",
      status: "fail",
      summary: "og:image URL je nedostupná.",
      details: [{ label: "URL", value: absolute, status: "fail" }],
    };
  }
  return {
    id: "og-tags",
    title: "Overenie og:image",
    status: head.status < 400 ? "pass" : "fail",
    summary: head.status < 400 ? "og:image je dostupná." : `og:image vrátila ${head.status}.`,
    details: [
      { label: "URL", value: absolute },
      { label: "HTTP status", value: String(head.status), status: head.status < 400 ? "pass" : "fail" },
      {
        label: "Content-Type",
        value: head.headers["content-type"] ?? "—",
      },
      {
        label: "Veľkosť (1200×630)",
        value: "Pre overenie rozmerov použite https://www.opengraph.xyz/",
        status: "info",
      },
    ],
  };
}

export function checkTwitterTags(page: FetchedPage): CheckResult {
  const $ = cheerio.load(page.html);
  const card = $('meta[name="twitter:card"]').attr("content");
  const title = $('meta[name="twitter:title"]').attr("content");
  const desc = $('meta[name="twitter:description"]').attr("content");
  const img = $('meta[name="twitter:image"]').attr("content");

  const details = [
    { label: "twitter:card", value: card || "—", status: card ? ("pass" as const) : ("warn" as const) },
    { label: "twitter:title", value: title || "(fallback z og:title)", status: "info" as const },
    { label: "twitter:description", value: desc || "(fallback z og:description)", status: "info" as const },
    { label: "twitter:image", value: img || "(fallback z og:image)", status: "info" as const },
  ];

  return {
    id: "twitter-tags",
    title: "Twitter / X / LinkedIn share metadata",
    status: card ? "pass" : "warn",
    summary: card
      ? `Twitter card: ${card}.`
      : "Bez explicitných twitter:* tagov sa použijú OG fallbacky (zvyčajne ok).",
    details: [
      ...details,
      {
        label: "LinkedIn",
        value: "LinkedIn používa OG tagy. Overte v LinkedIn Post Inspector.",
        status: "info",
      },
    ],
  };
}

export async function checkRobots(
  originalInput: string,
  page: FetchedPage,
  auth?: BasicAuth
): Promise<CheckResult> {
  const $ = cheerio.load(page.html);
  const metaRobots = $('meta[name="robots"]').attr("content");
  const origin = new URL(normalizeUrl(originalInput)).origin;
  const robotsRes = await fetchText(origin + "/robots.txt", auth);

  const hasFile = !!robotsRes && robotsRes.status < 400 && robotsRes.body.trim().length > 0;
  const disallowAll = hasFile && /Disallow:\s*\/\s*$/im.test(robotsRes!.body);
  const noindexMeta = !!metaRobots && /noindex/i.test(metaRobots);
  const sitemapInRobots = hasFile && /Sitemap:/i.test(robotsRes!.body);

  const status: CheckStatus = disallowAll || noindexMeta ? "fail" : hasFile ? "pass" : "warn";

  return {
    id: "robots",
    title: "Meta robots & robots.txt",
    status,
    summary: disallowAll
      ? "robots.txt zakazuje celý web (Disallow: /)."
      : noindexMeta
      ? "Stránka má meta robots noindex – web sa nebude indexovať!"
      : hasFile
      ? "robots.txt existuje a nezakazuje indexovanie."
      : "robots.txt nebol nájdený.",
    details: [
      { label: "Meta robots", value: metaRobots ?? "(nenastavené – default index, follow)" , status: noindexMeta ? "fail" : "pass"},
      { label: "/robots.txt status", value: robotsRes ? String(robotsRes.status) : "—", status: hasFile ? "pass" : "warn" },
      { label: "Disallow: /", value: disallowAll ? "Áno (CHYBA NA PRODUKCII!)" : "Nie", status: disallowAll ? "fail" : "pass" },
      { label: "Sitemap v robots.txt", value: sitemapInRobots ? "Áno" : "Nie", status: sitemapInRobots ? "pass" : "warn" },
    ],
  };
}

export async function checkSitemap(
  originalInput: string,
  auth?: BasicAuth
): Promise<CheckResult> {
  const origin = new URL(normalizeUrl(originalInput)).origin;
  const candidates = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"];
  const found: { url: string; status: number; sizeKb: number }[] = [];
  let sample = "";

  for (const c of candidates) {
    const r = await fetchText(origin + c, auth);
    if (r && r.status < 400 && r.body.includes("<")) {
      found.push({ url: origin + c, status: r.status, sizeKb: Math.round(r.body.length / 1024) });
      if (!sample) sample = r.body.substring(0, 4000);
    }
  }

  const hreflangMentions = (sample.match(/hreflang=/g) ?? []).length;
  const langSubs = Array.from(sample.matchAll(/<loc>([^<]*sitemap[^<]*)<\/loc>/gi)).map((m) => m[1]);

  return {
    id: "sitemap",
    title: "Sitemap.xml",
    status: found.length > 0 ? "pass" : "fail",
    summary:
      found.length > 0
        ? `Nájdených ${found.length} sitemap súborov.`
        : "Nepodarilo sa nájsť sitemap.xml ani sitemap_index.xml.",
    details: [
      ...found.map((f) => ({ label: f.url, value: `${f.status} · ${f.sizeKb} KB`, status: "pass" as const })),
      {
        label: "Multijazyčné mutácie",
        value:
          hreflangMentions > 0
            ? `hreflang anotácie nájdené (${hreflangMentions})`
            : langSubs.length > 0
            ? `Sub-sitemapy: ${langSubs.slice(0, 3).join(", ")}`
            : "Multijazyčnosť nedetekovaná v sitemape – ak je viacjazyčný web, doplňte hreflang.",
        status: "info",
      },
    ],
  };
}

export function checkTracking(page: FetchedPage): CheckResult {
  const html = page.html;
  const detections: { name: string; pattern: RegExp; example?: string }[] = [
    { name: "Google Tag Manager (GTM)", pattern: /GTM-[A-Z0-9]+/ },
    { name: "Google Analytics 4 (gtag)", pattern: /gtag\(\s*['"]config['"]\s*,\s*['"]G-[A-Z0-9]+/ },
    { name: "Google Analytics UA (legacy)", pattern: /UA-\d{4,}-\d+/ },
    { name: "Facebook Pixel", pattern: /fbq\s*\(\s*['"]init['"]/ },
    { name: "Meta Pixel ID", pattern: /connect\.facebook\.net\/[^"]+\/fbevents\.js/ },
    { name: "LinkedIn Insight", pattern: /snap\.licdn\.com\/li\.lms-analytics/ },
    { name: "TikTok Pixel", pattern: /analytics\.tiktok\.com\/i18n\/pixel/ },
    { name: "Hotjar", pattern: /static\.hotjar\.com\/c\/hotjar-/ },
    { name: "Microsoft Clarity", pattern: /clarity\.ms\/tag\// },
  ];

  const found = detections
    .map((d) => {
      const m = html.match(d.pattern);
      return m ? { name: d.name, match: m[0] } : null;
    })
    .filter(Boolean) as { name: string; match: string }[];

  const dataLayerPushes = (html.match(/dataLayer\.push\s*\(/g) ?? []).length;

  return {
    id: "tracking",
    title: "Tracking (GTM, GA, FB pixel)",
    status: found.length > 0 ? "pass" : "warn",
    summary:
      found.length > 0
        ? `Nájdené: ${found.map((f) => f.name).join(", ")}.`
        : "V HTML kóde sa nenašli štandardné trackingy. Možno sú injektované cez consent.",
    details: [
      ...found.map((f) => ({ label: f.name, value: f.match, status: "pass" as const })),
      { label: "dataLayer.push() v HTML", value: String(dataLayerPushes), status: "info" },
      {
        label: "Cieľ webu / KPI",
        value: "Definujte KPI a nastavte na ne event v GA4 (otázka číslo 10).",
        status: "info",
      },
    ],
  };
}

export function checkEcommerceEvents(page: FetchedPage): CheckResult {
  const html = page.html;
  const events = [
    "view_item",
    "view_item_list",
    "select_item",
    "add_to_cart",
    "remove_from_cart",
    "begin_checkout",
    "add_payment_info",
    "purchase",
  ];
  const isEshop =
    /woocommerce|shopify|prestashop|magento|opencart|shoptet/i.test(html) ||
    /add[_-]?to[_-]?cart/i.test(html);
  const found = events.filter((e) => html.includes(e));

  if (!isEshop && found.length === 0) {
    return {
      id: "ecommerce-events",
      title: "E-commerce eventy (view_item, add_to_cart, purchase)",
      status: "skip",
      summary: "Nezisťuje sa – web nevyzerá ako e-shop.",
      details: [{ label: "Indikátor e-shopu", value: "Žiadny detekovaný" }],
    };
  }

  return {
    id: "ecommerce-events",
    title: "E-commerce eventy (view_item, add_to_cart, purchase)",
    status: found.length >= 4 ? "pass" : found.length > 0 ? "warn" : "fail",
    summary: found.length
      ? `Detekované eventy v zdroji: ${found.join(", ")}.`
      : "Žiadne e-commerce eventy nedetekované – overte v GTM Preview.",
    details: events.map((e) => ({
      label: e,
      value: found.includes(e) ? "Detekované" : "Nedetekované v HTML",
      status: found.includes(e) ? ("pass" as const) : ("warn" as const),
    })),
  };
}

export async function checkFavicon(
  originalInput: string,
  page: FetchedPage,
  auth?: BasicAuth
): Promise<CheckResult> {
  const $ = cheerio.load(page.html);
  const origin = new URL(normalizeUrl(originalInput)).origin;
  const links: { rel: string; sizes?: string; href: string }[] = [];
  $('link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]').each((_, el) => {
    const rel = $(el).attr("rel") ?? "";
    const sizes = $(el).attr("sizes");
    const href = $(el).attr("href") ?? "";
    if (href) links.push({ rel, sizes, href });
  });
  const manifest = $('link[rel="manifest"]').attr("href");
  const themeColor = $('meta[name="theme-color"]').attr("content");

  const rootIco = await headRequest(origin + "/favicon.ico", auth);
  const sizes = new Set(links.map((l) => l.sizes).filter(Boolean) as string[]);
  const hasApple = links.some((l) => l.rel.includes("apple"));

  const ok = links.length >= 2 && hasApple && (sizes.size >= 2 || !!manifest);

  return {
    id: "favicon",
    title: "Favicon (všetky veľkosti)",
    status: ok ? "pass" : "warn",
    summary: ok
      ? `Nájdených ${links.length} icon linkov, apple-touch-icon: áno, manifest: ${manifest ? "áno" : "nie"}.`
      : "Favicon sada nie je úplná – odporúčame prejsť realfavicongenerator.net.",
    details: [
      ...links.slice(0, 8).map((l) => ({
        label: l.rel + (l.sizes ? ` (${l.sizes})` : ""),
        value: l.href,
        status: "pass" as const,
      })),
      { label: "/favicon.ico", value: rootIco ? String(rootIco.status) : "—", status: rootIco && rootIco.status < 400 ? "pass" : "warn" },
      { label: "manifest.json", value: manifest ?? "—", status: manifest ? "pass" : "warn" },
      { label: "theme-color", value: themeColor ?? "—", status: themeColor ? "pass" : "info" },
      { label: "Generátor", value: "https://realfavicongenerator.net/", status: "info" },
    ],
  };
}

export async function checkImages(
  page: FetchedPage,
  auth?: BasicAuth
): Promise<CheckResult> {
  const $ = cheerio.load(page.html);
  const imgs: { src: string; alt: string; loading: string }[] = [];
  $("img").each((_, el) => {
    const src =
      $(el).attr("src") ||
      $(el).attr("data-src") ||
      $(el).attr("srcset")?.split(",")[0]?.trim().split(" ")[0] ||
      "";
    if (!src) return;
    imgs.push({
      src,
      alt: $(el).attr("alt") ?? "",
      loading: $(el).attr("loading") ?? "",
    });
  });

  const sample = imgs.slice(0, 10);
  const results = await Promise.all(
    sample.map(async (img) => {
      try {
        const abs = new URL(img.src, page.finalUrl).toString();
        const h = await headRequest(abs, auth);
        return { ...img, abs, status: h?.status ?? 0, type: h?.headers["content-type"] ?? "", size: parseInt(h?.headers["content-length"] ?? "0", 10) };
      } catch {
        return { ...img, abs: img.src, status: 0, type: "", size: 0 };
      }
    })
  );

  const modernCount = results.filter((r) => /webp|avif/i.test(r.type)).length;
  const oversize = results.filter((r) => r.size > 300 * 1024);
  const noLazy = results.filter((r) => !r.loading || r.loading === "eager").length;

  const status: CheckStatus =
    results.length === 0 ? "info" : modernCount / Math.max(results.length, 1) >= 0.5 ? "pass" : "warn";

  return {
    id: "images",
    title: "Obrázky – veľkosti, webp/avif, lazy-loading",
    status,
    summary:
      results.length === 0
        ? "Žiadne <img> nájdené na úvodnej stránke."
        : `${modernCount}/${results.length} obrázkov používa webp/avif, ${oversize.length} > 300 KB.`,
    details: [
      ...results.map((r) => ({
        label: r.abs.split("/").pop() ?? r.abs,
        value: `${Math.round(r.size / 1024)} KB · ${r.type || "?"}`,
        status: r.size > 300 * 1024 ? ("warn" as const) : ("pass" as const),
      })),
      { label: "Bez lazy-loading", value: String(noLazy), status: noLazy > results.length / 2 ? "warn" : "info" },
      { label: "Tip", value: "Povoľte WP / Next.js automatické WebP/AVIF konverzie a generovanie veľkostí.", status: "info" },
    ],
  };
}

export function checkCaching(page: FetchedPage): CheckResult {
  const cc = page.headers["cache-control"] ?? "";
  const expires = page.headers["expires"] ?? "";
  const cf = page.headers["cf-cache-status"] ?? page.headers["cf-ray"];
  const server = page.headers["server"] ?? "";
  const xPoweredBy = page.headers["x-powered-by"] ?? "";
  const age = page.headers["age"];

  const hasCaching = !!cc && !/no-store/i.test(cc);
  const usesCloudflare = !!cf || /cloudflare/i.test(server);

  return {
    id: "caching",
    title: "Cachovanie + Cloudflare",
    status: hasCaching ? "pass" : "warn",
    summary: hasCaching ? `Cache-Control: ${cc}` : "Chýba alebo zakazuje cache (no-store).",
    details: [
      { label: "Cache-Control", value: cc || "—", status: hasCaching ? "pass" : "warn" },
      { label: "Expires", value: expires || "—" },
      { label: "Age", value: age ?? "—" },
      { label: "Server", value: server || "—" },
      { label: "X-Powered-By", value: xPoweredBy || "—" },
      {
        label: "Cloudflare",
        value: usesCloudflare ? "Áno (CF cache hit/miss header alebo CF server)" : "Nedetekované",
        status: usesCloudflare ? "pass" : "info",
      },
    ],
  };
}

export function externalToolsCheck(originalInput: string): CheckResult {
  const url = normalizeUrl(originalInput);
  return {
    id: "external-tools",
    title: "Externé nástroje (manuálne overenie)",
    status: "info",
    summary: "Spustite tieto kontroly v prehliadači.",
    details: [
      {
        label: "GTmetrix – rýchlosť",
        value: `https://gtmetrix.com/?url=${encodeURIComponent(url)}`,
        href: `https://gtmetrix.com/?url=${encodeURIComponent(url)}`,
        status: "info",
      },
      {
        label: "PageSpeed Insights",
        value: `https://pagespeed.web.dev/report?url=${encodeURIComponent(url)}`,
        href: `https://pagespeed.web.dev/report?url=${encodeURIComponent(url)}`,
        status: "info",
      },
      {
        label: "SEO Servis",
        value: `https://seo-servis.cz/source-zdrojovy-kod/`,
        href: `https://seo-servis.cz/source-zdrojovy-kod/`,
        status: "info",
      },
      {
        label: "Realfavicongenerator",
        value: "https://realfavicongenerator.net/favicon_checker",
        href: `https://realfavicongenerator.net/favicon_checker?site=${encodeURIComponent(url)}`,
        status: "info",
      },
      { label: "UptimeRobot", value: "Nastavte monitoring po nasadení.", status: "info" },
      { label: "Google Search Console", value: "Pridajte vlastníctvo a sitemap.", status: "info" },
      { label: "Wordfence (WP)", value: "Ak je to WordPress, nainštalujte security plugin.", status: "info" },
      {
        label: "Admin / FTP / SSL prístupy",
        value: "Manuálne: skontrolujte basic auth na produkcii, prístupy klientovi, SSL platnosť.",
        status: "info",
      },
    ],
  };
}

export async function loadHomepage(input: string, auth?: BasicAuth): Promise<FetchedPage> {
  const url = normalizeUrl(input);
  return fetchPage(url, { auth });
}

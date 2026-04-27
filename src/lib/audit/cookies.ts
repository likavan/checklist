import type { Browser, BrowserContext, Cookie, Page } from "playwright";
import { BasicAuth, CheckResult, CheckStatus } from "./types";
import { normalizeUrl } from "../utils";

const TRACKING_COOKIE_PATTERNS: { pattern: RegExp; vendor: string }[] = [
  { pattern: /^_ga(_|$)/, vendor: "Google Analytics" },
  { pattern: /^_gid$/, vendor: "Google Analytics" },
  { pattern: /^_gat/, vendor: "Google Analytics" },
  { pattern: /^_gcl_/, vendor: "Google Ads" },
  { pattern: /^_dc_gtm/, vendor: "Google Tag Manager" },
  { pattern: /^_fbp$/, vendor: "Facebook Pixel" },
  { pattern: /^_fbc$/, vendor: "Facebook Pixel" },
  { pattern: /^fr$/i, vendor: "Facebook" },
  { pattern: /^_hj/i, vendor: "Hotjar" },
  { pattern: /^_clck$/i, vendor: "Microsoft Clarity" },
  { pattern: /^_clsk$/i, vendor: "Microsoft Clarity" },
  { pattern: /^_uetsid/i, vendor: "Microsoft Ads UET" },
  { pattern: /^_uetvid/i, vendor: "Microsoft Ads UET" },
  { pattern: /^_pin_unauth/i, vendor: "Pinterest" },
  { pattern: /^_tt_enable_cookie/i, vendor: "TikTok" },
  { pattern: /^_ttp/i, vendor: "TikTok" },
  { pattern: /^li_/i, vendor: "LinkedIn" },
  { pattern: /^lidc$/i, vendor: "LinkedIn" },
  { pattern: /^_ym_/i, vendor: "Yandex Metrika" },
];

function classifyCookie(name: string): { tracking: boolean; vendor?: string } {
  for (const p of TRACKING_COOKIE_PATTERNS) {
    if (p.pattern.test(name)) return { tracking: true, vendor: p.vendor };
  }
  return { tracking: false };
}

interface ConsentResult {
  banner: { detected: boolean; platform?: string; selector?: string };
  before: { cookies: Cookie[]; trackers: { name: string; vendor: string }[] };
  afterAccept?: { cookies: Cookie[]; trackers: { name: string; vendor: string }[] };
  afterReject?: { cookies: Cookie[]; trackers: { name: string; vendor: string }[] };
  acceptClicked: boolean;
  rejectClicked: boolean;
  notes: string[];
}

async function detectPlatform(page: Page): Promise<{ platform?: string; selector?: string }> {
  return await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map((s) => s.src || "");
    const join = scripts.join(" ");
    const candidates: { rx: RegExp; name: string }[] = [
      { rx: /cookieconsent\.sk/i, name: "cookieconsent.sk" },
      { rx: /cookiebot|consent\.cookiebot/i, name: "Cookiebot" },
      { rx: /cookieyes/i, name: "CookieYes" },
      { rx: /onetrust|cookielaw/i, name: "OneTrust" },
      { rx: /usercentrics/i, name: "Usercentrics" },
      { rx: /iubenda/i, name: "Iubenda" },
      { rx: /termly/i, name: "Termly" },
      { rx: /klaro/i, name: "Klaro" },
      { rx: /quantcast|quantcast\.mgr\.consensu/i, name: "Quantcast Choice" },
      { rx: /didomi/i, name: "Didomi" },
      { rx: /complianz/i, name: "Complianz (WP)" },
      { rx: /borlabs/i, name: "Borlabs Cookie (WP)" },
      { rx: /cookie-script\.com/i, name: "CookieScript" },
      { rx: /cookie-?notice/i, name: "Cookie Notice" },
    ];
    for (const c of candidates) {
      if (c.rx.test(join)) return { platform: c.name };
    }
    const knownIds = ["#CybotCookiebotDialog", "#cookiescript_injected", "#onetrust-banner-sdk", "#cookie-law-info-bar", "#cmplz-cookybanner"];
    for (const sel of knownIds) {
      if (document.querySelector(sel)) return { platform: sel.replace("#", ""), selector: sel };
    }
    return {};
  });
}

async function findAcceptButton(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const candidates = [
      "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
      "#CybotCookiebotDialogBodyButtonAccept",
      "#onetrust-accept-btn-handler",
      "#cookiescript_accept",
      "[data-cmptype='accept']",
      ".cmplz-accept",
      ".cky-btn-accept",
      "button[aria-label*='accept' i]",
      "button[aria-label*='súhlas' i]",
      "button[aria-label*='prijať' i]",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && (el as HTMLElement).offsetParent !== null) return sel;
    }
    const keywords = [
      "súhlasím so všetkým",
      "súhlasím",
      "prijať všetko",
      "prijať všetky",
      "prijať",
      "povoliť všetko",
      "povolit vše",
      "souhlasím",
      "rozumiem",
      "accept all",
      "accept",
      "allow all",
      "i agree",
      "agree",
      "ok",
    ];
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a, [role='button'], input[type='button'], input[type='submit']"));
    for (const kw of keywords) {
      const match = buttons.find((b) => {
        const txt = (b.innerText || (b as HTMLInputElement).value || "").trim().toLowerCase();
        if (!txt) return false;
        if (!txt.includes(kw)) return false;
        const rect = b.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (match) {
        if (match.id) return "#" + CSS.escape(match.id);
        const cls = (match.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        const tag = match.tagName.toLowerCase();
        return cls ? `${tag}.${cls}` : tag + `:has-text("${kw}")`;
      }
    }
    return null;
  });
}

async function findRejectButton(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const candidates = [
      "#CybotCookiebotDialogBodyButtonDecline",
      "#onetrust-reject-all-handler",
      "#cookiescript_reject",
      ".cmplz-deny",
      ".cky-btn-reject",
      "[data-cmptype='reject']",
      "button[aria-label*='reject' i]",
      "button[aria-label*='odmiet' i]",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && (el as HTMLElement).offsetParent !== null) return sel;
    }
    const keywords = [
      "odmietnuť všetky",
      "odmietnuť všetko",
      "odmietnuť",
      "iba nevyhnutné",
      "len nevyhnutné",
      "iba potrebné",
      "len potrebné",
      "odmítnout",
      "odmítnout vše",
      "jen nezbytné",
      "reject all",
      "reject",
      "decline",
      "deny",
      "only necessary",
      "necessary only",
    ];
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a, [role='button'], input[type='button'], input[type='submit']"));
    for (const kw of keywords) {
      const match = buttons.find((b) => {
        const txt = (b.innerText || (b as HTMLInputElement).value || "").trim().toLowerCase();
        if (!txt) return false;
        if (!txt.includes(kw)) return false;
        const rect = b.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (match) {
        if (match.id) return "#" + CSS.escape(match.id);
        return match.tagName.toLowerCase() + `:has-text("${kw}")`;
      }
    }
    return null;
  });
}

async function snapshot(context: BrowserContext) {
  const cookies = await context.cookies();
  const trackers = cookies
    .map((c) => ({ name: c.name, classify: classifyCookie(c.name) }))
    .filter((c) => c.classify.tracking)
    .map((c) => ({ name: c.name, vendor: c.classify.vendor! }));
  return { cookies, trackers };
}

async function visitAndSettle(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Allow consent banners and tracking scripts to settle.
  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch {
    /* ignore – some sites stay busy */
  }
  await page.waitForTimeout(2500);
}

export async function runCookieConsentCheck(
  originalInput: string,
  auth?: BasicAuth
): Promise<CheckResult> {
  const url = normalizeUrl(originalInput);
  const start = Date.now();
  // Lazy-load playwright so the route doesn't try to load it on cold paths that don't need it.
  const { chromium } = await import("playwright");
  let browser: Browser | null = null;
  const notes: string[] = [];

  const httpCredentials = auth?.user
    ? { username: auth.user, password: auth.pass ?? "" }
    : undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const result: ConsentResult = {
      banner: { detected: false },
      before: { cookies: [], trackers: [] },
      acceptClicked: false,
      rejectClicked: false,
      notes,
    };

    // ===== Pass 1: load page, observe pre-consent state =====
    const ctx1 = await browser.newContext({ acceptDownloads: false, locale: "sk-SK", httpCredentials });
    const p1 = await ctx1.newPage();
    await visitAndSettle(p1, url);

    const platform = await detectPlatform(p1);
    if (platform.platform) {
      result.banner.detected = true;
      result.banner.platform = platform.platform;
      result.banner.selector = platform.selector;
    }

    result.before = await snapshot(ctx1);

    const acceptSel = await findAcceptButton(p1);
    if (acceptSel) {
      result.banner.detected = true;
      try {
        if (acceptSel.includes(":has-text(")) {
          const m = acceptSel.match(/^(\w+):has-text\("(.+)"\)$/);
          if (m) await p1.getByRole("button", { name: new RegExp(m[2], "i") }).first().click({ timeout: 5000 });
        } else {
          await p1.locator(acceptSel).first().click({ timeout: 5000 });
        }
        result.acceptClicked = true;
        await p1.waitForTimeout(3500);
        result.afterAccept = await snapshot(ctx1);
      } catch (e: unknown) {
        notes.push(`Akceptačný button našiel sa (${acceptSel}), ale klik zlyhal: ${(e as Error).message}`);
      }
    } else if (result.banner.detected) {
      notes.push("Banner detekovaný, ale 'Accept all' tlačidlo sa nepodarilo nájsť heuristikou.");
    } else {
      notes.push("Cookie banner sa nepodarilo detekovať – buď chýba, alebo používa neznámu implementáciu.");
    }
    await ctx1.close();

    // ===== Pass 2: fresh context, click Reject =====
    const ctx2 = await browser.newContext({ acceptDownloads: false, locale: "sk-SK", httpCredentials });
    const p2 = await ctx2.newPage();
    await visitAndSettle(p2, url);
    const rejectSel = await findRejectButton(p2);
    if (rejectSel) {
      try {
        if (rejectSel.includes(":has-text(")) {
          const m = rejectSel.match(/^(\w+):has-text\("(.+)"\)$/);
          if (m) await p2.getByRole("button", { name: new RegExp(m[2], "i") }).first().click({ timeout: 5000 });
        } else {
          await p2.locator(rejectSel).first().click({ timeout: 5000 });
        }
        result.rejectClicked = true;
        await p2.waitForTimeout(3500);
        result.afterReject = await snapshot(ctx2);
      } catch (e: unknown) {
        notes.push(`Reject button (${rejectSel}) klik zlyhal: ${(e as Error).message}`);
      }
    } else if (result.banner.detected) {
      notes.push("Reject / 'iba nevyhnutné' tlačidlo nebolo nájdené – overte manuálne (povinné podľa GDPR).");
    }
    await ctx2.close();

    // ===== Build summary =====
    const before = result.before;
    const accept = result.afterAccept;
    const reject = result.afterReject;

    const blocksTrackingBeforeConsent = before.trackers.length === 0;
    const trackingActivatesAfterAccept = !!accept && accept.trackers.length > before.trackers.length;
    const stillBlocksAfterReject = !!reject && reject.trackers.length === 0;

    const status: CheckStatus = (() => {
      if (!result.banner.detected) return "fail";
      if (!blocksTrackingBeforeConsent) return "fail";
      if (result.acceptClicked && accept && !trackingActivatesAfterAccept) return "warn";
      if (result.rejectClicked && reject && !stillBlocksAfterReject) return "fail";
      return "pass";
    })();

    const summary = (() => {
      const parts: string[] = [];
      parts.push(result.banner.platform ? `Banner: ${result.banner.platform}.` : "Banner detekcia: heuristická.");
      parts.push(`Pred consentom: ${before.trackers.length} tracking cookies.`);
      if (accept) parts.push(`Po Accept: ${accept.trackers.length}.`);
      if (reject) parts.push(`Po Reject: ${reject.trackers.length}.`);
      return parts.join(" ");
    })();

    const dedupTrackers = (list: { name: string; vendor: string }[]) => {
      const map = new Map<string, string>();
      list.forEach((t) => map.set(t.name, t.vendor));
      return Array.from(map.entries()).map(([name, vendor]) => ({ name, vendor }));
    };

    const beforeTrackers = dedupTrackers(before.trackers);
    const acceptTrackers = accept ? dedupTrackers(accept.trackers) : [];
    const rejectTrackers = reject ? dedupTrackers(reject.trackers) : [];

    return {
      id: "cookie-consent",
      title: "Cookie lišta – reálne blokovanie cookies",
      status,
      summary,
      details: [
        {
          label: "Detekovaná platforma",
          value: result.banner.platform ?? (result.banner.detected ? "Áno (neznáma)" : "Nedetekovaná"),
          status: result.banner.detected ? "pass" : "fail",
        },
        {
          label: "Pred consentom – všetky cookies",
          value: `${before.cookies.length} cookies`,
          status: "info",
        },
        {
          label: "Pred consentom – tracking cookies",
          value: beforeTrackers.length ? beforeTrackers.map((t) => `${t.name} (${t.vendor})`).join(", ") : "Žiadne (správne)",
          status: blocksTrackingBeforeConsent ? "pass" : "fail",
        },
        {
          label: "Accept all – tlačidlo",
          value: result.acceptClicked ? "Kliknuté" : "Nepodarilo sa kliknúť / nenájdené",
          status: result.acceptClicked ? "pass" : "warn",
        },
        ...(accept
          ? [
              {
                label: "Po Accept – všetky cookies",
                value: `${accept.cookies.length} cookies`,
                status: "info" as const,
              },
              {
                label: "Po Accept – tracking cookies",
                value: acceptTrackers.length
                  ? acceptTrackers.map((t) => `${t.name} (${t.vendor})`).join(", ")
                  : "Žiadne (možno consent zlyhal alebo sa GTM ešte neinicializoval)",
                status: trackingActivatesAfterAccept ? ("pass" as const) : ("warn" as const),
              },
            ]
          : []),
        {
          label: "Reject / iba nevyhnutné – tlačidlo",
          value: result.rejectClicked ? "Kliknuté" : "Nepodarilo sa kliknúť / nenájdené",
          status: result.rejectClicked ? "pass" : "warn",
        },
        ...(reject
          ? [
              {
                label: "Po Reject – tracking cookies",
                value: rejectTrackers.length
                  ? `Stále aktívne: ${rejectTrackers.map((t) => `${t.name} (${t.vendor})`).join(", ")} ⚠️`
                  : "Žiadne (správne)",
                status: stillBlocksAfterReject ? ("pass" as const) : ("fail" as const),
              },
            ]
          : []),
        ...(notes.length ? notes.map((n) => ({ label: "Pozn.", value: n, status: "info" as const })) : []),
        {
          label: "Trvanie testu",
          value: `${Math.round((Date.now() - start) / 1000)} s`,
          status: "info",
        },
      ],
      durationMs: Date.now() - start,
    };
  } catch (e: unknown) {
    return {
      id: "cookie-consent",
      title: "Cookie lišta – reálne blokovanie cookies",
      status: "fail",
      summary: `Test zlyhal: ${(e as Error).message}`,
      details: [
        { label: "Chyba", value: (e as Error).message, status: "fail" },
        {
          label: "Tip",
          value: "Skontrolujte, či je nainštalovaný Playwright Chromium (`npx playwright install chromium`).",
          status: "info",
        },
      ],
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

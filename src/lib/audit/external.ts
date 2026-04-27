import { CheckResult, CheckStatus } from "./types";
import { normalizeUrl } from "../utils";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scoreStatus(score: number | null): CheckStatus {
  if (score == null) return "info";
  if (score >= 90) return "pass";
  if (score >= 50) return "warn";
  return "fail";
}

interface PageSpeedAuditValue {
  displayValue?: string;
}
interface PageSpeedResponse {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, PageSpeedAuditValue>;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile: number; category: string }>;
    overall_category?: string;
  };
  error?: { message?: string };
}

export async function runPageSpeed(input: string): Promise<CheckResult> {
  const url = normalizeUrl(input);
  const start = Date.now();
  const params = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) {
    params.append("category", c);
  }
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) params.set("key", apiKey);

  try {
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`,
      { signal: AbortSignal.timeout(60_000) }
    );
    const data = (await res.json()) as PageSpeedResponse;
    if (!res.ok || !data.lighthouseResult) {
      throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    }
    const cats = data.lighthouseResult.categories ?? {};
    const audits = data.lighthouseResult.audits ?? {};
    const score = (k: string) => {
      const s = cats[k]?.score;
      return s == null ? null : Math.round(s * 100);
    };
    const perf = score("performance");
    const acc = score("accessibility");
    const bp = score("best-practices");
    const seo = score("seo");
    const fmt = (id: string) => audits[id]?.displayValue ?? "—";

    const crux = data.loadingExperience?.metrics ?? {};
    const cruxLcp = crux["LARGEST_CONTENTFUL_PAINT_MS"];
    const cruxCls = crux["CUMULATIVE_LAYOUT_SHIFT_SCORE"];
    const cruxInp = crux["INTERACTION_TO_NEXT_PAINT"];
    const cruxStatus = (cat?: string): CheckStatus =>
      cat === "FAST" ? "pass" : cat === "AVERAGE" ? "warn" : cat === "SLOW" ? "fail" : "info";
    const cruxFmt = (m?: { percentile: number; category: string }, divider = 1, suffix = "") =>
      m ? `${(m.percentile / divider).toFixed(divider === 1000 ? 2 : 0)}${suffix} (${m.category})` : "—";

    return {
      id: "pagespeed",
      title: "PageSpeed Insights (mobile)",
      status: scoreStatus(perf),
      summary:
        perf == null
          ? "PageSpeed nevrátil performance skóre."
          : `Performance ${perf}/100 · LCP ${fmt("largest-contentful-paint")} · CLS ${fmt("cumulative-layout-shift")}`,
      details: [
        { label: "Performance", value: perf == null ? "—" : `${perf}/100`, status: scoreStatus(perf) },
        { label: "Accessibility", value: acc == null ? "—" : `${acc}/100`, status: scoreStatus(acc) },
        { label: "Best practices", value: bp == null ? "—" : `${bp}/100`, status: scoreStatus(bp) },
        { label: "SEO", value: seo == null ? "—" : `${seo}/100`, status: scoreStatus(seo) },
        { label: "LCP (lab)", value: fmt("largest-contentful-paint") },
        { label: "CLS (lab)", value: fmt("cumulative-layout-shift") },
        { label: "TBT (lab)", value: fmt("total-blocking-time") },
        { label: "FCP (lab)", value: fmt("first-contentful-paint") },
        { label: "Speed Index (lab)", value: fmt("speed-index") },
        ...(cruxLcp || cruxCls || cruxInp
          ? [
              { label: "— Real-user (CrUX) —", value: data.loadingExperience?.overall_category ?? "—", status: "info" as const },
              { label: "LCP (real users)", value: cruxFmt(cruxLcp, 1000, " s"), status: cruxStatus(cruxLcp?.category) },
              { label: "CLS (real users)", value: cruxFmt(cruxCls, 100), status: cruxStatus(cruxCls?.category) },
              { label: "INP (real users)", value: cruxFmt(cruxInp, 1, " ms"), status: cruxStatus(cruxInp?.category) },
            ]
          : []),
        {
          label: "Plný report",
          value: `pagespeed.web.dev/report?url=${url}`,
          href: `https://pagespeed.web.dev/report?url=${encodeURIComponent(url)}`,
          status: "info",
        },
      ],
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      id: "pagespeed",
      title: "PageSpeed Insights (mobile)",
      status: "warn",
      summary: `Nedostupné: ${(e as Error).message}`,
      details: [
        { label: "URL", value: url },
        {
          label: "Tip",
          value: apiKey
            ? "API kľúč nastavený, ale request zlyhal. Skontrolujte kvótu."
            : "Pre rýchlejšie / spoľahlivejšie behy nastavte PAGESPEED_API_KEY env.",
          status: "info",
        },
      ],
      durationMs: Date.now() - start,
    };
  }
}

interface ObservatoryResponse {
  id?: number;
  scan?: {
    grade?: string;
    score?: number;
    tests_passed?: number;
    tests_failed?: number;
    tests_quantity?: number;
  };
  grade?: string;
  score?: number;
  tests_passed?: number;
  tests_failed?: number;
  tests_quantity?: number;
  error?: string;
}

export async function runObservatory(input: string): Promise<CheckResult> {
  const url = normalizeUrl(input);
  const host = new URL(url).host;
  const start = Date.now();
  // The HTTP Observatory has been migrated to MDN. Try the current MDN endpoint, then the legacy one.
  const endpoints = [
    `https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${encodeURIComponent(host)}`,
    `https://http-observatory.services.mozilla.com/api/v2/analyze?host=${encodeURIComponent(host)}`,
  ];
  let lastErr = "";
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, { method: "POST", signal: AbortSignal.timeout(45_000) });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json()) as ObservatoryResponse;
      const scan = data.scan ?? data;
      const grade = scan.grade;
      const score = scan.score;
      const passed = scan.tests_passed;
      const failed = scan.tests_failed;
      const total = scan.tests_quantity;

      if (!grade) {
        lastErr = data.error ?? "Bez grade";
        continue;
      }

      const status: CheckStatus = (() => {
        const g = grade.toUpperCase();
        if (g.startsWith("A")) return "pass";
        if (g.startsWith("B")) return "warn";
        return "fail";
      })();

      return {
        id: "headers-security",
        title: "Mozilla HTTP Observatory (security headers)",
        status,
        summary: `Grade ${grade}${score != null ? ` (${score}/100)` : ""}${passed != null && total ? ` · ${passed}/${total} testov OK` : ""}`,
        details: [
          { label: "Grade", value: grade, status },
          { label: "Skóre", value: score != null ? `${score}/100` : "—" },
          { label: "Testy prešli", value: passed != null ? String(passed) : "—", status: "pass" },
          { label: "Testy zlyhali", value: failed != null ? String(failed) : "—", status: failed && failed > 0 ? "warn" : "pass" },
          {
            label: "Plný report",
            value: `developer.mozilla.org/observatory/analyze?host=${host}`,
            href: `https://developer.mozilla.org/en-US/observatory/analyze?host=${encodeURIComponent(host)}`,
            status: "info",
          },
        ],
        durationMs: Date.now() - start,
      };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return {
    id: "headers-security",
    title: "Mozilla HTTP Observatory (security headers)",
    status: "warn",
    summary: `Nedostupné: ${lastErr || "neznáma chyba"}`,
    details: [
      { label: "Hostname", value: host },
      {
        label: "Tip",
        value: "Skúste manuálne na https://developer.mozilla.org/en-US/observatory",
        href: `https://developer.mozilla.org/en-US/observatory/analyze?host=${encodeURIComponent(host)}`,
        status: "info",
      },
    ],
    durationMs: Date.now() - start,
  };
}

interface SslLabsEndpoint {
  ipAddress?: string;
  grade?: string;
  hasWarnings?: boolean;
  statusMessage?: string;
}
interface SslLabsResponse {
  status?: "DNS" | "IN_PROGRESS" | "READY" | "ERROR";
  statusMessage?: string;
  endpoints?: SslLabsEndpoint[];
  errors?: { message: string }[];
}

async function sslLabsFetch(host: string, params: Record<string, string>): Promise<SslLabsResponse> {
  const qs = new URLSearchParams({ host, all: "done", ...params });
  const res = await fetch(`https://api.ssllabs.com/api/v3/analyze?${qs}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`SSL Labs HTTP ${res.status}`);
  return (await res.json()) as SslLabsResponse;
}

export async function runSslLabs(input: string): Promise<CheckResult> {
  const url = normalizeUrl(input);
  const host = new URL(url).host;
  const start = Date.now();
  try {
    let info = await sslLabsFetch(host, { fromCache: "on", maxAge: "24" });
    if (info.status === "ERROR") {
      const msg = info.statusMessage ?? info.errors?.[0]?.message ?? "ERROR";
      throw new Error(msg);
    }
    const deadline = Date.now() + 150_000;
    while (info.status !== "READY" && info.status !== "ERROR" && Date.now() < deadline) {
      await sleep(8_000);
      info = await sslLabsFetch(host, { fromCache: "on", maxAge: "24" });
    }
    if (info.status !== "READY") {
      throw new Error(`Timeout (status: ${info.status ?? "neznámy"})`);
    }
    const endpoints = info.endpoints ?? [];
    const primaryGrade = endpoints[0]?.grade ?? "?";
    const status: CheckStatus = primaryGrade.startsWith("A")
      ? "pass"
      : primaryGrade.startsWith("B")
      ? "warn"
      : "fail";
    return {
      id: "ssl-labs",
      title: "SSL Labs (TLS/SSL grade)",
      status,
      summary: `Grade ${primaryGrade}${endpoints.length > 1 ? ` · ${endpoints.length} endpointov` : ""}`,
      details: [
        { label: "Primárny grade", value: primaryGrade, status },
        { label: "Hostname", value: host },
        { label: "Endpointov", value: String(endpoints.length) },
        ...endpoints.slice(0, 4).map((e) => ({
          label: e.ipAddress ?? "endpoint",
          value: `${e.grade ?? "?"}${e.hasWarnings ? " (warnings)" : ""}${e.statusMessage ? ` · ${e.statusMessage}` : ""}`,
          status: ((e.grade ?? "F").startsWith("A") ? "pass" : "warn") as CheckStatus,
        })),
        {
          label: "Plný report",
          value: `ssllabs.com/ssltest/analyze.html?d=${host}`,
          href: `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(host)}`,
          status: "info",
        },
      ],
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      id: "ssl-labs",
      title: "SSL Labs (TLS/SSL grade)",
      status: "warn",
      summary: `Nedostupné: ${(e as Error).message}`,
      details: [
        { label: "Hostname", value: host },
        {
          label: "Manuálne",
          value: `https://www.ssllabs.com/ssltest/analyze.html?d=${host}`,
          href: `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(host)}`,
          status: "info",
        },
      ],
      durationMs: Date.now() - start,
    };
  }
}

import { NextRequest } from "next/server";
import {
  checkSslAndRedirects,
  checkBasicAuthStatus,
  checkHeadings,
  checkSeoMeta,
  checkOgTags,
  verifyOgImage,
  checkTwitterTags,
  checkRobots,
  checkSitemap,
  checkTracking,
  checkEcommerceEvents,
  checkFavicon,
  checkImages,
  checkCaching,
  externalToolsCheck,
  loadHomepage,
} from "@/lib/audit/checks";
import { runCookieConsentCheck } from "@/lib/audit/cookies";
import { runPageSpeed, runObservatory, runSslLabs } from "@/lib/audit/external";
import { BasicAuth, CheckResult, StreamEvent } from "@/lib/audit/types";
import { normalizeUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

function event(e: StreamEvent): string {
  return JSON.stringify(e) + "\n";
}

function fail(id: CheckResult["id"], title: string, err: unknown): CheckResult {
  return {
    id,
    title,
    status: "fail",
    summary: (err as Error).message ?? "Chyba pri kontrole",
    details: [{ label: "Detail", value: String(err), status: "fail" }],
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    skipBrowser?: boolean;
    skipPageSpeed?: boolean;
    skipObservatory?: boolean;
    enableSslLabs?: boolean;
    auth?: BasicAuth;
  };

  if (!body.url) {
    return new Response(JSON.stringify({ error: "url is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const url = normalizeUrl(body.url);
  const skipBrowser = !!body.skipBrowser;
  const skipPageSpeed = !!body.skipPageSpeed;
  const skipObservatory = !!body.skipObservatory;
  const enableSslLabs = !!body.enableSslLabs;
  const auth: BasicAuth | undefined =
    body.auth && body.auth.user ? { user: body.auth.user, pass: body.auth.pass ?? "" } : undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(new TextEncoder().encode(event(e)));
      const emit = (r: CheckResult) => send({ type: "check", result: r });

      // Start slow API calls early so they overlap with everything else.
      const pageSpeedPromise = skipPageSpeed ? null : runPageSpeed(url).catch((e) => fail("pagespeed", "PageSpeed Insights", e));
      const observatoryPromise = skipObservatory ? null : runObservatory(url).catch((e) => fail("headers-security", "HTTP Observatory", e));

      const total =
        15 +
        (skipBrowser ? -1 : 0) +
        (skipPageSpeed ? 0 : 1) +
        (skipObservatory ? 0 : 1) +
        (enableSslLabs ? 1 : 0);
      send({ type: "started", url, total });

      try {
        const [ssl, redirects] = await checkSslAndRedirects(url, auth);
        emit(ssl);
        emit(redirects);

        try {
          emit(await checkBasicAuthStatus(url, auth));
        } catch (e) {
          emit(fail("basic-auth", "Basic auth", e));
        }

        let page;
        try {
          page = await loadHomepage(url, auth);
        } catch (e) {
          emit(fail("seo-meta", "Načítanie domovskej stránky", e));
          send({ type: "done" });
          controller.close();
          return;
        }

        if (page.status === 401) {
          emit({
            id: "seo-meta",
            title: "Načítanie domovskej stránky",
            status: "fail",
            summary: "Stránka vrátila 401 Unauthorized – zadajte basic auth credentials.",
            details: [
              { label: "Status", value: "401", status: "fail" },
              { label: "URL", value: page.finalUrl },
            ],
          });
          send({ type: "done" });
          controller.close();
          return;
        }

        emit(checkHeadings(page));
        emit(checkSeoMeta(page));
        emit(checkOgTags(page));

        try {
          const ogVerify = await verifyOgImage(page, auth);
          if (ogVerify) emit(ogVerify);
        } catch (e) {
          emit(fail("og-tags", "Overenie og:image", e));
        }

        emit(checkTwitterTags(page));

        try {
          emit(await checkRobots(url, page, auth));
        } catch (e) {
          emit(fail("robots", "Robots", e));
        }
        try {
          emit(await checkSitemap(url, auth));
        } catch (e) {
          emit(fail("sitemap", "Sitemap", e));
        }

        emit(checkTracking(page));
        emit(checkEcommerceEvents(page));

        try {
          emit(await checkFavicon(url, page, auth));
        } catch (e) {
          emit(fail("favicon", "Favicon", e));
        }
        try {
          emit(await checkImages(page, auth));
        } catch (e) {
          emit(fail("images", "Images", e));
        }

        emit(checkCaching(page));

        if (!skipBrowser) {
          try {
            const cookieResult = await runCookieConsentCheck(url, auth);
            emit(cookieResult);
          } catch (e) {
            emit(fail("cookie-consent", "Cookie consent test", e));
          }
        }

        // Resolve the externally-running API checks (kicked off at start).
        if (pageSpeedPromise) {
          try {
            emit(await pageSpeedPromise);
          } catch (e) {
            emit(fail("pagespeed", "PageSpeed Insights", e));
          }
        }
        if (observatoryPromise) {
          try {
            emit(await observatoryPromise);
          } catch (e) {
            emit(fail("headers-security", "HTTP Observatory", e));
          }
        }
        if (enableSslLabs) {
          try {
            emit(await runSslLabs(url));
          } catch (e) {
            emit(fail("ssl-labs", "SSL Labs", e));
          }
        }

        emit(externalToolsCheck(url));
        send({ type: "done" });
      } catch (e: unknown) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

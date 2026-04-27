"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import type { CheckResult, StreamEvent } from "@/lib/audit/types";
import { CheckCard } from "@/components/CheckCard";
import { CHECKLIST_QUESTIONS } from "@/lib/audit/checklist-questions";

export default function Home() {
  const [url, setUrl] = useState("");
  const [skipBrowser, setSkipBrowser] = useState(false);
  const [skipPageSpeed, setSkipPageSpeed] = useState(false);
  const [skipObservatory, setSkipObservatory] = useState(false);
  const [enableSslLabs, setEnableSslLabs] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [auditedUrl, setAuditedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get("url");
    if (sharedUrl) setUrl(sharedUrl);
    // Intentionally never read user/pass from query params – credentials in URL are unsafe.
  }, []);

  async function copyShareLink() {
    if (typeof window === "undefined") return;
    const target = url.trim();
    if (!target) return;
    const link = new URL(window.location.pathname, window.location.origin);
    link.searchParams.set("url", target);
    try {
      await navigator.clipboard.writeText(link.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Skopírujte link:", link.toString());
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setRunning(true);
    setResults([]);
    setError(null);
    setAuditedUrl(null);
    setProgress({ done: 0, total: 0 });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          skipBrowser,
          skipPageSpeed,
          skipObservatory,
          enableSslLabs,
          auth: authUser ? { user: authUser, pass: authPass } : undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const txt = await res.text();
        throw new Error(txt || "Audit zlyhal");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.type === "started") {
            setAuditedUrl(evt.url ?? url);
            setProgress({ done: 0, total: evt.total ?? 0 });
          } else if (evt.type === "check" && evt.result) {
            setResults((prev) => [...prev, evt.result!]);
            setProgress((p) => ({ ...p, done: p.done + 1 }));
          } else if (evt.type === "error") {
            setError(evt.message ?? "Neznáma chyba");
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function abort() {
    abortRef.current?.abort();
  }

  const counts = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <main className="flex-1 w-full">
      <div className="border-b border-stone-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-stone-500">
              v1 · pre-launch
            </span>
          </div>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight">
            Checklist Auditor
          </h1>
          <p className="mt-3 text-stone-600 max-w-2xl">
            Vložte URL webu a nástroj prejde checklist pred spustením – SEO meta,
            OG/Twitter share, sitemap, robots, tracking, favicon, redirecty,
            cachovanie a hlavne <strong>reálny test cookie lišty</strong> (či
            naozaj blokuje cookies pred consentom).
          </p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.priklad.sk"
              className="flex-1 px-4 py-3 rounded-md border border-stone-300 bg-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-stone-900"
              disabled={running}
            />
            <button
              type="submit"
              disabled={running || !url.trim()}
              className="px-6 py-3 rounded-md bg-stone-900 text-white font-medium hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {running ? "Bežím…" : "Spustiť audit"}
            </button>
            <button
              type="button"
              onClick={copyShareLink}
              disabled={!url.trim()}
              title="Skopíruje link s URL (bez auth credentials)"
              className="px-4 py-3 rounded-md border border-stone-300 hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed transition font-medium text-stone-700"
            >
              {copied ? "✓ Skopírované" : "Zdieľať"}
            </button>
            {running && (
              <button
                type="button"
                onClick={abort}
                className="px-4 py-3 rounded-md border border-stone-300 hover:bg-stone-100"
              >
                Zrušiť
              </button>
            )}
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-stone-600">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!skipBrowser}
                onChange={(e) => setSkipBrowser(!e.target.checked)}
                className="accent-stone-900"
                disabled={running}
              />
              Cookie test <span className="text-stone-400 text-xs">(Playwright)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!skipPageSpeed}
                onChange={(e) => setSkipPageSpeed(!e.target.checked)}
                className="accent-stone-900"
                disabled={running}
              />
              PageSpeed <span className="text-stone-400 text-xs">(Google API)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!skipObservatory}
                onChange={(e) => setSkipObservatory(!e.target.checked)}
                className="accent-stone-900"
                disabled={running}
              />
              Security headers <span className="text-stone-400 text-xs">(Mozilla)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableSslLabs}
                onChange={(e) => setEnableSslLabs(e.target.checked)}
                className="accent-stone-900"
                disabled={running}
              />
              SSL Labs <span className="text-stone-400 text-xs">(~1–2 min)</span>
            </label>
            <button
              type="button"
              onClick={() => setAuthOpen((v) => !v)}
              className="text-stone-700 underline decoration-stone-300 hover:decoration-stone-700"
              disabled={running}
            >
              {authOpen ? "Skryť basic auth" : "Pridať basic auth"}
              {authUser ? ` · ${authUser}` : ""}
            </button>
          </div>

          {authOpen && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl rounded-md border border-stone-200 bg-stone-50 p-4">
              <label className="flex flex-col gap-1 text-xs text-stone-600">
                Používateľ
                <input
                  type="text"
                  autoComplete="off"
                  value={authUser}
                  onChange={(e) => setAuthUser(e.target.value)}
                  className="px-3 py-2 rounded-md border border-stone-300 bg-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-stone-900"
                  disabled={running}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-stone-600">
                Heslo
                <input
                  type="password"
                  autoComplete="off"
                  value={authPass}
                  onChange={(e) => setAuthPass(e.target.value)}
                  className="px-3 py-2 rounded-md border border-stone-300 bg-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-stone-900"
                  disabled={running}
                />
              </label>
              <p className="md:col-span-2 text-xs text-stone-500">
                Údaje sa pošlú len do lokálneho <code className="font-mono">/api/audit</code> endpointu (odtiaľ ďalej ako Authorization: Basic na auditovaný web). <strong>Share link credentials neobsahuje</strong> – pri zdieľaní si ich druhá strana zadá sama. Heslá v URL nie sú bezpečné (history, server logy, Referer).
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {auditedUrl && (
          <div className="mb-6 flex flex-wrap items-center gap-4 text-sm">
            <span className="font-mono text-stone-500">{auditedUrl}</span>
            {progress.total > 0 && (
              <span className="font-mono text-stone-500">
                {progress.done}/{progress.total} kontrol
              </span>
            )}
            <span className="flex gap-2">
              {counts.pass ? <Pill className="bg-emerald-50 text-emerald-800 border-emerald-200">{counts.pass} OK</Pill> : null}
              {counts.warn ? <Pill className="bg-amber-50 text-amber-800 border-amber-200">{counts.warn} pozor</Pill> : null}
              {counts.fail ? <Pill className="bg-red-50 text-red-800 border-red-200">{counts.fail} chyba</Pill> : null}
              {counts.info ? <Pill className="bg-stone-100 text-stone-700 border-stone-200">{counts.info} info</Pill> : null}
              {counts.skip ? <Pill className="bg-stone-100 text-stone-500 border-stone-200">{counts.skip} N/A</Pill> : null}
            </span>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {results.map((r, i) => (
            <CheckCard key={`${r.id}-${i}`} result={r} />
          ))}

          {running && (
            <div className="rounded-md border border-stone-200 bg-white px-4 py-4 flex items-center gap-3 text-sm text-stone-600">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-stone-500 pulse-ring" />
              Beží ďalšia kontrola…
            </div>
          )}
        </div>

        {!running && results.length === 0 && !error && (
          <div className="rounded-lg border border-stone-200 bg-white p-8">
            <h2 className="text-lg font-semibold">Čo audit pokrýva</h2>
            <ul className="mt-4 grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm text-stone-700">
              {CHECKLIST_QUESTIONS.map((q, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-stone-400">{String(i + 1).padStart(2, "0")}</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-stone-500">
              Niektoré body (prístupy na FTP, Wordfence, Search Console, Uptimerobot) treba overiť ručne – nástroj na ne odkáže.
            </p>
          </div>
        )}
      </div>

      <footer className="border-t border-stone-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-6 text-xs text-stone-500 flex flex-wrap gap-4 justify-between">
          <span>Local-first audit nástroj. Cookie test používa headless Chromium (Playwright).</span>
          <span className="font-mono">{new Date().getFullYear()}</span>
        </div>
      </footer>
    </main>
  );
}

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}
    >
      {children}
    </span>
  );
}

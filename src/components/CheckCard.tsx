"use client";

import { useState } from "react";
import type { CheckResult, CheckStatus } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  CheckStatus,
  { label: string; bg: string; ring: string; chip: string; icon: string }
> = {
  pass: {
    label: "OK",
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: "✓",
  },
  warn: {
    label: "Pozor",
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    chip: "bg-amber-100 text-amber-900 border-amber-200",
    icon: "!",
  },
  fail: {
    label: "Chyba",
    bg: "bg-red-50",
    ring: "ring-red-200",
    chip: "bg-red-100 text-red-800 border-red-200",
    icon: "×",
  },
  info: {
    label: "Info",
    bg: "bg-stone-50",
    ring: "ring-stone-200",
    chip: "bg-stone-100 text-stone-700 border-stone-200",
    icon: "i",
  },
  skip: {
    label: "N/A",
    bg: "bg-stone-50",
    ring: "ring-stone-200",
    chip: "bg-stone-100 text-stone-500 border-stone-200",
    icon: "–",
  },
};

export function CheckCard({ result }: { result: CheckResult }) {
  const [open, setOpen] = useState(result.status === "fail");
  const meta = STATUS_META[result.status];

  return (
    <div className={cn("rounded-lg bg-white border border-stone-200 overflow-hidden ring-1", meta.ring)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-stone-50 transition"
      >
        <span
          className={cn(
            "shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center font-mono font-semibold text-sm",
            meta.bg,
            "border",
            meta.ring.replace("ring-", "border-")
          )}
        >
          {meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-stone-900">{result.title}</h3>
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border",
                meta.chip
              )}
            >
              {meta.label}
            </span>
            {result.durationMs ? (
              <span className="font-mono text-xs text-stone-400">
                {(result.durationMs / 1000).toFixed(1)}s
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-stone-600">{result.summary}</p>
        </div>
        <span className="shrink-0 text-stone-400 font-mono text-xs select-none">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && result.details && result.details.length > 0 && (
        <div className="border-t border-stone-200 bg-stone-50/50 px-5 py-4">
          <dl className="grid gap-2">
            {result.details.map((d, i) => {
              const dStatus = d.status ?? "info";
              const dMeta = STATUS_META[dStatus];
              return (
                <div
                  key={i}
                  className="grid grid-cols-1 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm border-b border-stone-100 pb-2 last:border-b-0 last:pb-0 items-start"
                >
                  <dt className="text-stone-500 flex items-start gap-2 min-w-0">
                    <span
                      className={cn(
                        "inline-block w-1.5 h-1.5 rounded-full mt-2 shrink-0",
                        dStatus === "pass" && "bg-emerald-500",
                        dStatus === "warn" && "bg-amber-500",
                        dStatus === "fail" && "bg-red-500",
                        dStatus === "info" && "bg-stone-400",
                        dStatus === "skip" && "bg-stone-300"
                      )}
                    />
                    <span className="break-all">{d.label}</span>
                  </dt>
                  <dd className="text-stone-800 font-mono text-xs break-all min-w-0">
                    {d.href ? (
                      <a
                        href={d.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-stone-900 underline decoration-stone-400 hover:decoration-stone-900"
                      >
                        {d.value}
                      </a>
                    ) : (
                      <span className={cn(dStatus === "fail" && "text-red-700", dStatus === "warn" && "text-amber-800")}>
                        {d.value}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </div>
  );
}

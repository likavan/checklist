export type CheckStatus = "pass" | "warn" | "fail" | "info" | "skip";

export interface BasicAuth {
  user: string;
  pass: string;
}

export type CheckId =
  | "ssl"
  | "redirects"
  | "basic-auth"
  | "headings"
  | "seo-meta"
  | "og-tags"
  | "twitter-tags"
  | "robots"
  | "sitemap"
  | "tracking"
  | "ecommerce-events"
  | "cookie-consent"
  | "favicon"
  | "images"
  | "caching"
  | "cloudflare"
  | "wordpress-security"
  | "pagespeed"
  | "headers-security"
  | "ssl-labs"
  | "external-tools";

export interface CheckDetail {
  label: string;
  value?: string;
  status?: CheckStatus;
  href?: string;
}

export interface CheckResult {
  id: CheckId;
  title: string;
  status: CheckStatus;
  summary: string;
  details?: CheckDetail[];
  durationMs?: number;
}

export interface StreamEvent {
  type: "check" | "started" | "done" | "error";
  result?: CheckResult;
  message?: string;
  url?: string;
  total?: number;
}

import type { BasicAuth } from "./types";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ChecklistAuditor/1.0";

export interface FetchedPage {
  ok: boolean;
  status: number;
  finalUrl: string;
  redirectChain: string[];
  headers: Record<string, string>;
  html: string;
  timing: number;
}

function authHeader(auth?: BasicAuth): Record<string, string> {
  if (!auth || !auth.user) return {};
  const token = Buffer.from(`${auth.user}:${auth.pass ?? ""}`, "utf-8").toString("base64");
  return { authorization: `Basic ${token}` };
}

function withDefaultHeaders(auth?: BasicAuth, extra: HeadersInit = {}): HeadersInit {
  return { "user-agent": DEFAULT_UA, ...authHeader(auth), ...(extra as Record<string, string>) };
}

export async function fetchPage(
  url: string,
  init: RequestInit & { auth?: BasicAuth } = {}
): Promise<FetchedPage> {
  const start = Date.now();
  const { auth, ...rest } = init;
  const res = await fetch(url, {
    redirect: "follow",
    ...rest,
    headers: withDefaultHeaders(auth, rest.headers),
  });
  const html = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return {
    ok: res.ok,
    status: res.status,
    finalUrl: res.url,
    redirectChain: [],
    headers,
    html,
    timing: Date.now() - start,
  };
}

export async function headRequest(
  url: string,
  auth?: BasicAuth
): Promise<{ status: number; headers: Record<string, string>; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: withDefaultHeaders(auth),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return { status: res.status, headers, finalUrl: res.url };
  } catch {
    return null;
  }
}

export async function fetchText(
  url: string,
  auth?: BasicAuth
): Promise<{ status: number; body: string; headers: Record<string, string> } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: withDefaultHeaders(auth),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const body = await res.text();
    return { status: res.status, body, headers };
  } catch {
    return null;
  }
}

export async function followRedirectsManually(
  url: string,
  maxHops = 5,
  auth?: BasicAuth
): Promise<{ chain: { url: string; status: number; location?: string }[]; finalUrl: string }> {
  const chain: { url: string; status: number; location?: string }[] = [];
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: withDefaultHeaders(auth),
    });
    const location = res.headers.get("location") ?? undefined;
    chain.push({ url: current, status: res.status, location });
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
  return { chain, finalUrl: current };
}

export async function probeBasicAuth(url: string): Promise<{
  required: boolean;
  realm?: string;
  status: number;
} | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": DEFAULT_UA },
    });
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    if (res.status === 401 && /basic/i.test(wwwAuth)) {
      const realmMatch = wwwAuth.match(/realm="?([^"]+)"?/i);
      return { required: true, realm: realmMatch?.[1], status: res.status };
    }
    return { required: false, status: res.status };
  } catch {
    return null;
  }
}

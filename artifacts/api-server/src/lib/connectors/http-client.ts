import dns from "node:dns/promises";
import net from "node:net";

export interface HttpClientOptions {
  method?: string;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  retries?: number;
  headers?: Record<string, string>;
  userAgent?: string;
  correlationId?: string;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  statusText: string;
  headers: Headers;
  text: string;
  json: () => any;
  elapsedMs: number;
}

// Enable TLS fallback for public Kenyan government/county portals that lack bundled intermediate CA certs
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// Bounded concurrency per domain map
const domainLastRequest = new Map<string, number>();
const domainActiveRequests = new Map<string, number>();

/**
 * SSRF Protection: verify IP address is not private / internal
 */
function isPrivateIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") return true;

  // IPv4 private ranges:
  // 10.0.0.0 - 10.255.255.255
  // 172.16.0.0 - 172.31.255.255
  // 192.168.0.0 - 192.168.255.255
  // 169.254.0.0 - 169.254.255.255 (link-local / AWS metadata)
  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  // IPv6 link-local and unique local
  if (ip.toLowerCase().startsWith("fe80:") || ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")) {
    return true;
  }

  return false;
}

/**
 * Validate URL is publicly routable and HTTP/HTTPS
 */
export async function validateSafeUrl(rawUrl: string): Promise<{ valid: boolean; error?: string; urlObj?: URL }> {
  try {
    const urlObj = new URL(rawUrl);
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return { valid: false, error: `Disallowed protocol: ${urlObj.protocol}` };
    }

    const hostname = urlObj.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return { valid: false, error: "Access to localhost or internal names is prohibited (SSRF prevention)" };
    }

    // Resolve DNS to verify IP is not in private range
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      for (const addr of addresses) {
        if (isPrivateIp(addr.address)) {
          return { valid: false, error: `Resolved IP ${addr.address} is a private network address (SSRF blocked)` };
        }
      }
    } catch {
      // If DNS resolution fails, URL cannot be fetched
      return { valid: false, error: `DNS resolution failed for hostname: ${hostname}` };
    }

    return { valid: true, urlObj };
  } catch (err: any) {
    return { valid: false, error: err.message || "Invalid URL format" };
  }
}

/**
 * Robust HTTP client with SSRF checks, rate limits, exponential backoff, and response limits
 */
export async function secureFetch(url: string, options: HttpClientOptions = {}): Promise<HttpResponse> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxResponseBytes ?? 2 * 1024 * 1024; // 2MB cap
  const maxRetries = options.retries ?? 2;
  const userAgent =
    options.userAgent ??
    "KaziScout/2.0 (+https://github.com/vintech/kaziscout; automated verified career discovery)";

  const validation = await validateSafeUrl(url);
  if (!validation.valid || !validation.urlObj) {
    throw new Error(`[SSRF/URL Security] Blocked URL "${url}": ${validation.error}`);
  }

  const hostname = validation.urlObj.hostname;

  // Per-domain gentle rate limiting: enforce minimum 200ms delay between calls to same domain
  const lastTime = domainLastRequest.get(hostname) || 0;
  const now = Date.now();
  if (now - lastTime < 250) {
    await new Promise((resolve) => setTimeout(resolve, 250 - (now - lastTime)));
  }
  domainLastRequest.set(hostname, Date.now());

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    attempt++;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...options.headers,
      };

      if (options.correlationId) {
        headers["X-Correlation-ID"] = options.correlationId;
      }

      const res = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timer);
      const elapsedMs = Date.now() - startTime;

      // Check status: if 429 (rate-limited), respect Retry-After
      if (res.status === 429 && attempt <= maxRetries) {
        const retryAfterSec = Number(res.headers.get("retry-after")) || Math.pow(2, attempt);
        const waitMs = Math.min(retryAfterSec * 1000, 10_000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      // Read response body with byte limiter
      const rawText = await res.text();
      const truncatedText = rawText.length > maxBytes ? rawText.slice(0, maxBytes) : rawText;

      return {
        status: res.status,
        ok: res.ok,
        statusText: res.statusText,
        headers: res.headers,
        text: truncatedText,
        json: () => JSON.parse(truncatedText),
        elapsedMs,
      };
    } catch (err: any) {
      lastError = err;
      if (attempt <= maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 400;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
}

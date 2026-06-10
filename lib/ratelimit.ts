/**
 * In-memory sliding-window rate limiter — a guardrail / off-ramp against runaway
 * clients and casual abuse hammering the upstream Esplora API.
 *
 * This answers the question every system owes before it ships: "what happens
 * when a client misbehaves?" Without it, one bad actor (or a buggy loop) can
 * accelerate load straight into the upstream API and blow the blast radius.
 *
 * LIMITATION (documented honestly, per PRINCIPLES.md): this is PER-INSTANCE on
 * serverless — not distributed. It's a solid baseline, but for production-grade,
 * cross-instance limiting put Vercel's WAF rate-limiting or a shared store
 * (e.g. Upstash Redis) in front. Don't mistake "a limiter exists" for "abuse is
 * impossible."
 */

interface Bucket {
  count: number;
  reset: number; // epoch ms when the window resets
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateResult {
  ok: boolean;
  retryAfter: number; // seconds
  remaining: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateResult {
  const now = Date.now();

  // Opportunistic cleanup so the bucket map can't grow unbounded.
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
    lastSweep = now;
  }

  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0, remaining: limit - 1 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000), remaining: 0 };
  }
  b.count += 1;
  return { ok: true, retryAfter: 0, remaining: limit - b.count };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Standard 429 response with a Retry-After header. */
export function tooManyRequests(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: "rate limit exceeded — slow down", retryAfter }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfter),
        "cache-control": "no-store",
      },
    }
  );
}

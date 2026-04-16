/**
 * PropertyAPI.co integration service
 * Base URL: https://api.propertyapi.co/api/v1/
 * Auth: X-Api-Key header
 *
 * Supports 7 rotating API keys:
 *   PROPERTY_API_KEY   (original key, 100 credits/month)
 *   PROPERTY_API_KEY_1 … PROPERTY_API_KEY_7 (7 additional keys, 100 credits each)
 *   Total: 800 credits/month across all keys, used in round-robin order.
 *
 * Cooldown rules (enforced in the endpoint, not here):
 *   - Per lead:     max 2 fetches, 5-hour cooldown between them
 *   - Per campaign: max 1 fetch per 10 minutes (across different leads)
 *   - Super admin:  no cooldowns
 *
 * Adjustment factors (midpoint values) for ARV calculation:
 *   Bedroom:        ±$12,500
 *   Bathroom:       ±$7,500
 *   Square Footage: ±$50/sqft
 *   Year Built:     ±$150/year
 *   Pool:           ±$15,000
 *   Garage:         ±$7,500
 */

import { logger } from "../lib/logger";

// NOTE: The subdomain api.propertyapi.co has no DNS record — use root domain
const BASE_URL = "https://propertyapi.co/api/v1";

// ─── Key pool & round-robin rotation ─────────────────────────────────────────

function loadApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const k = process.env[`PROPERTY_API_KEY_${i}`];
    if (k) keys.push(k.trim());
  }
  // Fallback to legacy single key
  const legacy = process.env.PROPERTY_API_KEY;
  if (legacy && !keys.includes(legacy.trim())) keys.push(legacy.trim());
  return keys;
}

let _keyIndex = 0;
const _depletedKeys = new Set<string>();

export function markKeyDepleted(key: string) {
  _depletedKeys.add(key);
  logger.warn({ key: key.slice(0, 8) + "…" }, "[propertyApi] key marked depleted (402)");
}

export function getNextApiKey(): string | null {
  const keys = loadApiKeys();
  if (keys.length === 0) return null;
  // Skip depleted keys; try up to keys.length times
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[_keyIndex % keys.length]!;
    _keyIndex = (_keyIndex + 1) % keys.length;
    if (!_depletedKeys.has(key)) return key;
  }
  // All keys depleted — return null so caller can surface a clear error
  logger.error("[propertyApi] ALL PropertyAPI keys depleted");
  return null;
}

export function getKeyPoolSize(): number {
  return loadApiKeys().length;
}

// ─── Campaign Daily Limit Tracking (in-memory) ───────────────────────────────
// Tracks timestamps of each action per campaign within a rolling 24-hour window.
// The daily limit is configurable per campaign (stored in DB, passed in at call time).

const DAILY_MS = 24 * 60 * 60 * 1000;

/** Prune timestamps older than 24 hours from the array. */
function pruneOld(timestamps: number[]): number[] {
  const cutoff = Date.now() - DAILY_MS;
  return timestamps.filter(t => t > cutoff);
}

export interface SkipTraceCooldownResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

// ─── Skip Trace ───────────────────────────────────────────────────────────────

const skipTraceMap = new Map<number, number[]>(); // campaignId → timestamps in last 24h

export function checkSkipTraceCooldown(
  campaignId: number,
  isSuperAdmin: boolean,
  dailyLimit = 1,
): SkipTraceCooldownResult {
  if (isSuperAdmin) return { allowed: true };
  const raw = skipTraceMap.get(campaignId) ?? [];
  const recent = pruneOld(raw);
  skipTraceMap.set(campaignId, recent);
  if (recent.length >= dailyLimit) {
    // Oldest timestamp + 24h = when the first slot opens up again
    const oldestTs = Math.min(...recent);
    const retryAfterMs = oldestTs + DAILY_MS - Date.now();
    const hours = Math.ceil(Math.max(retryAfterMs, 0) / 3600000);
    return {
      allowed: false,
      reason: `Skip trace limit: ${dailyLimit} per campaign per day. Try again in ~${hours} hour(s).`,
      retryAfterMs: Math.max(retryAfterMs, 0),
    };
  }
  return { allowed: true };
}

export function recordSkipTrace(campaignId: number) {
  const existing = pruneOld(skipTraceMap.get(campaignId) ?? []);
  existing.push(Date.now());
  skipTraceMap.set(campaignId, existing);
}

// ─── Fetch Comps ──────────────────────────────────────────────────────────────

const fetchCompsMap = new Map<number, number[]>(); // campaignId → timestamps in last 24h

export function checkFetchCompsCooldown(
  campaignId: number,
  isSuperAdmin: boolean,
  dailyLimit = 1,
): SkipTraceCooldownResult {
  if (isSuperAdmin) return { allowed: true };
  const raw = fetchCompsMap.get(campaignId) ?? [];
  const recent = pruneOld(raw);
  fetchCompsMap.set(campaignId, recent);
  if (recent.length >= dailyLimit) {
    const oldestTs = Math.min(...recent);
    const retryAfterMs = oldestTs + DAILY_MS - Date.now();
    const hours = Math.ceil(Math.max(retryAfterMs, 0) / 3600000);
    return {
      allowed: false,
      reason: `Fetch comps limit: ${dailyLimit} per campaign per day. Try again in ~${hours} hour(s).`,
      retryAfterMs: Math.max(retryAfterMs, 0),
    };
  }
  return { allowed: true };
}

export function recordFetchComps(campaignId: number) {
  const existing = pruneOld(fetchCompsMap.get(campaignId) ?? []);
  existing.push(Date.now());
  fetchCompsMap.set(campaignId, existing);
}

// ─── Skip Trace Types & Call ──────────────────────────────────────────────────

export interface SkipTracePhone {
  number: string;
  type?: string;
  isDisconnected?: boolean;
}

export interface SkipTraceResult {
  matchStatus: string;
  phones: SkipTracePhone[];
  emails: string[];
  creditsRemaining?: number;
}

export interface SkipTraceError {
  httpStatus?: number;
  apiMessage?: string;
}
let _lastSkipTraceError: SkipTraceError | null = null;

export function getLastSkipTraceError(): SkipTraceError | null {
  return _lastSkipTraceError;
}

// ─── PeopleDataLabs Skip Trace fallback ───────────────────────────────────────
// Used when PropertyAPI credits are exhausted.
// Endpoint: GET https://api.peopledatalabs.com/v5/person/enrich
// Cost: ~$0.265/credit (trial includes 100 free credits)

async function runSkipTracePDL(
  street: string,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
): Promise<SkipTraceResult | null> {
  const apiKey = process.env.PEOPLEDATALABS_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams();
    if (street) params.set("street_address", street);
    if (city)   params.set("locality", city);
    if (state)  params.set("region", state);
    if (zip)    params.set("postal_code", zip);
    params.set("min_likelihood", "0.5");
    params.set("pretty", "false");

    const res = await fetch(
      `https://api.peopledatalabs.com/v5/person/enrich?${params.toString()}`,
      { headers: { "X-Api-Key": apiKey } },
    );

    if (res.status === 404) {
      // No record found — not an error
      logger.info("[PDL skipTrace] no record found");
      _lastSkipTraceError = { apiMessage: "No contact data found (PDL)" };
      return null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, body: text.slice(0, 300) }, "[PDL skipTrace] HTTP error");
      _lastSkipTraceError = { httpStatus: res.status, apiMessage: text.slice(0, 200) };
      return null;
    }

    const json = await res.json() as any;
    const data = json?.data ?? {};

    const phones: SkipTracePhone[] = (data.phone_numbers || []).slice(0, 5).map((n: string) => ({
      number: n,
      type: undefined,
      isDisconnected: false,
    }));
    const emails: string[] = (data.emails || []).slice(0, 5).map((e: any) =>
      typeof e === "string" ? e : e?.address
    ).filter(Boolean);

    if (!phones.length && !emails.length) {
      logger.info("[PDL skipTrace] matched but no phones/emails");
      _lastSkipTraceError = { apiMessage: "No contact data found (PDL)" };
      return null;
    }

    logger.info({ phones: phones.length, emails: emails.length }, "[PDL skipTrace] success");
    return { matchStatus: "matched", phones, emails };
  } catch (err) {
    logger.error({ err }, "[PDL skipTrace] fetch error");
    _lastSkipTraceError = { apiMessage: String(err) };
    return null;
  }
}

export async function runSkipTrace(
  street: string,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
  firstName?: string | null,
  lastName?: string | null,
): Promise<SkipTraceResult | null> {
  _lastSkipTraceError = null;
  const apiKey = getNextApiKey();
  if (!apiKey) {
    logger.warn("[skipTrace] No PropertyAPI keys configured — trying PDL fallback");
    const pdlResult = await runSkipTracePDL(street, city, state, zip);
    if (pdlResult) return pdlResult;
    _lastSkipTraceError = { apiMessage: "No skip trace API keys configured on server" };
    return null;
  }
  const keyIndex = (_keyIndex === 0 ? loadApiKeys().length : _keyIndex);

  const lookup: Record<string, any> = {
    uid: "lead_skip",
    address: {
      street,
      ...(city  ? { city }  : {}),
      ...(state ? { state } : {}),
      ...(zip   ? { zip }   : {}),
    },
  };
  if (firstName || lastName) {
    lookup["name"] = {
      ...(firstName ? { first: firstName } : {}),
      ...(lastName  ? { last: lastName }  : {}),
    };
  }

  try {
    const resp = await fetch(`${BASE_URL}/skip-trace`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ lookups: [lookup] }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      logger.error({ status: resp.status, body: text.slice(0, 500) }, `[skipTrace] key#${keyIndex} HTTP error`);
      if (resp.status === 402 || text.toLowerCase().includes("insufficient credits") || text.toLowerCase().includes("credit")) {
        logger.info("[skipTrace] PropertyAPI credits exhausted — trying PDL fallback");
        const pdlResult = await runSkipTracePDL(street, city, state, zip);
        if (pdlResult) return pdlResult;
      }
      _lastSkipTraceError = { httpStatus: resp.status, apiMessage: text.slice(0, 300) };
      return null;
    }
    const json = await resp.json() as any;

    // PropertyAPI returns data as an array with flat fields: phone_1_number, email_1, …
    const item: Record<string, any> = Array.isArray(json.data) ? (json.data[0] ?? {}) : (json.data ?? {});

    const hasAnyResult = item.phone_1_number || item.email_1 || item.name_first || item.name_last;
    if (!hasAnyResult) {
      logger.warn({ status: json.status }, "[skipTrace] PropertyAPI returned no contacts — trying PDL fallback");
      const pdlResult = await runSkipTracePDL(street, city, state, zip);
      if (pdlResult) return pdlResult;
      _lastSkipTraceError = { apiMessage: "No contact data found for this property owner" };
      return null;
    }

    const phones: SkipTracePhone[] = [];
    const emails: string[] = [];

    for (let i = 1; i <= 5; i++) {
      const number = item[`phone_${i}_number`];
      if (!number) continue;
      phones.push({
        number: String(number),
        type: item[`phone_${i}_type`] ? String(item[`phone_${i}_type`]) : undefined,
        isDisconnected: false,
      });
    }

    for (let i = 1; i <= 5; i++) {
      const email = item[`email_${i}`];
      if (email) emails.push(String(email));
    }

    const matchStatus = (item.name_first || item.name_last) ? "matched" : "unmatched";
    const creditsRemaining = json.credits_remaining ?? json.quote?.credit_balance_after;

    logger.info({ keyIndex, matchStatus, phones: phones.length, emails: emails.length, credits: creditsRemaining }, "[skipTrace] success");
    return { matchStatus, phones, emails, creditsRemaining };
  } catch (err) {
    logger.error({ err }, `[skipTrace] key#${keyIndex} fetch error`);
    _lastSkipTraceError = { apiMessage: String(err) };
    return null;
  }
}

// ─── Cooldown tracking (in-memory; resets on restart) ────────────────────────

interface LeadFetchRecord {
  count: number;
  firstAt: number;
  lastAt: number;
}

const leadFetchMap = new Map<number, LeadFetchRecord>();
const campaignFetchMap = new Map<number, number>(); // campaignId → lastFetchTimestamp

const LEAD_MAX_FETCHES   = 2;
const LEAD_COOLDOWN_MS   = 5 * 60 * 60 * 1000;   // 5 hours
const CAMPAIGN_COOLDOWN_MS = 10 * 60 * 1000;      // 10 minutes

export interface CooldownCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

export function checkCooldown(
  leadId: number,
  campaignId: number,
  isSuperAdmin: boolean,
): CooldownCheckResult {
  if (isSuperAdmin) return { allowed: true };

  const now = Date.now();

  // Campaign cooldown — 10 min between any lead fetch within same campaign
  const campLast = campaignFetchMap.get(campaignId);
  if (campLast != null) {
    const elapsed = now - campLast;
    if (elapsed < CAMPAIGN_COOLDOWN_MS) {
      const retryAfterMs = CAMPAIGN_COOLDOWN_MS - elapsed;
      return {
        allowed: false,
        reason: `Campaign cooldown: please wait ${Math.ceil(retryAfterMs / 60000)} more minute(s) before fetching another lead in this campaign.`,
        retryAfterMs,
      };
    }
  }

  // Per-lead: max 2 fetches, 5-hour cooldown between them
  const rec = leadFetchMap.get(leadId);
  if (rec) {
    if (rec.count >= LEAD_MAX_FETCHES) {
      const elapsed = now - rec.lastAt;
      if (elapsed < LEAD_COOLDOWN_MS) {
        const retryAfterMs = LEAD_COOLDOWN_MS - elapsed;
        const hours = Math.ceil(retryAfterMs / 3600000);
        return {
          allowed: false,
          reason: `This lead has already been fetched ${rec.count} times. Cooldown resets in ~${hours} hour(s).`,
          retryAfterMs,
        };
      }
      // Reset window after cooldown passes
      leadFetchMap.set(leadId, { count: 0, firstAt: now, lastAt: now });
    }

    const elapsed = now - rec.lastAt;
    if (rec.count >= 1 && elapsed < LEAD_COOLDOWN_MS) {
      const retryAfterMs = LEAD_COOLDOWN_MS - elapsed;
      const hours = Math.ceil(retryAfterMs / 3600000);
      return {
        allowed: false,
        reason: `Lead cooldown: wait ~${hours} hour(s) before fetching this lead again.`,
        retryAfterMs,
      };
    }
  }

  return { allowed: true };
}

export function recordFetch(leadId: number, campaignId: number) {
  const now = Date.now();
  const rec = leadFetchMap.get(leadId);
  if (rec) {
    leadFetchMap.set(leadId, { ...rec, count: rec.count + 1, lastAt: now });
  } else {
    leadFetchMap.set(leadId, { count: 1, firstAt: now, lastAt: now });
  }
  campaignFetchMap.set(campaignId, now);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PropertyApiData {
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  ownerName?: string | null;
  lotSqft?: number | null;
  hasPool?: boolean;
  hasGarage?: boolean;
  avm?: number | null;
  taxAssessedValue?: number | null;
  lastSalePrice?: number | null;
  lastSaleDate?: string | null;
  propertyType?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  creditsRemaining?: number;
  rawFields?: Record<string, any>;
  keyUsed?: number; // 1-based index of the key used
}

// ─── Fetched Comp (from radius search) ────────────────────────────────────────
export interface FetchedComp {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  salePrice: number;
  soldDate: string;
  propertyType?: string;
}

export interface FetchCompsResult {
  comps: FetchedComp[];
  totalInRadius: number;
  creditsUsed: number;
  error?: string;
}

/** Call search-by-address (1 credit per call, uses next key in rotation). Returns null on failure. */
export async function fetchPropertyData(address: string): Promise<PropertyApiData | null> {
  const apiKey = getNextApiKey();
  if (!apiKey) {
    console.warn("[propertyApi] No API keys configured — set PROPERTY_API_KEY or PROPERTY_API_KEY_1 … 5");
    return null;
  }
  const keyIndex = (_keyIndex === 0 ? loadApiKeys().length : _keyIndex); // 1-based index of key that was just used

  try {
    const url = `${BASE_URL}/parcels/search-by-address?address=${encodeURIComponent(address)}`;
    const resp = await fetch(url, {
      headers: { "X-Api-Key": apiKey },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      console.error(`[propertyApi] key#${keyIndex} HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return null;
    }
    const json = await resp.json() as { data?: Record<string, any>; credits_remaining?: number };
    const d = json.data || {};

    // Field names confirmed from live API response (propertyapi.co)
    const beds          = num(d["bedrooms"]          ?? d["Bedrooms"]);
    const baths         = num(d["bathrooms"]         ?? d["Bathrooms"]);
    // Prefer living_sqft (heated area) then square_feet then lot sqft fields
    const sqft          = num(d["living_sqft"]       ?? d["square_feet"]        ?? d["building_sqft"]);
    const yearBuilt     = num(d["year_built"]        ?? d["struct_year_built"]);
    // lot_size is in acres; convert to sqft
    const lotAcres      = num(d["lot_size"]);
    const lotSqft       = lotAcres != null ? Math.round(lotAcres * 43560)
                        : num(d["sqft_county_preferred"] ?? d["sqft_county"]);
    const hasPool       = false; // not in API response
    const hasGarage     = false; // not in API response
    // AVM: prefer market_estimate (model-derived), fallback to market_value
    const avm           = num(d["market_estimate"]   ?? d["market_value"]);
    const taxAssessed   = num(d["assessed_total"]    ?? d["tax_assessed_value"]);
    const lastSalePrice = num(d["last_sale_price"]);
    const lastSaleDateRaw = str(d["last_sale_date"]);
    const lastSaleDate = lastSaleDateRaw ? lastSaleDateRaw.split("T")[0] : null;
    const propertyType  = str(d["use_standardized_desc"] ?? d["property_type"]);
    const ownerName     = str(d["owner"]                 ?? d["owner_name"]);
    const latitude      = num(d["latitude"]);
    const longitude     = num(d["longitude"]);

    logger.info({ keyIndex, creditsRemaining: json.credits_remaining }, "[propertyApi] success");

    return {
      beds, baths, sqft, yearBuilt, ownerName, lotSqft, hasPool, hasGarage,
      avm, taxAssessedValue: taxAssessed, lastSalePrice, lastSaleDate, propertyType,
      latitude, longitude,
      creditsRemaining: json.credits_remaining,
      rawFields: d,
      keyUsed: keyIndex,
    };
  } catch (err) {
    logger.error({ err }, "[propertyApi] fetch error");
    return null;
  }
}

// ─── Adjustment Factor Constants ──────────────────────────────────────────────
export const ADJUSTMENT_FACTORS = {
  bedroom:   12500,
  bathroom:  7500,
  sqft:      50, // fallback only — callers should pass a market-derived rate when available
  yearBuilt: 150,
  pool:      15000,
  garage:    7500,
  lotSqft:   3,
};

/**
 * Annual appreciation rate used for time adjustments on comps.
 * 3% is a conservative, market-neutral default.
 * A comp that sold N months ago is adjusted upward by salePrice × (3%/year × N/12)
 * to reflect what it would sell for today in an appreciating market.
 */
export const ANNUAL_APPRECIATION_RATE = 0.03;

export interface SubjectProperty {
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  condition?: number | null;
}

export interface CompProperty {
  salePrice: number;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  /** ISO date string (YYYY-MM-DD) of when the comp sold — used for time adjustment */
  soldDate?: string | null;
}

/**
 * Calculate an adjusted comp price.
 * AdjustedComp = BaseCompValue
 *   + (BedroomDiff × $12,500)
 *   + (BathroomDiff × $7,500)
 *   + (SqftDiff × marketPricePerSqft)   ← derived from actual comps, not hardcoded
 *   + (YearBuiltDiff × $150)
 *   + TimeAdjustment (salePrice × ANNUAL_APPRECIATION_RATE × monthsAgo / 12)
 *
 * Diffs: subject - comp (positive means subject is "better" → add value).
 * Time adjustment accounts for market appreciation since the comp sold.
 *
 * @param marketPricePerSqft  Optional: median $/sqft derived from the actual comp set.
 *                            When omitted, falls back to ADJUSTMENT_FACTORS.sqft (50).
 */
export function calculateAdjustedComp(subject: SubjectProperty, comp: CompProperty, marketPricePerSqft?: number): number {
  let adjusted = comp.salePrice;
  const sqftRate = marketPricePerSqft ?? ADJUSTMENT_FACTORS.sqft;
  if (subject.beds      != null && comp.beds      != null) adjusted += (subject.beds      - comp.beds)      * ADJUSTMENT_FACTORS.bedroom;
  if (subject.baths     != null && comp.baths     != null) adjusted += (subject.baths     - comp.baths)     * ADJUSTMENT_FACTORS.bathroom;
  if (subject.sqft      != null && comp.sqft      != null) adjusted += (subject.sqft      - comp.sqft)      * sqftRate;
  if (subject.yearBuilt != null && comp.yearBuilt != null) adjusted += (subject.yearBuilt - comp.yearBuilt) * ADJUSTMENT_FACTORS.yearBuilt;

  // Time adjustment: older comps are adjusted upward to reflect today's market value
  if (comp.soldDate) {
    const soldMs = new Date(comp.soldDate).getTime();
    if (!isNaN(soldMs)) {
      const monthsAgo = (Date.now() - soldMs) / (1000 * 60 * 60 * 24 * 30.5);
      const timeAdj = comp.salePrice * ANNUAL_APPRECIATION_RATE * (monthsAgo / 12);
      adjusted += timeAdj;
    }
  }

  return Math.max(0, Math.round(adjusted));
}

/**
 * Derive ARV from adjusted comp prices.
 * Uses average; if >3 comps drops highest/lowest outliers first.
 */
export function calculateArvFromComps(adjustedPrices: number[]): number | null {
  if (adjustedPrices.length === 0) return null;
  let prices = [...adjustedPrices].sort((a, b) => a - b);
  if (prices.length > 3) prices = prices.slice(1, prices.length - 1);
  return Math.round(prices.reduce((s, v) => s + v, 0) / prices.length);
}

/**
 * Query the AI for the current estimated median resale price-per-sqft for a market.
 * Used as a fallback when comp data is insufficient to derive it directly.
 * Returns a rounded integer $/sqft or null if the AI call fails.
 */
export async function estimateMarketPricePerSqft(
  city: string,
  state: string,
  zip?: string,
): Promise<number | null> {
  const aiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const aiApiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!aiBaseUrl || !aiApiKey) {
    logger.warn("[propertyApi] AI not configured — cannot estimate market $/sqft");
    return null;
  }

  const location = [city, state, zip].filter(Boolean).join(", ");
  const prompt =
    `What is the current estimated median resale price per square foot ($/sqft) for ` +
    `single-family residential homes in ${location}? ` +
    `Reply ONLY with a JSON object: { "pricePerSqft": <number> }. No explanation.`;

  try {
    const aiRes = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${aiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "llama-3.1-70b-versatile",
        max_tokens: 128,
        messages: [
          { role: "system", content: "You are a real estate market data expert. Answer only with valid JSON." },
          { role: "user",   content: prompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      logger.error({ status: aiRes.status, location }, "[propertyApi] AI market $/sqft call failed");
      return null;
    }

    const json = await aiRes.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content);
    const rate = Number(parsed?.pricePerSqft);
    if (rate > 0 && rate < 10000) {
      logger.info({ location, rate }, "[propertyApi] AI-derived market $/sqft");
      return Math.round(rate);
    }
    logger.warn({ location, parsed }, "[propertyApi] AI returned implausible $/sqft value");
    return null;
  } catch (err) {
    logger.error({ err, location }, "[propertyApi] AI market $/sqft estimate threw");
    return null;
  }
}

// ─── Radius Comp Fetch ────────────────────────────────────────────────────────

const MAX_RADIUS_PARCELS = 100; // max parcels to export (1 credit each)
const SALE_LOOKBACK_MONTHS = 24;

/** ISO date string N months ago — used to filter to recently-sold parcels only. */
function saleDateFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - SALE_LOOKBACK_MONTHS);
  return d.toISOString().split("T")[0]!;
}

/** Count parcels in radius with date filter. Returns { count, exportToken } or throws. */
async function countParcels(
  apiKey: string,
  lat: number,
  lng: number,
  radiusMiles: number,
): Promise<{ count: number; exportToken: string }> {
  const query: Record<string, any> = {
    latitude: lat,
    longitude: lng,
    radius_miles: radiusMiles,
    last_sale_date_from: saleDateFrom(), // only parcels sold within last 24 months
  };
  const resp = await fetch(`${BASE_URL}/parcels/count`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`count failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  const json = await resp.json() as any;
  return {
    count: json.data?.count ?? 0,
    exportToken: json.data?.export_token ?? "",
  };
}

// ─── Async comps job types ────────────────────────────────────────────────────

export interface StartCompsResult {
  exportToken: string;
  count: number;
  actualRadius: number;
  apiKey: string;
  error?: string;
}

export interface PollCompsResult {
  status: "running" | "completed" | "failed";
  downloadUrl?: string;
}

/**
 * Step 1+2: Count parcels (FREE) with auto-radius shrink, then kick off export.
 * Returns immediately — does NOT poll or download.
 * Caller must poll with pollCompsExport() until completed, then call downloadComps().
 */
export async function startCompsExport(
  lat: number,
  lng: number,
  radiusMiles: number,
): Promise<StartCompsResult> {
  const apiKey = getNextApiKey();
  if (!apiKey) {
    return { exportToken: "", count: 0, actualRadius: radiusMiles, apiKey: "", error: "No PropertyAPI keys configured" };
  }

  // ── Step 1: Count (FREE) — try requested radius, auto-shrink if needed ────
  const radiiToTry = [radiusMiles];
  if (radiusMiles > 0.15) radiiToTry.push(0.15);
  if (radiusMiles > 0.1)  radiiToTry.push(0.1);
  if (radiusMiles > 0.05) radiiToTry.push(0.05);

  let count = 0;
  let exportToken = "";
  let actualRadius = radiusMiles;

  for (const r of radiiToTry) {
    logger.info({ lat, lng, radius: r, dateFrom: saleDateFrom() }, "[comps] counting (FREE)");
    try {
      const result = await countParcels(apiKey, lat, lng, r);
      count = result.count;
      exportToken = result.exportToken;
      actualRadius = r;
      logger.info({ radius: r, count }, "[comps] parcel count");
      if (count <= MAX_RADIUS_PARCELS) break;
    } catch (err: any) {
      logger.error({ err: err?.message }, "[comps] count step failed");
      return { exportToken: "", count: 0, actualRadius, apiKey, error: "Network error reaching PropertyAPI" };
    }
  }

  if (count === 0) {
    return { exportToken: "", count: 0, actualRadius, apiKey };
  }

  if (count > MAX_RADIUS_PARCELS) {
    return {
      exportToken: "",
      count,
      actualRadius,
      apiKey,
      error: `Too many parcels in this area (${count} within ${actualRadius} mi). Use "Add Comp → Auto-Fill" to look up individual addresses instead.`,
    };
  }

  if (!exportToken) {
    return { exportToken: "", count, actualRadius, apiKey, error: "No export token returned from PropertyAPI" };
  }

  // ── Step 2: Start export (charges credits) — returns immediately ──────────
  logger.info({ count, exportToken }, "[comps] starting export job (charges credits)");
  const exportResp = await fetch(`${BASE_URL}/parcels/export`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ export_token: exportToken }),
  });

  if (!exportResp.ok) {
    const body = await exportResp.text().catch(() => "");
    logger.error({ status: exportResp.status, body: body.slice(0, 300) }, "[comps] export start failed");

    // 402 = this key is exhausted — mark it depleted and retry with next key
    if (exportResp.status === 402) {
      markKeyDepleted(apiKey);
      const nextKey = getNextApiKey();
      if (nextKey && nextKey !== apiKey) {
        logger.info({ key: nextKey.slice(0, 8) + "…" }, "[comps] retrying export with next key");
        const retryResp = await fetch(`${BASE_URL}/parcels/export`, {
          method: "POST",
          headers: { "X-Api-Key": nextKey, "Content-Type": "application/json" },
          body: JSON.stringify({ export_token: exportToken }),
        });
        if (retryResp.ok) {
          return { exportToken, count, actualRadius, apiKey: nextKey };
        }
        if (retryResp.status === 402) markKeyDepleted(nextKey);
        const retryBody = await retryResp.text().catch(() => "");
        logger.error({ status: retryResp.status, body: retryBody.slice(0, 200) }, "[comps] retry export also failed");
      }
      return { exportToken: "", count, actualRadius, apiKey, error: "All PropertyAPI credits exhausted. Keys will reset at the start of next month." };
    }

    return { exportToken: "", count, actualRadius, apiKey, error: `Export failed (${exportResp.status})` };
  }

  return { exportToken, count, actualRadius, apiKey };
}

/**
 * Step 3: Poll the export job status ONCE.
 * Call this repeatedly (e.g. every 2s) until status === "completed" or "failed".
 */
export async function pollCompsExport(
  apiKey: string,
  exportToken: string,
): Promise<PollCompsResult> {
  try {
    const resp = await fetch(`${BASE_URL}/parcels/export/${exportToken}`, {
      headers: { "X-Api-Key": apiKey },
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "[comps] poll non-200");
      return { status: "running" }; // treat as still running
    }
    const json = await resp.json() as any;
    const status = json.data?.jobStatus ?? json.data?.job_status ?? "";
    const downloadUrl = json.data?.downloadUrl ?? json.data?.download_url ?? "";
    logger.info({ status, downloadUrl }, "[comps] poll result");
    if (status === "completed" && downloadUrl) return { status: "completed", downloadUrl };
    if (status === "failed") return { status: "failed" };
    return { status: "running" };
  } catch (err) {
    logger.warn({ err }, "[comps] poll error");
    return { status: "running" };
  }
}

/**
 * Step 4: Download the completed CSV export and parse into comps.
 * Returns at most 8 comps sorted by most recent sale.
 */
export async function downloadComps(
  apiKey: string,
  downloadUrl: string,
): Promise<FetchedComp[]> {
  const OUTPUT_FIELDS = [
    "address", "city", "state", "zip",
    "bedrooms", "bathrooms", "square_feet", "year_built",
    "last_sale_price", "last_sale_date",
    "use_standardized_desc",
  ].join(",");

  const dlResp = await fetch(
    `${BASE_URL}/parcels/download?url=${encodeURIComponent(downloadUrl)}&output_fields=${OUTPUT_FIELDS}`,
    { headers: { "X-Api-Key": apiKey } },
  );

  if (!dlResp.ok) {
    const body = await dlResp.text().catch(() => "");
    logger.error({ status: dlResp.status, body: body.slice(0, 300) }, "[comps] download failed");
    throw new Error(`CSV download failed (${dlResp.status})`);
  }

  const csvText = await dlResp.text();
  logger.info({ bytes: csvText.length }, "[comps] CSV downloaded");

  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]);
  const idx = (name: string) => headers.indexOf(name);

  const TWO_YEARS_AGO = new Date();
  TWO_YEARS_AGO.setFullYear(TWO_YEARS_AGO.getFullYear() - 2);

  const comps: FetchedComp[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvRow(lines[i]);
    const get = (name: string) => values[idx(name)] ?? "";

    const salePrice = parseFloat(get("last_sale_price").replace(/[^0-9.]/g, ""));
    if (!salePrice || salePrice <= 0) continue;

    const saleDateStr = get("last_sale_date").split("T")[0];
    if (!saleDateStr) continue;

    const saleDate = new Date(saleDateStr);
    if (isNaN(saleDate.getTime()) || saleDate < TWO_YEARS_AGO) continue;

    comps.push({
      address:      get("address"),
      city:         get("city")   || undefined,
      state:        get("state")  || undefined,
      zip:          get("zip")    || undefined,
      beds:         parseFloat(get("bedrooms"))  || undefined,
      baths:        parseFloat(get("bathrooms")) || undefined,
      sqft:         parseInt(get("square_feet")) || undefined,
      yearBuilt:    parseInt(get("year_built"))  || undefined,
      salePrice,
      soldDate:     saleDateStr,
      propertyType: get("use_standardized_desc") || undefined,
    });
  }

  comps.sort((a, b) => new Date(b.soldDate).getTime() - new Date(a.soldDate).getTime());
  return comps.slice(0, 8);
}

/**
 * @deprecated Use startCompsExport + pollCompsExport + downloadComps instead.
 * Kept for backward compatibility — wraps the new async flow synchronously.
 */
export async function fetchCompsFromRadius(
  lat: number,
  lng: number,
  radiusMiles: number,
): Promise<FetchCompsResult> {
  const started = await startCompsExport(lat, lng, radiusMiles);
  if (started.error || !started.exportToken) {
    return { comps: [], totalInRadius: started.count, creditsUsed: 0, error: started.error };
  }

  // ── Step 3+4: Poll until done (legacy blocking behaviour — use async flow instead) ─
  let downloadUrl = "";
  for (let attempt = 1; attempt <= 60; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await pollCompsExport(started.apiKey, started.exportToken);
    if (poll.status === "completed" && poll.downloadUrl) { downloadUrl = poll.downloadUrl; break; }
    if (poll.status === "failed") return { comps: [], totalInRadius: started.count, creditsUsed: started.count, error: "PropertyAPI export job failed" };
  }

  if (!downloadUrl) {
    return { comps: [], totalInRadius: started.count, creditsUsed: started.count, error: "Export timed out — try again shortly" };
  }

  const comps = await downloadComps(started.apiKey, downloadUrl);
  return { comps, totalInRadius: started.count, creditsUsed: started.count };
}

/**
 * @deprecated — legacy blocking implementation kept for reference.
 */
async function _fetchCompsFromRadiusOld(
  lat: number,
  lng: number,
  radiusMiles: number,
): Promise<FetchCompsResult> {
  const apiKey = getNextApiKey();
  if (!apiKey) {
    return { comps: [], totalInRadius: 0, creditsUsed: 0, error: "No PropertyAPI keys configured" };
  }

  const radiiToTry = [radiusMiles];
  if (radiusMiles > 0.15) radiiToTry.push(0.15);
  if (radiusMiles > 0.1)  radiiToTry.push(0.1);
  if (radiusMiles > 0.05) radiiToTry.push(0.05);

  let count = 0;
  let exportToken = "";
  let actualRadius = radiusMiles;

  for (const r of radiiToTry) {
    try {
      const result = await countParcels(apiKey, lat, lng, r);
      count = result.count; exportToken = result.exportToken; actualRadius = r;
      if (count <= MAX_RADIUS_PARCELS) break;
    } catch { return { comps: [], totalInRadius: 0, creditsUsed: 0, error: "Network error" }; }
  }

  if (count === 0) return { comps: [], totalInRadius: 0, creditsUsed: 0 };
  if (count > MAX_RADIUS_PARCELS || !exportToken) {
    return { comps: [], totalInRadius: count, creditsUsed: 0, error: `Too many parcels (${count} within ${actualRadius} mi)` };
  }

  const exportResp = await fetch(`${BASE_URL}/parcels/export`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ export_token: exportToken }),
  });
  if (!exportResp.ok) return { comps: [], totalInRadius: count, creditsUsed: 0, error: "Export start failed" };

  let downloadUrl = "";
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const poll = await pollCompsExport(apiKey, exportToken);
    if (poll.status === "completed" && poll.downloadUrl) { downloadUrl = poll.downloadUrl; break; }
    if (poll.status === "failed") return { comps: [], totalInRadius: count, creditsUsed: count, error: "Export job failed" };
  }
  if (!downloadUrl) return { comps: [], totalInRadius: count, creditsUsed: count, error: "Export timed out" };

  const comps = await downloadComps(apiKey, downloadUrl).catch(() => []);
  return { comps, totalInRadius: count, creditsUsed: count };
}


/** Parse one CSV row, handling double-quoted fields with embedded commas. */
function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === "," && !inQuote) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function num(v: any): number | null {
  if (v === null || v === undefined || v === "" || v === false) return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}
function bool(v: any): boolean {
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
}
function str(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

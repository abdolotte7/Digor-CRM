import { logger } from "../lib/logger";

const ATTOM_BASE = "https://api.gateway.attomdata.com";

function loadAttomKeys(): string[] {
  const keys: string[] = [];
  const k1 = process.env.ATTOM_API_KEY?.trim();
  if (k1) keys.push(k1);
  const k2 = process.env.ATTOM_API_KEY_2?.trim();
  if (k2 && k2 !== k1) keys.push(k2);
  return keys;
}

let _attomKeyIndex = 0;
const _depletedAttomKeys = new Set<string>();

export function hasAttomKey(): boolean {
  return loadAttomKeys().length > 0;
}

function getNextAttomKey(): string | null {
  const keys = loadAttomKeys();
  if (!keys.length) return null;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[_attomKeyIndex % keys.length]!;
    _attomKeyIndex = (_attomKeyIndex + 1) % keys.length;
    if (!_depletedAttomKeys.has(key)) return key;
  }
  return null;
}

export async function attomGet(path: string, params: Record<string, string | number>): Promise<any> {
  const keys = loadAttomKeys();
  if (!keys.length) throw new Error("ATTOM_API_KEY not configured");

  let lastError = "";
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = getNextAttomKey();
    if (!key) break;

    const url = new URL(`${ATTOM_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    try {
      const res = await fetch(url.toString(), {
        headers: { "apikey": key, "accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 401 || res.status === 403) {
        _depletedAttomKeys.add(key);
        lastError = `ATTOM ${res.status} (key unauthorized)`;
        logger.warn({ key: key.slice(0, 8) + "…", status: res.status }, "[ATTOM] key unauthorized — rotating to next");
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ATTOM ${res.status}: ${text.slice(0, 300)}`);
      }

      return await res.json();
    } catch (err: any) {
      if (err?.message?.startsWith("ATTOM")) throw err;
      lastError = err?.message || "Network error";
      logger.warn({ err: err?.message, attempt, path }, "[ATTOM] network error — retrying");
    }
  }

  throw new Error(lastError || "All ATTOM keys exhausted or unauthorized");
}

export interface AttomComp {
  address: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  salePrice: number;
  soldDate: string;
  propertyType?: string;
}

export async function geocodeViaAttom(
  street: string,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const address2 = [city, state, zip].filter(Boolean).join(" ");
    const data = await attomGet("/propertyapi/v1.0.0/property/snapshot", {
      address1: street,
      ...(address2 ? { address2 } : {}),
    });
    const prop = data?.property?.[0];
    const lat = parseFloat(prop?.location?.latitude ?? prop?.address?.latitude ?? "0");
    const lng = parseFloat(prop?.location?.longitude ?? prop?.address?.longitude ?? "0");
    if (lat && lng) return { lat, lng };
    return null;
  } catch (err) {
    logger.warn({ err }, "[ATTOM] geocodeViaAttom failed");
    return null;
  }
}

export async function fetchCompsViaAttom(
  lat: number,
  lng: number,
  radiusMiles: number,
  maxComps = 8,
  subjectSqft?: number | null,
  subjectPropertyType?: string | null,
): Promise<AttomComp[]> {
  const data = await attomGet("/propertyapi/v1.0.0/sale/snapshot", {
    latitude: lat,
    longitude: lng,
    radius: radiusMiles,
    pagesize: Math.min(maxComps * 4, 50),
  });

  const sales: any[] = data?.property || [];
  const TWO_YEARS_AGO = new Date();
  TWO_YEARS_AGO.setMonth(TWO_YEARS_AGO.getMonth() - 24);

  const comps: AttomComp[] = [];

  for (const sale of sales) {
    const salePrice = sale?.sale?.amount?.saleamt;
    if (!salePrice || salePrice <= 0) continue;

    const saleDateRaw = sale?.sale?.saleTransDate || sale?.sale?.salesearchdate;
    if (saleDateRaw) {
      const d = new Date(saleDateRaw);
      if (isNaN(d.getTime()) || d < TWO_YEARS_AGO) continue;
    }
// Skip multi-family / commercial when subject is a single-family home
const rawPropType = (sale?.summary?.proptype || "").toUpperCase();
const subjectIsSingleFamily = !subjectPropertyType ||
  ["single", "sfr", "residential"].some(t => subjectPropertyType.toLowerCase().includes(t));

if (subjectIsSingleFamily && rawPropType) {
  const INCOMPATIBLE = ["MULTI", "DUPLEX", "TRIPLEX", "QUADRUPLEX", "COMMERCIAL", "APARTMENT"];
  if (INCOMPATIBLE.some(m => rawPropType.includes(m))) continue;
}

// Skip comps where sqft is more than 75% bigger or 43% smaller than subject
// (ATTOM universalsize on a quadruplex = total building, not per-unit — this filters that out)
const compSqft: number | undefined = sale?.building?.size?.universalsize;
if (subjectSqft && compSqft) {
  const ratio = compSqft / subjectSqft;
  if (ratio > 1.75 || ratio < 0.57) continue;
}
    const addr 
      = sale?.address;
    const fullAddr = [addr?.line1, addr?.locality, addr?.countrySubd]
      .filter(Boolean).join(", ");

    const soldDate = saleDateRaw
      ? new Date(saleDateRaw).toISOString().split("T")[0]!
      : "";

    comps.push({
      address: fullAddr,
      beds: sale?.building?.rooms?.bedroomscount || undefined,
      baths: sale?.building?.rooms?.bathstotal || undefined,
      sqft: sale?.building?.size?.universalsize || undefined,
      yearBuilt: sale?.summary?.yearbuilt || undefined,
      salePrice,
      soldDate,
      propertyType: sale?.summary?.proptype || undefined,
    });

    if (comps.length >= maxComps) break;
  }

  return comps;
}

export async function fetchAttomAvm(
  street: string,
  cityStateZip: string,
): Promise<{ value: number; low: number; high: number; confidence: number } | null> {
  try {
    const data = await attomGet("/attomavm/detail", {
      address1: street,
      address2: cityStateZip,
    });
    const avm = data?.property?.[0]?.avm;
    if (!avm?.amount?.value) return null;
    return {
      value:      Math.round(avm.amount.value),
      low:        Math.round(avm.amount.low   ?? avm.amount.value),
      high:       Math.round(avm.amount.high  ?? avm.amount.value),
      confidence: avm.indicatorCode ?? 0,
    };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[ATTOM] fetchAttomAvm failed");
    return null;
  }
}
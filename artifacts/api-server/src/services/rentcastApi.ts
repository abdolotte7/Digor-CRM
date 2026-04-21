const RENTCAST_BASE = "https://api.rentcast.io/v1";

export async function getRentcastValuation(params: {
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  propertyType?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
}): Promise<{ price: number; low: number; high: number } | null> {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) return null;

  const fullAddress = [params.address, params.city, params.state, params.zip]
    .filter(Boolean).join(", ");

  const url = new URL(`${RENTCAST_BASE}/avm/value`);
  url.searchParams.set("address", fullAddress);
  if (params.propertyType) url.searchParams.set("propertyType", params.propertyType);
  if (params.beds != null)  url.searchParams.set("bedrooms", String(params.beds));
  if (params.baths != null) url.searchParams.set("bathrooms", String(params.baths));
  if (params.sqft != null)  url.searchParams.set("squareFootage", String(params.sqft));

  try {
    const res = await fetch(url.toString(), {
      headers: { "X-Api-Key": key, "accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (!data?.price) return null;
    return {
      price:  Math.round(data.price),
      low:    Math.round(data.priceRangeLow  ?? data.price * 0.9),
      high:   Math.round(data.priceRangeHigh ?? data.price * 1.1),
    };
  } catch {
    return null;
  }
}
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TrendPoint = { title: string; interest: number };

async function fromSerpAPI(q: string, geo?: string) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return { trends: [] as TrendPoint[], error: "SERPAPI_KEY manquant", status: 500 };
  }

  // ⚠️ SerpAPI attend 'date=today 12-m' (pas 'time=now 12-m')
  const params = new URLSearchParams({
    engine: "google_trends",
    q,
    data_type: "TIMESERIES",
    date: "today 12-m", // 12 derniers mois
    tz: "0",
    api_key: apiKey,
  });
  if (geo) params.set("geo", geo);

  const url = `https://serpapi.com/search.json?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text();
    return { trends: [], error: `SerpAPI ${res.status}: ${text}`, status: res.status };
  }

  const data = await res.json();

  // SerpAPI peut renvoyer 200 avec un champ 'error' dans le JSON
  if (data?.error) {
    return { trends: [], error: `SerpAPI: ${String(data.error)}`, status: 502 };
  }

  const raw: any[] = data?.interest_over_time?.timeline_data ?? [];
  if (!Array.isArray(raw) || raw.length === 0) {
    return { trends: [], error: "SerpAPI: timeline_data vide", status: 502 };
  }

  const points: TrendPoint[] = raw
    .map((item: any) => ({
      title: String(item?.date ?? item?.formattedAxisTime ?? item?.time ?? ""),
      interest: Number(item?.values?.[0]?.extracted_value ?? item?.values?.[0]?.value ?? 0),
    }))
    .slice(-52); // ~ 1 an

  return { trends: points, error: null as string | null, status: 200 };
}

async function fromGoogleTrends(q: string, geo?: string) {
  try {
    const mod = await import("google-trends-api");
    const googleTrends = (mod as any).default ?? (mod as any);

    const results = await googleTrends.interestOverTime({
      keyword: q,
      startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 12 mois
      granularTimeResolution: true,
      ...(geo ? { geo } : {}),
    });

    const parsed = JSON.parse(results);
    const timeline: any[] = parsed?.default?.timelineData ?? [];

    if (!Array.isArray(timeline) || timeline.length === 0) {
      return { trends: [] as TrendPoint[], error: "google-trends-api: timelineData vide", status: 502 };
    }

    const points: TrendPoint[] = timeline
      .map((t: any) => {
        const iso = new Date(Number(t.time) * 1000).toISOString().slice(0, 10);
        return { title: iso, interest: Number(t.value?.[0] ?? 0) };
      })
      .slice(-52);

    return { trends: points, error: null as string | null, status: 200 };
  } catch (e: any) {
    return { trends: [] as TrendPoint[], error: e?.message ?? "Erreur google-trends-api", status: 500 };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "artificial intelligence").trim();
  const geo = searchParams.get("geo") || undefined;
  const debug = searchParams.get("debug") === "1";

  // 1) Tente SerpAPI (avec le bon paramètre 'date')
  const a = await fromSerpAPI(q, geo);
  if (a.trends.length > 0) {
    const body: any = { trends: a.trends, source: "serpapi" };
    if (debug) body.debug = { serpapi: { count: a.trends.length, error: a.error } };
    return NextResponse.json(body, { status: 200 });
  }

  // 2) Fallback: google-trends-api
  const b = await fromGoogleTrends(q, geo);
  if (b.trends.length > 0) {
    const body: any = { trends: b.trends, source: "google-trends-api" };
    if (debug) body.debug = { serpapi: { error: a.error }, gtrends: { count: b.trends.length, error: b.error } };
    return NextResponse.json(body, { status: 200 });
  }

  // 3) Rien → on explique
  const msg = [a.error, b.error].filter(Boolean).join(" | ") || "Pas de données";
  const body: any = { trends: [], error: msg, source: "none" };
  if (debug) body.debug = { serpapi: { error: a.error }, gtrends: { error: b.error } };
  return NextResponse.json(body, { status: 502 });
}

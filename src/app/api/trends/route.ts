// app/api/trends/route.ts  (ou src/app/api/trends/route.ts)
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TrendPoint = { title: string; interest: number };

async function fromSerpAPI(q: string, geo?: string) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { trends: [] as TrendPoint[], error: "SERPAPI_KEY manquant" };

  const params = new URLSearchParams({
    engine: "google_trends",
    q,
    data_type: "TIMESERIES",
    time: "now 12-m", // 12 derniers mois
    tz: "0",
    api_key: apiKey,
  });
  if (geo) params.set("geo", geo);

  const url = `https://serpapi.com/search.json?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    return { trends: [] as TrendPoint[], error: `SerpAPI ${res.status}: ${text}` };
  }

  const data = await res.json();
  if (data?.error) return { trends: [] as TrendPoint[], error: String(data.error) };

  const raw: any[] = data?.interest_over_time?.timeline_data ?? [];
  if (!Array.isArray(raw) || raw.length === 0) {
    return { trends: [] as TrendPoint[], error: "SerpAPI: timeline_data vide" };
  }

  const points: TrendPoint[] = raw.map((item: any) => ({
    title: String(item?.date ?? item?.formattedAxisTime ?? item?.time ?? ""),
    interest: Number(item?.values?.[0]?.extracted_value ?? item?.values?.[0]?.value ?? 0),
  })).slice(-52);

  return { trends: points };
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
      return { trends: [] as TrendPoint[], error: "google-trends-api: timelineData vide" };
    }

    const points: TrendPoint[] = timeline.map((t: any) => {
      const iso = new Date(Number(t.time) * 1000).toISOString().slice(0, 10);
      return { title: iso, interest: Number(t.value?.[0] ?? 0) };
    }).slice(-52);

    return { trends: points };
  } catch (e: any) {
    return { trends: [] as TrendPoint[], error: e?.message ?? "Erreur google-trends-api" };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "artificial intelligence").trim();
  const geo = searchParams.get("geo") || undefined;

  // 1) Tente SerpAPI
  const a = await fromSerpAPI(q, geo);
  if (a.trends.length > 0) {
    return NextResponse.json({ trends: a.trends, source: "serpapi" }, { status: 200 });
  }

  // 2) Fallback: google-trends-api (gratuit)
  const b = await fromGoogleTrends(q, geo);
  if (b.trends.length > 0) {
    return NextResponse.json({ trends: b.trends, source: "google-trends-api" }, { status: 200 });
  }

  // 3) Rien → expliquer pourquoi
  const msg = [a.error, b.error].filter(Boolean).join(" | ");
  return NextResponse.json({ trends: [], error: msg || "Pas de données" }, { status: 502 });
}

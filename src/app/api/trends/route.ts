import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "artificial intelligence";
  const apiKey = process.env.SERPAPI_KEY;

  const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(
    q
  )}&data_type=TIMESERIES&api_key=${apiKey}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    // On transforme les données pour ton dashboard
    const trends = (data.interest_over_time?.timeline_data || []).map(
      (item: any) => ({
        title: item.date,
        interest: item.values[0].extracted_value,
      })
    );

    return NextResponse.json({ trends });
  } catch (err) {
    console.error("Erreur API SerpApi:", err);
    return NextResponse.json({ trends: [] });
  }
}

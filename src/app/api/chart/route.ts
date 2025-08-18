import { NextResponse } from "next/server";

type TrendPoint = { title: string; interest: number };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "trend";
  const points = searchParams.get("points");

  if (!points) {
    return NextResponse.json({ ok: false, error: "missing points" }, { status: 400 });
  }

  let data: TrendPoint[] = [];
  try {
    data = JSON.parse(points);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid points json" }, { status: 400 });
  }

  const chartConfig = {
    type: "line",
    data: {
      labels: data.map((p) => p.title),
      datasets: [
        {
          label: q,
          data: data.map((p) => p.interest),
          borderColor: "rgb(37, 99, 235)",
          backgroundColor: "rgba(37, 99, 235, 0.18)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  };

  const qcUrl =
    "https://quickchart.io/chart?c=" + encodeURIComponent(JSON.stringify(chartConfig));

  return NextResponse.json({ ok: true, url: qcUrl });
}

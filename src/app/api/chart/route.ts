import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "trend";
  const points = searchParams.get("points");

  if (!points) {
    return NextResponse.json({ ok: false, error: "missing points" }, { status: 400 });
  }

  const data: { title: string; interest: number }[] = JSON.parse(points);

  // On fabrique une URL QuickChart (chart.js derrière)
  const chartConfig = {
    type: "line",
    data: {
      labels: data.map((p) => p.title),
      datasets: [
        {
          label: q,
          data: data.map((p) => p.interest),
          borderColor: "rgb(37, 99, 235)",
          backgroundColor: "rgba(37, 99, 235, 0.2)",
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true },
      },
    },
  };

  const qcUrl =
    "https://quickchart.io/chart?c=" + encodeURIComponent(JSON.stringify(chartConfig));

  return NextResponse.json({ ok: true, url: qcUrl });
}

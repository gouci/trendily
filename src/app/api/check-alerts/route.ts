import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

type TrendPoint = { title: string; interest: number };

function pctWoW(points: TrendPoint[]): number | null {
  if (!points || points.length < 2) return null;
  const last = points[points.length - 1].interest;
  const prev = points[points.length - 2].interest;
  if (!prev) return null;
  return Math.round(((last - prev) / prev) * 100);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // --- sécurité ---
  const key = url.searchParams.get("key");
  if (key !== process.env.ALERT_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const force = url.searchParams.get("force") === "true";

  // --- clients ---
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, detectSessionInUrl: false } }
  );

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing RESEND_API_KEY" }, { status: 500 });
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || "Trendily <onboarding@resend.dev>";

  // --- lire abonnements ---
  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!alerts || alerts.length === 0) return NextResponse.json({ ok: true, sent: 0, forced: force, attempts: 0 });

  const byQuery = new Map<string, any[]>();
  for (const a of alerts) {
    const list = byQuery.get(a.query) ?? [];
    list.push(a);
    byQuery.set(a.query, list);
  }

  let sentCount = 0;
  let attempts = 0;
  const details: Array<{ id: string; email: string; query: string; pct: number | null; status: "sent" | "skipped" | "error"; error?: any }> = [];
  const now = Date.now();

  for (const [query, subs] of byQuery.entries()) {
    const res = await fetch(`${url.origin}/api/trends?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const json = await res.json();
    const points: TrendPoint[] = json?.trends ?? [];
    const pct = pctWoW(points);
    const lastInterest = points.at(-1)?.interest ?? null;

    if (pct == null && !force) {
      for (const sub of subs) details.push({ id: sub.id, email: sub.email, query, pct, status: "skipped" });
      continue;
    }

    for (const sub of subs) {
      const threshold = Number(sub.threshold ?? 10);
      const lastNotifiedAt = sub.last_notified_at ? new Date(sub.last_notified_at).getTime() : 0;
      const hoursSince = (now - lastNotifiedAt) / 36e5;

      const shouldSend = force || (pct != null && pct >= threshold && hoursSince >= 24);
      if (!shouldSend) {
        details.push({ id: sub.id, email: sub.email, query, pct: pct ?? null, status: "skipped" });
        continue;
      }

      attempts++;

      const to = sub.email;

      const subject = `ALERTE Trendily — “${query}” +${pct ?? 0}% cette semaine`;
      const html = `
        <div style="font-family:system-ui; line-height:1.55">
          <h2>🚀 Tendance en hausse : ${query}</h2>
          <p><strong>+${pct ?? 0}%</strong> vs semaine précédente. Indice d’intérêt actuel : <strong>${lastInterest ?? "?"}</strong>.</p>
          <p>Idées d’actions rapides :</p>
          <ul>
            <li>Vidéo/short “pourquoi maintenant”.</li>
            <li>Article pratique longue traîne.</li>
            <li>Mini outil / template en lead magnet.</li>
          </ul>
          <p style="margin-top:16px;color:#666">— Trendily</p>
        </div>`;

      try {
        const { error: sendErr } = await resend.emails.send({ from, to, subject, html });
        if (sendErr) {
          details.push({ id: sub.id, email: to, query, pct: pct ?? null, status: "error", error: sendErr });
          continue;
        }
        sentCount++;
        details.push({ id: sub.id, email: to, query, pct: pct ?? null, status: "sent" });

        await supabase.from("alerts").update({ last_notified_at: new Date().toISOString() }).eq("id", sub.id);

        await delay(300); // éviter la limite Resend
      } catch (e: any) {
        details.push({ id: sub.id, email: to, query, pct: pct ?? null, status: "error", error: e?.message ?? String(e) });
      }
    }
  }

  return NextResponse.json({ ok: true, forced: force, sent: sentCount, attempts, details });
}

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

/** Convertit "2025-08-10" => "2025-08-10" (YYYY-MM-DD) en s’assurant du format date */
function toISODate(d: string): string {
  // d vient déjà de l’API au format "YYYY-MM-DD", on le normalise quand même
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d; // au cas où, on renvoie tel quel
  return date.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // --- sécurité ---
  const key = url.searchParams.get("key");
  if (key !== process.env.ALERT_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const force = url.searchParams.get("force") === "true";

  // --- Supabase clients ---
  // Client “admin” (service role) pour écrire dans la table trends même si RLS activée.
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    // Si la SERVICE_ROLE_KEY n’est pas dispo, on retombe sur l’anon key pour ne pas crasher
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, detectSessionInUrl: false } }
  );

  // Client “anon” pour lecture “standard” (alerts)
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, detectSessionInUrl: false } }
  );

  // --- Resend ---
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing RESEND_API_KEY" }, { status: 500 });
  }
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || "Trendily <onboarding@resend.dev>";

  // --- lire abonnements ---
  const { data: alerts, error } = await supabaseAnon
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!alerts || alerts.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, forced: force, attempts: 0 });
  }

  // Regrouper par query (ta table alerts ne stocke pas encore le geo, on met GLOBAL par défaut)
  const byQuery = new Map<string, any[]>();
  for (const a of alerts) {
    const list = byQuery.get(a.query) ?? [];
    list.push(a);
    byQuery.set(a.query, list);
  }

  let sentCount = 0;
  let attempts = 0;
  const details: Array<{
    id: string;
    email: string;
    query: string;
    pct: number | null;
    status: "sent" | "skipped" | "error";
    error?: any;
  }> = [];
  const now = Date.now();

  for (const [query, subs] of byQuery.entries()) {
    // Récup data live (GLOBAL pour l’instant)
    const res = await fetch(`${url.origin}/api/trends?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const json = await res.json();
    const points: TrendPoint[] = json?.trends ?? [];
    const pct = pctWoW(points);
    const lastInterest = points.at(-1)?.interest ?? null;

    // --- Historisation : upsert dans public.trends ---
    // geo = "GLOBAL" par défaut (on ajoutera un champ geo aux alerts plus tard si besoin)
    const geo = "GLOBAL";
    if (points.length > 0) {
      try {
        const rows = points.map((p) => ({
          query,
          geo,
          week_start: toISODate(p.title), // "YYYY-MM-DD"
          interest: p.interest,
        }));
        // upsert par (query, geo, week_start)
        const { error: upsertErr } = await supabaseAdmin
          .from("trends")
          .upsert(rows, { onConflict: "query,geo,week_start" });
        if (upsertErr) {
          console.error("Upsert trends error:", upsertErr);
        }
      } catch (e) {
        console.error("Historisation trends échouée:", e);
      }
    }

    // --- Générer l’URL du graphe (pour l’email) ---
    let chartUrl: string | null = null;
    if (points.length > 0) {
      try {
        const chartRes = await fetch(
          `${url.origin}/api/chart?q=${encodeURIComponent(query)}&points=${encodeURIComponent(JSON.stringify(points))}`,
          { cache: "no-store" }
        );
        const chartJson = await chartRes.json();
        if (chartRes.ok && chartJson?.url) chartUrl = chartJson.url;
      } catch (e) {
        console.error("Erreur génération chart:", e);
      }
    }

    if (pct == null && !force) {
      for (const sub of subs) details.push({ id: sub.id, email: sub.email, query, pct, status: "skipped" });
      continue;
    }

    for (const sub of subs) {
      const threshold = Number(sub.threshold ?? 10);
      const lastNotifiedAt = sub.last_notified_at ? new Date(sub.last_notified_at).getTime() : 0;
      const hoursSince = (now - lastNotifiedAt) / 36e5;

      const shouldSend = force || (pct != null && pct >= threshold && hoursSince >= 24);

      // Mode test Resend : n’envoie que vers ton adresse
      const isResendTestMode = String(from).includes("@resend.dev");
      const allowedRecipient = process.env.RESEND_TEST_RECIPIENT || "guillaume.coulbaux@gmail.com";
      const to = sub.email;
      if (isResendTestMode && to !== allowedRecipient) {
        details.push({ id: sub.id, email: to, query, pct: pct ?? null, status: "skipped", error: "resend_test_mode_restriction" });
        continue;
      }

      if (!shouldSend) {
        details.push({ id: sub.id, email: to, query, pct: pct ?? null, status: "skipped" });
        continue;
      }

      attempts++;

      const subject = `ALERTE Trendily — “${query}” +${pct ?? 0}% cette semaine`;
      const html = `
        <div style="font-family:system-ui; line-height:1.55">
          <h2>🚀 Tendance en hausse : ${query}</h2>
          <p><strong>+${pct ?? 0}%</strong> vs semaine précédente. Indice d’intérêt actuel : <strong>${lastInterest ?? "?"}</strong>.</p>
          ${chartUrl ? `<p><img src="${chartUrl}" alt="Graphique d’évolution ${query}" style="max-width:100%;border-radius:10px"/></p>` : ""}
          <p>Idées d’actions rapides :</p>
          <ul>
            <li>Vidéo/short “pourquoi maintenant”.</li>
            <li>Article pratique longue traîne.</li>
            <li>Mini outil / template en lead magnet.</li>
          </ul>
          <p style="margin-top:16px;color:#666">— Trendily</p>
        </div>
      `.trim();

      try {
        const { error: sendErr } = await resend.emails.send({ from, to, subject, html });
        if (sendErr) {
          details.push({ id: sub.id, email: to, query, pct: pct ?? null, status: "error", error: sendErr });
          continue;
        }
        sentCount++;
        details.push({ id: sub.id, email: to, query, pct: pct ?? null, status: "sent" });

        await supabaseAnon.from("alerts").update({ last_notified_at: new Date().toISOString() }).eq("id", sub.id);

        // Resend limite à ~2 req/s
        await delay(600);
      } catch (e: any) {
        details.push({ id: sub.id, email: to, query, pct: pct ?? null, status: "error", error: e?.message ?? String(e) });
      }
    }
  }

  return NextResponse.json({ ok: true, forced: force, sent: sentCount, attempts, details });
}

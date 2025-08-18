"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/* --- AJOUT pour le graphe --- */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
/* --- FIN AJOUT --- */

type TrendPoint = { title: string; interest: number };
type AugPoint = TrendPoint & { delta: number | null; pct: number | null };
type AlertRow = { id: string; email: string; query: string; threshold: number; created_at: string };

const ALERT_PCT = 10;

export default function Dashboard() {
  // Supabase client
  const supabase = useMemo(
    () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, detectSessionInUrl: false } }
      ),
    []
  );

  // --------- Trends ----------
  const [data, setData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("artificial intelligence");
  const [geo, setGeo] = useState<string>("FR"); // AJOUT: pays pour requêtes
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/trends?q=${encodeURIComponent(q)}${geo ? `&geo=${geo}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        if (!abort) setData(json.trends ?? []);
      } catch (e: any) {
        if (!abort) setError(e?.message ?? "Erreur inconnue");
        if (!abort) setData([]);
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => { abort = true; };
  }, [q, geo]); // AJOUT: relance quand le pays change

  const latest: AugPoint[] = useMemo(() => {
    const points = [...data].slice(-12);
    return points.map((p, i) => {
      const prev = i > 0 ? points[i - 1].interest : null;
      const delta = prev == null ? null : p.interest - prev;
      const pct = prev && prev !== 0 ? Math.round((delta! / prev) * 100) : null;
      return { ...p, delta, pct };
    });
  }, [data]);

  const last = latest.at(-1) ?? null;
  const hasAlert = !!(last && last.pct != null && last.pct >= ALERT_PCT);

  // --------- Abonnements (alerts) ----------
  const [subEmail, setSubEmail] = useState("");
  const [threshold, setThreshold] = useState<number>(10);
  const [submitting, setSubmitting] = useState(false);
  const [subMsg, setSubMsg] = useState<string | null>(null);
  const [subs, setSubs] = useState<AlertRow[]>([]);
  const [subsLoading, setSubsLoading] = useState(true);

  async function loadSubs() {
    setSubsLoading(true);
    const { data, error } = await supabase
      .from("alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("Select alerts error:", error);
      setSubMsg(`Erreur chargement: ${error.message}`);
      setSubs([]);
    } else {
      setSubs((data as AlertRow[]) ?? []);
    }
    setSubsLoading(false);
  }

  useEffect(() => {
    loadSubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubMsg(null);
    try {
      const { data, error } = await supabase
        .from("alerts")
        .upsert(
          { email: subEmail, query: q, threshold },
          { onConflict: "email,query", ignoreDuplicates: true }
        )
        .select(); // <= renvoie la ligne insérée/ignorée

      if (error) {
        const msg = /duplicate key|conflict/i.test(error.message)
          ? "Tu es déjà abonné(e) à cette requête."
          : `Erreur : ${error.message}`;
        setSubMsg(msg);
      } else {
        // data peut être [] si ignoreDuplicates a agi (déjà présent)
        if (data && data.length > 0) {
          setSubMsg("Abonnement enregistré ✅");
        } else {
          setSubMsg("Déjà abonné à cette requête (aucune création).");
        }
        setSubEmail("");
        await loadSubs();
      }
    } catch (e: any) {
      setSubMsg(`Erreur inconnue: ${e?.message ?? "?"}`);
    } finally {
      setSubmitting(false);
    }
  };

  // --------- Insights ----------
  const makeInsights = () => {
    if (!last) return null;
    const pct = last.pct ?? 0;
    const interest = last.interest;
    const momentum = pct >= 30 ? "forte accélération" : pct >= 15 ? "accélération notable" : "remontée progressive";
    const contexte =
      `La requête “${q}” enregistre une ${momentum} cette semaine (+${pct}% vs semaine précédente, ` +
      `indice d’intérêt ${interest}). Ce signal indique une hausse de l’attention et une fenêtre d’opportunité à court terme.`;
    const opportunites = [
      "Contenu : vidéo YouTube/TikTok “pourquoi maintenant” + tuto rapide.",
      "SEO : guide pratique + mots-clés longue traîne.",
      "Lead magnet : mini outil / checklist / template pour capter des emails.",
      "Partenariats : collab rapide avec créateur/outil adjacent."
    ];
    const risques = [
      "Pic temporaire si l’actualité retombe.",
      "Concurrence rapide sur formats génériques.",
      "Rester sur un angle niche (cas d’usage précis)."
    ];
    const actions = [
      "24h : 1 post + 1 short (hook fort, bénéfice concret).",
      "72h : guide/minioutil gratuit → 50–200 emails.",
      "7 jours : tester une offre simple (atelier live, pack templates, mini-cours)."
    ];
    const fullText =
`[INSIGHT — ${q}]
Contexte: ${contexte}

Opportunités:
- ${opportunites.join("\n- ")}

Risques:
- ${risques.join("\n- ")}

Actions rapides:
- ${actions.join("\n- ")}`;
    return { contexte, opportunites, risques, actions, fullText };
  };

  const insights = hasAlert ? makeInsights() : null;

  const copyInsights = async () => {
    if (!insights) return;
    try {
      await navigator.clipboard.writeText(insights.fullText);
      alert("Insights copiés ✅");
    } catch {
      alert("Impossible de copier.");
    }
  };

  // --------- UI ----------
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem("q") as HTMLInputElement;
    setQ(input.value.trim() || "artificial intelligence");
  };

  return (
    <main className="min-h-screen bg-white px-6 py-12">
      <h1 className="mb-4 text-3xl font-bold">Dashboard — Trends</h1>

      <div className="mb-3 text-xs text-neutral-500">
        Supabase: {process.env.NEXT_PUBLIC_SUPABASE_URL}
      </div>

      {!loading && !error && (
        <div className={`mb-6 rounded-xl border p-4 ${hasAlert ? "border-green-300 bg-green-50 text-green-800" : "border-neutral-200 bg-neutral-50 text-neutral-700"}`}>
          {hasAlert ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="mr-2 rounded-md bg-green-600 px-2 py-1 text-xs font-bold text-white">ALERTE</span>
                <strong>{q}</strong> : +{last!.pct}% cette semaine vs la précédente.
              </div>
              <div className="text-xs">Intérêt actuel : <strong>{last!.interest}</strong></div>
            </div>
          ) : (
            <div className="text-sm">
              Pas d’alerte (&lt; {ALERT_PCT}% semaine/sur/semaine) sur <strong>{q}</strong> pour l’instant.
            </div>
          )}
        </div>
      )}

      {hasAlert && insights && (
        <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Insights actionnables</h2>
            <button onClick={copyInsights} className="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white">
              Copier
            </button>
          </div>
          <div className="space-y-4 text-sm leading-relaxed text-neutral-800">
            <div><h3 className="font-semibold">Contexte</h3><p className="mt-1">{insights.contexte}</p></div>
            <div><h3 className="font-semibold">Opportunités</h3><ul className="mt-1 list-disc pl-5">{insights.opportunites.map((o, i) => <li key={i}>{o}</li>)}</ul></div>
            <div><h3 className="font-semibold">Risques</h3><ul className="mt-1 list-disc pl-5">{insights.risques.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            <div><h3 className="font-semibold">Actions rapides (24h → 7j)</h3><ul className="mt-1 list-disc pl-5">{insights.actions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
          </div>
        </section>
      )}

      {/* Abonnement aux alertes */}
      <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold">S’abonner à l’alerte</h2>
        <p className="mt-1 text-sm text-neutral-600">Alerte email quand <strong>{q}</strong> dépasse ton seuil (% semaine vs semaine).</p>

        <form onSubmit={handleSubscribe} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            placeholder="ton@email.com"
            required
            value={subEmail}
            onChange={(e) => setSubEmail(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:ring-2 focus:ring-black"
          />
          <input
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:ring-2 focus:ring-black sm:w-40"
          />
          <button type="submit" disabled={submitting} className="rounded-xl bg-black px-5 py-3 font-medium text-white disabled:opacity-50 sm:w-auto">
            {submitting ? "Envoi..." : "S’abonner"}
          </button>
        </form>

        {subMsg && <p className={`mt-2 text-sm ${subMsg.startsWith("Erreur") ? "text-red-600" : "text-green-600"}`}>{subMsg}</p>}
      </section>

      {/* Mes abonnements (debug) */}
      <section className="mb-10 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Mes abonnements (debug)</h2>
        {subsLoading ? (
          <p className="mt-2 text-sm text-neutral-600">Chargement…</p>
        ) : subs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">Aucun abonnement pour le moment.</p>
        ) : (
          <pre className="mt-3 rounded-xl bg-neutral-100 p-4 text-sm">{JSON.stringify(subs, null, 2)}</pre>
        )}
      </section>

      {/* Recherche & liste des semaines */}
      <form onSubmit={handleSearch} className="mb-6 flex gap-3">
        <input
          name="q"
          defaultValue={q}
          placeholder='Ex: "ai for seo", "ai video editing", "ai agents e-commerce"'
          className="w-full max-w-xl rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:ring-2 focus:ring-black"
        />
        {/* Select pays (optionnel) */}
        <select
          value={geo}
          onChange={(e) => setGeo(e.target.value)}
          className="rounded-xl border border-neutral-300 px-3 py-3 outline-none focus:ring-2 focus:ring-black"
          title="Pays"
        >
          <option value="">Global</option>
          <option value="FR">France</option>
          <option value="US">USA</option>
          <option value="GB">UK</option>
          <option value="DE">Allemagne</option>
        </select>

        <button className="rounded-xl bg-black px-5 py-3 font-medium text-white">Rechercher</button>
      </form>

      {/* --- AJOUT : Graphique sur les 12 dernières semaines --- */}
      {!loading && !error && latest.length > 0 && (
        <section className="mb-8 rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-semibold">Évolution — {q} ({geo || "Global"})</h2>
          <div className="w-full" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latest}>
                <CartesianGrid strokeDasharray="4 4" />
                <XAxis dataKey="title" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: any, name: any) => {
                    if (name === "interest") return [value, "Intérêt"];
                    if (name === "pct") return [`${value}%`, "Évolution vs-1"];
                    return [value, name];
                  }}
                  labelFormatter={(label) => `Semaine: ${label}`}
                />
                <Line type="monotone" dataKey="interest" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
      {/* --- FIN AJOUT --- */}

      {loading && <p>Chargement des tendances…</p>}
      {error && <p className="text-red-600">Erreur : {error}</p>}

      {!loading && !error && latest.length === 0 && <p>Aucune donnée pour cette requête.</p>}

      {!loading && !error && latest.length > 0 && (
        <div className="space-y-3">
          {latest.map((p, i) => {
            const isAlert = p.pct != null && p.pct >= ALERT_PCT;
            return (
              <div key={`${p.title}-${i}`} className="flex items-center justify-between rounded-xl border border-neutral-200 p-4">
                <div>
                  <div className="text-sm text-neutral-500">{p.title}</div>
                  <div className="text-lg font-semibold">Intérêt : {p.interest}</div>
                </div>
                <div className="flex items-center gap-3">
                  {isAlert && <span className="rounded-md bg-green-600 px-2 py-1 text-xs font-bold text-white">ALERTE</span>}
                  {p.pct == null ? (
                    <span className="text-neutral-500">—</span>
                  ) : (
                    <span className={`font-bold ${p.pct >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {p.pct >= 0 ? "+" : ""}{p.pct}% vs semaine préc.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

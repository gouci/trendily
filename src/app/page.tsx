"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type UserRow = { id: string; email: string; plan: string | null };

export default function Home() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [rows, setRows] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Charger les inscriptions existantes
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("users")
        .select("*")
        .order("id", { ascending: false });
      setRows((data as UserRow[]) || []);
      setLoading(false);
    })();
  }, []);

  // Gestion formulaire
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const { error } = await supabase
      .from("users")
      .insert({ email, plan: "free" });
    if (error) {
      setMessage(`Erreur : ${error.message}`);
    } else {
      setMessage("Inscription réussie ✅");
      setEmail("");
      const { data } = await supabase
        .from("users")
        .select("*")
        .order("id", { ascending: false });
      setRows((data as UserRow[]) || []);
    }
    setSubmitting(false);
  };

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Trendily — Reste en avance sur les tendances IA
        </h1>
        <p className="mt-4 text-lg text-neutral-600">
          Recevez des alertes sur les tendances IA de niche avant qu’elles ne deviennent
          mainstream. Idéal pour marketeurs, créateurs de contenu et entrepreneurs.
        </p>

        <a
          href="/dashboard"
          className="mt-6 inline-block rounded-xl bg-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-300"
        >
          Voir le Dashboard
        </a>


        {/* Formulaire */}
        <form
          onSubmit={handleSubmit}
          className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
        >
          <input
            type="email"
            placeholder="Votre email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full max-w-xs rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:ring-2 focus:ring-black"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full max-w-xs rounded-xl bg-black px-5 py-3 font-medium text-white disabled:opacity-50 sm:w-auto"
          >
            {submitting ? "Envoi..." : "Essai gratuit"}
          </button>
        </form>

        {message && (
          <p
            className={`mt-3 ${
              message.includes("Erreur") ? "text-red-600" : "text-green-600"
            }`}
          >
            {message}
          </p>
        )}
      </section>

      {/* Pricing */}
      <section className="bg-neutral-50 py-16">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-3xl font-bold">Plans & Tarifs</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {/* Free */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center">
              <h3 className="text-xl font-semibold">Free</h3>
              <p className="mt-2 text-neutral-600">1 niche, 5 alertes/mois</p>
              <p className="mt-4 text-3xl font-bold">0€</p>
            </div>

            {/* Pro */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center">
              <h3 className="text-xl font-semibold">Pro</h3>
              <p className="mt-2 text-neutral-600">
                3 niches, 20 alertes/mois, insights détaillés
              </p>
              <p className="mt-4 text-3xl font-bold">19€/mois</p>
            </div>

            {/* Premium */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center">
              <h3 className="text-xl font-semibold">Premium</h3>
              <p className="mt-2 text-neutral-600">
                5 niches, 50 alertes/mois, export PDF, support prioritaire
              </p>
              <p className="mt-4 text-3xl font-bold">49€/mois</p>
            </div>
          </div>
        </div>
      </section>

      {/* Debug inscriptions */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="mb-3 text-lg font-semibold">Inscriptions (debug)</h2>
        {loading ? (
          <p>Chargement...</p>
        ) : rows.length === 0 ? (
          <p>Aucune inscription.</p>
        ) : (
          <pre className="rounded-xl bg-neutral-100 p-4 text-sm">
            {JSON.stringify(rows, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}

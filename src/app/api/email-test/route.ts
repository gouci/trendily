import { NextResponse } from "next/server";
import { Resend } from "resend";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const to = searchParams.get("to");
  if (!to) return NextResponse.json({ ok: false, error: "Missing ?to=" }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing RESEND_API_KEY" }, { status: 500 });

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      // 🔒 on force l'adresse de test Resend
      from: "Trendily <onboarding@resend.dev>",
      // 🔒 et on envoie UNIQUEMENT vers ton adresse de compte Resend
      to,
      subject: "Test Trendily ✅",
      html: `<div style="font-family:system-ui">
        <h2>Trendily — Test d’envoi</h2>
        <p>Si tu reçois cet email, la configuration fonctionne.</p>
      </div>`,
    });

    if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown" }, { status: 500 });
  }
}

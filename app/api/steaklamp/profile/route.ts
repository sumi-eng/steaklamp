import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET() {
  const session = await auth();
  const user = session?.user;

  if (!user?.provider || !user?.providerAccountId) {
    return json({ ok: false, error: "not_authenticated" }, 401);
  }

  const { data, error } = await supabaseAdmin
    .from("steaklamp_guest_profiles")
    .select("name, phone, email")
    .eq("provider", user.provider)
    .eq("provider_account_id", user.providerAccountId)
    .maybeSingle();

  if (error) {
    return json({ ok: false, error: "profile_load_failed", detail: error.message }, 500);
  }

  return json({
    ok: true,
    profile: {
      name: data?.name ?? user.name ?? null,
      phone: data?.phone ?? null,
      email: data?.email ?? user.email ?? null,
    },
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  const user = session?.user;

  if (!user?.provider || !user?.providerAccountId) {
    return json({ ok: false, error: "not_authenticated" }, 401);
  }

  const body = await req.json().catch(() => ({}));

  const name = body.name ? String(body.name).trim() : null;
  const phone = body.phone ? String(body.phone).trim() : null;
  const email = body.email ? String(body.email).trim() : null;

  const { error } = await supabaseAdmin
    .from("steaklamp_guest_profiles")
    .upsert(
      {
        provider: user.provider,
        provider_account_id: user.providerAccountId,
        name,
        phone,
        email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,provider_account_id" }
    );

  if (error) {
    return json({ ok: false, error: "profile_save_failed", detail: error.message }, 500);
  }

  return json({ ok: true });
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

async function getStore() {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("code", "steaklamp")
    .single();

  if (error || !data) throw new Error(error?.message ?? "store_not_found");
  return data;
}

export async function GET() {
  try {
    const store = await getStore();

    const { data, error } = await supabaseAdmin
      .from("store_closures")
      .select("id, closed_on, reason, created_at")
      .eq("store_id", store.id)
      .order("closed_on", { ascending: true });

    if (error) throw error;

    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "unknown_error" },
      500
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const closedOn = String(body.closed_on ?? "").trim();
    const reason = String(body.reason ?? "臨時休業").trim();

    if (!closedOn) {
      return json({ ok: false, error: "closed_on_required" }, 400);
    }

    const store = await getStore();

    const { data, error } = await supabaseAdmin
      .from("store_closures")
      .upsert(
        {
          store_id: store.id,
          closed_on: closedOn,
          reason: reason || "臨時休業",
        },
        { onConflict: "store_id,closed_on" }
      )
      .select("id, closed_on, reason, created_at")
      .single();

    if (error) throw error;

    return json({ ok: true, item: data });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "unknown_error" },
      500
    );
  }
}

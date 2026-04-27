import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const id = String(body.id ?? "").trim();
    const name = String(body.name ?? "").trim();
    const phone = body.phone ? String(body.phone).trim() : null;
    const email = body.email ? String(body.email).trim() : null;
    const persons = Number(body.persons ?? 0);
    const startAtRaw = String(body.startAt ?? "");
    const durationMinutes = Number(body.durationMinutes ?? 120);
    const notes = body.notes ? String(body.notes) : null;
const seatId = String(body.seatId ?? "").trim();
if (!seatId) return json({ ok: false, error: "seat_required" }, 400);


    if (!id) return json({ ok: false, error: "id_required" }, 400);
    if (!name) return json({ ok: false, error: "name_required" }, 400);
    if (!persons) return json({ ok: false, error: "persons_required" }, 400);
    if (!startAtRaw) return json({ ok: false, error: "start_at_required" }, 400);

    const startAt = new Date(startAtRaw);
    if (Number.isNaN(startAt.getTime())) {
      return json({ ok: false, error: "invalid_start_at" }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from("reservations")
      .update({
        name,
seat_id: seatId,

        phone,
        email,
        persons,
        start_at: startAt.toISOString(),
        duration_minutes: durationMinutes,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return json({ ok: false, error: "update_failed", detail: error.message }, 500);
    }

    return json({ ok: true, reservation: data });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "unexpected_error",
        detail: e instanceof Error ? e.message : "unknown_error",
      },
      500
    );
  }
}

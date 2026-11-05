import { NextResponse } from "next/server";
import { requireAdmin } from "@/steaklamp/lib/adminAuth";
import { supabaseAdmin } from "@/steaklamp/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin("closures/[id] DELETE");
  if (denied) return denied;

  try {
    const { id } = await params;

    const { error } = await supabaseAdmin
      .from("store_closures")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown_error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { importHotpepperReservationFromText } from "@/steaklamp/lib/inbound/hotpepper-import";

export const runtime = "nodejs";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const rawText = String(body.rawText ?? "");
    const messageId = body.messageId ?? null;

    if (!rawText) {
      return json(
        { ok: false, error: "rawText_required" },
        400
      );
    }

    const result = await importHotpepperReservationFromText({
      rawText,
      messageId,
    });

    return json(result);
  } catch (e) {
    console.error("hotpepper inbound error", e);

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

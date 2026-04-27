import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { importHotpepperReservationFromText } from "@/steaklamp/lib/inbound/hotpepper-import";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "RESEND_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const resend = new Resend(apiKey);
    const event = await req.json().catch(() => ({} as any));

    console.log("STEAKLAMP_RESEND_INBOUND_EVENT =", JSON.stringify(event));

    if (event?.type !== "email.received") {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "not_email_received",
      });
    }

    const emailId =
      event?.data?.email_id ??
      event?.data?.id ??
      event?.email_id ??
      event?.id;

    if (!emailId) {
      return NextResponse.json(
        { ok: false, error: "email_id not found in webhook payload" },
        { status: 400 }
      );
    }

    const { data: receivedEmail, error: receivedError } =
      await resend.emails.receiving.get(String(emailId));

    if (receivedError) {
      console.error("STEAKLAMP_RESEND_RECEIVED_GET_ERROR =", receivedError);
      return NextResponse.json(
        { ok: false, error: receivedError.message },
        { status: 500 }
      );
    }

    console.log("STEAKLAMP_RECEIVED_EMAIL =", JSON.stringify(receivedEmail, null, 2));
const toText = JSON.stringify((receivedEmail as any)?.to ?? "").toLowerCase();

if (!toText.includes("hp-steak@phecoreer.resend.app")) {
  console.log("STEAKLAMP_RESEND_IGNORE_TO =", toText);

  return NextResponse.json({
    ok: true,
    ignored: true,
    reason: "not_steak_mail",
    to: (receivedEmail as any)?.to ?? null,
  });
}


    const textBody = String(
      receivedEmail?.text || receivedEmail?.html || ""
    ).trim();

    console.log("STEAKLAMP_TEXT_BODY_HEAD =", textBody.slice(0, 1000));

    if (!textBody) {
      console.warn("STEAKLAMP_RESEND_RECEIVED_EMPTY_BODY =", emailId);
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "empty_email_body",
      });
    }

    const result = await importHotpepperReservationFromText({
      rawText: textBody,
      messageId:
        (receivedEmail as any)?.headers?.["message-id"] ??
        (receivedEmail as any)?.messageId ??
        null,
    });

    console.log("STEAKLAMP_HOTPEPPER_IMPORT_RESULT =", JSON.stringify(result, null, 2));

    return NextResponse.json({
      ok: true,
      emailId,
      result,
    });
  } catch (e: any) {
    console.error("STEAKLAMP_RESEND_INBOUND_FATAL =", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

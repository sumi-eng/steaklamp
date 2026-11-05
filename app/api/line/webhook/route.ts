import { NextResponse } from "next/server";
import {
  gateWebhook,
  parseJsonBody,
  verifyLineSignature,
} from "@/steaklamp/lib/webhookVerify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 署名の検証（Messaging API の Channel secret）。本文は検証のため、パース前の文字列のまま取得する
  const rawBody = await req.text();
  const rejected = gateWebhook(
    "line/webhook",
    verifyLineSignature(
      rawBody,
      req.headers.get("x-line-signature"),
      process.env.LINE_CHANNEL_SECRET
    )
  );
  if (rejected) return rejected;

  const body = parseJsonBody(rawBody);

  console.log("LINE WEBHOOK:", JSON.stringify(body, null, 2));

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();

  console.log("LINE WEBHOOK:", JSON.stringify(body, null, 2));

  return NextResponse.json({ ok: true });
}

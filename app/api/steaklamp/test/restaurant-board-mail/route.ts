import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function buildRestaurantBoardTestMail() {
  return [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "【食べログ】ネット予約通知",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "予約識別番号：LAMP-TEST-001",
    "処理区分：新規予約",
    "店舗名：Steak Lamp",
    "来店日時：2026年 6月 20日(土) 19:00",
    "人数：2名",
    "コース名：Aコース",
    "お名前：【テスト】Lamp連携",
    "電話番号：090-0000-0000",
    "メールアドレス：-",
    "卓：右テーブル",
    "要望・質問事項：",
    "Lamp自社予約からレストランボード取り込みテスト",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

export async function POST() {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return json({ ok: false, error: "RESEND_API_KEY is missing" }, 500);
    }

    const to = process.env.RESTAURANT_BOARD_IMPORT_EMAIL;

    if (!to) {
      return json(
        {
          ok: false,
          error: "RESTAURANT_BOARD_IMPORT_EMAIL is missing",
          hint: "Vercelに gm...@reserve-mail.com を登録してください",
        },
        500
      );
    }

    const resend = new Resend(apiKey);

    const result = await resend.emails.send({
      from: "hp-steak@phcoreer.resend.app",
      to,
      subject: "【食べログ】ネット予約通知",
      text: buildRestaurantBoardTestMail(),
    });

    return json({
      ok: true,
      result,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "unknown_error",
      },
      500
    );
  }
}

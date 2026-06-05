import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function buildRestaurantBoardTestMail() {
  return [
    "Lamp 様",
    "",
    "------------------------------",
    "！本メールは食べログより自動送信している予約通知メールです！",
    "※ご返信されても予約者様には送信されません。",
    "予約者様の電話番号・メールアドレスをご確認の上、直接ご連絡をお願いいたします。",
    "------------------------------",
    "",
    "食べログのインターネット予約サービスに新しい予約が入りました。",
    "",
    "お名前：テスト 太郎（テスト タロウ）様",
    "電話番号：09000000000",
    "日付：06/20",
    "来店時刻：19:00",
    "滞在可能時間：2時間30分",
    "人数：2名",
    "コース：Aコース",
    "卓：右テーブル",
    "ご要望：",
    "Lamp自社予約からレストランボード取り込みテスト",
    "",
    "キャンセルポリシー：",
    "当日キャンセル（連絡なし）：コース料金の100%",
    "当日キャンセル（連絡あり）：コース料金の50%",
    "",
    "上記予約情報を店舗様でお使いの予約台帳に転記頂きますようお願い申し上げます。",
    "",
    "株式会社カカクコム",
    "食べログ店舗会員サポート",
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
  from: "Steak Lamp <sumi@naturallife.jp>",
  to,
  subject: "食べログのインターネット予約サービスに新しい予約が入りました",
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
export async function GET() {
  return POST();
}


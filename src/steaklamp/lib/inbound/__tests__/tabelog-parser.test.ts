import { describe, expect, it } from "vitest";
import { parseTabelogReservationMail } from "../tabelog-parser";

// ※サンプル本文は解析ロジックのラベルから起こした暫定版。
//   実メール(変更・キャンセル)を入手したら本文・件名を差し替えること。
const body = (head: string) => `${head}

予約番号URL: https://example.invalid/booking?bookingId=TB12345&x=1

日付: 12/24(水)
来店時刻: 18:30
人数: 4名
滞在可能時間: 2時間
お名前: 山田 太郎 様
電話番号: 090-1234-5678
コース: Bコース
卓: カウンター席
`;

describe("parseTabelogReservationMail", () => {
  it("新規", () => {
    const p = parseTabelogReservationMail(body("食べログ 新しい予約が入りました"), "【食べログ】新着予約");
    expect(p.mailType).toBe("new");
    expect(p.externalId).toBe("TB12345");
    expect(p.time).toBe("18:30");
    expect(p.persons).toBe(4);
    expect(p.durationMinutes).toBe(120);
    expect(p.name).toBe("山田 太郎");
  });

  it("キャンセル（件名）", () => {
    const p = parseTabelogReservationMail(body("食べログ 予約内容をご確認ください"), "【食べログ】予約キャンセルのお知らせ");
    expect(p.mailType).toBe("cancel");
    expect(p.externalId).toBe("TB12345");
  });

  it("キャンセル（本文先頭）", () => {
    const p = parseTabelogReservationMail(body("食べログ 次の予約がキャンセルされました"));
    expect(p.mailType).toBe("cancel");
  });

  it("変更", () => {
    const p = parseTabelogReservationMail(body("食べログ 予約が変更されました"), "【食べログ】予約変更のお知らせ");
    expect(p.mailType).toBe("change");
    expect(p.externalId).toBe("TB12345");
    expect(p.persons).toBe(4);
  });

  it("判定不能は unknown", () => {
    expect(parseTabelogReservationMail(body("お知らせ")).mailType).toBe("unknown");
  });
});

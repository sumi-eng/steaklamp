import { describe, expect, it } from "vitest";
import Encoding from "encoding-japanese";
import { parseHotpepperReservationMail } from "../hotpepper-parser";
import { decodeJisIfNeeded } from "../mail-body";

// 変更メールは実メール(2026-10-09受信、個人情報は伏せ済み)。
// 新規・キャンセルは書式未確認のため、同じヘッダ構成で作った暫定サンプル。
const header = (kind: string) => `「隠れ家ダイニング Lamp 徳島秋田町店」様
レストランボード・ホットペッパーグルメからのお知らせです。

${kind}

■予約経路：ホットペッパーグルメ
■予約依頼番号：SE3894084
■代表者：ヨシダ　ナナミ様
■コース：お席のみのご予約
■席情報：Ｔ1～Ｔ３
　　　　　テーブル（喫煙可）
■ポイント利用額：0ポイント
`;

const CHANGE_BODY = `${header("【即予約】の変更")}
【予約変更内容】
■来店日時：2026年10月12日(月) 19:00 → 2026年10月12日(月) 20:00
■人数：2名様 → 3名様
■ポイント発行額
　変更前：100ポイント
　　内訳：基本ポイント　100ポイント(50ポイント×2名)
　変更後：100ポイント
　　内訳：基本ポイント　100ポイント(50ポイント×2名)
`;

const NEW_BODY = (kind: string) => `${header(kind)}
■来店日時：2026年10月12日(月) 19:00
■人数：2名様
`;

describe("parseHotpepperReservationMail", () => {
  it("即予約の変更: 変更後の日時・人数を採用する", () => {
    const p = parseHotpepperReservationMail(CHANGE_BODY, "[即予約]予約内容が変更されました");
    expect(p.mailType).toBe("change");
    expect(p.externalId).toBe("SE3894084");
    expect(p.date).toBe("2026-10-12");
    expect(p.time).toBe("20:00");
    expect(p.persons).toBe(3);
    expect(p.prevDateTime).toContain("19:00");
    expect(p.name).toBe("ヨシダ　ナナミ");
  });

  it("件名が無くても本文で変更と判定できる", () => {
    expect(parseHotpepperReservationMail(CHANGE_BODY).mailType).toBe("change");
  });

  it("リクエスト予約の申し込み", () => {
    const p = parseHotpepperReservationMail(NEW_BODY("【リクエスト予約】の申し込み"));
    expect(p.mailType).toBe("new");
    expect(p.time).toBe("19:00");
    expect(p.persons).toBe(2);
  });

  it("即予約の新規", () => {
    expect(parseHotpepperReservationMail(NEW_BODY("【即予約】の申し込み")).mailType).toBe("new");
  });

  it("リクエスト予約のキャンセル", () => {
    const p = parseHotpepperReservationMail(NEW_BODY("【リクエスト予約】のキャンセル"));
    expect(p.mailType).toBe("cancel");
    expect(p.externalId).toBe("SE3894084");
  });

  it("即予約のキャンセル", () => {
    expect(parseHotpepperReservationMail(NEW_BODY("【即予約】のキャンセル")).mailType).toBe("cancel");
  });

  it("予約種別の無いメールは unknown", () => {
    expect(parseHotpepperReservationMail("お知らせ\n■予約依頼番号：SE1").mailType).toBe("unknown");
  });
});

describe("decodeJisIfNeeded", () => {
  const toJis = (s: string) =>
    Encoding.codeToString(Encoding.convert(Encoding.stringToCode(s), { to: "JIS", from: "UNICODE" }));

  it("ISO-2022-JPのエスケープシーケンスのままの本文を日本語に戻す", () => {
    const raw = toJis(CHANGE_BODY);
    expect(raw).toContain("\u001b$B");
    expect(decodeJisIfNeeded(raw)).toBe(CHANGE_BODY);
  });

  it("ESCが文字列 \u001b として届いても戻せる", () => {
    const raw = toJis("■人数：2名様").split(String.fromCharCode(27)).join(String.fromCharCode(92) + "u001b");
    expect(raw).toContain(String.fromCharCode(92) + "u001b");
    expect(decodeJisIfNeeded(raw)).toBe("■人数：2名様");
  });

  it("すでに読める本文は変更しない", () => {
    expect(decodeJisIfNeeded(CHANGE_BODY)).toBe(CHANGE_BODY);
    expect(decodeJisIfNeeded(NEW_BODY("【リクエスト予約】の申し込み"))).toBe(
      NEW_BODY("【リクエスト予約】の申し込み")
    );
  });
});

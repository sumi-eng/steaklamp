import { describe, expect, it, vi } from "vitest";

// DB・LINEに触れないよう、取込モジュールが読み込む依存を差し替える
vi.mock("@/steaklamp/lib/supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("@/steaklamp/lib/lineNotify", () => ({
  sendLineReservationNotice: vi.fn(),
  sendLineReviewNotice: vi.fn(),
  sendLineText: vi.fn(),
}));

import { inferCourse as inferHotpepper } from "../hotpepper-import";
import { inferCourse as inferIkyu } from "../ikyu-import";

const CHRISTMAS = { courseName: "クリスマスコース", coursePrice: 11000 };

describe("ホットペッパーのコース判定", () => {
  it("クリスマスを含むプラン名は、11,000円でもCコースにせずクリスマスコースにする", () => {
    expect(inferHotpepper("【12/24限定】クリスマスコース 11,000円")).toEqual(CHRISTMAS);
    expect(inferHotpepper("クリスマスディナー（11000円）")).toEqual(CHRISTMAS);
  });

  it("通常のコースの判定は変わらない", () => {
    expect(inferHotpepper("Cコース 12,000円")).toEqual({ courseName: "Cコース", coursePrice: 12000 });
    expect(inferHotpepper("Bコース 9,800円")).toEqual({ courseName: "Bコース", coursePrice: 9800 });
    expect(inferHotpepper("Aコース 7,200円")).toEqual({ courseName: "Aコース", coursePrice: 7200 });
    // 旧価格のプラン名は旧価格のまま
    expect(inferHotpepper("Cコース 11,000円")).toEqual({ courseName: "Cコース", coursePrice: 11000 });
  });
});

describe("一休のコース判定", () => {
  it("クリスマスを含むプラン名は、11,000円でもCコースにせずクリスマスコースにする", () => {
    expect(inferIkyu("クリスマスコース 11,000円")).toEqual(CHRISTMAS);
    expect(inferIkyu("【一休限定】聖夜のクリスマスディナー ¥11000")).toEqual(CHRISTMAS);
  });

  it("通常のコースの判定は変わらない", () => {
    expect(inferIkyu("Cコース")).toEqual({ courseName: "Cコース", coursePrice: 12000 });
    expect(inferIkyu("プラン 12,000円")).toEqual({ courseName: "Cコース", coursePrice: 12000 });
    // 11,000円だけでクリスマスの語が無ければ、従来どおり旧Cコース扱い
    expect(inferIkyu("プラン 11,000円")).toEqual({ courseName: "Cコース", coursePrice: 11000 });
  });
});

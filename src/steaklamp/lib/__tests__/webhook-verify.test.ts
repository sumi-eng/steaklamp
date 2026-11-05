import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/steaklamp/lib/supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("@/steaklamp/lib/lineNotify", () => ({
  sendLineReservationNotice: vi.fn(),
  sendLineReviewNotice: vi.fn(),
  sendLineText: vi.fn(),
}));

import {
  gateWebhook,
  verifyLineSignature,
  verifyResendSignature,
} from "../webhookVerify";
import { POST as ikyuPost } from "../../../../app/api/steaklamp/inbound/ikyu/route";
import { POST as tabelogPost } from "../../../../app/api/steaklamp/inbound/tabelog/route";
import { POST as resendPost } from "../../../../app/api/steaklamp/inbound/resend/route";
import { POST as linePost } from "../../../../app/api/line/webhook/route";

// ---- テスト用の署名生成 ----
const KEY_BYTES = crypto.randomBytes(24);
const SECRET = `whsec_${KEY_BYTES.toString("base64")}`;

function svixHeaders(body: string, opts: { id?: string; ts?: number; secretBytes?: Buffer } = {}) {
  const id = opts.id ?? "msg_test_1";
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = crypto
    .createHmac("sha256", opts.secretBytes ?? KEY_BYTES)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return new Headers({
    "svix-id": id,
    "svix-timestamp": ts,
    "svix-signature": `v1,${sig}`,
  });
}

const LINE_SECRET = "line-channel-secret";
function lineSignature(body: string, secret = LINE_SECRET) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

const EVENT_BODY = JSON.stringify({ type: "email.sent", data: { email_id: "e1" } });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.env.RESEND_API_KEY = "re_dummy";
  process.env.RESEND_WEBHOOK_SECRET_IKYU = SECRET;
  process.env.RESEND_WEBHOOK_SECRET_TABELOG = SECRET;
  process.env.RESEND_WEBHOOK_SECRET_RESEND = SECRET;
  process.env.LINE_CHANNEL_SECRET = LINE_SECRET;
});

afterEach(() => {
  delete process.env.WEBHOOK_VERIFY_MODE;
  delete process.env.RESEND_WEBHOOK_SECRET;
  vi.restoreAllMocks();
});

describe("Resend(svix) の署名検証", () => {
  it("正しい署名は通る", () => {
    const r = verifyResendSignature({
      rawBody: EVENT_BODY,
      headers: svixHeaders(EVENT_BODY),
      secret: SECRET,
    });
    expect(r).toEqual({ ok: true });
  });

  it("本文が改ざんされていたら拒否する", () => {
    const r = verifyResendSignature({
      rawBody: EVENT_BODY.replace("e1", "e2"),
      headers: svixHeaders(EVENT_BODY),
      secret: SECRET,
    });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("別のシークレットで署名されたものは拒否する", () => {
    const r = verifyResendSignature({
      rawBody: EVENT_BODY,
      headers: svixHeaders(EVENT_BODY, { secretBytes: crypto.randomBytes(24) }),
      secret: SECRET,
    });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("古い時刻のリクエスト（再送攻撃）は拒否する", () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 60;
    const r = verifyResendSignature({
      rawBody: EVENT_BODY,
      headers: svixHeaders(EVENT_BODY, { ts: old }),
      secret: SECRET,
    });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("署名ヘッダーが無い・シークレット未設定は拒否する（理由を区別する）", () => {
    expect(
      verifyResendSignature({ rawBody: EVENT_BODY, headers: new Headers(), secret: SECRET })
    ).toEqual({ ok: false, reason: "missing_headers" });
    expect(
      verifyResendSignature({ rawBody: EVENT_BODY, headers: svixHeaders(EVENT_BODY), secret: "" })
    ).toEqual({ ok: false, reason: "missing_secret" });
  });
});

describe("LINE の署名検証", () => {
  it("正しい署名は通る", () => {
    const body = JSON.stringify({ events: [] });
    expect(verifyLineSignature(body, lineSignature(body), LINE_SECRET)).toEqual({ ok: true });
  });

  it("改ざん・別シークレット・ヘッダー無し・シークレット未設定は拒否する", () => {
    const body = JSON.stringify({ events: [] });
    expect(verifyLineSignature(body + " ", lineSignature(body), LINE_SECRET).ok).toBe(false);
    expect(verifyLineSignature(body, lineSignature(body, "other"), LINE_SECRET).ok).toBe(false);
    expect(verifyLineSignature(body, null, LINE_SECRET)).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    expect(verifyLineSignature(body, lineSignature(body), undefined)).toEqual({
      ok: false,
      reason: "missing_secret",
    });
  });
});

describe("gateWebhook（モード）", () => {
  const bad = { ok: false, reason: "bad_signature" } as const;

  it("log：拒否せず、拒否されるはずのものをログに残す", () => {
    expect(gateWebhook("t", bad, "log")).toBeNull();
    const logged = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(logged).toContain("STEAKLAMP_WEBHOOK_WOULD_REJECT route=t reason=bad_signature");
  });

  it("enforce：401で拒否する。正しい署名は通す", () => {
    expect(gateWebhook("t", bad, "enforce")?.status).toBe(401);
    expect(gateWebhook("t", { ok: true }, "enforce")).toBeNull();
  });
});

describe("受信ルート（enforce）", () => {
  beforeEach(() => {
    process.env.WEBHOOK_VERIFY_MODE = "enforce";
  });

  function request(url: string, body: string, headers: Headers) {
    return new Request(url, { method: "POST", body, headers });
  }

  const routes = [
    ["ikyu", ikyuPost],
    ["tabelog", tabelogPost],
    ["resend", resendPost],
  ] as const;

  for (const [name, handler] of routes) {
    it(`${name}：署名なしは401で、処理されない`, async () => {
      const res = await handler(
        request(`http://localhost/api/steaklamp/inbound/${name}`, EVENT_BODY, new Headers()) as never
      );
      expect(res.status).toBe(401);
    });

    it(`${name}：署名が不正なら401`, async () => {
      const res = await handler(
        request(
          `http://localhost/api/steaklamp/inbound/${name}`,
          EVENT_BODY,
          svixHeaders(EVENT_BODY, { secretBytes: crypto.randomBytes(24) })
        ) as never
      );
      expect(res.status).toBe(401);
    });

    it(`${name}：正しい署名なら検証を通過して処理に進む（対象外のイベントは無視されて200）`, async () => {
      const res = await handler(
        request(`http://localhost/api/steaklamp/inbound/${name}`, EVENT_BODY, svixHeaders(EVENT_BODY)) as never
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ignored).toBe(true);
    });
  }

  it("共通シークレット（RESEND_WEBHOOK_SECRET）でも検証できる", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET_IKYU;
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const res = await ikyuPost(
      request("http://localhost/x", EVENT_BODY, svixHeaders(EVENT_BODY)) as never
    );
    expect(res.status).toBe(200);
  });

  it("シークレット未設定のままでは受け付けない（enforce）", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET_IKYU;
    const res = await ikyuPost(
      request("http://localhost/x", EVENT_BODY, svixHeaders(EVENT_BODY)) as never
    );
    expect(res.status).toBe(401);
  });

  it("LINE：署名なし・不正は401、正しければ200", async () => {
    const body = JSON.stringify({ events: [] });
    const noSig = await linePost(request("http://localhost/api/line/webhook", body, new Headers()));
    expect(noSig.status).toBe(401);

    const bad = await linePost(
      request("http://localhost/api/line/webhook", body, new Headers({ "x-line-signature": lineSignature(body, "x") }))
    );
    expect(bad.status).toBe(401);

    const ok = await linePost(
      request("http://localhost/api/line/webhook", body, new Headers({ "x-line-signature": lineSignature(body) }))
    );
    expect(ok.status).toBe(200);
  });
});

describe("受信ルート（log モード：切り替え前は従来どおり動く）", () => {
  it("署名が無くても処理される", async () => {
    const res = await ikyuPost(
      new Request("http://localhost/x", { method: "POST", body: EVENT_BODY }) as never
    );
    expect(res.status).toBe(200);

    const line = await linePost(
      new Request("http://localhost/api/line/webhook", { method: "POST", body: "{}" })
    );
    expect(line.status).toBe(200);
  });
});

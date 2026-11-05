"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHRISTMAS,
  CHRISTMAS_CANCEL_POLICY,
  CHRISTMAS_MENU,
  CHRISTMAS_PRICE_TEXT,
  dateLabel,
} from "@/steaklamp/lib/christmas";

type TimeInfo = { time: string; available: boolean; reason?: string };

type DayInfo = {
  date: string;
  label: string;
  closed: boolean;
  full: boolean;
  remainingGroups: number;
  remainingPersons: number;
  maxSelectablePersons: number;
  times: TimeInfo[];
};

type AvailabilityResponse = {
  ok: boolean;
  receptionOpen: boolean;
  dates: DayInfo[];
  error?: string;
};

type Step = "select" | "info" | "confirm" | "done";

const SHOP_TEL_LINK = `tel:${CHRISTMAS.phone.replace(/-/g, "")}`;

const inputClass =
  "h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 outline-none focus:border-amber-500";
const selectClass =
  "h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 text-stone-900 outline-none focus:border-amber-500 disabled:bg-stone-100 disabled:text-stone-500";

function remainingText(d: Pick<DayInfo, "remainingGroups" | "remainingPersons">) {
  return `残り${d.remainingGroups}組・${d.remainingPersons}名`;
}

function isValidEmail(v: string) {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function ChristmasReservePage() {
  const [step, setStep] = useState<Step>("select");
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [persons, setPersons] = useState<number>(CHRISTMAS.minPartySize);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [allergy, setAllergy] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (forPersons: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/steaklamp/christmas/availability?persons=${forPersons}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as AvailabilityResponse;
      if (res.ok && json.ok) {
        setData(json);
        setLoadFailed(false);
        return json;
      }
      setLoadFailed(true);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  useEffect(() => {
    load(persons).then((json) => {
      if (!json) return;
      // 選んでいた時刻が、人数を変えて席が取れなくなったら選び直してもらう
      const day = json.dates.find((d) => d.date === date);
      const slot = day?.times.find((t) => t.time === time);
      if (time && !slot?.available) setTime("");
    });
    // 人数が変わったときに再取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persons, load]);

  const selectedDay = useMemo(
    () => data?.dates.find((d) => d.date === date) ?? null,
    [data, date]
  );

  const personOptions = useMemo(() => {
    const max = selectedDay?.maxSelectablePersons || CHRISTMAS.maxPartySize;
    const list: number[] = [];
    for (let n = CHRISTMAS.minPartySize; n <= Math.min(CHRISTMAS.maxPartySize, max); n++) {
      list.push(n);
    }
    return list;
  }, [selectedDay]);

  function selectDate(d: DayInfo) {
    if (d.full) return;
    setDate(d.date);
    setTime("");
    setErrorMessage(null);
    if (persons > d.maxSelectablePersons) setPersons(Math.max(CHRISTMAS.minPartySize, d.maxSelectablePersons));
  }

  function goInfo() {
    setErrorMessage(null);
    if (!date) return setErrorMessage("日付を選択してください。");
    if (!time) return setErrorMessage("開始時刻を選択してください。");
    setStep("info");
  }

  function goConfirm() {
    setErrorMessage(null);
    if (!name.trim()) return setErrorMessage("お名前を入力してください。");
    const digits = phone.replace(/[^\d]/g, "");
    if (digits.length < 10 || digits.length > 11) {
      return setErrorMessage("電話番号は10桁または11桁で入力してください。");
    }
    if (!isValidEmail(email.trim())) return setErrorMessage("メールアドレスの形式をご確認ください。");
    if (!allergy.trim()) {
      return setErrorMessage("アレルギー・苦手な食材を入力してください（無ければ「なし」）。");
    }
    if (!agreed) return setErrorMessage("キャンセルポリシーへの同意が必要です。");
    setStep("confirm");
  }

  async function submit() {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/steaklamp/christmas/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          time,
          persons,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          allergy: allergy.trim(),
          agreedToCancelPolicy: agreed,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErrorMessage(json.error || "ご予約を確定できませんでした。");
        // 満席などで失敗したときは、選び直せるように最新の空きに戻す
        if (res.status === 409) {
          setStep("select");
          setTime("");
          load(persons);
        }
        return;
      }
      setStep("done");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "通信エラーが発生しました。");
    } finally {
      setSubmitting(false);
    }
  }

  const receptionClosed = data ? !data.receptionOpen : false;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 [color-scheme:light]">
      <style jsx global>{`
        input,
        select,
        textarea,
        button {
          color-scheme: light;
        }
        input,
        select,
        textarea {
          color: #1c1917 !important;
          background-color: #ffffff !important;
          -webkit-text-fill-color: #1c1917 !important;
        }
        input::placeholder,
        textarea::placeholder {
          color: #a8a29e !important;
          opacity: 0.55 !important;
        }
        button:disabled {
          color: #57534e !important;
          -webkit-text-fill-color: #57534e !important;
          opacity: 1 !important;
        }
      `}</style>

      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6">
          <div className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Passion for Grilling Lamp
          </div>
          <div className="mt-2 text-sm text-stone-600 sm:text-base">クリスマスコースのご予約</div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-rose-100 bg-rose-50 px-5 py-5 sm:px-8">
            <div className="text-xl font-extrabold text-rose-800 sm:text-2xl">
              🎄 {CHRISTMAS.courseName}
            </div>
            <div className="mt-1 text-lg font-bold">{CHRISTMAS_PRICE_TEXT}</div>
            {CHRISTMAS_MENU.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-stone-700">
                {CHRISTMAS_MENU.map((m) => (
                  <li key={m}>・{m}</li>
                ))}
              </ul>
            ) : null}
            <ul className="mt-3 space-y-1 text-xs text-stone-600">
              <li>
                ・対象日：{CHRISTMAS.dates.map((d) => dateLabel(d)).join("・")}
              </li>
              <li>・開始時刻：{CHRISTMAS.times.join(" / ")}（120分）</li>
              <li>
                ・1組{CHRISTMAS.minPartySize}〜{CHRISTMAS.maxPartySize}名様
              </li>
              <li>・お支払いはご来店時にお願いいたします。</li>
            </ul>
          </div>

          <div className="px-5 py-6 sm:px-8 sm:py-8">
            {loadFailed ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                空席状況を取得できませんでした。時間をおいて再度お試しください。
                <button
                  type="button"
                  onClick={() => load(persons)}
                  className="ml-2 font-bold underline"
                >
                  再読み込み
                </button>
              </div>
            ) : null}

            {receptionClosed ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                クリスマスコースのWeb受付期間外です。（受付期間：11月6日〜12月20日）
                <div className="mt-2">
                  お問い合わせはお電話（
                  <a className="font-bold underline" href={SHOP_TEL_LINK}>
                    {CHRISTMAS.phone}
                  </a>
                  ）へ。
                </div>
              </div>
            ) : null}

            {step === "select" && data && !receptionClosed ? (
              <div className="space-y-6">
                <div>
                  <div className="mb-2 text-sm font-bold">① ご来店日</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {data.dates.map((d) => {
                      const selected = d.date === date;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          disabled={d.full}
                          onClick={() => selectDate(d)}
                          className={[
                            "rounded-2xl border px-4 py-4 text-left transition",
                            d.full
                              ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400"
                              : selected
                                ? "border-amber-500 bg-amber-100 ring-2 ring-amber-200"
                                : "border-stone-200 bg-white hover:border-amber-300 hover:bg-amber-50",
                          ].join(" ")}
                        >
                          <div className="text-lg font-extrabold">{d.label}</div>
                          <div
                            className={[
                              "mt-1 text-sm font-bold",
                              d.full ? "text-red-500" : "text-emerald-700",
                            ].join(" ")}
                          >
                            {d.full ? "満席" : remainingText(d)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedDay ? (
                  <div>
                    <div className="mb-2 text-sm font-bold">② 開始時刻</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {selectedDay.times.map((t) => {
                        const selected = t.time === time;
                        return (
                          <button
                            key={t.time}
                            type="button"
                            disabled={!t.available}
                            onClick={() => {
                              setTime(t.time);
                              setErrorMessage(null);
                            }}
                            className={[
                              "rounded-2xl border px-2 py-3 text-center transition",
                              !t.available
                                ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400"
                                : selected
                                  ? "border-amber-500 bg-amber-100 ring-2 ring-amber-200"
                                  : "border-stone-200 bg-white hover:border-amber-300 hover:bg-amber-50",
                            ].join(" ")}
                          >
                            <div className="text-lg font-extrabold">{t.time}</div>
                            <div className="mt-1 text-[11px] font-bold">
                              {t.available
                                ? remainingText(selectedDay)
                                : t.reason === "no_seat"
                                  ? "満席"
                                  : "選択不可"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {selectedDay ? (
                  <div>
                    <div className="mb-2 text-sm font-bold">③ 人数</div>
                    <select
                      value={persons}
                      onChange={(e) => setPersons(Number(e.target.value))}
                      className={selectClass}
                    >
                      {personOptions.map((n) => (
                        <option key={n} value={n}>
                          {n}名
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-xs text-stone-500">
                      この日は{remainingText(selectedDay)}です。
                    </div>
                  </div>
                ) : null}

                {errorMessage ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                    {errorMessage}
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={goInfo}
                    disabled={!date || !time}
                    className="inline-flex h-12 items-center justify-center rounded-2xl bg-amber-500 px-6 font-extrabold text-stone-900 shadow-sm hover:bg-amber-400 disabled:bg-stone-300 disabled:text-stone-500"
                  >
                    お客様情報の入力へ
                  </button>
                </div>
              </div>
            ) : null}

            {step === "info" ? (
              <div className="space-y-5">
                <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm">
                  {dateLabel(date)} {time}〜 ／ {persons}名
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold">お名前</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass}
                    placeholder="山田 太郎"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold">電話番号</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputClass}
                    placeholder="09012345678"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold">
                    メールアドレス（予約確認・前日のご案内をお送りします）
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="example@example.com"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold">
                    アレルギー・苦手な食材 <span className="text-red-600">（必須）</span>
                  </label>
                  <textarea
                    value={allergy}
                    onChange={(e) => setAllergy(e.target.value)}
                    rows={3}
                    className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-amber-500"
                    placeholder="無ければ「なし」とご入力ください"
                  />
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm">
                  <div className="font-bold">キャンセルポリシー</div>
                  <ul className="mt-2 space-y-1 text-stone-700">
                    {CHRISTMAS_CANCEL_POLICY.map((p) => (
                      <li key={p}>・{p}</li>
                    ))}
                  </ul>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 font-bold">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="h-5 w-5"
                    />
                    キャンセルポリシーに同意します
                  </label>
                </div>

                {errorMessage ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                    {errorMessage}
                  </div>
                ) : null}

                <div className="flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage(null);
                      setStep("select");
                    }}
                    className="h-12 rounded-2xl border border-stone-300 bg-white px-6 font-bold"
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    onClick={goConfirm}
                    className="h-12 rounded-2xl bg-amber-500 px-6 font-extrabold text-stone-900 shadow-sm hover:bg-amber-400"
                  >
                    確認画面へ
                  </button>
                </div>
              </div>
            ) : null}

            {step === "confirm" ? (
              <div className="space-y-5">
                <div className="text-lg font-bold">ご予約内容の確認</div>
                <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-stone-500">コース</dt>
                  <dd className="font-bold">
                    {CHRISTMAS.courseName}（{CHRISTMAS_PRICE_TEXT}）
                  </dd>
                  <dt className="text-stone-500">日時</dt>
                  <dd className="font-bold">
                    {dateLabel(date)} {time}〜
                  </dd>
                  <dt className="text-stone-500">人数</dt>
                  <dd className="font-bold">{persons}名</dd>
                  <dt className="text-stone-500">お名前</dt>
                  <dd>{name}</dd>
                  <dt className="text-stone-500">電話番号</dt>
                  <dd>{phone}</dd>
                  <dt className="text-stone-500">メール</dt>
                  <dd>{email || "（未入力）"}</dd>
                  <dt className="text-stone-500">アレルギー等</dt>
                  <dd className="whitespace-pre-wrap">{allergy}</dd>
                  <dt className="text-stone-500">ポリシー</dt>
                  <dd>同意済み</dd>
                </dl>

                {errorMessage ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                    {errorMessage}
                  </div>
                ) : null}

                <div className="flex justify-between gap-3">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setErrorMessage(null);
                      setStep("info");
                    }}
                    className="h-12 rounded-2xl border border-stone-300 bg-white px-6 font-bold disabled:opacity-50"
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="h-12 rounded-2xl bg-amber-500 px-6 font-extrabold text-stone-900 shadow-sm hover:bg-amber-400 disabled:bg-stone-300 disabled:text-stone-500"
                  >
                    {submitting ? "送信中..." : "予約を確定する"}
                  </button>
                </div>
              </div>
            ) : null}

            {step === "done" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-emerald-900">
                  <div className="text-lg font-bold">ご予約を受け付けました。</div>
                  <div className="mt-2 text-sm">
                    {dateLabel(date)} {time}〜 ／ {persons}名 ／ {CHRISTMAS.courseName}
                  </div>
                  {email.trim() ? (
                    <div className="mt-2 text-sm">
                      ご予約内容を {email.trim()} にお送りしました。
                    </div>
                  ) : null}
                </div>
                <div className="text-xs text-stone-600">
                  2日前までのキャンセルは確認メールのリンクから、前日・当日はお電話（
                  <a className="font-bold underline" href={SHOP_TEL_LINK}>
                    {CHRISTMAS.phone}
                  </a>
                  ）でお願いいたします。
                </div>
              </div>
            ) : null}

            {loading && !data ? (
              <div className="text-sm text-stone-500">空席状況を確認中...</div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 text-center text-sm">
          <a className="text-stone-600 underline" href="/steaklamp/reserve">
            通常のご予約はこちら
          </a>
        </div>
      </div>
    </div>
  );
}

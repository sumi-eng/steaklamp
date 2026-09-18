"use client";

import { signIn, signOut, useSession } from "next-auth/react";

const CALLBACK_URL = "/steaklamp/reserve/en";

const SNS_PROVIDERS: { id: string; label: string; className: string }[] = [
  { id: "line", label: "Sign in with LINE", className: "bg-[#06C755] text-white hover:bg-[#05b34c]" },
  { id: "google", label: "Sign in with Google", className: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50" },
  { id: "facebook", label: "Sign in with Facebook", className: "bg-[#1877F2] text-white hover:bg-[#1568d6]" },
];

export default function SnsLoginPanelEn() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return null;
  }

  if (status === "authenticated" && session?.user) {
    return (
      <div className="mb-6 flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          Signed in as <span className="font-bold">{session.user.name ?? "you"}</span>.
          {" "}Your name, phone number, and email have been filled in automatically.
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: CALLBACK_URL })}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-emerald-300 bg-white px-4 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-stone-200 bg-white px-4 py-4">
      <div className="text-sm font-bold text-stone-900">Sign in with a social account (optional)</div>
      <div className="mt-1 text-xs text-stone-600">
        Signing in lets us fill in your name, phone number, and email automatically next time. You can still make a reservation without signing in.
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SNS_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => signIn(p.id, { callbackUrl: CALLBACK_URL })}
            className={`inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-bold shadow-sm transition ${p.className}`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

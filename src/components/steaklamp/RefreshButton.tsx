"use client";

// 「更新」ボタン。取得中は押せなくなり、くるくる表示で更新中だと分かる。
// 見た目は台帳の既存ボタン(前日/今日/翌日)に合わせてあり、size="sm" は予約一覧画面用の小さめの見た目。
export default function RefreshButton({
  onClick,
  loading,
  size = "lg",
}: {
  onClick: () => void;
  loading: boolean;
  size?: "lg" | "sm";
}) {
  const sizeClass =
    size === "lg"
      ? "rounded-2xl px-4 py-3 text-sm font-semibold"
      : "rounded-xl px-3 py-2 text-sm font-semibold text-stone-700";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
      className={`inline-flex items-center gap-1.5 border border-stone-300 bg-white disabled:cursor-not-allowed disabled:opacity-60 ${sizeClass}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 3v6h-6" />
      </svg>
      {loading ? "更新中" : "更新"}
    </button>
  );
}

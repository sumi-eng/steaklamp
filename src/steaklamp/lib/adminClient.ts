// 管理画面（ブラウザ側）用の fetch。ログインが切れた（401）・権限が無い（403）ときに、
// 画面全体へ通知して「再ログイン」の案内を出せるようにする。画面上の入力内容は消さない。

export const ADMIN_AUTH_EVENT = "steaklamp:admin-auth";

export type AdminAuthEventDetail = { status: 401 | 403 };

export async function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, init);
  if ((res.status === 401 || res.status === 403) && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<AdminAuthEventDetail>(ADMIN_AUTH_EVENT, {
        detail: { status: res.status as 401 | 403 },
      })
    );
  }
  return res;
}

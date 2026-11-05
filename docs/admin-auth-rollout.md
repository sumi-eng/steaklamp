# 管理画面・API の認証 切り替え手順

台帳が使えなくなるのを避けるため、**log モード（確認だけ）→ enforce モード（実際に拒否）** の2段階で切り替える。
モードは Vercel の環境変数で決まり、**変更後は再デプロイで反映**される（1〜2分）。

| 環境変数 | 値 | 役割 |
|---|---|---|
| `ADMIN_AUTH_MODE` | `log`（未設定も同じ）/ `enforce` | 管理画面・管理APIの認証 |
| `WEBHOOK_VERIFY_MODE` | `log`（未設定も同じ）/ `enforce` | 受信webhookの署名検証 |
| `STEAKLAMP_ADMIN_EMAILS` | お店用とオーナーのGoogleメールをカンマ区切り | 管理者の許可リスト（Googleログインのみ有効。未設定だと全員拒否） |
| `RESEND_WEBHOOK_SECRET_RESEND` / `_TABELOG` / `_IKYU` | Resend の Signing Secret（`whsec_...`） | 各受信webhookの署名シークレット |
| `LINE_CHANNEL_SECRET` | LINE Messaging API の Channel secret | LINE webhook の署名検証 |
| `CRON_SECRET` | 推測されにくい文字列 | クリスマスのリマインド（設定済みであること） |

> `STEAKLAMP_ADMIN_EMAILS` の書式: `メール1,メール2`（カンマ・空白・セミコロン区切り。大文字小文字は区別しない）。
> 2つのアドレスを区切りなしで連結すると、どちらにも一致せず誰もログインできなくなる。

## 設定手順

### 管理者の許可リスト
1. Vercel → Settings → Environment Variables で `STEAKLAMP_ADMIN_EMAILS` を登録する（Production）。
2. 再デプロイする。

### Resend の署名シークレット（3つ）
1. Resend ダッシュボード → Webhooks を開く。
2. 登録されている3つのエンドポイント（`/api/steaklamp/inbound/resend`・`/tabelog`・`/ikyu`）を、それぞれ開く。
3. 「Signing Secret」（`whsec_...`）をコピーし、対応する環境変数に登録する。
   - `/inbound/resend`（ホットペッパー用）→ `RESEND_WEBHOOK_SECRET_RESEND`
   - `/inbound/tabelog` → `RESEND_WEBHOOK_SECRET_TABELOG`
   - `/inbound/ikyu` → `RESEND_WEBHOOK_SECRET_IKYU`

### LINE の Channel secret
1. LINE Developers → 通知の送信に使っている **Messaging API のチャネル** を開く。
2. Basic settings の「Channel secret」をコピーし、`LINE_CHANNEL_SECRET` に登録する。
3. 同じチャネルの Messaging API 設定で、Webhook URL の「検証」ボタンが成功することを確認する。
   - LINE ログイン用のチャネル（`LINE_CLIENT_SECRET` の側）とは別物の場合が多い。
   - `WEBHOOK_VERIFY_MODE` は全 webhook に共通。Channel secret が未設定のまま `enforce` にすると、LINE の webhook は全て拒否される（現状はログを出すだけの処理なので予約には影響しないが、LINE 側の検証は失敗する）。取得できるまでは LINE だけ未対応であることを承知のうえで切り替えること。

## 切り替えの流れ

### 手順0：事前確認（営業中でも可）
- 台帳の 🎄 パネルにある「管理者ログイン（Google）」で、各端末（スタッフのiPhone・お店の共用端末）から実際にログインする。
- 締切ボタンが出れば、許可リストとGoogleログインが正しく動いている。

### 手順1：log モードで運用（数日）
- `ADMIN_AUTH_MODE` と `WEBHOOK_VERIFY_MODE` は **未設定のまま**（または `log`）でデプロイする。この状態では何も拒否されない。
- Vercel の Logs で、次の文字列を検索する。
  - `STEAKLAMP_ADMIN_AUTH_WOULD_DENY` … enforce にすると拒否される管理操作（`route=` と `email=` が出る）。**正当な操作が混じっていないか**を確認する。
  - `STEAKLAMP_WEBHOOK_WOULD_REJECT` … enforce にすると拒否される受信（`reason=` が `missing_secret` / `missing_headers` / `bad_signature`）。**予約サイト・Resend・LINE からの正当な受信が混じっていないか**を確認する。
  - `STEAKLAMP_UNUSED_ROUTE_CALLED` … `availability(POST)` と `reservations(POST)` が呼ばれた記録。**何も出なければ未使用**と判断して削除できる。

### 手順2：enforce に切り替え（定休日の水曜か閉店後）
- **管理画面の認証と、webhook の署名検証は別の日に**切り替える（問題の切り分けのため）。
  1. `ADMIN_AUTH_MODE=enforce` → 再デプロイ → 下記の確認を行う。
  2. 後日、`WEBHOOK_VERIFY_MODE=enforce` → 再デプロイ → 下記の確認を行う。

#### enforce 後の確認（管理画面）
- [ ] 未ログインの端末で管理画面を開くと、ログイン画面が出る（予約は表示されない）
- [ ] お店用アカウントでログインすると、台帳が表示される
- [ ] 予約の追加・変更・削除、休業日の追加・削除ができる
- [ ] 営業時間・席の設定画面が開く
- [ ] お客様の予約ページ（日本語・英語）で予約でき、空きが表示される
- [ ] 予約確認メールのキャンセルリンクが開く

#### enforce 後の確認（webhook）
- [ ] 各予約サイトの確認メールを1通ずつ受信し、台帳に反映される（またはResendのダッシュボードから再送する）
- [ ] LINE Developers の「検証」ボタンが成功する
- [ ] Vercel の Logs に `STEAKLAMP_WEBHOOK_REJECTED` が出ていない

## 問題があったときの戻し方（上ほど速い）
1. Vercel → Deployments で、直前の正常なデプロイを **Instant Rollback**（約1分）。
2. 環境変数 `ADMIN_AUTH_MODE` / `WEBHOOK_VERIFY_MODE` を `log` に戻して再デプロイ。
3. 該当コミットを `git revert` して push。

ログインできなくなった場合も、手順1か2で復旧できる。その間もLINEへの予約通知は止まらない。

## 注意
- **シークレット未設定のまま enforce にすると、その受信口は全て拒否される**（偽造を防ぐため、検証できないものは通さない）。
  enforce にする前に、手順1のログで `reason=missing_secret` が出ていないことを確認する。
- ホーム画面に追加した台帳は、Safari のショートカットとして動く。**manifest を追加して全画面アプリ化しない**（iPhone では全画面アプリのCookieがSafariと別になり、Googleログインが途中で止まることがあるため）。
- セッションは30日（使うたびに延長）。営業中に切れた場合は、画面上部に再ログインの案内が出る。表示中の内容や入力途中のモーダルは消えない。

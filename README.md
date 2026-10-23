# YouTube Comment Filter

YouTube のコメント欄を、NG ユーザ・NG ワードと端末内の AI（Chrome の Prompt API）の判定で絞り込む Violentmonkey 用のユーザスクリプトです。
動画ページ（`/watch`）と Shorts（`/shorts/…`）のコメント欄が対象です。
隠したコメントは文頭の数文字だけを見せ、ホバーすると少し待ってから全文を表示します。

## 必要なもの

- デスクトップの Chrome 149 以上（Prompt API は Windows / macOS / Linux / ChromeOS のみ）
- Chrome Web Store 版の Violentmonkey
- Chrome 138 以降では、`chrome://extensions` → Violentmonkey の「詳細」で「ユーザースクリプトを許可」をオンにする
- AI の判定を使う場合は、Prompt API のモデル用の空き容量とハードウェアの要件（<https://developer.chrome.com/docs/ai/get-started> ）を満たしていること

## インストール

Violentmonkey を入れた Chrome で次の URL を開くと、インストール画面が開きます。

<https://github.com/hazymoon/youtube-comment-filter/releases/latest/download/youtube-comment-filter.user.js>

新しい Release が出ると、Violentmonkey が自動で更新します。

## 設定

### NG ユーザ・NG ワード

Violentmonkey のスクリプトの「値」タブにある `ngUsers` / `ngWords` に、文字列の配列で書きます。
値は初回の起動で空の配列として作られます。

```json
["@example_handle", "UCxxxxxxxxxxxxxxxxxxxxxx"]
```

- `ngUsers` にはハンドル（`@` で始まる）とチャンネル ID（`UC` + 22 文字）を混在して書けます。投稿者と、返信の先頭の @メンションの宛先の両方に効きます
- `ngWords` の正規表現は `"/死ね|しね/i"` のように `/` で囲んだ文字列で書きます

表示中のコメントにマウスを乗せると、投稿者の名前の横に「NG」ボタンが出ます。
押して確認すると、その投稿者（ハンドル、読めなければチャンネル ID）を `ngUsers` に追加し、すぐに判定し直します。

### 判定から外すコメント

次のコメントは、NG ユーザ・NG ワード・AI のどの判定でも隠しません。

- 動画のチャンネル所有者のコメント
- 固定コメント
- 認証バッジ付きのチャンネルのコメント
- 許可ユーザ（「値」タブの `allowUsers` に、`ngUsers` と同じ書式で書く）

ただし、返信はスレッド単位で隠れます。親のコメントを隠すと、その下の返信は上に挙げたコメントでも一緒に隠れます。

所有者・固定・認証バッジを外すかは、設定ブロックの `EXEMPT_OWNER` / `EXEMPT_PINNED` / `EXEMPT_VERIFIED` で切り替えられます。
認証バッジの見分け方は、実際のページでまだ確認していません。

### その他の設定

AI の有効化・カテゴリ・表示の速さなどは、スクリプト先頭の設定ブロックで変えられます。
ただし、自動更新するとスクリプトごと置き換わるため、このブロックへの変更は消えます。
「値」タブに書けて更新後も残るのは `ngUsers` / `ngWords` / `allowUsers` だけです。
このブロックを変えた場合は、Violentmonkey でスクリプトの自動更新を切ってください。

## 開発

```sh
npm test
npm run build
```

`src/` を編集したら `npm run build` で `dist/` を作り直してコミットします（CI が作り直し忘れを検出します）。

### リリース

1. `scripts/build.mjs` の `@version` を上げ、`npm run build` してコミットする
2. 同じバージョンのタグ（例: `v0.1.0`）を push する

タグの push で GitHub Actions が Release を作り、`dist/youtube-comment-filter.user.js` を添付します。
タグと `@version` が食い違うと Release は作られません。

## ライセンス

[MIT](LICENSE)

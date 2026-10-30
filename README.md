# YouTube Comment Filter

YouTube のコメント欄を、NG ユーザ・NG ワードと端末内の AI（Chrome の Prompt API）の判定で絞り込む Violentmonkey 用のユーザスクリプトです。
動画ページ（`/watch`）と Shorts（`/shorts/…`）のコメント欄が対象です。
隠したコメントは文頭の数文字だけを見せ、ホバーすると少し待ってから全文を表示します。

件数バーの「理由を表示」を押すと、隠したコメントの位置に「NG ワード「…」で非表示」のような理由の帯が出ます。
帯を押すとその親コメントを一時的に表示し、もう一度押すと隠します（返信は隠したままで、判定と件数は変わりません）。
この切り替えは保存せず、ページを読み込み直すと消えます。

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
キーボードの Tab キーでコメント内の投稿者名などに移ったときも出るので、そのまま Tab キーで進んで押せます。
押して確認すると、その投稿者（ハンドル、読めなければチャンネル ID）を `ngUsers` に追加し、すぐに判定し直します。

キーボードだけでも本文を読めます。
Tab キーは、1 つのコメントの中をアイコン → 投稿者名 → 投稿時刻 → 「NG」ボタン → 本文の順に進みます。
本文で止まると、ホバーしたときと同じ量を見せます。
Enter キーか Space キーを押すと全文の表示に切り替わり、もう一度押すと戻ります（マウスで本文をクリックしたときと同じです）。

### 判定から外すコメント

次のコメントは、NG ユーザ・NG ワード・AI のどの判定でも隠しません。

- 動画のチャンネル所有者のコメント
- 固定コメント
- 認証バッジ付きのチャンネルのコメント
- 許可ユーザ（「値」タブの `allowUsers` に、`ngUsers` と同じ書式で書く）

ただし、返信はスレッド単位で隠れます。親のコメントを隠すと、その下の返信は上に挙げたコメントでも一緒に隠れます。

所有者・固定・認証バッジを外すかは、「値」タブの `exemptOwner` / `exemptPinned` / `exemptVerified` に `true` か `false` を書いて切り替えられます。

### その他の設定

AI の有効化・カテゴリ・表示の速さなどは、「値」タブに次の名前で値を書くと変えられます。
値は自動更新しても残ります。
なお、スクリプト先頭の設定ブロックの `NG_USERS` / `NG_WORDS` / `ALLOW_USERS` は今も自動更新で消えるので、NG ユーザ・NG ワード・許可ユーザは「値」タブの `ngUsers` / `ngWords` / `allowUsers` に書いてください。
起動時に読むので、書き換えたらページを読み込み直すと反映されます。
書いていない値は既定値を使います（これらの値は自動では作られないので、変えたいものだけを書き足します）。
型や範囲が正しくない値は既定値に戻し、理由を DevTools の console に出します。

| 名前 | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `aiEnabled` | 真偽値 | `true` | 端末内の AI で判定するか。`false` にすると NG ユーザ・NG ワードだけで判定する |
| `aiCategories` | 配列 | 5 つのカテゴリ（`src/config.js` の `AI_CATEGORIES`） | AI に判定させるカテゴリ。`{"name": "…", "description": "…"}` を 1 つ以上並べる。`name` は空にできない。変えると判定し直す |
| `aiBatchSize` | 1 以上 10 以下の整数 | `1` | 1 回の AI 呼び出しでまとめて判定する件数。変えると判定し直す |
| `aiTimeoutMs` | 1 以上 2147483647 以下の整数 | `30000` | 1 回の判定にかける時間の上限（ミリ秒） |
| `aiMaxChars` | 1 以上の整数 | `500` | AI に渡す 1 コメントの本文の最大文字数 |
| `aiCacheMaxEntries` | 1 以上の整数 | `5000` | AI の判定結果を保存しておく件数の上限 |
| `previewChars` | 1 以上の整数 | `25` | 表示するコメントで、既定で見せる文頭の文字数 |
| `revealDelayMs` | 0 以上の整数 | `300` | マウスを乗せてから続きを見せ始めるまでの待ち時間（ミリ秒） |
| `revealMsPerLine` | 1 以上の整数 | `700` | 続きを 1 行ぶん見せるのにかける時間（ミリ秒） |
| `exemptOwner` | 真偽値 | `true` | 動画のチャンネル所有者のコメントを判定から外すか |
| `exemptPinned` | 真偽値 | `true` | 固定コメントを判定から外すか |
| `exemptVerified` | 真偽値 | `true` | 認証バッジ付きのチャンネルのコメントを判定から外すか |
| `debug` | 真偽値 | `false` | 判定の経過を DevTools の console に出すか |

`aiCategories` は、たとえば次のように書きます。

```json
[{ "name": "宣伝", "description": "商品やチャンネルの宣伝。" }]
```

## 開発

開発・実機での確認・リリースの手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## ライセンス

[MIT](LICENSE)

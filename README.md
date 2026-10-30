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
| `allowLinkDomains` | 文字列の配列 | なし（書かないと使わない） | 本文のリンクの飛び先として許可するドメイン。書くと、ここに無いドメインへのリンクを含むコメントを隠す |

`aiCategories` は、たとえば次のように書きます。

```json
[{ "name": "宣伝", "description": "商品やチャンネルの宣伝。" }]
```

`allowLinkDomains` は、たとえば次のように書きます。

```json
["example.com", "github.com"]
```

- ドメインはサブドメインも含めて許可します（`example.com` で `www.example.com` も許可）。大文字小文字は区別しません
- YouTube 内のリンク（@メンション・時刻リンク・`youtube.com` / `youtu.be`）は書かなくても常に許可します
- 空の配列 `[]` を書くと、YouTube 以外へのリンクを含むコメントをすべて隠します
- `https://example.com/…` のように `http://` / `https://` を付けた値はホスト名（`example.com`）を、`*.example.com` は `example.com` を許可します
- `example.com/path` のようにスキームを付けずにパスを付けた値・`com` のようなラベル 1 つだけの値はドメインとして読めないので無視し、理由を DevTools の console に出します。読めない値を捨てた残りで判定するので、全部読めないと `[]` と同じになります
- YouTube の外部リンク（`/redirect`）なのに飛び先が読めないリンクは、許可外として隠します。YouTube 自身が作るリンクは必ず飛び先を読めるので、読めないものは手で作ったものとみなします
- 隠したコメントは、件数バーでは NG ワードに数えます
- 判定から外すコメント（チャンネル所有者・固定・認証バッジ・許可ユーザ）は、リンクがあっても隠しません

次のものは見分けられません。

- 本文にリンクとして表示されていない URL の文字列
- 許可したドメインの中のリダイレクト（`google.com/url?q=…` など）や、`youtube.com` の中の `/redirect` 以外のリダイレクトの先
- 短縮 URL の先。短縮サービスのドメインで判定します
- チャンネルや動画の宣伝のリンク。`youtube.com` / `youtu.be` は常に許可するので隠れません
- 判定のあとでリンクだけが変わったコメント。判定はコメントが現れたときのリンクで行い、本文が変わらなければ判定し直しません

## 開発

開発・実機での確認・リリースの手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## ライセンス

[MIT](LICENSE)

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

### 判定から外すコメント

次のコメントは、NG ユーザ・NG ワード・AI のどの判定でも隠しません。

- 動画のチャンネル所有者のコメント
- 固定コメント
- 認証バッジ付きのチャンネルのコメント
- 許可ユーザ（「値」タブの `allowUsers` に、`ngUsers` と同じ書式で書く）

ただし、返信はスレッド単位で隠れます。親のコメントを隠すと、その下の返信は上に挙げたコメントでも一緒に隠れます。

所有者・固定・認証バッジを外すかは、設定ブロックの `EXEMPT_OWNER` / `EXEMPT_PINNED` / `EXEMPT_VERIFIED` で切り替えられます。

### その他の設定

AI の有効化・カテゴリ・表示の速さなどは、スクリプト先頭の設定ブロックで変えられます。
ただし、自動更新するとスクリプトごと置き換わるため、このブロックへの変更は消えます。
「値」タブに書けて更新後も残るのは `ngUsers` / `ngWords` / `allowUsers` だけです。
このブロックを変えた場合は、Violentmonkey でスクリプトの自動更新を切ってください。

## 開発

```sh
npm ci
npm test
npm run lint
npm run fmt
npm run build
```

`npm run build` で `src/` を結合して `dist/` に書き出します。`dist/` はコミットせず、リリースのときに作って Release に添付します。
`npm run lint`（oxlint）と、`npm run fmt`（oxfmt）で整形した結果も CI が確かめます。整形だけを確かめるときは `npm run fmt:check` を使います。

### 手元の dist を実機で確かめる

Violentmonkey にローカルの `dist/youtube-comment-filter.user.js` を追跡させると、`npm run build` で作り直すたびに自動で読み込み直します。コードを貼り付けて入れ替える必要はありません。

1. `chrome://extensions` → Violentmonkey の「詳細」で「ファイルの URL へのアクセスを許可する」をオンにする
2. `file:///<リポジトリの絶対パス>/dist/youtube-comment-filter.user.js` を Chrome で開き、インストール画面で、ローカルのファイルを追跡するチェックを入れてインストールする
3. インストール画面のタブは開いたままにする（閉じると追跡が止まる）

同じ名前のスクリプトとして入るので、Release から入れたものと入れ替わります。確かめ終わったら、[インストール](#インストール)の URL から入れ直して戻します。
worktree で作業しているときは、確かめたい worktree の `dist/` を開きます。

`dist/` は git の管理外なので、`git switch` などでブランチを切り替えても中身は前のブランチでビルドしたままです。切り替えたら `npm run build` で作り直します（同じファイルに書き込むので追跡は止まりません）。

### リリース

[release-please](https://github.com/googleapis/release-please) がリリースを自動で準備します。

1. `feat:` や `fix:` のコミットが main に入ると、release-please がリリース PR を作り、以降のマージのたびに更新する
2. リリース PR をマージすると、タグと Release が作られ、`dist/youtube-comment-filter.user.js` が添付される

バージョンは Conventional Commits から決まります（0.x のあいだは `feat:` と破壊的変更で minor、`fix:` で patch が上がります）。`@version` は `package.json` の `version` から作るので、手で書き換えません。変更履歴は [CHANGELOG.md](CHANGELOG.md) にあります。

## ライセンス

[MIT](LICENSE)

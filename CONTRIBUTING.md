# 開発

```sh
npm ci
npm test
npm run lint
npm run fmt
npm run build
```

`npm run build` は `src/` を結合して `dist/youtube-comment-filter.user.js` に書き出します。`dist/` はコミットしません。
CI は lint・整形（`npm run fmt:check`）・テスト・ビルドを確かめます。

## 手元の dist を実機で確かめる

Violentmonkey にローカルの dist を追跡させると、`npm run build` のたびに読み込み直します。

1. `chrome://extensions` → Violentmonkey の「詳細」で「ファイルの URL へのアクセスを許可する」をオンにする
2. `file:///<リポジトリの絶対パス>/dist/youtube-comment-filter.user.js` を開き、ローカルのファイルを追跡するチェックを入れてインストールする（worktree なら、その worktree の `dist/` を開く）
3. インストール画面のタブは開いたままにする（閉じると追跡が止まる）

Release から入れたものと入れ替わるので、確かめ終わったら [README のインストール](README.md#インストール)の URL から入れ直します。
ブランチを切り替えたら、`npm run build` で作り直します。

## リリース

[release-please](https://github.com/googleapis/release-please) が、main に入った `feat:` / `fix:` からリリース PR を作ります。
リリース PR をマージすると、バージョン・[CHANGELOG.md](CHANGELOG.md)・タグが更新され、dist を添付した Release が公開されます。

Release は下書きで作り、添付が済んでから公開するので、途中で失敗してもインストール URL は前のリリースを指したままです。
下書きのまま残ったときは、ワークフローを再実行しても添付されないので、タグを checkout して手で添付・公開します。

```sh
npm run build
gh release upload <タグ> dist/youtube-comment-filter.user.js
gh release edit <タグ> --draft=false
```

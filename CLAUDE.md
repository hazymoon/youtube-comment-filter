# CLAUDE.md

## リリース

release-please が main のコミットからリリース PR・タグ・Release・CHANGELOG を作る。仕組みと手で戻す手順は README の「リリース」節にある。

### PR のタイトルが CHANGELOG の 1 行になる

マージは squash だけで、squash のコミットは PR のタイトルをそのまま使い、本文は空になる。そのため PR のタイトルがリリースノートの単位になる。

- PR のタイトルは Conventional Commits の形で、利用者に向けた日本語で書く。`feat:` と `fix:` がリリースの対象（0.x のあいだは `feat:` で minor、`fix:` で patch）、`chore:` `docs:` `test:` `refactor:` `style:` は CHANGELOG に載らない
- PR の中の個々のコミットは CHANGELOG に出ないので、PR の中で直した不具合を `fix:` で積んでかまわない
- 利用者に向けた変更が 2 つ以上あるときは PR を分ける。分けられずにマージした後なら、マージ済み PR の本文に `BEGIN_COMMIT_OVERRIDE` 〜 `END_COMMIT_OVERRIDE` の節を書き、その中に 1 行ずつ `feat:` / `fix:` を並べる（次の release-please の実行で使われる）

### release-please に任せるもの

`package.json` の `version`、`@version`、`CHANGELOG.md`、タグは release-please がリリース PR で更新する。リリースはリリース PR をマージして出す。バージョンを指定したいときは、コミット本文に `Release-As: x.y.z` を書いたコミットを main に入れる。

### dist はコミットしない

`dist/` は git の管理外で、Release のときにワークフローがビルドして添付する。実機で確かめる前には `npm run build` で作り直す。

### 整形だけのコミットを git blame から外す

`.git-blame-ignore-revs` に載せたいコミットの SHA は、squash でマージした後に決まる。マージ後に、できた SHA を書き足す PR を別に出す。

# YouTube コメント欄の DOM 構造（実測）

工程 2 の DOM 層のセレクタを決めるための記録。2026-10-20 に、spike v0.2.0 の DOM 調査と v0.3.0 の骨格ダンプ（macOS の Chrome 155、page 世界）で確認した。YouTube の変更で壊れうるので、セレクタは `src/` の 1 か所の定数にまとめ、本書の該当箇所を根拠として参照する。

## コメント欄の外枠

```text
ytd-comments#comments
└ ytd-item-section-renderer#sections
  ├ div#header > ytd-comments-header-renderer   … 件数・並べ替え・投稿欄
  ├ div#spinner-container
  ├ div#contents
  │ ├ ytd-comment-thread-renderer               … トップレベルのコメント（1 件ごと）
  │ └ yt-comment-filter-context-view-model      … YouTube 自身の表示（本スクリプトとは無関係）
  └ div#continuations
```

- 隠し方テストの結果から、コメント欄を閉じるときは `ytd-comments#comments` に `visibility:hidden` を当てる（`display:none` だと読み込みが止まる）。件数バーはその外（直前の兄弟要素）に置く

## 1 コメント = 1 `ytd-comment-thread-renderer`

返信も、1 件ずつ入れ子の `ytd-comment-thread-renderer` になっている。トップレベルと返信で構造は同じ。

```text
ytd-comment-thread-renderer
├ div#comment-container
│ └ ytd-comment-view-model#comment              … コメント本体
└ div#replies
  └ ytd-comment-replies-renderer
    ├ div#collapsed-threads                      … 「返信を表示」ボタン（未展開時）
    └ div#expanded-threads
      └ yt-sub-thread > div.ytSubThreadSubThreadContent
        └ ytd-comment-thread-renderer            … 返信（さらに返信を持ちうる）
```

- 返信かどうか: 祖先に `ytd-comment-replies-renderer` があれば返信
- thread-renderer を `display:none` にすると、そのコメントへの返信もまとめて消える（「親が NG ならスレッドごと隠す」に一致）
- 返信の展開ボタン・続きの読み込みは `ytd-continuation-item-renderer.replies-continuation`

## `ytd-comment-view-model#comment` の中

```text
div#body
├ div#author-thumbnail > button#author-thumbnail-button
└ div#main
  ├ div#header > div#header-author
  │ ├ h3 > a#author-text[href="/@handle"]       … 投稿者（通常）
  │ ├ span#author-comment-badge                  … 投稿者がチャンネル所有者か、認証済みのチャンネルのとき
  │ │ └ ytd-author-comment-badge-renderer > a#name[href="/@handle"]
  │ │   （このとき a#author-text は hidden 属性付き。href は残っている）
  │ └ span#published-time-text > a[href="/watch?v=…&lc=<commentId>"]
  ├ ytd-expander#expander[collapsed]
  │ ├ div#content                                … -webkit-line-clamp: 4、overflow: hidden
  │ │ └ yt-attributed-string[slot="content"]     … 本文（querySelector('#content-text') で取れる）
  │ │   └ span.ytAttributedStringHost
  │ │     └ a.ytAttributedStringLink[href]       … 本文中のリンク（@返信の宛先は /channel/UC… 形式）
  │ ├ tp-yt-paper-button#less                    … 「一部を表示」
  │ └ tp-yt-paper-button#more                    … 「もっと見る」（溢れたときだけ表示）
  ├ ytd-tri-state-button-view-model.translate-button
  └ ytd-comment-engagement-bar#action-buttons    … 高評価・返信ボタン
```

- 本文の `id="content-text"` は属性として骨格ダンプに出なかったが、`querySelector('#content-text')` では取れた（spike v0.2.0 の `contentTextFound: true`、v0.3.0 の @返信の判定）。DOM 層は本文の要素として `#content-text` を第一に使い、取れないときは `#expander yt-attributed-string[slot="content"]` を使う。本文の文字列は「データ」の polymer の原文を優先し、要素の textContent はそれが読めないときに使う（翻訳で中身が訳文に差し替わるため）
- YouTube 自身の折りたたみは `ytd-expander#expander > #content` の 4 行で、溢れたときに `#more` が出る。段階表示はこの `#content` の行数を上書きし、`#more` / `#less` を隠して置き換える
- @返信の宛先リンクは本文の先頭の `a.ytAttributedStringLink` で、href は `/channel/UC…` だった

### 固定コメントの印

2026-10-23 に、固定コメントのある動画で確認した（トップレベル 20 件のうち 1 件が固定。Chrome、page 世界）。

```text
div#main > div#header
└ div#pinned-comment-badge                       … どのコメントにもある（固定でなければ空）
  └ ytw-pinned-comment-badge-renderer            … 固定コメントにだけある（「@handle さんによって固定されています」）
```

- 印のタグは `ytw-` で始まる。旧世代の `ytd-pinned-comment-badge-renderer` は無かった
- 空の `div#pinned-comment-badge` は全コメントにあるので、固定かどうかはその中の `ytw-pinned-comment-badge-renderer` の有無で見分ける

## データ（page 世界でのみ読める）

| 値 | 取得元 |
| --- | --- |
| コメント ID | `ytd-comment-view-model` の `.data.commentId`。DOM では `#published-time-text a` の `lc=` |
| 投稿者のチャンネル ID | `ytd-comment-view-model` の `.polymerController.__data.commentEntity.author.channelId` |
| 投稿者のハンドル | データ内には無い。`a#author-text` か `a#name` の href（`/@handle`） |
| 表示名 | `.polymerController.__data.commentEntity.author.displayName`（判定には使わない） |
| 投稿者が動画のチャンネル所有者か | `.polymerController.__data.commentEntity.author.isCreator`（boolean） |
| 投稿者が認証済みのチャンネルか | `.polymerController.__data.commentEntity.author.isVerified`（boolean） |
| 本文（原文） | `.polymerController.__data.commentEntity.properties.content.content`（文字列）。読めないときや空文字のときは `#content-text` の textContent |

- 2026-10-23 に 2 本の動画で確認した。所有者のコメントは `isCreator: true` だった。所有者ではない認証済みのチャンネル 4 件は、`isCreator: false`・`isVerified: true` で、所有者と同じ `span#author-comment-badge` のバッジ（`a#name`）が付いていた。所有者かどうかはバッジでは見分けられない
- 2026-10-24 に、英語のコメントの「日本語に翻訳」を押して確認した（Chrome + Violentmonkey）。翻訳すると `#content-text` の中身が訳文に差し替わるが、`commentEntity.properties.content.content` と `.polymerController.__data.contentText.content` は原文のままで、訳文は `commentEntity.translatedContent.content` に入った。「原文を見る」を押すと `#content-text` は原文に戻った
- 同じ日に、翻訳していない 30 件（返信を含む）で、原文の文字列と `#content-text` の textContent を比べた。@返信の宛先（`@handle`）や改行を含め、26 件は一致した。食い違った 4 件はどれも画像の絵文字を含むコメントで、textContent には画像の絵文字が入らないが、原文には `😂` のような絵文字の文字や `:whistle-red-blow:` のようなカスタム絵文字の名前が入っていた。原文が空文字のコメントは無かった。画像の絵文字の位置は `commentEntity.properties.content.attachmentRuns` に入っていた（各要素の `startIndex`・`length` が原文の UTF-16 の位置で、`element.type.imageType` を持つ。`:whistle-red-blow:` は 0 から 18 文字、`😂` は 31 から 2 文字）。DOM 層は、この範囲のうちカスタム絵文字の名前の形のものだけを原文から取り除いて本文として使う（NG ワードが絵文字の名前に一致しないように。投稿者が手で打った `:名前:` は取り除かない）

## Shorts のコメント欄

2026-10-23 に、Shorts のページ（`/shorts/<videoId>`、Chrome、page 世界）でコメントのパネルを開いて確認した。

```text
ytd-shorts
└ div#shorts-panel-container > div#anchored-panel
  └ ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]
    ├ div#header > ytd-engagement-panel-title-header-renderer
    └ div#content > ytd-section-list-renderer > div#contents
      └ ytd-comments                              … id が無い（動画ページの ytd-comments#comments とは別の要素）
        └ ytd-item-section-renderer#sections > div#contents > ytd-comment-thread-renderer …
```

- `ytd-comments` より内側（`ytd-comment-thread-renderer` 以下、`ytd-comment-view-model#comment`、`#content-text`、`ytd-expander#expander > #content`、`#more`）は動画ページと同じ構造だった
- 投稿者のリンクの href は `/@handle`、`#published-time-text a` の href は `lc=` を持ち、その値は `.data.commentId` と一致した。`.polymerController.__data.commentEntity.author.channelId` も取れた
- Shorts のページでも `ytd-watch-flexy` とその中の `ytd-comments#comments`（中身は空）が DOM に残っている。対象のコメント欄はページの種類で探し分ける
- 次の Shorts へ移ると `yt-navigate-start` → `yt-navigate-finish` が発火した。`ytd-comments` とパネルの要素は使い回され（同一の要素のまま）、パネルは開いたまま中身だけが次の動画のコメントに入れ替わった
- 2026-10-28 に、パネルを開いたまま次の Shorts へ移ったあと、`ytd-comments` が作り直されていたことがあった（`ytd-shorts ytd-comments` は 1 つで、その中の thread は本スクリプトが判定していない状態、件数バーは DOM に無かった）。使い回されるとは限らないので、コメント欄は遷移のイベントを待たずに探し直す
- 同じ日に、`yt-navigate-finish` の後の数百ミリ秒は、前の動画のコメント（本スクリプトが判定済みの thread）がまだ DOM に残っていることを確かめた。遷移の完了後の最初のスキャンは前の動画の thread を見るので、判定待ちのものは順番待ちに入りうる。AI に送るのは、取り出す時点で監視中のコメント欄に判定待ちのまま残っているものだけにする


## 動画の投稿者

なりすましの判定で、動画の投稿者のハンドルと表示名を読むための記録。2026-10-30 に、動画ページと Shorts のページ（Chrome、page 世界）で確認した。

```text
動画ページ
ytd-watch-flexy[video-id="<videoId>"]
└ … ytd-video-owner-renderer
  ├ a[href="/@handle"]                            … 投稿者のハンドル（最初の /@ のリンク）
  └ ytd-channel-name#channel-name … yt-formatted-string#text > a   … 表示名

Shorts のページ
ytd-shorts
├ div#shorts-container … ytd-reel-video-renderer#reel-video-renderer
│ └ … yt-reel-player-overlay-view-model … yt-reel-channel-bar-view-model
│   └ span.ytReelChannelBarViewModelChannelName > a[href="/@handle/shorts"]   … ハンドル（文字列も @handle）
└ div#anchored-panel > ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-structured-description"]
  └ … ytd-video-description-header-renderer > div#channel-info
    ├ a[href="/@handle"]
    └ ytd-channel-name#channel-name … yt-formatted-string#text   … 表示名
```

- 動画ページでは、ハンドルが `/@RickAstleyYT`、表示名が「Rick Astley」だった。`ytd-video-owner-renderer` は 1 つだけだった
- Shorts では、画面に出る投稿者の行（`yt-reel-channel-bar-view-model`）の文字列はハンドルで、表示名は概要欄のパネルの見出しにだけあった。概要欄のパネルは閉じていても（`visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"`）DOM にあり、次の Shorts へ移ると中身が入れ替わった。`#channel-name` の textContent はツールチップの分も含んで表示名が 2 回入るので、`yt-formatted-string#text` から読む
- Shorts の `ytd-reel-video-renderer` は 1 つだけで、次の Shorts へ移っても同じ要素が使い回された
- 動画ページで関連動画へ移ると、`ytd-watch-flexy` の `video-id` 属性と投稿者の要素は同じ時点（100 ミリ秒ごとに見て同じ回）で新しい動画のものに変わった。それより前は URL だけが新しい動画を指し、投稿者は前の動画のままだった。投稿者は `video-id` が URL の `v=` と一致するときだけ読む
- Shorts で次の動画へ移ると、URL と `ytd-reel-video-renderer` の `.data.command.reelWatchEndpoint.videoId` が先に変わり（`yt-navigate-finish` の直前）、投稿者の行と概要欄の見出しは 100〜900 ミリ秒ほど遅れて変わった（2 回の測定）。投稿者の要素にも概要欄のデータにも動画 ID は無く、読んだ投稿者がいまの動画のものかは確かめられない。遷移の直後は前の動画の投稿者を読みうる。投稿者の要素はコメント欄の外にあり、変化がコメント欄の監視に届かないので、document の変化のたびに投稿者を読み直し、前のスキャンが判定に使ったものと違えばスキャンして判定し直す

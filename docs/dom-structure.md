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
  │ ├ span#author-comment-badge                  … 投稿者がチャンネル所有者のとき
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

- 本文の `id="content-text"` は属性として骨格ダンプに出なかったが、`querySelector('#content-text')` では取れた（spike v0.2.0 の `contentTextFound: true`、v0.3.0 の @返信の判定）。DOM 層は `#content-text` を第一に使い、取れないときは `#expander yt-attributed-string[slot="content"]` を使う
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


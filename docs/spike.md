# 工程 1 spike: Prompt API と YouTube コメント DOM の実測

## 目的

工程 2（本体の実装）に進む前に、次の前提を実機で確かめる。

- Violentmonkey のユーザスクリプトから、YouTube の動画ページで Prompt API（`LanguageModel`）を呼べるか。既定（`@inject-into` なし = auto）と `@inject-into page` のどちらで呼べるか
- 日本語の入出力指定（`expectedInputs` / `expectedOutputs` に `languages: ['ja']`）で `availability()` と `create()` が通るか。`create()` のユーザー操作要件とダウンロードの有無
- `responseConstraint`（JSON Schema。`category` に `type: ['string', 'null']` と `null` を含む `enum`）が通るか。1 件と 10 件の所要時間、初回と 2 回目以降の差、出力 ID と入力 ID の一致
- 入力量の上限（`contextUsage` / `contextWindow` / `measureContextUsage`。旧名 `inputUsage` / `inputQuota` / `measureInputUsage` の有無も記録）
- 同一セッションへの並行投入と、`clone()` した 2 セッションへの並行投入の合計時間
- 注入方式ごとの `GM_setValue` / `GM_getValue` の可否
- コメント要素のタグ名、コメント ID・チャンネル ID（UC）・ハンドルの取得元と、注入方式による読める範囲の違い

spike は計測専用で、外部へのネットワーク送信はしない。記録にはコメント本文を含めず、ID とハンドルは先頭数文字以外を伏せる。

## 対象ファイル

| ファイル | 内容 |
| --- | --- |
| `spike/lm-spike.user.js` | 既定（`@inject-into` なし）。`@name` は `YCF LM Spike (default inject)` |
| `spike/lm-spike-page.user.js` | 同じ内容に `@inject-into page` を足したもの。`@name` は `YCF LM Spike (inject-into page)` |

## 前提条件

- デスクトップの Chrome（Prompt API は Windows / macOS / Linux / ChromeOS のみ。Android / iOS は非対応）
- Chrome 149 以上（Web 向けの提供は 148 から、`ja` の入出力指定は 149 から）。これより古いと `availability()` が `unavailable` や例外になり、「使えない」と誤判定しうるので、記録欄の Chrome バージョンと突き合わせる
- モデル用の空き容量とハードウェアの要件（<https://developer.chrome.com/docs/ai/get-started> ）を満たしている
- Chrome Web Store 版の Violentmonkey（MV3。Chrome 135 以上が必要）
- Chrome 138 以降では、`chrome://extensions` → Violentmonkey の「詳細」で「ユーザースクリプトを許可」をオンにする

## 導入手順

1. Violentmonkey のダッシュボードを開く（拡張機能アイコン → 歯車）
2. 「+」→「新規作成」を選ぶ
3. エディタの既存の内容をすべて消し、`spike/lm-spike.user.js` の内容を貼り付けて保存する
4. 同じ手順で `spike/lm-spike-page.user.js` も登録する
5. ダッシュボードで、どちらか片方だけを有効にする（両方を有効にするとパネルが重なり、計測も干渉する）

## 実行手順

1. 既定（`YCF LM Spike (default inject)`）だけを有効にする
2. 動画ページ（`https://www.youtube.com/watch?v=...`）を開く。`@match` は `https://www.youtube.com/*` なので、トップページから遷移してきてもパネルは出ている。スクリプトを有効にした直後だけは再読み込みする
3. コメント欄が読み込まれるまでスクロールする（DOM 調査に必要）
4. 画面右下のパネルの「計測開始」を押す。ダウンロードが発生した場合はパネルに進捗が出る。全段で数分かかることがある
5. 完了したら「JSON をコピー」を押す（失敗したらパネル内の JSON を選択してコピーする）。同じ JSON は DevTools の console にも `[YCF LM Spike JSON]` として出る
6. パネルに「コメント要素なし」と出た場合は、コメント欄までスクロールしてからもう一度押す
7. 既定の結果を取ったら、結果にかかわらず必ず、既定を無効にして `YCF LM Spike (inject-into page)` だけを有効にし、手順 2〜6 を繰り返す（記録欄は両方の列を埋める前提）

既定の結果を読むときは、特に次の点を見る。

- `env.injectInto` が `content` だったか
- `typeofLanguageModel` と `typeofUnsafeWindowLanguageModel` がどちらも `undefined` だったか
- `dom.elements[].props.data` などが `undefined` で、ID を DOM 以外から取れなかったか

page 指定でパネルが出ない場合、page への注入に失敗している（page 指定は content に落ちず実行されない）。その事実を記録欄に書く。

## 隠し方テストの手順

コメント欄（`ytd-comments#comments`）を読み込み前から隠したときに、YouTube がコメントを取りに行くかを隠し方ごとに確かめる。決定 5（コメント欄を既定で閉じる）の実装方式を決めるために使う。注入方式には依存しないので、既定版だけで行う。

| 隠し方 | 内容 |
| --- | --- |
| `none` | 隠さない（比較の基準） |
| `display` | `display:none`。欄の高さが 0 になり、画面に入らない |
| `visibility` | `visibility:hidden`。高さは保ったまま見えなくする |
| `opacity` | `opacity:0`。高さを保ち、描画もされるが透明にする |

隠し方ごとに次を繰り返す（`none` → `display` → `visibility` → `opacity` の順）。

1. 動画ページを開き、パネルの「隠し方テスト」で隠し方を選んで「設定して再読み込み」を押す
2. 再読み込み後、ページの最下部まで数回スクロールし、20 秒ほど待つ（コメント欄が見えなくても、本来ある位置まで下りる）
3. 「隠し方の結果を出す」を押し、「JSON をコピー」で取る
4. `none` 以外では、続けて「解除して観測」を押す。15 秒後に完了の表示が出たら、もう一度「隠し方の結果を出す」→「JSON をコピー」で取る（隠すのをやめた後に、まとめて読み込みが始まるかを見る）

終わったら、隠し方を `none` に戻して「設定して再読み込み」を押す。隠し方は保存されるので、戻さないと以降のページ表示でもコメント欄が隠れたままになり、LanguageModel の計測にも影響する。

## 記録欄

既定版の結果を記録した。

### 実行環境

| 項目 | 既定 | page 指定 |
| --- | --- | --- |
| 実行日 | 2026-10-20 | 未実施（既定で page に注入されたため不要と判断） |
| Chrome バージョン | 155 | |
| OS | macOS（Mac mini） | |
| Violentmonkey バージョン（`env.handlerVersion`） | 2.49.0 | |
| spike のバージョン | 0.2.0 | |

page 指定版は「計測開始」を押しても「待機中」から進まなかった。既定版の結果から page 世界での動作は確認できたので、原因は追っていない。

### 結果の要約（既定）

| 項目 | 結果 |
| --- | --- |
| env: `injectInto`（実効モード） | `page` |
| env: `typeof LanguageModel` / `typeof unsafeWindow.LanguageModel` | `function` / `function` |
| env: `window === unsafeWindow` | false（`@grant` により window はラッパー） |
| env: `typeof ytInitialData`（unsafeWindow 経由） | `object` |
| env: `trustedTypes` | API あり、default policy なし |
| availability | `available`（取得元は global、4.1ms） |
| create | 成功、15675ms。ダウンロードの進捗は 0 → 1 が即時（ダウンロード済み）。所要時間はモデルの読み込みとみられる |
| quota: `contextWindow` / `contextUsage`（base） | 9216 / 137 |
| quota: measure 値 | 10 件 248（スキーマ込み・omit 時も同じ値）、1 件 35 |
| quota: 旧名の `typeof` | すべて `undefined` |
| prompt 1 件 | 1185 / 753 / 734ms、中央値 753ms。JSON.parse と ID 一致はすべて成功 |
| prompt 10 件 | 7049 / 6781 / 6820ms、中央値 6820ms。JSON.parse と ID 一致はすべて成功 |
| 初回と 2 回目以降の差 | 1 件で初回のみ約 430ms 長い。10 件ではほぼ差なし |
| concurrency: 同一セッション 2 本 | 1 本目は成功、2 本目は `UnknownError: kErrorUnknown`（8124ms）。仕様の「キューで直列化」とは異なり、同時投入は失敗する |
| concurrency: clone 2 本 | 合計 25216ms（19468 / 25216ms）。順に投げた場合（約 13.6 秒）より遅い |
| schemaVariants | anyOf 表記 5793ms、omitResponseConstraintInput 6596ms。どちらも成功（omit 時は contextUsage が 631 → 555） |
| gm | `GM_setValue` / `GM_getValue` とも成功、Promise を返さない（同期） |
| dom: タグ名と件数 | `ytd-comment-thread-renderer` 9、`ytd-comment-view-model` 9、`ytd-comment-replies-renderer` 1、`ytd-comment-renderer` 0 |
| dom: プロパティ | `.data` と `.polymerController` あり、`.__data` は要素に無く `polymerController.__data` にある |
| dom: commentId | スレッド要素 `.data.commentViewModel.commentViewModel.commentId`、本体要素 `.data.commentId`、`polymerController.__data.commentEntity.properties.commentId` |
| dom: UC の channelId | `polymerController.__data.commentEntity.author.channelId`（ほか endpoint 系 4 か所） |
| dom: ハンドル | データ内に無し。著者リンクの href が `/@handle` 形式。`commentEntity.author.displayName` に表示名 |
| dom: タイムスタンプリンクの `lc=` | あり（commentId と同じ形式の 26 文字） |

### 判定の精度について

穏当な批判として用意した c6（「この方法には反対です。安全面の説明がもう少し欲しかった。」）が、10 件まとめた全 9 回で `hide: true`（人格攻撃・侮辱）と判定された。c7〜c9（不快なもの）の直前に置いたことによる並び順の影響か、指示文の問題かは切り分けていない。工程 2 の最初に、1 件ずつ判定した場合との比較と指示文の調整を行う。

### 隠し方テストの結果

`timeline` の `threads` / `viewModels` が増えたか、最初に増えた時刻（`atMs`）、`continuation` の有無、`targetHeight` を見る。

| 隠し方 | 隠したまま読み込まれたか（最終の `threads` 件数） | 解除後 15 秒で読み込まれたか | `targetHeight` |
| --- | --- | --- | --- |
| `none` | 読み込まれた（開始 4.0 秒で 9 件） | （対象外） | 504 → 1067 |
| `display` | 読み込まれなかった（7.0 秒まで 0 件。scrollY 544 まで下りていた） | 読み込まれた（解除後 1 秒以内に 9 件） | 0 → 解除後 1067 |
| `visibility` | 読み込まれた（開始 3.0 秒で 9 件） | 解除の時点で読み込み済み | 504 → 1067 |
| `opacity` | 判定できない（開始 2.5 秒で解除したため、隠した状態での読み込みを観測していない） | 解除後 2 秒で 9 件 | 504 → 1067 |

実行日: 2026-10-20、既定版（v0.2.0）、macOS の Chrome。

### 隠し方テストからわかったこと

- `visibility:hidden` なら、隠したままでもコメントが `none` と同じように読み込まれ、欄の高さも保たれる
- `display:none` では、隠している間は読み込まれず、解除すると 1 秒以内に読み込まれる。隠した時間は 7 秒だけだが、`none` / `visibility` が 3〜4 秒で読み込まれていたことから、読み込みを止めたと判断する
- `opacity` は、読み込みが始まる前に解除したため判定できない。`visibility` で目的を果たせるので、測り直しは不要とする
- どの回も最初の 9 件までで、さらにスクロールして続きを読み込む動作（continuation）は観測していない

工程 2 では、コメント欄を `visibility:hidden` で閉じる。件数の表示と「コメントを表示」ボタンは、子要素に `visibility:visible` を指定して見せるか、`ytd-comments` の外に置く。

LanguageModel 計測の JSON は、コメント作者のハンドルの一部を含むためリポジトリには保存せず、上の要約だけを記録した。

## 判定基準

- `LanguageModel` が既定でも page 指定でも使えない（`availability` が `unavailable`、`LanguageModel` が見えない、または `create()` が失敗する）なら、工程 2 に進まない
- `responseConstraint` のスキーマが例外になる場合は、例外名（`NotSupportedError` / `SyntaxError` など）を記録し、`schemaVariants` で通った表記を工程 2 で使う。どの表記も通らなければ、出力形式をプロンプトの指示だけで縛り、`JSON.parse` 失敗を判定失敗として扱う前提で工程 2 の仕様を見直す
- 10 件の出力 ID が入力と一致しない（`ids.exactMatch` が false）場合は、工程 2 で ID の突き合わせと欠落時の再判定を必須にする

## AI_BATCH_SIZE と AI_CONCURRENCY の算定

記号を次のように置く。

- `T1`: 1 件の prompt の中央値（ms）。2 回目以降の値を使い、初回の値はウォームアップとして別に扱う
- `T10`: 10 件の prompt の中央値（ms）
- `Tsame`: 同一セッション 2 本の合計（ms）
- `Tclone`: clone 2 本の合計（ms）
- `W`: `contextWindow`、`B`: base 作成直後の `contextUsage`、`M10`: 10 件の measure 値（スキーマ込み）
- `L`: 1 バッチあたり許容する待ち時間（ms）。工程 2 の体験要件として決める（例: 10 秒）

### AI_BATCH_SIZE

1. 1 件あたりの限界コストを `c = (T10 - T1) / 9`、固定コストを `f = T1 - c` と見積もる
2. 時間の上限から `N_time = floor((L - f) / c)`
3. 入力量の上限から `N_ctx = floor((W - B) * 0.5 / (M10 / 10))`。係数 0.5 は出力と長文コメントの余裕
4. `AI_BATCH_SIZE = max(1, min(N_time, N_ctx, 10))`。10 を超える値は spike で測っていないので上限にする
5. 固定コスト `f` が `T10` の半分以上を占めるなら、まとめる効果が大きいので上限寄りにする。`T10` が `10 × T1` に近いなら、まとめる効果は小さいので、体験を優先して小さめ（3〜5）にする

### AI_CONCURRENCY

1. 同一セッションの並行投入は FIFO で直列化される前提なので、同一セッションでの並行化はしない。`Tsame ≈ 2 × T10` ならこの前提を確認できたことになる。ただし 2 本目の入力には 1 本目のやり取りが履歴として加わるので、`Tsame` は `2 × T10` より大きめに出る。`sameSession.contextUsageAfter` と併せて見る
2. `Tclone < 1.5 × T10` なら clone 間で並列に処理されているとみなし、`AI_CONCURRENCY = 2` を候補にする
3. `Tclone ≈ 2 × T10` なら端末側で直列化されているので、`AI_CONCURRENCY = 1` にする（clone を増やしてもメモリを使うだけ）
4. 2 より大きい値は spike で測っていないので、採るなら工程 2 で追加計測してから決める

### 算定結果（2026-10-20、Mac mini / Chrome 155）

- `c = (6820 - 753) / 9 ≈ 674ms`、`f ≈ 79ms`。固定コストはごく小さく、所要時間は件数にほぼ比例する。まとめても速くならないので、件数は体験だけで決める
- `AI_BATCH_SIZE = 5`。最初の結果が約 3.4 秒で出る。c6 の誤判定が並び順によるものとわかった場合は、1 件ずつ判定する方式にする（所要時間はほぼ変わらない）
  - 工程 2 で既定値を 1 に変えた。まとめると、本文に埋めた指示で同じバッチの他のコメントの判定を変えられるため（隠させる側は 1 件ずつの再判定で塞いだが、表示させる側は塞げない）。上の計測のとおり、所要時間はほぼ変わらない。5 との正確さの比較は工程 3 で行う
- `AI_CONCURRENCY = 1`。同一セッションへの同時投入は `UnknownError` で失敗し、clone 2 本の同時実行は順に投げるより遅かった。判定の順番待ちは自前で 1 本に並べる
- create はモデルの読み込みに約 15.7 秒かかる。`available` のときはユーザー操作が要らないので、ページを開いた時点で create を始める

## DOM 調査の結果から決めること

### コメント ID の取得元

- 第一候補は、タイムスタンプリンクの `lc=`（`dom.timestampLink`）。DOM の属性なので、注入方式に関係なく読める
- `lc=` が無い場合は、`dom.elements[].search.*.found.commentId` のキーパスを使う。これは要素の `.data` などページ JS が付けたプロパティなので、page 指定でしか読めない可能性が高い。既定と page 指定の結果を比べて確かめる
- どちらも無い場合は、著者と本文のハッシュをキャッシュキーにする方針を工程 2 の仕様に足す

### チャンネル ID（UC）の取得可否

- 著者リンクが `/channel/UC...` 形式なら、DOM から取れる
- `/@handle` 形式しか無い場合、`found.browseIdUC` にキーパスがあれば page 指定で取れる
- どちらでも取れない場合は、NG ユーザをハンドルだけで指定する仕様にするか、UC からハンドルを解決する手段を仕様に書く

### コメント欄を閉じる方式

- 隠したままでも `none` と同様にコメントが読み込まれる隠し方があれば、工程 2 ではそれでコメント欄を閉じる（描画は続けて見た目だけを隠す）
- `display` で読み込まれず、解除後に読み込まれるなら、`display:none` は使わない。解除後にも読み込まれない場合は、ボタンで開いた後にスクロールを促す手段を仕様に足す
- どの隠し方でも読み込まれない場合は、「閉じる」を、コメント欄の手前に本文を覆う帯を重ねる方式などに変えることを検討する
- 判定待ちのコメントで欄の高さが縮み、続きの読み込みが止まらなくなる問題は、このテストでは再現できない。工程 2 で、判定中のコメントを 1 行の帯に置き換えて高さを保つ仕様にして防ぐ

### 注入方式への影響

- 既定で `env.injectInto` が `page` になり、`LanguageModel` と ID の取得元が揃って使えるなら、工程 2 でも `@inject-into page` を明示して固定する（auto に任せると、条件次第で content に落ちて ID が読めなくなる）
- page 指定で `LanguageModel` が使えず、content で使える場合は、content で `LanguageModel` を使い、ID の取得だけ page 側から CustomEvent で受け取る 2 層構成を検討する
- 工程 2 の DOM 生成は、spike の結果によらず `createElement` と `textContent` に限定する（YouTube は `require-trusted-types-for 'script'` を強制しているとみられ、そうなら page 世界での `innerHTML` への文字列代入は例外になる。`trustedTypes.present` は API の有無を示すだけで、強制の有無はわからない）
- `gm` が page 指定で使えない場合は、設定とキャッシュの保存先を見直す

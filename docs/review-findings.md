# 計画の敵対的レビュー結果

工程 1 の着手時に、計画（YouTube コメントフィルタ構築方針）を 2 観点（実行環境と API / DOM と判定ロジック）で敵対的にレビューした結果。工程 2 の仕様を確定するときの入力にする。spike で確かめられる項目は `docs/spike.md` の計測に組み込み済み。

## blocker

### 隔離世界からはコメント ID・UC チャンネル ID を読めない可能性

- 問題: 既定の content 注入（隔離世界）では Polymer 要素の .data 等ページ JS の expando が見えない。新しいレイアウトの DOM には /@handle のリンクしか無く、UC ID と安定したコメント ID が取れないと NG ユーザ（UC）とキャッシュキーが成立しない。
- 計画の変更案: 注入世界は LanguageModel だけでなく ID の取得元でも決める。page 世界が必要なら @inject-into page を明示して固定し、auto には任せない。UC ID を取れない場合は、NG ユーザを handle のみにするか UC→handle 解決の手段を仕様に書く
- spike での確認: 両方の世界で ytd-comment-thread-renderer（または ytd-comment-view-model）の .data / __data の有無を確認し、タイムスタンプリンク href の lc= パラメータ、作者リンク href から UC ID とコメント ID を取れるかを docs/spike.md に記録する

### コメント欄を既定で隠すと YouTube の遅延読み込みが発火しない

- 問題: YouTube はコメントの読み込み（continuation）を交差監視で起動する。ytd-comments を display:none で閉じると、スピナーが表示領域に入らず、コメントが一切取得されないおそれがある。開いた後もフィルタで全件が非表示になると次ページの読み込みが止まりうる。
- 計画の変更案: 「閉じる」の実装方式（DOM は描画したまま隠す、ボタン押下後に再スクロールを促す等）を仕様に明記する。全件が非表示のときも continuation の要素が表示領域に残るようにする
- spike での確認: #comments に display:none を当てたままスクロールし、ytd-comment-thread-renderer が追加されるかを数える。visibility:hidden / height:0 の場合と比較する

### コメント ID・UC チャンネル ID を DOM だけでは取れない可能性がある

- 問題: ytd-comment-view-model 世代では作者リンクの href は /@handle が主で、UC ID は DOM に出ないことがある。Polymer の data やエンティティストアは page world の JS プロパティなので、Violentmonkey 既定の content（isolated world）からは読めない。
- 計画の変更案: ID の取得元を spike の結果で確定させる。commentId はタイムスタンプ href の lc= を第一候補にする。UC ID が page world でしか取れないなら @inject-into page に固定するか、UC 指定の NG を handle の解決に置き換える。ID が取れないときのキャッシュキー（作者+本文ハッシュ）も仕様に足す
- spike での確認: 実ページで $0.closest('ytd-comment-view-model') の outerHTML と、page world での $0.data / __data / polymerController を dump する。UC ID と commentId（タイムスタンプリンク &lc= を含む）がどこから取れるかを、isolated world と page world の両方で記録する

## major

### create() のユーザー操作要件の理解がずれている

- 問題: 仕様上、ユーザー操作が要るのは availability() が downloadable / downloading の場合（ダウンロード開始時）で、available なら不要と読める。コメント欄を既定で閉じる根拠がこの要件だけなら設計の前提が崩れる。逆に、クリック後に GM_getValue 等を await してから create() を呼ぶと、一時的なユーザー操作の有効期限が切れうる。
- 計画の変更案: コメント欄を閉じる目的（判定待ちの体験・誤爆の防止）とユーザー操作要件を分けて書く。downloadable のときの扱い（ダウンロードを促す／ルールのみ）を仕様に加え、create() はハンドラ内で同期的に最初に呼ぶ
- spike での確認: available 状態で、ユーザー操作のない読み込み直後に create() が成功するかを確認する。downloadable の環境ではクリックハンドラ内で await を挟んでから create() を呼び、失敗するかを確認する

### availability() の確認場所と引数が本番と一致しているか不明

- 問題: Chrome 155 で available を確認した文脈（DevTools のトップレベル、youtube.com のどちらの世界か、expectedInputs の言語指定の有無）が不明。日本語の入出力指定（expectedInputs / expectedOutputs の languages:['ja']）の有無で結果が変わったり、create() で例外になったりしうる。
- 計画の変更案: availability() と create() には常に同じオプションオブジェクトを渡すことを仕様に入れ、spike の記録項目に注入世界とオプションを加える
- spike での確認: youtube.com 上で、スクリプトと同じ注入世界から、本番と同じオプション（expectedInputs/expectedOutputs に ja）を渡して availability() と create() を実行し、結果を記録する

### 10 件まとめた prompt が入力上限と文脈の蓄積で失敗しうる

- 問題: セッションには inputQuota があり、responseConstraint のスキーマも既定で入力に数えられる。同じセッションで prompt() を繰り返すと履歴が積もり、上限超過（QuotaExceededError）や古い文脈の追い出しが起き、判定が先行バッチの影響を受ける。長いコメントが 10 件あると 1 回分でも超えうる。
- 計画の変更案: バッチは件数ではなく measureInputUsage で切る。システム指示を initialPrompts に入れた基底セッションをバッチごとに clone() して履歴を持ち越さない。1 件ごとの文字数に上限を設け、切り詰める
- spike での確認: measureInputUsage() と inputQuota を記録し、長文 10 件を同じセッションで 5 回連続して prompt() したときの例外と inputUsage の推移を測る。omitResponseConstraintInput の有無による差も測る

### 判定完了まで非表示にすると体験が破綻しうる推論時間

- 問題: 端末内の Nano は、初回のモデル読み込みと構造化出力で 1 バッチ数秒〜十数秒かかりうる。逐次実行でコメント数十件なら、欄を開いてもしばらく空になる。タイムアウトしたコメントは非表示のまま「判定待ち」に数えるだけなので、永久に見えないコメントが生じる。
- 計画の変更案: 許容する待ち時間の閾値を spike の結果から数値で決めて仕様に書く。表示順に近いものから優先判定する。判定待ちの件数を押すと一時表示する手段か、再判定する手段を仕様に加える
- spike での確認: 1 件と 10 件の所要時間を、create 直後の初回、2 回目以降、長文ありの 3 条件で測る（工程 1 の計測を拡張する）

### SPA 遷移と要素の再利用で判定済みの印が古くなる

- 問題: YouTube は遷移や並べ替えで ytd-comment-thread-renderer を作り直さずにデータだけ差し替えることがある。childList の監視と要素に付けた印だけだと、別のコメントに古い判定が残る。遷移時に実行中の prompt() が前の動画の結果を書き込む。
- 計画の変更案: 判定の対応付けは要素ではなくコメント ID で行い、描画のたびに ID を再取得して照合する。遷移時は AbortController で prompt() を中断し、結果の反映前に現在の動画 ID を確認する
- spike での確認: 動画 A→B の遷移と「新しい順」への切替で、同じ要素インスタンスが再利用されるか（WeakMap の印と表示 ID を比べる）を確認する

### @inject-into page と GM_*・CSP・Trusted Types の両立が未確認

- 問題: YouTube は CSP と require-trusted-types-for 'script' を強制している。page 注入が失敗して content に落ちうるほか、innerHTML 代入が例外になる。page モードで GM_setValue が使えるかも前提になっている。
- 計画の変更案: DOM 生成は createElement/textContent に限定することを規約にする。spike で page 注入が不安定なら、content で LanguageModel を使い、ID 取得だけ page world へ CustomEvent で橋渡しする 2 層構成を検討する
- spike での確認: @inject-into page で typeof GM_setValue、typeof LanguageModel、実際に注入された world（window.ytInitialData が見えるか）を console に出す。div.innerHTML='x' が TrustedHTML 違反になるかを確かめる

### 判定待ちの非表示が継続読み込みを暴走させる

- 問題: 保留中のコメントを display:none にするとリストの高さがほぼ 0 になる。ytd-continuation-item-renderer がすぐ可視になって次ページを連続で読み、全件の取得と大量の prompt() を誘発しうる。
- 計画の変更案: 保留中は高さを保つ placeholder（1 行の「判定中」帯）に置き換えるか、continuation 要素を判定キューが空になるまで退避させる。判定キューに上限と backpressure を設ける
- spike での確認: 全スレッドを display:none にした状態でコメント欄を開き、ytd-comment-thread-renderer の数が勝手に増え続けるかを 30 秒観測する

### 要素の再利用・SPA 遷移で判定結果を取り違える

- 問題: Polymer は SPA 遷移や並び替え（人気順/新しい順）でも ytd-comments とスレッド要素を再利用し、data だけを差し替えることがある。data-processed 等のノード単位の印や遅れて返った prompt 結果が、別のコメントに適用されうる。
- 計画の変更案: 判定の結果は commentId をキーにし、適用直前に要素の現在の ID と照合する。遷移ごとに generation 番号を進め、古い generation の prompt 結果は破棄する（AbortSignal も渡す）。MutationObserver は属性・テキストの変化（ID の差し替え）も拾う
- spike での確認: 動画 A のコメント要素に WeakMap で印を付けてから動画 B へ SPA 遷移・並び替えを行い、同じノードが別の commentId で残るかを確認する

### RegExp を正規化後の本文に当てると利用者の元表記の正規表現が合わない

- 問題: /ゴミ|カス/ はひらがな化で一致しなくなる。\s・記号を前提にした /https?:\/\// /\bfoo\b/ や 、。 を含むパターンも壊れる。利用者は正規化の結果を見られないので原因に気づけない。
- 計画の変更案: 文字列 NG は正規化後に照合し、RegExp は NFKC のみの本文に当てる（または両方に当てて OR）を既定にする。正規化テキストを確認できるデバッグ表示を用意する。u フラグを強制し、ReDoS 対策として長さ上限と try/catch を入れる

### 正規化（ひらがな化・記号/空白除去）で誤検出が増える

- 問題: 空白・記号の除去で単語の境界をまたいだ一致が起きる（「あ ほ」→「あほ」）。カタカナの「カス」が「かすかに」に一致する等、短い語ほど誤爆する。\p{S} 除去で絵文字だけのコメントは空文字になる。
- 計画の変更案: node:test に誤検出例（かすかに・境界またぎ・絵文字のみ）を固定する。短い語（2 文字以下）は単語境界モードか完全一致を選べるようにし、空文字化した本文は照合しない

### ハンドルの照合と本文の正規化が衝突する

- 問題: ハンドルは `.` `_` `-` を含みうるが、`\p{P}` 除去を通すと `@foo_bar` と `@foobar` が同一視される。@返信の宛先が表示名テキストのみ（旧コメントや href が /channel/UC…）の場合、ハンドル NG と一致しない。
- 計画の変更案: ユーザー判定とメンション判定は本文の正規化を通さず、href から抽出したハンドルを小文字化して完全一致で照合する。href が UC 形式なら UC NG と照合する。表示名テキストのみの宛先は対象外と明記する
- spike での確認: 返信先頭のメンションの `<a>` の href とテキストを、ハンドル・旧表示名・UC 形式の 3 パターンで採取する

### Gemini Nano の入力枠とセッションの文脈の蓄積

- 問題: 同一セッションで prompt() を重ねると履歴が溜まり、inputQuota を超えて QuotaExceeded や先頭の破棄が起きる。10 件まとめると長文で 1 回の枠を超えうる。並列 prompt は直列化される。
- 計画の変更案: バッチごとにベースセッションを clone() するか initialPrompts 付きで作り直す。バッチは件数でなく measureInputUsage で詰める。キューは 1 本に直列化する
- spike での確認: session.inputQuota、measureInputUsage(10 件分)、5 バッチ後の inputUsage を記録する。expectedInputs/expectedOutputs に languages:['ja'] を渡したときの create の成否も見る

### responseConstraint の出力 ID を信頼している

- 問題: スキーマで形は縛れても、ID の欠落・重複・入力に無い ID の捏造は防げない。欠落分を「判定済み・表示」と扱うと NG を素通しする。
- 計画の変更案: ID を短い連番（c0..c9）に置き換えて渡し、戻りを入力集合と突合する。欠落分は単件で再判定し、それでも欠落すれば判定待ちに数える。category は enum で縛る
- spike での確認: 10 件バッチを 20 回回し、返却 ID 集合と入力 ID 集合の差分の発生率を記録する

### 段階表示とクリック固定が YouTube 自身の展開・リンクと衝突する

- 問題: 本文には「もっと見る/一部を表示」(#expander)、タイムスタンプ（シーク）、@メンション、ハッシュタグ、URL がある。独自の line-clamp で YouTube の溢れ判定が狂い、クリック固定がリンク操作を奪う。タッチ端末にはホバーが無い。
- 計画の変更案: クリック判定は target.closest('a,button,tp-yt-paper-button,#expander') を除外する。clamp は YouTube の expander と別のラッパー要素に当てるか、全文固定時は YouTube 側の展開状態を尊重する。ホバーの代替（キー操作・タップ）を決める
- spike での確認: 本文に -webkit-line-clamp:1 を当てたときの #expander のボタン表示状態と、本文内のタイムスタンプをクリックしたときのイベント経路（target・preventDefault の有無）を確認する

## minor

### 単一キーの GM_setValue キャッシュは書き込みコストとタブ間競合を抱える

- 問題: 上限付きキャッシュを 1 つのキーに丸ごと保存すると、更新のたびに全体を直列化して拡張機能のストレージへ送る。複数タブで同時に書くと最後の書き込みで上書きされる。Violentmonkey のストレージ容量の上限と書き込みの遅延も未確認。
- 計画の変更案: 書き込みは debounce でまとめる。上限件数と削除方式（古い順）を数値で決める。タブ間の取りこぼしは「再判定されるだけ」として受容することを仕様に明記する
- spike での確認: 5,000 件規模のオブジェクトで GM_setValue の所要時間を測る。2 タブで同時に追記し、取りこぼしを確認する

### unavailable 時の挙動と「判定完了まで非表示」の関係が未定義

- 問題: Linux の機種・GPU・空き容量の要件を満たさない環境では unavailable か downloadable になる。ルールのみに倒すときに判定待ちの非表示が発生しないか、途中でエラーになったときに保留中のコメントを表示に戻すかが書かれていない。
- 計画の変更案: 状態遷移（unavailable / downloadable / エラー / タイムアウト）ごとに、保留中のコメントを表示するか非表示を続けるかを表にして仕様に入れる
- spike での確認: LanguageModel を未定義にする、availability を unavailable にする、prompt() が例外を投げる、の 3 つを差し替え（stub）で再現し、非表示のまま残るコメントが無いかを確認する（Linux 実機は無くても再現できる）

### 正規化後に照合する RegExp と記号・絵文字の NG ワードが矛盾する

- 問題: \p{P}\p{S}\s を除いてから照合するため、記号・絵文字・空白・カタカナを含む NG パターンは決して一致しない。RegExp の境界（\b、スペース）も意味を失う。
- 計画の変更案: NG ワード（パターン）にも同じ正規化を適用するか、RegExp は生テキストに照合するかを仕様で決め、node:test で記号と絵文字のケースを固定する

### responseConstraint の出力に存在しない ID が混じりうる

- 問題: スキーマで形を縛っても、ID の値の取り違え・欠落・重複は防げない。コメント本文に指示文が含まれると、判定が誘導されうる。
- 計画の変更案: 出力の ID を入力と突き合わせ、欠落した ID は再判定かタイムアウトとして扱う。ID はバッチ内の連番に置き換えて渡す
- spike での確認: 10 件の判定で、入力 ID の集合と出力 ID の集合が一致した割合を記録する。ID を enum でスキーマに埋め込んだ場合とも比較する

### コメントのタグ名と構造が世代で混在する

- 問題: スレッドは ytd-comment-thread-renderer、本体は ytd-comment-view-model（旧 ytd-comment-renderer）。返信は ytd-comment-replies-renderer 配下に遅延挿入される。A/B テストで旧構造が残る利用者もいる。
- 計画の変更案: セレクタを 1 モジュールに集約して両世代に対応し、未知の構造では fail-open（表示）にしてログを出す
- spike での確認: 親・返信・「他の返信を表示」後の各要素のタグ名とセレクタを記録し、ログアウト状態でも同じかを見る

### 返信の遅延展開と親子の扱いが仕様にない

- 問題: 返信は「N 件の返信」クリックと continuation で後から入る。親が NG のとき返信をどうするか、件数を親子別に数えるか、返信だけ判定待ちのときの親の表示が決まっていない。
- 計画の変更案: 親 NG 時はスレッドごと隠す等の規則と件数の定義（スレッド単位/コメント単位）を仕様に明記する。返信は展開時に別バッチで判定する

### 判定待ちの解除経路と遅延の上限が仕様にない

- 問題: タイムアウト後は非表示のまま判定待ちに数えるが、再試行・手動表示・キャッシュしない旨が決まっていない。1 バッチ数秒なら、開いた直後に長時間何も見えない。
- 計画の変更案: 判定待ちの件数の表示から個別/一括で開ける操作を仕様に足す。タイムアウトの結果はキャッシュしない。初回は先頭数件を優先する等の順序制御を決める
- spike での確認: 1 件・10 件の所要時間に加えて、初回 create 直後のバッチ（ウォームアップ前）を別に計測する

### 「コメントを表示」のクリックを create() のユーザー操作にする前提

- 問題: user activation が要るのは availability が downloadable/downloading のときで、available なら不要。一方、クリック後に await（GM_getValue 等）を挟むと一時的な activation が切れうる。SPA 遷移後に欄を閉じ直す仕様では毎回クリックが要る。
- 計画の変更案: create() はハンドラの最初の同期区間で開始し、セッションは遷移をまたいで再利用する。欄の既定の開閉を遷移ごとに戻すかを仕様に明記する
- spike での確認: クリックハンドラ内で GM_getValue を await した後に LanguageModel.create() を呼び、downloadable 状態を模して成否を見る（可能なら別プロファイル）

### GM_setValue キャッシュの書き込みの増幅

- 問題: 上限付きキャッシュを 1 キーのオブジェクトで持つと、判定のたびに全体をシリアライズして保存し、件数が増えるほど遅くなる。複数タブの同時書き込みで後勝ちになり、結果が失われる。
- 計画の変更案: 書き込みはデバウンスしてまとめる。LRU の上限と追い出しは純粋関数にして node:test で固定する。タブ間の競合は許容する旨を明記する

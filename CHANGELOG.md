# Changelog

## [0.6.0](https://github.com/hazymoon/youtube-comment-filter/compare/v0.5.2...v0.6.0) (2026-10-30)


### Features

* NG ワードの照合で、キリル文字などラテン文字に似た文字を同じ文字とみなす ([#41](https://github.com/hazymoon/youtube-comment-filter/issues/41)) ([903f0fe](https://github.com/hazymoon/youtube-comment-filter/commit/903f0febd764ec3dbc360409f8b1a30b990f1e4b))
* 動画の投稿者になりすましたコメントを隠す ([#46](https://github.com/hazymoon/youtube-comment-filter/issues/46)) ([090bdb1](https://github.com/hazymoon/youtube-comment-filter/commit/090bdb1ef1f50da0d34873e845cc56959e7f0ce4))
* 設定ブロックの値を「値」タブで変えられるようにし、自動更新後も残す ([#42](https://github.com/hazymoon/youtube-comment-filter/issues/42)) ([9f7b086](https://github.com/hazymoon/youtube-comment-filter/commit/9f7b08618170585d51527e5a8c9e4638641901ac))
* 許可したドメイン以外へのリンクを含むコメントを隠せるようにする ([#45](https://github.com/hazymoon/youtube-comment-filter/issues/45)) ([bf647da](https://github.com/hazymoon/youtube-comment-filter/commit/bf647da7cb7e01fe7cd6cd418c793f8d58a9b986))
* 隠したコメントの理由を帯で表示し、押すと一時的に表示する ([#44](https://github.com/hazymoon/youtube-comment-filter/issues/44)) ([1467d1a](https://github.com/hazymoon/youtube-comment-filter/commit/1467d1a0bc5c4c0a1107d5cdba17309626389c9f))

## [0.5.2](https://github.com/hazymoon/youtube-comment-filter/compare/v0.5.1...v0.5.2) (2026-10-29)


### Bug Fixes

* Shorts で次の動画へ移り続けても、AI の判定が遅れていかないようにする ([#38](https://github.com/hazymoon/youtube-comment-filter/issues/38)) ([3f01429](https://github.com/hazymoon/youtube-comment-filter/commit/3f0142923798f630642329436b74e0fd95a27b0f))
* タブが休止したあとも、AI の判定が止まったままにならないようにする ([#39](https://github.com/hazymoon/youtube-comment-filter/issues/39)) ([f1718f7](https://github.com/hazymoon/youtube-comment-filter/commit/f1718f7c4941e9eed386321be850ec591972e375))

## [0.5.1](https://github.com/hazymoon/youtube-comment-filter/compare/v0.5.0...v0.5.1) (2026-10-28)


### Bug Fixes

* Shorts で次の動画へ移ったあとも、コメント欄とツールバーが表示されるようにする ([#36](https://github.com/hazymoon/youtube-comment-filter/issues/36)) ([29eef11](https://github.com/hazymoon/youtube-comment-filter/commit/29eef11f268ad447316b960953c87b226a7ba3b1))

## [0.5.0](https://github.com/hazymoon/youtube-comment-filter/compare/v0.4.1...v0.5.0) (2026-10-27)


### Features

* キーボードだけでも、コメントの本文を全文まで読めるようにする ([#33](https://github.com/hazymoon/youtube-comment-filter/issues/33)) ([1e6fd28](https://github.com/hazymoon/youtube-comment-filter/commit/1e6fd281cddd907cd8051e0ead22412ca606eedb))

## [0.4.1](https://github.com/hazymoon/youtube-comment-filter/compare/v0.4.0...v0.4.1) (2026-10-27)


### Bug Fixes

* NG 登録でコメントが隠れたあとも、キーボードで続けて操作できるようにする ([#32](https://github.com/hazymoon/youtube-comment-filter/issues/32)) ([4bccb6d](https://github.com/hazymoon/youtube-comment-filter/commit/4bccb6d97b3e3e8d3a3984f50138e4d6f1751d3c))

## [0.4.0](https://github.com/hazymoon/youtube-comment-filter/compare/v0.3.0...v0.4.0) (2026-10-26)


### Features

* NG ボタンにキーボードだけでも移動して押せるよう、コメント内にフォーカスがあるときも見せる ([#20](https://github.com/hazymoon/youtube-comment-filter/issues/20)) ([2e5a1b1](https://github.com/hazymoon/youtube-comment-filter/commit/2e5a1b1a8c7c099162a8c4a4efe75db7688b7b1c))
* ホバーで本文の高さが伸縮してレイアウトが動かないよう、段階表示の高さを最初から確保する ([#21](https://github.com/hazymoon/youtube-comment-filter/issues/21)) ([33a61fa](https://github.com/hazymoon/youtube-comment-filter/commit/33a61fa4cb9df4cfbcb7288f817e3664419c052c))


### Bug Fixes

* 判定から外す条件のデータが後から届いたコメントを、次のスキャンで判定から外せるようにする ([#19](https://github.com/hazymoon/youtube-comment-filter/issues/19)) ([e4bd991](https://github.com/hazymoon/youtube-comment-filter/commit/e4bd9917125abee4256e6c429a6359cf37634c1c))
* 固定の印の hidden だけが付け外しされたときも判定し直せるよう、コメント欄の監視で hidden 属性を受け取る ([#19](https://github.com/hazymoon/youtube-comment-filter/issues/19)) ([0579114](https://github.com/hazymoon/youtube-comment-filter/commit/0579114963518e19ddb527b04f56d91f21c6d162))
* 設定で外していない条件や結果を変えない変化で判定し直さないよう、判定から外すかどうかの結果を記録して比べる ([#19](https://github.com/hazymoon/youtube-comment-filter/issues/19)) ([cbc92b6](https://github.com/hazymoon/youtube-comment-filter/commit/cbc92b6946254bdeb3956f0bc6a979066d67d525))
* 翻訳で本文が差し替わっても AI に送り直さないよう、原文を polymer のデータから読む ([#26](https://github.com/hazymoon/youtube-comment-filter/issues/26)) ([e80334b](https://github.com/hazymoon/youtube-comment-filter/commit/e80334b8867c63071e461ff7351ef0c156907d68))

## [0.3.0](https://github.com/hazymoon/youtube-comment-filter/compare/v0.2.0...v0.3.0) (2026-10-23)


### Features

* 投稿者・固定コメント等を判定から外し、コメントから NG ユーザに登録できるようにする ([#14](https://github.com/hazymoon/youtube-comment-filter/issues/14)) ([6e53a0e](https://github.com/hazymoon/youtube-comment-filter/commit/6e53a0e3eeb2e8970b2bc78b4576b6bc177a4780))

## [0.2.0](https://github.com/hazymoon/youtube-comment-filter/compare/v0.1.1...v0.2.0) (2026-10-23)


### Features

* Shorts のコメント欄にも同じフィルタを掛ける ([#4](https://github.com/hazymoon/youtube-comment-filter/issues/4)) ([c5183e6](https://github.com/hazymoon/youtube-comment-filter/commit/c5183e6ed9556266eb8211c0e2cd70302b836dc9))

## [0.1.1](https://github.com/hazymoon/youtube-comment-filter/compare/v0.1.0...v0.1.1) (2026-10-22)


### Bug Fixes

* YouTube の色変数の改名でダークモードの件数バーが黒文字になり読めないため直す ([#2](https://github.com/hazymoon/youtube-comment-filter/issues/2)) ([bfe6983](https://github.com/hazymoon/youtube-comment-filter/commit/bfe698333431fe75726e999663db3e30de1cf3ed))

## 0.1.0 (2026-10-21)


### Features

* コメントの照合と AI 判定の入出力を DOM から切り離して実装 ([c29ce44](https://github.com/hazymoon/youtube-comment-filter/commit/c29ce4449a90511f0d8ead2a4d520ef391162257))
* コメント欄で NG・AI 判定を実際に効かせるため DOM 層と UI を結線 ([34e8655](https://github.com/hazymoon/youtube-comment-filter/commit/34e86554f68c2b54790cd1811f9f7b41701ca1fb))
* 隠した割合で開くか判断できるよう件数バーに総数を出し、AI が隠したコメントを DEBUG で確かめられるようにする ([b12cf91](https://github.com/hazymoon/youtube-comment-filter/commit/b12cf919ee32ea47bcb0e5264f116c08f4f80eda))
* dist を貼り替えても NG 設定が消えないよう、Violentmonkey の値にも NG ユーザ・NG ワードを書けるようにする ([60ef1f7](https://github.com/hazymoon/youtube-comment-filter/commit/60ef1f77907ab0b9cb8c70d73e1dcf2329aedf97))
* 集団や出来事への一方的な決めつけも隠すため AI のカテゴリに「偏見・決めつけ」を足す ([318b970](https://github.com/hazymoon/youtube-comment-filter/commit/318b970dc67623fc7eb43ff4f94d503ed8010191))
* 短いコメントが既定の 1 行表示で全文見えないよう、文頭の数文字だけを見せる ([dfad627](https://github.com/hazymoon/youtube-comment-filter/commit/dfad627f0cb6007c13ce89b2b3aa7a3595ac9a86))
* ホバーで全文が一度に見えないよう、少し待ってから 1 行ずつ左から右へ見せる ([386c5bf](https://github.com/hazymoon/youtube-comment-filter/commit/386c5bf9e2f74088ad9feed39eadb3a355ca8107))
* Release から自動更新されるようにユーザスクリプトのメタデータに配布元を書く ([341ffe6](https://github.com/hazymoon/youtube-comment-filter/commit/341ffe629d586869fd27b62ee440daf593951a10))

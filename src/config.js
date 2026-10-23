/**
 * @file 利用者が編集する設定。
 * Violentmonkey のエディタでこのブロックの値を書き換えて保存すると反映される。
 *
 * NG_USERS・NG_WORDS・ALLOW_USERS は、Violentmonkey のスクリプトの「値」タブの ngUsers / ngWords / allowUsers にも文字列の配列で書ける。
 * 値はスクリプトを貼り替えても残るので、こちらに書くとよい（ここに書いた分と合わせて使う）。
 * 正規表現は "/死ね|しね/i" のように / で囲んだ文字列で書く。値の名前は初回の起動で空の配列として作られる。
 */

/**
 * 非表示にするユーザ。投稿者と、返信の先頭の @メンションの宛先の両方に効く。
 * ハンドル（"@" で始まる）とチャンネル ID（"UC" + 22 文字）を混在して書ける。
 * ハンドルは大文字小文字を区別しない。チャンネル ID は区別する。
 *
 * @example
 * export const NG_USERS = [
 *   '@example_handle',
 *   'UCxxxxxxxxxxxxxxxxxxxxxx',
 * ];
 * @type {string[]}
 */
export const NG_USERS = [];

/**
 * 非表示にする語。文字列と正規表現を混在して書ける。
 * 文字列は、本文と同じ正規化（全角半角の統一・小文字化・カタカナをひらがなに・記号と空白の除去）をしてから部分一致で照合する。
 * 短い語は別の語の一部にも一致するので（「かす」が「かすかに」に一致する等）、2 文字以下の語は正規表現で書くとよい。
 * 正規表現は、全角半角だけ統一した本文と、文字列と同じ正規化をした本文の両方に当て、どちらかで一致すれば非表示にする。
 *
 * @example
 * export const NG_WORDS = [
 *   'ネタバレ',
 *   /死ね|しね/,
 *   /https?:\/\/bit\.ly\//i,
 * ];
 * @type {(string|RegExp)[]}
 */
export const NG_WORDS = [];

/**
 * 判定から外して常に表示するユーザ。書式は NG_USERS と同じ。
 * NG_USERS・NG_WORDS・AI のどの判定よりも優先する（NG_USERS と両方に書くと表示になる）。
 * Violentmonkey の「値」タブの allowUsers にも書ける。
 * @type {string[]}
 */
export const ALLOW_USERS = [];

/**
 * 動画のチャンネル所有者のコメントを判定から外して常に表示するか。
 * @type {boolean}
 */
export const EXEMPT_OWNER = true;

/**
 * 固定コメントを判定から外して常に表示するか。
 * @type {boolean}
 */
export const EXEMPT_PINNED = true;

/**
 * 認証バッジ付きのチャンネルのコメントを判定から外して常に表示するか。
 * @type {boolean}
 */
export const EXEMPT_VERIFIED = true;

/**
 * 端末内の AI（Chrome の Prompt API）で不快なコメントを判定するか。
 * false にするか、端末で AI が使えないときは、NG_USERS と NG_WORDS だけで判定する。
 * @type {boolean}
 */
export const AI_ENABLED = true;

/**
 * AI に判定させるカテゴリ。name は判定結果の表示に使い、description は AI への判定基準の説明になる。
 * 変更すると過去の判定結果のキャッシュは使われなくなり、判定し直す。
 * @type {{ name: string, description: string }[]}
 */
export const AI_CATEGORIES = [
  {
    name: '人格攻撃・侮辱',
    description: '特定の人（投稿者・出演者・他のコメント投稿者など）の能力・容姿・人格をけなす、ばかにする、見下す表現。',
  },
  {
    name: '差別・ヘイト',
    description: '人種・民族・国籍・性別・性的指向・障害・宗教・出身地などの属性を理由に、人や集団をおとしめる、排除を求める表現。',
  },
  {
    name: '煽り・挑発',
    description: '相手を怒らせる・言い争いに引き込む目的で、からかう、挑発する、喧嘩を売る表現。',
  },
  {
    name: '暴言',
    description: '「死ね」「消えろ」などの乱暴な言葉や脅し、相手に危害を加えることをほのめかす表現。',
  },
  {
    name: '偏見・決めつけ',
    description:
      '国籍・民族・宗教・移民・政党・報道機関などの集団や、ニュースの出来事について、根拠を示さずに一方的に断定する、悪者と決めつける、陰謀論を述べる、対立をあおる表現。攻撃的な言葉が無くても当てはまる。',
  },
];

/**
 * 1 回の AI 呼び出しでまとめて判定するコメントの件数。1 にすると 1 件ずつ判定する。
 * 所要時間は件数にほぼ比例し、まとめても速くならない（docs/spike.md）。
 * まとめると、本文に埋めた指示で同じバッチの他のコメントの判定を変えられるため、既定は 1 にする。
 * 2 以上のとき、まとめた判定で隠すとされたコメントは 1 件ずつ判定し直してから隠す（src/queue.js の createAiQueue）。
 * そのぶん隠すコメントが多いほど判定に時間がかかる。
 * 隠さないとされたコメントは判定し直さないので、同じバッチの他のコメントの指示で表示にされうる。
 * 変更すると過去の判定結果のキャッシュは使われなくなり、判定し直す（方式を比べられるようにするため）。
 * @type {number}
 */
export const AI_BATCH_SIZE = 1;

/**
 * AI の同時実行数。同一セッションへの同時投入は UnknownError で失敗し、
 * clone した 2 セッションの同時実行も順に投げるより遅かったため（docs/spike.md）、1 本に並べて順に処理する。
 * 順番待ち（src/queue.js の createAiQueue）は 1 本で直列に処理する作りで、この値を読まない。
 * 1 以外の値は未計測で、変えても同時実行数は増えない。
 * @type {number}
 */
export const AI_CONCURRENCY = 1;

/**
 * 1 バッチの判定にかける時間の上限（ミリ秒）。
 * 実測の所要時間（docs/spike.md）に、端末の負荷による揺れを見込んだ余裕を持たせる。
 * 超えたコメントは「判定待ち」として扱い、1 回だけ判定し直す。
 * @type {number}
 */
export const AI_TIMEOUT_MS = 30000;

/**
 * AI に渡す 1 コメントの本文の最大文字数。超えた分は切り捨てる。
 * セッションの入力枠を長文 1 件で使い切らないようにするため。
 * @type {number}
 */
export const AI_MAX_CHARS = 500;

/**
 * AI の判定結果を保存しておく件数の上限。超えたら最後に使った時期が古いものから捨てる。
 * 保存は全件をまとめて書き込むため、件数が増えるほど 1 回の書き込みが重くなる。
 * @type {number}
 */
export const AI_CACHE_MAX_ENTRIES = 5000;

/**
 * 表示するコメントで、既定で見せる文頭の文字数（全角文字の幅で数える目安）。
 * 1 行に収まる短いコメントでも全文が見えないようにするため。ホバーで 4 行、クリックで全文になる。
 * @type {number}
 */
export const PREVIEW_CHARS = 25;

/**
 * マウスを乗せてから、続きを見せ始めるまでの待ち時間（ミリ秒）。
 * スクロール中にマウスが通り過ぎただけで見え始めないようにするため。
 * @type {number}
 */
export const REVEAL_DELAY_MS = 300;

/**
 * マウスを乗せたとき、続きを 1 行ぶん左から右へ見せるのにかける時間（ミリ秒）。4 行ぶんを読む順に見せる。
 * 不快だと判断した時点でマウスを外せば、残りは見えずに文頭だけの表示に戻る。
 * @type {number}
 */
export const REVEAL_MS_PER_LINE = 700;

/**
 * true にすると、判定の経過を DevTools の console に出す。
 * @type {boolean}
 */
export const DEBUG = false;

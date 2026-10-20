/**
 * @file 利用者が編集する設定。
 * Violentmonkey のエディタでこのブロックの値を書き換えて保存すると反映される。
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
];

/**
 * 1 回の AI 呼び出しでまとめて判定するコメントの件数。1 にすると 1 件ずつ判定する。
 * 所要時間は件数にほぼ比例し、まとめても速くならない（docs/spike.md）。
 * まとめると、本文に埋めた指示で同じバッチの他のコメントの判定を変えられるため、既定は 1 にする。
 * 2 以上のとき、まとめた判定で隠すとされたコメントは 1 件ずつ判定し直してから隠す（src/queue.js の createAiQueue）。
 * そのぶん隠すコメントが多いほど判定に時間がかかる。
 * 隠さないとされたコメントは判定し直さないので、同じバッチの他のコメントの指示で表示にされうる。
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
 * true にすると、判定の経過を DevTools の console に出す。
 * @type {boolean}
 */
export const DEBUG = false;

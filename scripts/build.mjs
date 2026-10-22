/**
 * @file src の ES modules を 1 つのユーザスクリプトに結合する。
 *
 * バンドラを入れずに済ませるため、変換は行単位の単純なものに限る。
 * - import 文（複数行を含む）を削除する
 * - 行頭の "export " を取り除く
 * - export default / export { } / export * はこの変換では扱えないのでエラーにする
 * - 全モジュールが 1 つのスコープに入るため、top-level の名前が重複したらエラーにする
 *
 * 変換は文字列・コメント・テンプレートリテラルの文脈を見ない。そのため、それらの中に列 0 から
 * import / export で始まる行を書くと、中身が黙って書き換わる。変換した位置がコードの中かを
 * vm.Script で確かめ、そうでなければエラーにする。
 * 重複の検出は正規表現で拾える宣言に限られるので、結合後の全文もコンパイルし、
 * const / let / class の重複（分割代入・複数宣言子を含む）はその SyntaxError で止める。
 *
 * `node scripts/build.mjs` で実行すると dist/youtube-comment-filter.user.js に書き出す。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** src のディレクトリ */
export const SRC_DIR = join(ROOT_DIR, 'src');

/** 出力先 */
export const OUTPUT_PATH = join(ROOT_DIR, 'dist', 'youtube-comment-filter.user.js');

/**
 * 結合する順序。利用者が設定を読みやすいように config.js を先頭に置き、起動処理の main.js を最後に置く。
 * 依存されるモジュールを先に置く（関数宣言は巻き上がるが、const は宣言前に使えないため）。
 */
export const MODULE_ORDER = [
  'config.js',
  'normalize.js',
  'hash.js',
  'rules.js',
  'ai.js',
  'cache.js',
  'queue.js',
  'selectors.js',
  'dom.js',
  'decide.js',
  'styles.js',
  'ui.js',
  'lm.js',
  'scanner.js',
  'navigation.js',
  'settings.js',
  'main.js',
];

/** ユーザスクリプトのメタデータ */
export const USERSCRIPT_META = [
  ['name', 'YouTube Comment Filter'],
  ['namespace', 'https://github.com/hazymoon/youtube-comment-filter'],
  ['version', '0.1.1'],
  ['description', 'YouTube のコメント欄を、NG ユーザ・NG ワードと端末内の AI（Chrome の Prompt API）の判定で絞り込みます'],
  ['homepageURL', 'https://github.com/hazymoon/youtube-comment-filter'],
  ['supportURL', 'https://github.com/hazymoon/youtube-comment-filter/issues'],
  // 開発中の main ではなくリリースしたものだけを配るため、最新の Release の添付ファイルを指す。
  // 更新はこの URL のファイルの @version が上がったときだけ検知される。
  ['downloadURL', 'https://github.com/hazymoon/youtube-comment-filter/releases/latest/download/youtube-comment-filter.user.js'],
  ['updateURL', 'https://github.com/hazymoon/youtube-comment-filter/releases/latest/download/youtube-comment-filter.user.js'],
  ['match','https://www.youtube.com/*'],
  ['run-at', 'document-start'],
  ['inject-into', 'page'],
  ['grant', 'GM_getValue'],
  ['grant', 'GM_setValue'],
  ['noframes', ''],
];

// Alternatives: import ... from '...'; | import '...'; | leading "export ".
// The import clause excludes quotes, backticks, slashes and semicolons so that a match cannot run past
// the end of a statement, a comment, or a string into later code.
const MODULE_SYNTAX_PATTERN =
  /^import\s+[^;'"`/]*?\sfrom\s*(['"])[^'"\n]*\1[ \t]*;?[ \t]*(?:\r?\n|$)|^import\s*(['"])[^'"\n]*\2[ \t]*;?[ \t]*(?:\r?\n|$)|^export\s+/gm;
// Inserted at an edited position: a syntax error in code, harmless inside a comment, string or template literal.
const CODE_CONTEXT_PROBE = ')(}{';
const UNSUPPORTED_EXPORT_PATTERN = /^export\s+(?:default\b|\{|\*)/m;
const TOP_LEVEL_DECLARATION_PATTERN = /^(?:async\s+)?(?:function\s*\*?\s*|(?:class|const|let|var)\s+)([A-Za-z_$][\w$]*)/gm;

/**
 * メタデータブロックの文字列を作る。
 * @param {[string, string][]} meta キーと値の組
 * @returns {string}
 */
export function renderMetaBlock(meta = USERSCRIPT_META) {
  const width = Math.max(...meta.map(([key]) => key.length));
  const lines = meta.map(([key, value]) => (value === '' ? `// @${key}` : `// @${key.padEnd(width)} ${value}`));
  return ['// ==UserScript==', ...lines, '// ==/UserScript=='].join('\n');
}

/**
 * 1 モジュールのソースを結合用に変換する。
 * @param {string} source モジュールのソース
 * @param {string} fileName エラーメッセージ用のファイル名
 * @returns {string} import を削除し、export を外したソース
 * @throws {Error} この変換で扱えない export の形を含むとき
 */
export function transformModule(source, fileName) {
  const unsupported = UNSUPPORTED_EXPORT_PATTERN.exec(source);
  if (unsupported) {
    throw new Error(`${fileName}: "${unsupported[0]}" は使えません。名前付きの export（export function / export const など）だけを使ってください`);
  }
  let transformed = '';
  let consumed = 0;
  /** @type {{ offset: number, line: number }[]} */
  const edits = [];
  for (const match of source.matchAll(MODULE_SYNTAX_PATTERN)) {
    transformed += source.slice(consumed, match.index);
    edits.push({ offset: transformed.length, line: source.slice(0, match.index).split('\n').length });
    consumed = match.index + match[0].length;
  }
  transformed += source.slice(consumed);

  const leftover = /^(?:import|export)\b.*$/m.exec(transformed);
  if (leftover) {
    throw new Error(`${fileName}: 変換できない import / export が残りました: ${leftover[0]}`);
  }
  assertEditsInCode(transformed, edits, fileName);
  return transformed;
}

/**
 * 変換した位置がすべてコードの中（コメント・文字列・テンプレートリテラルの外）にあるかを確かめる。
 * その位置に構文エラーになる文字列を差し込んでもコンパイルできるなら、コードの外だったと判断する。
 * @param {string} transformed 変換後のソース
 * @param {{ offset: number, line: number }[]} edits 変換後のソースでの位置と、元のソースでの行番号
 * @param {string} fileName エラーメッセージ用のファイル名
 * @throws {Error} 変換後のソースがコンパイルできない、またはコードの外を変換していたとき
 */
function assertEditsInCode(transformed, edits, fileName) {
  if (edits.length === 0) return;
  try {
    new vm.Script(transformed, { filename: fileName });
  } catch (error) {
    throw new Error(`${fileName}: 変換後のソースがコンパイルできません: ${/** @type {Error} */ (error).message}`);
  }
  for (const { offset, line } of edits) {
    const probe = transformed.slice(0, offset) + CODE_CONTEXT_PROBE + transformed.slice(offset);
    let compiles = true;
    try {
      new vm.Script(probe);
    } catch {
      compiles = false;
    }
    if (compiles) {
      throw new Error(
        `${fileName}:${line}: コメント・文字列・テンプレートリテラルの中にある行頭の import / export を変換しようとしました。` +
          'それらの中では列 0 から import / export で始まる行を書かないでください',
      );
    }
  }
}

/**
 * 変換後のソースから top-level の宣言名を取り出す。
 * 字下げの無い行の function / class / const / let / var を top-level とみなす。
 * @param {string} source 変換後のソース
 * @returns {string[]}
 */
export function topLevelNames(source) {
  return Array.from(source.matchAll(TOP_LEVEL_DECLARATION_PATTERN), (match) => match[1]);
}

/**
 * top-level の名前の重複を調べる。
 * @param {{ fileName: string, source: string }[]} modules 変換後のモジュール
 * @throws {Error} 重複があるとき
 */
export function assertNoDuplicateNames(modules) {
  /** @type {Map<string, string>} */
  const owners = new Map();
  const duplicates = [];
  for (const { fileName, source } of modules) {
    for (const name of topLevelNames(source)) {
      const owner = owners.get(name);
      if (owner !== undefined) {
        duplicates.push(`${name}（${owner} と ${fileName}）`);
      } else {
        owners.set(name, fileName);
      }
    }
  }
  if (duplicates.length > 0) {
    throw new Error(`top-level の名前が重複しています: ${duplicates.join(', ')}`);
  }
}

/**
 * ユーザスクリプトを組み立てる。
 * @param {{ srcDir?: string, order?: string[], meta?: [string, string][] }} [options] テストで入力を差し替える
 * @returns {string} ユーザスクリプトの全文
 */
export function buildUserscript({ srcDir = SRC_DIR, order = MODULE_ORDER, meta = USERSCRIPT_META } = {}) {
  const modules = order.map((fileName) => ({
    fileName,
    source: transformModule(readFileSync(join(srcDir, fileName), 'utf8'), fileName),
  }));
  assertNoDuplicateNames(modules);

  const body = modules.map(({ fileName, source }) => `// ---- ${fileName} ----\n${source.trimEnd()}\n`).join('\n');
  const output = [
    renderMetaBlock(meta),
    '',
    '// This file is generated by scripts/build.mjs from src/. Edit src/ and run `npm run build`.',
    '(function () {',
    "'use strict';",
    '',
    body,
    'main();',
    '})();',
    '',
  ].join('\n');
  try {
    new vm.Script(output, { filename: 'youtube-comment-filter.user.js' });
  } catch (error) {
    throw new Error(`結合後のスクリプトがコンパイルできません（top-level の名前の重複など）: ${/** @type {Error} */ (error).message}`);
  }
  return output;
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  const output = buildUserscript();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, output);
  console.log(`wrote ${OUTPUT_PATH}`);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { buildUserscript, transformModule } from '../scripts/build.mjs';

const output = buildUserscript();

test('メタデータブロックで始まり、必要な指定を含む', () => {
  assert.ok(output.startsWith('// ==UserScript==\n'));
  const meta = output.slice(0, output.indexOf('// ==/UserScript=='));
  for (const pattern of [
    /^\/\/ @inject-into\s+page$/m,
    /^\/\/ @run-at\s+document-start$/m,
    /^\/\/ @grant\s+GM_getValue$/m,
    /^\/\/ @grant\s+GM_setValue$/m,
    /^\/\/ @match\s+https:\/\/www\.youtube\.com\/\*$/m,
    /^\/\/ @noframes$/m,
  ]) {
    assert.match(meta, pattern);
  }
});

test('import / export の行が残っていない', () => {
  assert.doesNotMatch(output, /^\s*(?:import|export)\s/m);
});

test('IIFE で包まれ、config.js が先頭、main() の呼び出しが最後にある', () => {
  const body = output.slice(output.indexOf('// ==/UserScript=='));
  assert.ok(body.indexOf('// ---- config.js ----') < body.indexOf('// ---- normalize.js ----'));
  assert.ok(body.indexOf('(function () {') < body.indexOf('// ---- config.js ----'));
  assert.match(output, /\nmain\(\);\n\}\)\(\);\n$/);
});

test('スクリプトとしてコンパイルできる', () => {
  assert.doesNotThrow(() => new vm.Script(output, { filename: 'youtube-comment-filter.user.js' }));
});

test('transformModule は複数行の import を削除し、export を外す', () => {
  const source = [
    "import { a } from './a.js';",
    'import {',
    '  b,',
    '  c,',
    "} from './b.js';",
    "import './side-effect.js';",
    'export const X = 1;',
    'export function f() {',
    '  return X;',
    '}',
    '',
  ].join('\n');
  assert.equal(transformModule(source, 'x.js'), 'const X = 1;\nfunction f() {\n  return X;\n}\n');
});

/**
 * 一時ディレクトリにモジュールを書き出す。
 * @param {Record<string, string>} files ファイル名と内容
 */
function writeTempModules(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ycf-build-test-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

test('export default / export { } / export * を含むモジュールはエラーにする', () => {
  for (const content of [
    'export default function f() {}\n',
    'const a = 1;\nexport { a };\n',
    "export * from './x.js';\n",
  ]) {
    const dir = writeTempModules({ 'a.js': content, 'main.js': 'export function main() {}\n' });
    assert.throws(() => buildUserscript({ srcDir: dir, order: ['a.js', 'main.js'] }), /a\.js: .*は使えません/);
  }
});

test('top-level の名前が重複したらエラーにする', () => {
  const dir = writeTempModules({
    'a.js': 'export const shared = 1;\nfunction helper() {}\n',
    'b.js': 'export function shared() {}\nasync function helper() {}\n',
    'main.js': 'export function main() {}\n',
  });
  assert.throws(
    () => buildUserscript({ srcDir: dir, order: ['a.js', 'b.js', 'main.js'] }),
    /重複しています: shared（a\.js と b\.js）, helper（a\.js と b\.js）/,
  );
});

test('字下げされた宣言は top-level とみなさない', () => {
  const dir = writeTempModules({
    'a.js': 'export function f() {\n  const x = 1;\n  return x;\n}\n',
    'b.js': 'export function g() {\n  const x = 2;\n  return x;\n}\n',
    'main.js': 'export function main() {}\n',
  });
  assert.doesNotThrow(() => buildUserscript({ srcDir: dir, order: ['a.js', 'b.js', 'main.js'] }));
});

test('transformModule は副作用 import の後の名前付き import の間にあるコードを消さない', () => {
  const source =
    "import './side.js';\nconst keepMe = 1;\nimport { y } from './b.js';\nexport function f() { return keepMe; }\n";
  assert.equal(transformModule(source, 'x.js'), 'const keepMe = 1;\nfunction f() { return keepMe; }\n');
});

test('transformModule は名前空間 import と既定値付きの import も削除する', () => {
  const source = 'import * as ns from \'./n.js\';\nimport x, { y as z } from "./z.js";\nexport const A = 1;\n';
  assert.equal(transformModule(source, 'x.js'), 'const A = 1;\n');
});

test('ブロックコメント内の行頭 import はエラーにし、コメント以降のコードを黙って消さない', () => {
  for (const source of [
    '/*\nimport notes: keep this\n*/\nexport function lost() { return 1; }\nexport const KEEP = 1; // value from "elsewhere"\n',
    "/*\nimport { x } from './x.js';\n*/\nexport const KEEP = 1;\n",
  ]) {
    assert.throws(() => transformModule(source, 'a.js'), /^Error: a\.js(?::\d+)?: /);
  }
});

test('テンプレートリテラル内の行頭 import / export はエラーにし、黙って書き換えない', () => {
  for (const source of [
    'export const T = `line1\nexport const fake = 1;\nline3`;\n',
    "export const T = `a\nimport x from 'y';\nb`;\n",
  ]) {
    assert.throws(() => transformModule(source, 'a.js'), /^Error: a\.js(?::\d+)?: /);
  }
});

test('正規表現で拾いにくい top-level 宣言の重複もエラーにする', () => {
  for (const [a, b] of [
    ['function *gen() {}\n', 'function gen() {}\n'],
    ['const o = {};\nconst { x } = o;\n', 'const x = 1;\n'],
    ['const p = 1, q = 2;\n', 'const q = 3;\n'],
  ]) {
    const dir = writeTempModules({ 'a.js': a, 'b.js': b, 'main.js': 'export function main() {}\n' });
    assert.throws(
      () => buildUserscript({ srcDir: dir, order: ['a.js', 'b.js', 'main.js'] }),
      /重複|already been declared/,
    );
  }
});

// 計算テスト： node calc.test.js で実行
const assert = require('assert');
const C = require('./calc.js');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

const sample = [
  { mm: 1750, count: 11 },
  { mm: 520, count: 4 },
  { mm: 220, count: 4 },
  { mm: 2520, count: 11 },
  { mm: 1900, count: 1 },
];

t('依頼文の例：合計 51.83m', () => {
  const s = C.clothSummary({ dims: sample.map((d) => ({ ...d })) });
  assert.strictEqual(s.requiredMm, 51830);
  assert.strictEqual(C.fmtM(s.requiredMm), '51.83m');
  assert.strictEqual(C.fmtM(1750 * 11), '19.25m');
  assert.strictEqual(C.fmtM(520 * 4), '2.08m');
  assert.strictEqual(C.fmtM(220 * 4), '0.88m');
  assert.strictEqual(C.fmtM(2520 * 11), '27.72m');
  assert.strictEqual(C.fmtM(1900), '1.90m');
});

t('いろんな書き方を読める（× x X ✕ * 枚 全角）', () => {
  const r = C.parseDimText('1750×11\n520x4\n220X4\n2520✕11\n1900*1\n1750 11枚\n１７５０×１１\n900-3枚');
  assert.deepStrictEqual(r.map((x) => [x.mm, x.count, x.status]), [
    [1750, 11, 'ok'], [520, 4, 'ok'], [220, 4, 'ok'], [2520, 11, 'ok'],
    [1900, 1, 'ok'], [1750, 11, 'ok'], [1750, 11, 'ok'], [900, 3, 'ok'],
  ]);
});

t('1行に複数あっても分けて読む', () => {
  const r = C.parseDimText('1750×11 520×4, 220x4');
  assert.deepStrictEqual(r.map((x) => [x.mm, x.count, x.status]), [[1750, 11, 'ok'], [520, 4, 'ok'], [220, 4, 'ok']]);
});

t('読めない行は推測せず「要確認」', () => {
  const r = C.parseDimText('17?0×11\nリビング');
  assert.strictEqual(r[0].status, 'check');
  assert.strictEqual(r[0].mm, null);
  assert.strictEqual(r[1].status, 'check');
});

t('ありえない寸法は要確認', () => {
  const r = C.parseDimText('17500×1');
  assert.strictEqual(r[0].status, 'check');
});

t('1750×11 のうち5枚糊付け → 未糊付けは 1750×6 = 10.50m', () => {
  const d = { mm: 1750, count: 11 };
  C.setDimStage(d, 'pasted', 5);
  const c = C.dimCounts(d);
  assert.strictEqual(c.unpasted, 6);
  const s = C.clothSummary({ dims: [d] });
  assert.strictEqual(s.unpastedMm, 10500);
  assert.strictEqual(s.pastedMm, 8750);
  assert.strictEqual(s.usedMm, 8750);
});

t('糊付け済み→施工済みにしても使用量が二重にならない', () => {
  const d = { mm: 1750, count: 11 };
  C.setDimStage(d, 'pasted', 5);
  const before = C.clothSummary({ dims: [d] }).usedMm;
  C.setDimStage(d, 'installed', 5);
  const after = C.clothSummary({ dims: [d] });
  assert.strictEqual(after.usedMm, before);
  assert.strictEqual(after.uninstalledMm, 1750 * 6);
  assert.strictEqual(after.unpastedMm, 1750 * 6);
});

t('施工済みを先に入れると糊付け済みも自動で上がる / 糊付けを減らすと施工済みも下がる', () => {
  const d = { mm: 1000, count: 10 };
  C.setDimStage(d, 'installed', 4);
  assert.strictEqual(d.pasted, 4);
  C.setDimStage(d, 'pasted', 2);
  assert.strictEqual(d.installed, 2);
  C.setDimStage(d, 'pasted', 99);
  assert.strictEqual(d.pasted, 10); // 枚数を超えない
});

t('必要・未糊付け・未施工を別々に計算', () => {
  const d1 = { mm: 2000, count: 10, pasted: 6, installed: 3 };
  const s = C.clothSummary({ dims: [d1] });
  assert.strictEqual(s.requiredMm, 20000);
  assert.strictEqual(s.unpastedMm, 8000);
  assert.strictEqual(s.uninstalledMm, 14000);
  assert.strictEqual(s.installedMm, 6000);
});

t('手入力の使用ログ：80m 必要で 20m+15m 使用 → 残り 45m', () => {
  const s = C.clothSummary({ dims: [{ mm: 80000, count: 1 }], usageLogs: [{ meters: 20 }, { meters: 15 }] });
  assert.strictEqual(C.fmtM(s.remainingMm), '45.00m');
});

t('ロス・柄合わせは設定したときだけ加算', () => {
  const dims = [{ mm: 2500, count: 4 }];
  assert.strictEqual(C.clothSummary({ dims }).requiredMm, 10000);
  const s = C.clothSummary({ dims, extraPerPieceMm: 100, extraFixedM: 2 });
  assert.strictEqual(s.requiredMm, 2600 * 4 + 2000);
  assert.strictEqual(s.extraPiecesMm, 400);
});

// 61枚・ロスなし83.54m になるテスト用データ（依頼の数字に合わせて作ったもの）
const sixtyOne = () => [
  { mm: 1750, count: 11, pasted: 5, installed: 3 },
  { mm: 520, count: 4, pasted: 2, installed: 1 },
  { mm: 220, count: 4 },
  { mm: 2520, count: 11 },
  { mm: 1900, count: 1 },
  { mm: 1057, count: 30 },
];

t('61枚：ロスなし 83.54m / ロス50mm 86.59m / ロス100mm 89.64m', () => {
  const dims = sixtyOne();
  const s0 = C.clothSummary({ dims, extraPerPieceMm: 0 });
  assert.strictEqual(s0.pieces, 61);
  assert.strictEqual(C.fmtM(s0.baseMm), '83.54m');
  assert.strictEqual(C.fmtM(s0.requiredMm), '83.54m');
  assert.strictEqual(C.fmtM(C.clothSummary({ dims, extraPerPieceMm: 50 }).requiredMm), '86.59m');
  assert.strictEqual(C.fmtM(C.clothSummary({ dims, extraPerPieceMm: 100 }).requiredMm), '89.64m');
  assert.strictEqual(C.fmtM(C.clothSummary({ dims, extraPerPieceMm: 50 }).baseMm), '83.54m'); // 寸法だけの合計は変わらない
});

t('1750×11 ロス50mm → (1750+50)×11 = 19.80m、ロス0なら19.25m', () => {
  const d = { mm: 1750, count: 11 };
  assert.strictEqual(C.fmtM(C.pieceMm(d, { extraPerPieceMm: 50 }) * 11), '19.80m');
  assert.strictEqual(C.fmtM(C.pieceMm(d, { extraPerPieceMm: 0 }) * 11), '19.25m');
});

t('今回の不具合：ロス1750mmだと 38.50m / 9.08m / 7.88m になっていた', () => {
  const c = { extraPerPieceMm: 1750 };
  assert.strictEqual(C.fmtM(C.pieceMm({ mm: 1750 }, c) * 11), '38.50m');
  assert.strictEqual(C.fmtM(C.pieceMm({ mm: 520 }, c) * 4), '9.08m');
  assert.strictEqual(C.fmtM(C.pieceMm({ mm: 220 }, c) * 4), '7.88m');
});

t('ロスを変えても寸法・糊付け済み・施工済みの枚数は変わらず、二重加算もされない', () => {
  const cloth = { dims: sixtyOne(), extraPerPieceMm: 1750 };
  const before = JSON.stringify(cloth.dims);
  C.clothSummary(cloth);
  cloth.extraPerPieceMm = 50;
  C.clothSummary(cloth);
  cloth.extraPerPieceMm = 50; // 同じ値を何度入れても
  const s = C.clothSummary(cloth);
  assert.strictEqual(JSON.stringify(cloth.dims), before);
  assert.strictEqual(s.piecesPasted, 7);
  assert.strictEqual(s.piecesInstalled, 4);
  assert.strictEqual(C.fmtM(s.requiredMm), '86.59m');
});

t('ロスが空・マイナス・文字なら0として扱う', () => {
  [undefined, null, '', -5, 'abc', 0].forEach((v) => assert.strictEqual(C.lossMm({ extraPerPieceMm: v }), 0));
  assert.strictEqual(C.lossMm({ extraPerPieceMm: '50' }), 50);
});

t('除外した行は計算に入らない', () => {
  const s = C.clothSummary({ dims: [{ mm: 1000, count: 2 }, { mm: 5000, count: 1, excluded: true }] });
  assert.strictEqual(s.requiredMm, 2000);
});

t('仕入れ量があれば在庫残と不足を出す', () => {
  const s = C.clothSummary({ dims: [{ mm: 2500, count: 20, pasted: 4 }], stockM: 45 });
  assert.strictEqual(s.stockRemainMm, 45000 - 10000);
  assert.strictEqual(s.shortageMm, 5000);
});

t('小数の誤差が出ない（0.1m×3）', () => {
  const s = C.clothSummary({ dims: [], usageLogs: [{ meters: 0.1 }, { meters: 0.2 }] });
  assert.strictEqual(s.manualUsedMm, 300);
});

t('同じデータは同じハッシュ・違うデータは違うハッシュ', () => {
  const a = C.hashBytes(new Uint8Array([1, 2, 3, 4]));
  assert.strictEqual(a, C.hashBytes(new Uint8Array([1, 2, 3, 4])));
  assert.notStrictEqual(a, C.hashBytes(new Uint8Array([1, 2, 3, 5])));
});

console.log(`\n${passed} 件合格`);

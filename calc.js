// クロス計算ロジック（画面に依存しない純粋な計算だけを置く）
// 誤差を出さないため、長さは全部「mm の整数」で計算し、表示のときだけ m に直す。
(function (root) {
  'use strict';

  // 全角数字・記号を半角に揃える
  function normalize(text) {
    return String(text || '')
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[，、]/g, ',')
      .replace(/[　\t]/g, ' ');
  }

  // 寸法表のテキストを1行ずつ読み取る
  // 対応: 1750×11 / 1750x11 / 1750X11 / 1750✕11 / 1750*11 / 1750 11枚 / 1750-11枚
  // 読めない行は勝手に推測せず status:'check' で返す
  function parseDimText(text) {
    // 「1750×11 520×4」のように1行に複数ある時は分ける（iPhoneのテキスト認識でよく起きる）
    const lines = [];
    for (const l of normalize(text).split(/\r?\n/)) {
      const many = l.match(/\d{2,5}\s*[×xX✕✖*＊]\s*\d{1,3}\s*(?:枚)?/g);
      if (many && many.length > 1 && l.replace(/\d{2,5}\s*[×xX✕✖*＊]\s*\d{1,3}\s*(?:枚)?/g, '').trim().replace(/[,\s/]/g, '') === '') lines.push(...many);
      else lines.push(l);
    }
    const out = [];
    for (const rawLine of lines) {
      const raw = rawLine.trim();
      if (!raw) continue;
      // 取り消し線の代わりに、行頭に「~」「×」「消」があれば除外候補にする
      const struck = /^(~~|～|消|\(消\)|削除)/.test(raw) || /^~~.*~~$/.test(raw);
      const line = raw.replace(/^(~~|～|消|\(消\)|削除)\s*/, '').replace(/~~$/, '');

      let m = line.match(/^(\d{2,5})\s*(?:mm)?\s*[×xX✕✖*＊]\s*(\d{1,3})\s*(?:枚|まい)?$/);
      if (!m) m = line.match(/^(\d{2,5})\s*(?:mm)?\s*[\s\-ー－:：]\s*(\d{1,3})\s*(?:枚|まい)$/);
      if (!m) m = line.match(/^(\d{2,5})\s*(?:mm)?\s+(\d{1,3})$/);

      if (m) {
        const mm = parseInt(m[1], 10);
        const count = parseInt(m[2], 10);
        const warn = [];
        if (mm < 100 || mm > 6000) warn.push('寸法が普通の範囲（100〜6000mm）外です');
        if (count < 1) warn.push('枚数が0です');
        out.push({ mm, count, raw, struck, status: warn.length ? 'check' : 'ok', note: warn.join(' / ') });
      } else {
        out.push({ mm: null, count: null, raw, struck, status: 'check', note: '読み取れませんでした。数字を確認してください' });
      }
    }
    return out;
  }

  // 1枚あたりの長さ（柄合わせ・ロスの余分を設定している場合だけ足す）
  // 1枚あたりのロス（mm）。未設定・0・おかしな値は 0 として扱う
  function lossMm(cloth) {
    const v = Math.round(Number(cloth && cloth.extraPerPieceMm));
    return isFinite(v) && v > 0 ? v : 0;
  }

  // 寸法そのもの（dim.mm）は書き換えず、計算のたびにロスを足すだけなので二重加算にならない
  function pieceMm(dim, cloth) {
    return Number(dim.mm) + lossMm(cloth);
  }

  // 1つの寸法行の状態を数える
  // pasted   = 糊付け済み以上の枚数（施工済みも含む）
  // installed = 施工済みの枚数（必ず pasted 以下）
  // → 糊付け済み→施工済みに進めても、使用量は pasted で1回しか数えないので二重計上にならない
  function dimCounts(dim) {
    const count = Math.max(0, dim.count | 0);
    const pasted = Math.min(count, Math.max(0, dim.pasted | 0));
    const installed = Math.min(pasted, Math.max(0, dim.installed | 0));
    return {
      count,
      pasted,
      installed,
      unpasted: count - pasted, // 未糊付け
      pastedOnly: pasted - installed, // 糊付け済み・未施工
      uninstalled: count - installed, // 未施工（未糊付け＋糊付け済み）
    };
  }

  // 状態を変更する。施工済みは糊付け済みより多くできない、などのルールを守る
  function setDimStage(dim, stage, value) {
    const c = dimCounts(dim);
    const v = Math.max(0, Math.min(c.count, value | 0));
    if (stage === 'pasted') {
      dim.pasted = v;
      if ((dim.installed | 0) > v) dim.installed = v; // 糊付けを減らしたら施工済みも合わせて減らす
    } else if (stage === 'installed') {
      dim.installed = v;
      if ((dim.pasted | 0) < v) dim.pasted = v; // 施工済みにしたなら糊付けも済んでいる
    }
    return dim;
  }

  function sumLogsMm(logs) {
    return (logs || []).reduce((s, l) => s + Math.round(Number(l.meters || 0) * 1000), 0);
  }

  // 品番ごとの集計
  function clothSummary(cloth) {
    const dims = (cloth.dims || []).filter((d) => !d.excluded);
    let baseMm = 0, requiredPiecesMm = 0, unpastedMm = 0, uninstalledMm = 0, pastedMm = 0, installedMm = 0;
    let pieces = 0, piecesPasted = 0, piecesInstalled = 0;
    for (const d of dims) {
      const c = dimCounts(d);
      const len = pieceMm(d, cloth);
      baseMm += Number(d.mm) * c.count;
      requiredPiecesMm += len * c.count;
      unpastedMm += len * c.unpasted;
      uninstalledMm += len * c.uninstalled;
      pastedMm += len * c.pasted;
      installedMm += len * c.installed;
      pieces += c.count;
      piecesPasted += c.pasted;
      piecesInstalled += c.installed;
    }
    const extraFixedMm = cloth.extraFixedM ? Math.round(Number(cloth.extraFixedM) * 1000) : 0;
    const requiredMm = requiredPiecesMm + extraFixedMm; // 必要メーター
    const manualUsedMm = sumLogsMm(cloth.usageLogs); // 寸法表以外で手入力した使用量
    const usedMm = pastedMm + manualUsedMm; // 使用済み（糊付けした時点で使ったとみなす）
    const remainingMm = requiredMm - usedMm; // 残り必要メーター
    const stockMm = cloth.stockM ? Math.round(Number(cloth.stockM) * 1000) : null; // 仕入れ量（任意）
    return {
      baseMm, // 寸法×枚数そのままの合計
      extraPiecesMm: requiredPiecesMm - baseMm, // 柄合わせ・ロスで増えた分
      extraFixedMm,
      requiredMm,
      pastedMm,
      installedMm,
      unpastedMm,
      uninstalledMm,
      manualUsedMm,
      usedMm,
      remainingMm,
      stockMm,
      stockRemainMm: stockMm == null ? null : stockMm - usedMm, // 手元の在庫残
      shortageMm: stockMm == null ? null : Math.max(0, requiredMm - stockMm), // 仕入れ不足
      pieces,
      piecesPasted,
      piecesInstalled,
      progress: requiredPiecesMm ? installedMm / requiredPiecesMm : 0,
    };
  }

  // mm → "51.83m"
  function fmtM(mm, digits) {
    if (mm == null || isNaN(mm)) return '-';
    const d = digits == null ? 2 : digits;
    const v = mm / 1000;
    return (Object.is(Math.round(v * 100) / 100, -0) ? 0 : v).toFixed(d) + 'm';
  }

  // 同じ写真かどうかを見分けるための簡易ハッシュ（FNV-1a）
  function hashBytes(bytes) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < bytes.length; i++) {
      h1 ^= bytes[i];
      h1 = Math.imul(h1, 16777619);
      h2 ^= bytes[(bytes.length - 1 - i)];
      h2 = Math.imul(h2, 2246822519);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + bytes.length.toString(16);
  }

  const Calc = { normalize, parseDimText, lossMm, pieceMm, dimCounts, setDimStage, clothSummary, fmtM, hashBytes, sumLogsMm };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof self !== 'undefined' ? self : this);

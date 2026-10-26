// 写真から寸法を読み取る
// ① AI読み取り（Claude）… 手書きに強い。自分のAPIキーが必要（1枚あたり数円以下）
// ② 無料OCR（Tesseract）… 無料・端末内で処理。手書きは苦手なので必ず確認が必要
(function (root) {
  'use strict';

  // 写真を長辺1600pxのJPEGに縮める（保存容量とAIの料金を抑えるため）
  async function shrinkImage(file, maxSide) {
    const max = maxSide || 1600;
    const bmp = await loadImage(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を開けませんでした')); };
      img.src = url;
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.readAsDataURL(blob);
    });
  }

  const PROMPT = [
    'これは日本のクロス（壁紙）職人が現場で書いた寸法表の写真です。',
    '各行の「寸法（mm）」と「枚数」を読み取ってください。',
    '書き方の例: 「1750×11」「1750x11」「1750 11枚」。×の代わりに x X ✕ * が使われることもあります。',
    'ルール:',
    '- 1行ごとに1項目。上から順番に。',
    '- 読めない・自信がない数字は推測で埋めず、mm または count を null にして uncertain を true にする。',
    '- 少しでも迷った数字も uncertain を true にする。',
    '- 線で消されている（取り消し線・塗りつぶし）行は struck を true にする。',
    '- raw には写真に書かれている通りの文字を入れる（読めない文字は ? にする）。',
    '- 寸法表と関係ない文字（現場名・日付・部屋名など）は items に入れず memo に書く。',
  ].join('\n');

  const SCHEMA = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            raw: { type: 'string' },
            mm: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            count: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            struck: { type: 'boolean' },
            uncertain: { type: 'boolean' },
          },
          required: ['raw', 'mm', 'count', 'struck', 'uncertain'],
          additionalProperties: false,
        },
      },
      memo: { type: 'string' },
    },
    required: ['items', 'memo'],
    additionalProperties: false,
  };

  // APIキーはアプリに埋め込まず、各自が設定画面で入力→この端末の中だけに保存する
  async function readWithClaude(blob, opts) {
    const b64 = await blobToBase64(blob);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: opts.model || 'claude-opus-5-5',
        max_tokens: 16000,
        fallbacks: 'default',
        output_config: { effort: opts.effort || 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || res.statusText;
      if (res.status === 401) throw new Error('APIキーが正しくないようです（設定画面で確認してください）');
      if (res.status === 429) throw new Error('混み合っています。少し待ってからもう一度試してください');
      throw new Error('AI読み取りに失敗しました: ' + msg);
    }
    if (data.stop_reason === 'refusal') throw new Error('AIがこの画像の読み取りを断りました。手入力してください');
    const textBlock = (data.content || []).filter((b) => b.type === 'text').pop();
    if (!textBlock) throw new Error('AIの返事が空でした。もう一度試してください');
    const parsed = JSON.parse(textBlock.text);
    return {
      items: parsed.items.map((it) => {
        const bad = it.mm == null || it.count == null;
        let note = '';
        if (bad) note = '読み取れない数字があります';
        else if (it.uncertain) note = 'AIが自信なし。写真と見比べてください';
        else if (it.mm < 100 || it.mm > 6000) note = '寸法が普通の範囲外です';
        return { mm: it.mm, count: it.count, raw: it.raw, struck: !!it.struck, status: note ? 'check' : 'ok', note };
      }),
      memo: parsed.memo || '',
      usage: data.usage,
    };
  }

  // 無料OCR。初回だけ読み取り用データ（数MB）をダウンロードする
  let tessLoading = null;
  function loadTesseract() {
    if (root.Tesseract) return Promise.resolve();
    if (tessLoading) return tessLoading;
    tessLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = resolve;
      s.onerror = () => { tessLoading = null; reject(new Error('無料OCRの読み込みに失敗しました（電波を確認）')); };
      document.head.appendChild(s);
    });
    return tessLoading;
  }

  // OCRが読みやすいように、白黒くっきりにして大きくする（影・紙の色ムラ対策）
  async function binarize(blob) {
    const img = await loadImage(blob);
    const scale = Math.min(2.5, 2000 / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h);
    const d = px.data;
    const gray = new Uint8Array(w * h);
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) {
      const v = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
      gray[i] = v; hist[v]++;
    }
    // 大津の方法：文字と背景をいちばんきれいに分けるしきい値を自動で決める
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = gray.length - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; th = t; }
    }
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i] > th ? 255 : 0;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    }
    g.putImageData(px, 0, 0);
    return canvas;
  }

  const validCount = (items) => items.filter((it) => it.mm != null && it.count != null && it.status === 'ok').length;

  // 白黒にした画像と元の画像の両方で読んで、きちんと読めた行が多い方を使う
  async function readWithTesseract(blob, onProgress) {
    await loadTesseract();
    let pass = 0;
    const worker = await root.Tesseract.createWorker('eng', 1, {
      logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress((pass + m.progress) / 2); },
    });
    await worker.setParameters({ tessedit_char_whitelist: '0123456789xX* ', tessedit_pageseg_mode: '6' });
    const r1 = (await worker.recognize(await binarize(blob))).data.text;
    pass = 1;
    const r2 = (await worker.recognize(blob)).data.text;
    await worker.terminate();
    const a = root.Calc.parseDimText(r1), b = root.Calc.parseDimText(r2);
    const pick = validCount(b) > validCount(a) ? { items: b, text: r2 } : { items: a, text: r1 };
    const data = { text: pick.text };
    const items = pick.items;
    // 無料OCRは手書きが苦手なので、全部「確認してね」扱いにする
    items.forEach((it) => { if (it.status === 'ok') { it.status = 'check'; it.note = '無料OCRの結果です。写真と見比べてください'; } });
    return { items, memo: '', rawText: data.text };
  }

  root.OCR = { shrinkImage, blobToBase64, readWithClaude, readWithTesseract };
})(self);

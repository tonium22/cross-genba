// クロス現場帳：画面と操作
(function () {
  'use strict';
  const C = window.Calc;
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');

  const STATUS = { before: '作業前', doing: '作業中', done: '完了' };
  const STATUS_ORDER = { doing: 0, before: 1, done: 2 };
  const MODELS = {
    'claude-opus-5-5': 'Claude Opus 5.5（高精度・標準）',
    'claude-haiku-5-5': 'Claude Haiku 5.5（安い・速い）',
  };

  // ---------- 小さな道具 ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fmtDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[1]}/${+m[2]}/${+m[3]}` : ''; };
  const M = (mm) => C.fmtM(mm);
  const num = (v) => { const n = parseFloat(String(v).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))); return isNaN(n) ? null : n; };
  const go = (hash) => { location.hash = hash; };

  const Settings = {
    get(k, def) { try { const v = localStorage.getItem('cross.' + k); return v == null ? def : v; } catch (e) { return def; } },
    set(k, v) { try { if (v == null || v === '') localStorage.removeItem('cross.' + k); else localStorage.setItem('cross.' + k, v); } catch (e) { /* 保存できない環境 */ } },
  };

  // 有料AIは「ON」にしてキーを保存した時だけ使う（初期設定はOFF）
  const aiOn = () => Settings.get('aiEnabled', '0') === '1' && !!Settings.get('apiKey', '');

  function applyTheme() {
    const t = Settings.get('theme', 'auto');
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- 写真 ----------
  const urlCache = new Map();
  async function photoUrl(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const p = await DB.get('photos', id);
    if (!p) return '';
    const u = URL.createObjectURL(p.blob);
    urlCache.set(id, u);
    return u;
  }
  async function hydrate(root) {
    const imgs = (root || document).querySelectorAll('img[data-photo]:not([src])');
    for (const img of imgs) img.src = await photoUrl(img.dataset.photo);
  }
  const thumbsHtml = (ids) => (ids && ids.length ? `<div class="thumbs">${ids.map((id) => `<img data-photo="${esc(id)}" alt="写真">`).join('')}</div>` : '');

  async function savePhotoFile(file, extra) {
    const blob = await OCR.shrinkImage(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const p = Object.assign({ id: DB.uid(), blob, hash: C.hashBytes(bytes), createdAt: Date.now(), kind: 'attach' }, extra || {});
    await DB.put('photos', p);
    return p.id;
  }

  // どこからも使われなくなった写真を消す
  async function gcPhotos(ids) {
    const cand = new Set((ids || []).filter(Boolean));
    if (!cand.size) return;
    const [cloths, notes, reports] = await Promise.all([DB.all('cloths'), DB.all('notes'), DB.all('reports')]);
    const used = new Set();
    cloths.forEach((c) => { (c.photoIds || []).forEach((i) => used.add(i)); (c.dims || []).forEach((d) => d.sourcePhotoId && used.add(d.sourcePhotoId)); });
    notes.forEach((n) => (n.photoIds || []).forEach((i) => used.add(i)));
    reports.forEach((r) => (r.photoIds || []).forEach((i) => used.add(i)));
    for (const id of cand) if (!used.has(id)) { await DB.del('photos', id); urlCache.delete(id); }
  }

  function openLightbox(id) {
    const div = document.createElement('div');
    div.className = 'lightbox';
    div.innerHTML = `<img data-photo="${esc(id)}" alt="写真"><button class="icon-btn close">✕ 閉じる</button>`;
    div.addEventListener('click', () => div.remove());
    document.body.appendChild(div);
    hydrate(div);
  }

  // ---------- モーダル ----------
  function openModal(html, onDismiss) {
    $modal.innerHTML = `<div class="modal-bg"><div class="sheet"><div class="grab"></div>${html}</div></div>`;
    const bg = $modal.firstElementChild;
    bg.addEventListener('click', (e) => { if (e.target === bg) { closeModal(); onDismiss && onDismiss(); } });
    hydrate($modal);
    return bg.firstElementChild;
  }
  function closeModal() { $modal.innerHTML = ''; }

  function confirmBox(message, okLabel, danger) {
    return new Promise((resolve) => {
      const el = openModal(`<h2>確認</h2><p style="white-space:pre-wrap">${esc(message)}</p>
        <div class="actions"><button class="btn ghost" data-r="0">やめる</button><button class="btn ${danger === false ? '' : 'danger'}" data-r="1">${esc(okLabel || '削除する')}</button></div>`, () => resolve(false));
      el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { closeModal(); resolve(b.dataset.r === '1'); }));
    });
  }

  function chooseBox(title, options) {
    return new Promise((resolve) => {
      const el = openModal(`<h2>${esc(title)}</h2>${options.map((o, i) => `<button class="card tap" style="width:100%;text-align:left" data-i="${i}"><h3>${esc(o.label)}</h3>${o.sub ? `<div class="meta">${esc(o.sub)}</div>` : ''}</button>`).join('')}
        <div class="actions"><button class="btn ghost" data-i="-1">やめる</button></div>`, () => resolve(null));
      el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { closeModal(); const i = +b.dataset.i; resolve(i < 0 ? null : options[i].value); }));
    });
  }

  // 入力フォーム。fields の type: text / number / date / textarea / select / seg / checkbox / checks / photos
  function formModal(opt) {
    return new Promise((resolve) => {
      const photoState = {};
      const added = [];
      const fieldHtml = (f) => {
        const lab = `<label>${esc(f.label)}${f.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>`;
        const hint = f.hint ? `<div class="hint">${esc(f.hint)}</div>` : '';
        const v = f.value == null ? '' : f.value;
        switch (f.type) {
          case 'textarea':
            return `<div class="field">${lab}<textarea name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>${hint}</div>`;
          case 'select':
            return `<div class="field">${lab}<select name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${hint}</div>`;
          case 'seg':
            return `<div class="field">${lab}<input type="hidden" name="${f.name}" value="${esc(v)}"><div class="seg" data-seg="${f.name}">${f.options.map((o) => `<button type="button" data-v="${esc(o.value)}" class="${o.value === v ? 'on' : ''}">${esc(o.label)}</button>`).join('')}</div>${hint}</div>`;
          case 'checkbox':
            return `<div class="field"><label class="check"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>${hint}</div>`;
          case 'checks':
            return `<div class="field">${lab}${f.options.length ? f.options.map((o) => `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${(v || []).includes(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('') : '<div class="hint">まだありません</div>'}${hint}</div>`;
          case 'photos':
            photoState[f.name] = (v || []).slice();
            return `<div class="field">${lab}<div class="thumbs" data-photos="${f.name}"></div>
              <label class="btn sub small" style="margin-top:8px">📷 写真を追加<input type="file" accept="image/*" multiple hidden data-photo-input="${f.name}"></label>${hint}</div>`;
          default:
            return `<div class="field">${lab}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.step ? `step="${f.step}"` : ''} autocomplete="off">${hint}</div>`;
        }
      };
      const cancel = async () => { closeModal(); await gcPhotos(added); resolve(null); };
      const el = openModal(`<h2>${esc(opt.title)}</h2><form novalidate>${opt.fields.map(fieldHtml).join('')}
        <div class="actions"><button type="button" class="btn ghost" data-cancel>キャンセル</button><button class="btn" type="submit">${esc(opt.submitLabel || '保存')}</button></div></form>`, () => { gcPhotos(added); resolve(null); });
      const form = el.querySelector('form');

      const drawPhotos = (name) => {
        const box = form.querySelector(`[data-photos="${name}"]`);
        box.innerHTML = photoState[name].map((id) => `<span style="position:relative"><img data-photo="${esc(id)}" alt="写真"><button type="button" data-rm="${esc(id)}" data-for="${name}" style="position:absolute;top:-6px;right:-6px;width:28px;height:28px;border-radius:50%;border:0;background:var(--danger);color:#fff;font-weight:800">×</button></span>`).join('');
        hydrate(box);
      };
      Object.keys(photoState).forEach(drawPhotos);

      form.addEventListener('click', (e) => {
        const segBtn = e.target.closest('[data-seg] button');
        if (segBtn) {
          const seg = segBtn.parentElement;
          seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === segBtn));
          form.querySelector(`input[name="${seg.dataset.seg}"]`).value = segBtn.dataset.v;
        }
        const rm = e.target.closest('[data-rm]');
        if (rm) { photoState[rm.dataset.for] = photoState[rm.dataset.for].filter((i) => i !== rm.dataset.rm); drawPhotos(rm.dataset.for); }
        if (e.target.closest('[data-cancel]')) cancel();
      });
      form.addEventListener('change', async (e) => {
        const inp = e.target.closest('[data-photo-input]');
        if (!inp) return;
        const name = inp.dataset.photoInput;
        for (const file of inp.files) {
          try { const id = await savePhotoFile(file); added.push(id); photoState[name].push(id); } catch (err) { toast(err.message); }
        }
        inp.value = '';
        drawPhotos(name);
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const out = {};
        for (const f of opt.fields) {
          if (f.type === 'photos') out[f.name] = photoState[f.name];
          else if (f.type === 'checkbox') out[f.name] = form.querySelector(`[name="${f.name}"]`).checked;
          else if (f.type === 'checks') out[f.name] = [...form.querySelectorAll(`[name="${f.name}"]:checked`)].map((i) => i.value);
          else {
            const raw = form.querySelector(`[name="${f.name}"]`).value.trim();
            out[f.name] = f.type === 'number' ? num(raw) : raw;
          }
          if (f.required && (out[f.name] == null || out[f.name] === '')) { toast(`「${f.label}」を入力してください`); return; }
          if (f.type === 'number' && f.min != null && out[f.name] != null && out[f.name] < f.min) { toast(`「${f.label}」は${f.min}以上にしてください`); return; }
        }
        if (opt.validate) { const msg = opt.validate(out); if (msg) { toast(msg); return; } }
        closeModal();
        resolve(out);
      });
      const first = form.querySelector('input:not([type=hidden]):not([type=file]):not([type=checkbox]), textarea');
      if (first && opt.autofocus !== false) setTimeout(() => first.focus(), 250);
    });
  }

  // ---------- データ操作 ----------
  async function touch(store, obj) { obj.updatedAt = Date.now(); await DB.put(store, obj); return obj; }

  async function siteForm(site) {
    const isNew = !site;
    const v = await formModal({
      title: isNew ? '新しい現場' : '現場を編集',
      submitLabel: isNew ? '作成する' : '保存',
      fields: [
        { name: 'name', label: '現場名', required: true, value: site && site.name, placeholder: '例：堂島タワーマンション 1203' },
        { name: 'address', label: '住所（任意）', value: site && site.address, placeholder: '例：大阪市北区堂島…' },
        { name: 'startDate', label: '作業開始日', type: 'date', value: site ? site.startDate : today() },
        { name: 'status', label: '作業ステータス', type: 'seg', value: site ? site.status : 'before', options: Object.entries(STATUS).map(([value, label]) => ({ value, label })) },
        { name: 'memo', label: '現場メモ', type: 'textarea', value: site && site.memo, placeholder: '例：駐車場は裏、エレベーター養生あり' },
      ],
    });
    if (!v) return null;
    const s = Object.assign(site || { id: DB.uid(), createdAt: Date.now() }, v);
    await touch('sites', s);
    DB.persist();
    toast(isNew ? '現場を作成しました' : '保存しました');
    return s;
  }

  async function clothForm(siteId, cloth) {
    const isNew = !cloth;
    const v = await formModal({
      title: isNew ? 'クロス品番を追加' : '品番を編集',
      submitLabel: isNew ? '追加する' : '保存',
      fields: [
        { name: 'code', label: '品番', required: true, value: cloth && cloth.code, placeholder: '例：SP2578 / 天井用クロス' },
        { name: 'maker', label: 'メーカー（任意）', value: cloth && cloth.maker, placeholder: '例：サンゲツ' },
        { name: 'place', label: '使用場所', value: cloth && cloth.place, placeholder: '例：リビング・天井・洗面所' },
        { name: 'stockM', label: '仕入れ量 m（任意）', type: 'number', inputmode: 'decimal', step: '0.1', min: 0, value: cloth && cloth.stockM, hint: '入れると「手元の在庫残」と「不足」を表示します' },
        { name: 'extraPerPieceMm', label: '柄合わせ・ロス 1枚あたり mm（任意）', type: 'number', inputmode: 'numeric', min: 0, value: cloth && cloth.extraPerPieceMm, hint: '例：柄リピート分で1枚ごとに +100mm。入れた時だけ計算に足します' },
        { name: 'extraFixedM', label: '端材・予備 m（任意）', type: 'number', inputmode: 'decimal', step: '0.1', min: 0, value: cloth && cloth.extraFixedM, hint: '必要メーターに固定で足す分' },
      ],
    });
    if (!v) return null;
    const c = Object.assign(cloth || { id: DB.uid(), siteId, dims: [], usageLogs: [], photoIds: [], createdAt: Date.now() }, v);
    await touch('cloths', c);
    toast(isNew ? '品番を追加しました' : '保存しました');
    return c;
  }

  async function noteForm(siteId, note, presetClothId) {
    const cloths = await DB.by('cloths', 'siteId', siteId);
    const v = await formModal({
      title: note ? 'メモを編集' : '注意事項・メモを追加',
      fields: [
        { name: 'text', label: '内容', type: 'textarea', required: true, value: note && note.text, placeholder: '例：水回りのコーキングは太めに打つ' },
        { name: 'clothId', label: '対象', type: 'select', value: note ? note.clothId || '' : presetClothId || '', options: [{ value: '', label: 'この現場全体' }].concat(cloths.map((c) => ({ value: c.id, label: `クロス：${c.code}` }))) },
        { name: 'date', label: '日付', type: 'date', value: note ? note.date : today() },
        { name: 'pinned', label: '📌 ピン留めする（現場を開いた時に上に表示）', type: 'checkbox', value: note && note.pinned },
        { name: 'photoIds', label: '写真', type: 'photos', value: note && note.photoIds },
      ],
    });
    if (!v) return null;
    const n = Object.assign(note || { id: DB.uid(), siteId, createdAt: Date.now() }, v);
    await touch('notes', n);
    toast('メモを保存しました');
    return n;
  }

  async function reportForm(siteId, report) {
    const cloths = await DB.by('cloths', 'siteId', siteId);
    const v = await formModal({
      title: report ? '日報を編集' : '今日の日報',
      fields: [
        { name: 'date', label: '日付', type: 'date', value: report ? report.date : today() },
        { name: 'content', label: '作業内容', type: 'textarea', required: true, value: report && report.content, placeholder: '例：リビング壁 下地パテ→クロス貼り' },
        { name: 'clothIds', label: '使用したクロス', type: 'checks', value: report ? report.clothIds : [], options: cloths.map((c) => ({ value: c.id, label: c.code + (c.place ? `（${c.place}）` : '') })) },
        { name: 'quantity', label: '施工数量', value: report && report.quantity, placeholder: '例：SP2578 約25m / 天井 8枚' },
        { name: 'mistakes', label: 'ミスや注意点', type: 'textarea', value: report && report.mistakes, placeholder: '例：入隅のジョイントが開いた → 糊を多めに' },
        { name: 'photoIds', label: '写真', type: 'photos', value: report && report.photoIds },
      ],
    });
    if (!v) return null;
    const r = Object.assign(report || { id: DB.uid(), siteId, createdAt: Date.now() }, v);
    await touch('reports', r);
    toast('日報を保存しました');
    return r;
  }

  async function deleteSite(id) {
    const site = await DB.get('sites', id);
    const [cloths, notes, reports] = await Promise.all([DB.by('cloths', 'siteId', id), DB.by('notes', 'siteId', id), DB.by('reports', 'siteId', id)]);
    if (!(await confirmBox(`「${site.name}」を削除します。\nクロス${cloths.length}件・メモ${notes.length}件・日報${reports.length}件・写真も一緒に消えます。\n元に戻せません。`))) return false;
    const photos = [];
    cloths.forEach((c) => { photos.push(...(c.photoIds || [])); (c.dims || []).forEach((d) => photos.push(d.sourcePhotoId)); });
    notes.forEach((n) => photos.push(...(n.photoIds || [])));
    reports.forEach((r) => photos.push(...(r.photoIds || [])));
    for (const c of cloths) await DB.del('cloths', c.id);
    for (const n of notes) await DB.del('notes', n.id);
    for (const r of reports) await DB.del('reports', r.id);
    await DB.del('sites', id);
    await gcPhotos(photos);
    toast('削除しました');
    return true;
  }

  async function deleteCloth(id) {
    const c = await DB.get('cloths', id);
    if (!(await confirmBox(`品番「${c.code}」を削除します。\n寸法・使用記録・写真も消えます。元に戻せません。`))) return false;
    const notes = (await DB.by('notes', 'siteId', c.siteId)).filter((n) => n.clothId === id);
    const photos = (c.photoIds || []).concat((c.dims || []).map((d) => d.sourcePhotoId));
    for (const n of notes) { n.clothId = ''; await DB.put('notes', n); } // メモは現場全体のメモとして残す
    await DB.del('cloths', id);
    await gcPhotos(photos);
    toast('削除しました');
    return true;
  }

  // ---------- 画面の状態 ----------
  const ui = { query: '', showDone: false, siteTab: 'cloth' };
  let scan = null; // 読み取り中のデータ

  const header = (title, left, right) => `<header class="top">${left || ''}<h1>${esc(title)}</h1>${right || ''}</header>`;
  const backBtn = (hash) => `<a class="icon-btn" href="${hash}" aria-label="戻る" style="display:inline-flex;align-items:center;text-decoration:none">‹ 戻る</a>`;

  function progressBar(s) {
    const total = s.requiredMm - s.extraFixedMm || 1;
    const inst = Math.min(100, (s.installedMm / total) * 100);
    const paste = Math.min(100 - inst, ((s.pastedMm - s.installedMm) / total) * 100);
    return `<div class="bar"><i class="b-inst" style="width:${inst}%"></i><i class="b-paste" style="width:${paste}%"></i></div>`;
  }

  // ---------- ホーム ----------
  async function viewHome() {
    const [sites, cloths, last] = await Promise.all([DB.all('sites'), DB.all('cloths'), DB.get('meta', 'lastBackup')]);
    const q = ui.query.trim().toLowerCase();
    const bySite = {};
    cloths.forEach((c) => { (bySite[c.siteId] = bySite[c.siteId] || []).push(c); });
    const list = sites
      .filter((s) => ui.showDone || s.status !== 'done')
      .filter((s) => !q || [s.name, s.address, s.memo].concat((bySite[s.id] || []).map((c) => c.code)).join(' ').toLowerCase().includes(q))
      .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.updatedAt - a.updatedAt));
    const doneCount = sites.filter((s) => s.status === 'done').length;

    const days = last ? Math.floor((Date.now() - last.at) / 86400000) : null;
    const backupAlert = sites.length && (days == null || days >= 7)
      ? `<div class="alert warn row"><div class="grow">⚠ ${days == null ? 'まだバックアップしていません' : `最後のバックアップから${days}日`}。端末の故障やデータ削除に備えて保存しましょう。</div><a class="btn small" href="#/settings">保存</a></div>` : '';

    const cards = list.map((s) => {
      const cs = bySite[s.id] || [];
      let req = 0, rem = 0;
      cs.forEach((c) => { const x = C.clothSummary(c); req += x.requiredMm; rem += x.remainingMm; });
      return `<a class="card tap" href="#/site/${s.id}">
        <div class="row"><h3 class="grow">${esc(s.name)}</h3><span class="badge st-${s.status}">${STATUS[s.status]}</span></div>
        <div class="meta">${s.startDate ? `開始 ${fmtDate(s.startDate)}` : ''}${s.address ? ` ・ ${esc(s.address)}` : ''}</div>
        <div class="meta num" style="margin-top:6px">クロス ${cs.length}品番${cs.length ? ` ・ 必要 <b>${M(req)}</b> ・ 残り <b style="color:var(--blue)">${M(rem)}</b>` : ''}</div>
      </a>`;
    }).join('');

    return header('クロス現場帳', '', `<a class="icon-btn" href="#/settings" aria-label="設定" style="display:inline-flex;align-items:center;text-decoration:none">⚙ 設定</a>`) + `
      <main class="wrap">
        ${backupAlert}
        <input class="search" type="search" placeholder="🔍 現場名・住所・品番で検索" value="${esc(ui.query)}" data-input="query">
        <div class="row" style="margin:10px 2px 4px">
          <div class="grow meta">${list.length}件の現場</div>
          <label class="check" style="font-size:15px"><input type="checkbox" data-act="toggleDone" ${ui.showDone ? 'checked' : ''}> 完了も表示（${doneCount}）</label>
        </div>
        <div id="site-list">${cards || `<div class="empty"><div class="big">📁</div>${sites.length ? '該当する現場がありません' : 'まだ現場がありません。<br>下のボタンから作成してください。'}</div>`}</div>
      </main>
      <div class="fab-bar"><button class="btn" data-act="newSite">＋ 新しい現場</button></div>`;
  }

  // ---------- 現場の詳細 ----------
  async function viewSite(id) {
    const site = await DB.get('sites', id);
    if (!site) return notFound();
    const [cloths, notes, reports] = await Promise.all([DB.by('cloths', 'siteId', id), DB.by('notes', 'siteId', id), DB.by('reports', 'siteId', id)]);
    cloths.sort((a, b) => a.createdAt - b.createdAt);
    notes.sort((a, b) => (b.pinned - a.pinned) || String(b.date).localeCompare(a.date) || b.createdAt - a.createdAt);
    reports.sort((a, b) => String(b.date).localeCompare(a.date) || b.createdAt - a.createdAt);
    const pinned = notes.filter((n) => n.pinned);
    const clothName = (cid) => { const c = cloths.find((x) => x.id === cid); return c ? c.code : ''; };

    const pinBox = pinned.length ? `<div class="pin-box"><div class="t">📌 重要メモ</div><ul>${pinned.map((n) => `<li>${esc(n.text)}${n.clothId ? ` <span class="meta">（${esc(clothName(n.clothId))}）</span>` : ''}</li>`).join('')}</ul></div>` : '';

    const info = `<div class="card">
      <div class="seg" style="margin-bottom:10px">${Object.entries(STATUS).map(([k, l]) => `<button data-act="setStatus" data-id="${id}" data-v="${k}" class="${site.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="meta">${site.startDate ? `📅 開始 ${fmtDate(site.startDate)}` : ''}${site.address ? `<br>📍 ${esc(site.address)}` : ''}</div>
      ${site.memo ? `<div style="white-space:pre-wrap;margin-top:8px">${esc(site.memo)}</div>` : ''}
    </div>`;

    let body = '';
    let fab = '';
    if (ui.siteTab === 'cloth') {
      body = cloths.map((c) => {
        const s = C.clothSummary(c);
        return `<a class="card tap" href="#/cloth/${c.id}">
          <div class="row"><h3 class="grow">${esc(c.code)}</h3><span class="meta">${s.pieces}枚</span></div>
          <div class="meta">${[c.maker, c.place].filter(Boolean).map(esc).join(' ・ ') || '　'}</div>
          <div class="stats" style="margin-top:8px">
            <div class="stat"><div class="v num">${M(s.requiredMm)}</div><div class="l">必要</div></div>
            <div class="stat"><div class="v num">${M(s.unpastedMm)}</div><div class="l">未糊付け</div></div>
            <div class="stat main"><div class="v num">${M(s.remainingMm)}</div><div class="l">残り</div></div>
          </div>
          ${progressBar(s)}
        </a>`;
      }).join('') || `<div class="empty"><div class="big">🧻</div>クロス品番がまだありません</div>`;
      fab = `<button class="btn" data-act="newCloth" data-site="${id}">＋ クロス品番</button>`;
    } else if (ui.siteTab === 'note') {
      body = notes.map((n) => noteCard(n, clothName(n.clothId))).join('') || `<div class="empty"><div class="big">📝</div>メモはまだありません</div>`;
      fab = `<button class="btn" data-act="newNote" data-site="${id}">＋ メモ</button>`;
    } else {
      body = reports.map((r) => `<div class="card">
          <div class="row"><b class="grow">${fmtDate(r.date)}</b><button class="btn small ghost" data-act="editReport" data-id="${r.id}">編集</button></div>
          <div style="white-space:pre-wrap;margin-top:4px">${esc(r.content)}</div>
          ${(r.clothIds || []).length ? `<div class="meta">🧻 ${r.clothIds.map((cid) => esc(clothName(cid) || '（削除済み）')).join('、')}</div>` : ''}
          ${r.quantity ? `<div class="meta">📏 ${esc(r.quantity)}</div>` : ''}
          ${r.mistakes ? `<div class="alert warn" style="margin:8px 0 0">⚠ ${esc(r.mistakes)}</div>` : ''}
          ${thumbsHtml(r.photoIds)}
        </div>`).join('') || `<div class="empty"><div class="big">📒</div>日報はまだありません</div>`;
      fab = `<button class="btn" data-act="newReport" data-site="${id}">＋ 今日の日報</button>`;
    }

    return header(site.name, backBtn('#/'), `<button class="icon-btn" data-act="editSite" data-id="${id}">編集</button>`) + `
      <main class="wrap">
        ${pinBox}
        ${info}
        <button class="camera-btn" data-act="scanSite" data-site="${id}"><span class="ic">📷</span>寸法表の写真を読み取り</button>
        <div class="tabs">
          <button data-act="tab" data-v="cloth" class="${ui.siteTab === 'cloth' ? 'on' : ''}">クロス ${cloths.length}</button>
          <button data-act="tab" data-v="note" class="${ui.siteTab === 'note' ? 'on' : ''}">メモ ${notes.length}</button>
          <button data-act="tab" data-v="report" class="${ui.siteTab === 'report' ? 'on' : ''}">日報 ${reports.length}</button>
        </div>
        ${body}
        <div style="margin-top:30px"><button class="btn danger small" data-act="deleteSite" data-id="${id}">この現場を削除</button></div>
      </main>
      <div class="fab-bar">${fab}</div>`;
  }

  function noteCard(n, clothLabel) {
    return `<div class="note ${n.pinned ? 'pinned' : ''}">
      <div class="row meta"><span class="grow">${n.pinned ? '📌 ' : ''}${fmtDate(n.date)}${clothLabel ? ` ・ ${esc(clothLabel)}` : ''}</span>
        <button class="btn small ghost" data-act="pinNote" data-id="${n.id}">${n.pinned ? 'ピン解除' : '📌'}</button>
        <button class="btn small ghost" data-act="editNote" data-id="${n.id}">編集</button></div>
      <div class="txt">${esc(n.text)}</div>
      ${thumbsHtml(n.photoIds)}
    </div>`;
  }

  // ---------- クロス品番の詳細 ----------
  async function viewCloth(id) {
    const c = await DB.get('cloths', id);
    if (!c) return notFound();
    const site = await DB.get('sites', c.siteId);
    const notes = (await DB.by('notes', 'siteId', c.siteId)).filter((n) => n.clothId === id)
      .sort((a, b) => (b.pinned - a.pinned) || String(b.date).localeCompare(a.date));
    const s = C.clothSummary(c);
    const dims = c.dims || [];

    const extraLine = (s.extraPiecesMm || s.extraFixedMm)
      ? `<div class="alert info">ロス加算中：${c.extraPerPieceMm ? `1枚ごと +${c.extraPerPieceMm}mm（計 +${M(s.extraPiecesMm)}）` : ''}${c.extraPerPieceMm && c.extraFixedM ? ' ／ ' : ''}${c.extraFixedM ? `端材・予備 +${M(s.extraFixedMm)}` : ''}<br>寸法×枚数だけの合計は ${M(s.baseMm)}</div>` : '';

    const stock = s.stockMm != null ? `<div class="stats two" style="margin-top:8px">
        <div class="stat ${s.stockRemainMm < 0 ? 'bad' : ''}"><div class="v num">${M(s.stockRemainMm)}</div><div class="l">手元の在庫残（仕入れ ${M(s.stockMm)}）</div></div>
        <div class="stat ${s.shortageMm > 0 ? 'bad' : 'good'}"><div class="v num">${s.shortageMm > 0 ? M(s.shortageMm) : 'OK'}</div><div class="l">${s.shortageMm > 0 ? '仕入れ不足' : '仕入れ量は足りてる'}</div></div>
      </div>` : '';

    const dimRows = dims.map((d) => {
      const k = C.dimCounts(d);
      const len = C.pieceMm(d, c);
      return `<div class="dim ${k.installed === k.count && k.count ? 'done' : ''} ${d.excluded ? 'done' : ''}">
        <div class="dim-head">
          <div class="dim-size num">${d.mm}<small>mm</small> × ${d.count}<small>枚</small></div>
          <div class="dim-total num">${M(len * k.count)}</div>
        </div>
        ${d.label ? `<div class="meta">${esc(d.label)}</div>` : ''}
        ${d.excluded ? '<div class="meta">（計算から除外中）</div>' : `
        <div class="stepper-row">
          <div class="stepper paste"><div class="lab">糊付け済み</div><div class="ctl">
            <button data-act="step" data-dim="${d.id}" data-stage="pasted" data-d="-1" aria-label="糊付けを1枚減らす">−</button>
            <span class="n num" data-act="stepSet" data-dim="${d.id}" data-stage="pasted">${k.pasted}</span>
            <button data-act="step" data-dim="${d.id}" data-stage="pasted" data-d="1" aria-label="糊付けを1枚増やす">＋</button></div></div>
          <div class="stepper inst"><div class="lab">施工済み</div><div class="ctl">
            <button data-act="step" data-dim="${d.id}" data-stage="installed" data-d="-1" aria-label="施工を1枚減らす">−</button>
            <span class="n num" data-act="stepSet" data-dim="${d.id}" data-stage="installed">${k.installed}</span>
            <button data-act="step" data-dim="${d.id}" data-stage="installed" data-d="1" aria-label="施工を1枚増やす">＋</button></div></div>
        </div>`}
        <div class="dim-foot num">
          <span class="grow">${d.excluded ? '' : `未糊付け <b>${d.mm}×${k.unpasted}</b>（${M(len * k.unpasted)}）・ 未施工 ${k.uninstalled}枚`}</span>
          ${d.sourcePhotoId ? `<button class="btn small ghost" data-act="photo" data-id="${d.sourcePhotoId}">📷 元写真</button>` : ''}
          <button class="btn small ghost" data-act="editDim" data-dim="${d.id}">編集</button>
        </div>
      </div>`;
    }).join('') || `<div class="empty"><div class="big">📏</div>寸法がまだありません。<br>上の撮影ボタンか「＋手入力」で追加。</div>`;

    const logs = (c.usageLogs || []).slice().sort((a, b) => String(b.date).localeCompare(a.date));
    const logRows = logs.map((l) => `<div class="card row" style="padding:10px 14px">
        <div class="grow"><b class="num">${fmtDate(l.date)}　${Number(l.meters).toFixed(2)}m</b>${l.note ? `<div class="meta">${esc(l.note)}</div>` : ''}</div>
        <button class="btn small ghost" data-act="delLog" data-log="${l.id}">削除</button></div>`).join('');

    return header(c.code, backBtn(`#/site/${c.siteId}`), `<button class="icon-btn" data-act="editCloth" data-id="${id}">編集</button>`) + `
      <main class="wrap">
        <div class="meta" style="margin:-4px 2px 10px">${esc(site ? site.name : '')}${c.maker ? ` ・ ${esc(c.maker)}` : ''}${c.place ? ` ・ ${esc(c.place)}` : ''}</div>
        <div class="stats">
          <div class="stat"><div class="v num">${M(s.requiredMm)}</div><div class="l">必要</div></div>
          <div class="stat"><div class="v num">${M(s.usedMm)}</div><div class="l">使用済み</div></div>
          <div class="stat main"><div class="v num">${M(s.remainingMm)}</div><div class="l">残り</div></div>
        </div>
        <div class="stats two" style="margin-top:8px">
          <div class="stat"><div class="v num" style="color:var(--warn)">${M(s.unpastedMm)}</div><div class="l">未糊付け</div></div>
          <div class="stat"><div class="v num">${M(s.uninstalledMm)}</div><div class="l">未施工</div></div>
        </div>
        ${stock}
        ${progressBar(s)}
        <div class="legend"><span class="l-inst">施工済み ${s.piecesInstalled}枚</span><span class="l-paste">糊付け済み ${s.piecesPasted - s.piecesInstalled}枚</span><span class="l-un">未糊付け ${s.pieces - s.piecesPasted}枚</span></div>
        <div style="margin-top:14px">${extraLine}</div>
        <button class="camera-btn" data-act="scanCloth" data-id="${id}"><span class="ic">📷</span>寸法表の写真から追加</button>

        <div class="section-title"><span class="grow">寸法一覧（${s.pieces}枚）</span>
          <button class="btn small sub" data-act="pasteAll" data-id="${id}">全部糊付け</button>
          <button class="btn small sub" data-act="addDim" data-id="${id}">＋手入力</button></div>
        ${dimRows}

        <div class="section-title"><span class="grow">寸法表以外の使用量</span><button class="btn small sub" data-act="addLog" data-id="${id}">＋記録</button></div>
        <div class="hint" style="margin:-4px 4px 8px">糊付け済みにした分は自動で「使用済み」に入ります。張り替え・失敗した分など、寸法表にない使用だけここに記録してください。</div>
        ${logRows || '<div class="meta" style="padding:0 4px">記録なし</div>'}

        <div class="section-title"><span class="grow">注意事項・メモ</span><button class="btn small sub" data-act="newNote" data-site="${c.siteId}" data-cloth="${id}">＋メモ</button></div>
        ${notes.map((n) => noteCard(n, '')).join('') || '<div class="meta" style="padding:0 4px">メモなし</div>'}

        <div class="section-title"><span class="grow">写真</span><label class="btn small sub">＋写真<input type="file" accept="image/*" multiple hidden data-cloth-photo="${id}"></label></div>
        ${thumbsHtml(c.photoIds) || '<div class="meta" style="padding:0 4px">写真なし</div>'}

        <div style="margin-top:30px"><button class="btn danger small" data-act="deleteCloth" data-id="${id}">この品番を削除</button></div>
      </main>`;
  }

  // ---------- 撮影・読み取り ----------
  function newScan(clothId) { scan = { clothId, phase: 'pick', items: [], blob: null, hash: null, url: null, memo: '', error: '', method: '' }; }

  async function viewScan(clothId) {
    const c = await DB.get('cloths', clothId);
    if (!c) return notFound();
    if (!scan || scan.clothId !== clothId) newScan(clothId);
    const useAi = aiOn();
    const top = header(`読み取り：${c.code}`, backBtn(`#/cloth/${clothId}`));

    if (scan.phase === 'pick') {
      return top + `<main class="wrap">
        <div class="alert info">${useAi ? `🤖 有料AI読み取り（${esc(MODELS[Settings.get('model', 'claude-opus-5-5')] || '')}）を使います。` : '🆓 無料OCRで読み取ります（APIキー不要・写真は外に送りません）。手書きは間違えやすいので、次の一覧で必ず確認してください。'}</div>
        <label class="camera-btn" style="margin-bottom:12px"><span class="ic">🖼</span>写真アプリから選ぶ<input type="file" accept="image/*" hidden data-scan-file></label>
        <div class="hint" style="margin:-4px 4px 14px">iPhoneの標準カメラで撮った寸法表を選んでください</div>
        <div class="btn-grid">
          <button class="btn ghost" data-act="scanPaste">📋 文字を貼り付け</button>
          <button class="btn ghost" data-act="scanManual">✏️ 手で入力</button>
        </div>
        <label class="btn ghost block" style="margin-top:10px">📷 その場で撮影する<input type="file" accept="image/*" capture="environment" hidden data-scan-file></label>
        <div class="section-title">無料で読み取る2つの方法</div>
        <div class="card meta"><b>① 写真アプリから選ぶ</b>（このアプリの無料OCR）<br>きれいな字ならそのまま読めます。<br><br><b>② iPhoneの「テキスト認識」を使う</b>（手書きはこっちが強いことが多い）<br>写真アプリで寸法表を開く → 文字を長押し → 「すべてを選択」→「コピー」→ 上の「文字を貼り付け」に貼る</div>
        <div class="section-title">きれいに読むコツ</div>
        <div class="card meta">・紙を真上から、影が入らないように撮る<br>・1枚に寸法表だけが入るように寄る<br>・暗い現場ではライトを当てる<br>・数字と×ははっきり、1行に1つ書く</div>
      </main>`;
    }
    if (scan.phase === 'reading') {
      return top + `<main class="wrap"><div class="card" style="text-align:center"><div class="spinner"></div><b>読み取り中…</b><div class="meta" id="scan-progress">${scan.method === 'ai' ? 'AIが写真を見ています（10〜30秒くらい）' : '無料OCRで処理中（初回はデータのダウンロードで少し時間がかかります）'}</div></div>
        ${scan.url ? `<img class="scan-preview" src="${scan.url}" alt="撮影した寸法表">` : ''}</main>`;
    }
    if (scan.phase === 'dup') {
      return top + `<main class="wrap"><div class="alert danger"><b>この写真はすでに登録されています。</b><br>${esc(scan.dupInfo).replace(/\n/g, '<br>')}<br>二重登録を防ぐため、この写真は読み取りません。</div>
        <img class="scan-preview" src="${scan.url}" alt="撮影した寸法表">
        <div class="btn-grid" style="margin-top:12px"><button class="btn sub" data-act="scanRetake">撮り直す</button><a class="btn ghost" href="#/cloth/${clothId}">戻る</a></div></main>`;
    }
    if (scan.phase === 'error') {
      return top + `<main class="wrap"><div class="alert danger">${esc(scan.error)}</div>
        ${scan.url ? `<img class="scan-preview" src="${scan.url}" alt="撮影した寸法表">` : ''}
        <div class="btn-grid" style="margin-top:12px">
          <button class="btn" data-act="scanRead" data-m="${scan.method}">もう一度</button>
          ${scan.method === 'ai' ? '<button class="btn sub" data-act="scanRead" data-m="free">無料OCRで試す</button>' : ''}
          <button class="btn ghost" data-act="scanManualKeep">手で入力</button>
          <button class="btn ghost" data-act="scanRetake">撮り直す</button>
        </div></main>`;
    }

    // 確認画面
    const checks = scan.items.filter((it) => it.use && it.status === 'check' && !it.edited).length;
    const rows = scan.items.map((it, i) => {
      const tot = it.mm && it.count ? M(it.mm * it.count) : '?';
      const cls = (it.status === 'check' && !it.edited ? 'check' : '') + (it.use ? '' : ' off');
      const note = !it.use && it.struck ? '取り消し線あり → 除外候補（使うならチェック）' : (it.status === 'check' && !it.edited ? `⚠ ${it.note}` : '');
      return `<div class="scan-row ${cls}" data-row="${i}">
        <input type="checkbox" data-sf="use" data-i="${i}" ${it.use ? 'checked' : ''} aria-label="この行を使う">
        <input type="number" inputmode="numeric" data-sf="mm" data-i="${i}" value="${it.mm == null ? '' : it.mm}" placeholder="寸法" aria-label="寸法mm">
        <span class="x">×</span>
        <input type="number" inputmode="numeric" data-sf="count" data-i="${i}" value="${it.count == null ? '' : it.count}" placeholder="枚" aria-label="枚数">
        <button class="del" data-act="scanDel" data-i="${i}" aria-label="行を削除">🗑</button>
        <span class="tot num" data-tot="${i}">${tot}</span>
        ${(note || it.raw) ? `<div class="scan-note meta">${note ? esc(note) + ' ' : ''}${it.raw ? `<span style="color:var(--sub);font-weight:400">読み取り: 「${esc(it.raw)}」</span>` : ''}</div>` : ''}
      </div>`;
    }).join('');

    return top + `<main class="wrap">
      ${scan.url ? `<details open><summary class="meta" style="padding:6px 2px">撮影した写真（タップで閉じる）</summary><img class="scan-preview" src="${scan.url}" alt="撮影した寸法表"></details>` : ''}
      ${scan.memo ? `<div class="alert info">📝 写真のメモ：${esc(scan.memo)}</div>` : ''}
      <div class="alert ${checks ? 'warn' : 'info'}" id="scan-check">${checks ? `⚠ 要確認が <b>${checks}行</b> あります。写真と見比べて直してください。` : '写真と見比べて、合っていれば保存してください。'}</div>
      <div class="meta scan-head"><span>使う</span><span>寸法mm</span><span></span><span>枚数</span><span></span></div>
      ${rows || '<div class="empty">行がありません。下の「＋行を追加」から入力してください。</div>'}
      <button class="btn ghost block" data-act="scanAdd">＋ 行を追加</button>
      <div class="total-line"><span>合計（チェックした行）</span><span class="v num" id="scan-total">${M(scanTotal())}</span></div>
      ${scan.url && scan.method !== 'ai' ? '<div class="hint" style="margin-bottom:10px">無料OCRの結果です。読み間違いが多い時は、写真アプリの「テキスト認識」でコピー→「文字を貼り付け」も試してください。</div>' : ''}
    </main>
    <div class="fab-bar">${scan.url ? '<button class="btn sub" data-act="scanRetake" style="flex:0.7">撮り直す</button>' : ''}<button class="btn" data-act="scanSave">この内容で保存</button></div>`;
  }

  function scanTotal() {
    return scan.items.reduce((s, it) => s + (it.use && it.mm && it.count ? it.mm * it.count : 0), 0);
  }

  async function handleScanFile(file) {
    if (!file) return;
    const clothId = scan.clothId;
    newScan(clothId);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      scan.hash = C.hashBytes(bytes);
      scan.blob = await OCR.shrinkImage(file);
      scan.url = URL.createObjectURL(scan.blob);
    } catch (e) {
      scan.phase = 'error'; scan.error = e.message; return render();
    }
    const dups = await DB.by('photos', 'hash', scan.hash);
    if (dups.length) {
      const p = dups[0];
      let info = `登録日：${new Date(p.createdAt).toLocaleDateString('ja-JP')}`;
      if (p.clothId) {
        const c = await DB.get('cloths', p.clothId);
        const s = c && await DB.get('sites', c.siteId);
        if (c) info += `\n場所：${s ? s.name + ' / ' : ''}${c.code}`;
      }
      scan.phase = 'dup'; scan.dupInfo = info;
      return render();
    }
    await runRead(aiOn() ? 'ai' : 'free');
  }

  async function runRead(method) {
    scan.method = method;
    scan.phase = 'reading';
    await render();
    try {
      let r;
      if (method === 'ai') {
        r = await OCR.readWithClaude(scan.blob, { apiKey: Settings.get('apiKey', ''), model: Settings.get('model', 'claude-opus-5-5') });
      } else {
        r = await OCR.readWithTesseract(scan.blob, (p) => { const el = document.getElementById('scan-progress'); if (el) el.textContent = `無料OCRで処理中… ${Math.round(p * 100)}%`; });
      }
      scan.items = r.items.map((it) => Object.assign(it, { use: !it.struck }));
      scan.memo = r.memo || '';
      scan.phase = 'confirm';
      if (!scan.items.length) toast('数字が見つかりませんでした。手で追加してください');
    } catch (e) {
      scan.phase = 'error';
      scan.error = e.message || String(e);
    }
    render();
  }

  async function saveScan() {
    const use = scan.items.filter((it) => it.use);
    if (!use.length) return toast('保存する行がありません');
    const bad = use.findIndex((it) => !it.mm || !it.count || it.mm <= 0 || it.count <= 0 || !Number.isInteger(it.count));
    if (bad >= 0) return toast('寸法か枚数が空・不正な行があります（チェックを外すか入力してください）');
    const unchecked = use.filter((it) => it.status === 'check' && !it.edited).length;
    if (unchecked && !(await confirmBox(`要確認の行が${unchecked}行残っています。\n写真と見比べて合っていましたか？`, 'このまま保存', false))) return;

    const c = await DB.get('cloths', scan.clothId);
    let photoId = null;
    if (scan.blob) {
      // 保存の直前にももう一度重複チェック
      if ((await DB.by('photos', 'hash', scan.hash)).length) return toast('この写真はすでに登録されています');
      photoId = DB.uid();
      await DB.put('photos', { id: photoId, blob: scan.blob, hash: scan.hash, createdAt: Date.now(), kind: 'scan', clothId: c.id });
    }
    c.dims = (c.dims || []).concat(use.map((it) => ({ id: DB.uid(), mm: Math.round(it.mm), count: it.count, pasted: 0, installed: 0, sourcePhotoId: photoId, addedAt: Date.now() })));
    await touch('cloths', c);
    DB.persist();
    toast(`${use.length}行を追加しました（${M(scanTotal())}）`);
    scan = null;
    go(`#/cloth/${c.id}`);
  }

  // ---------- 設定 ----------
  async function viewSettings() {
    const key = Settings.get('apiKey', '');
    const model = Settings.get('model', 'claude-opus-5-5');
    const theme = Settings.get('theme', 'auto');
    const last = await DB.get('meta', 'lastBackup');
    let storage = '';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        storage = `使用中 約${(e.usage / 1048576).toFixed(1)}MB${persisted ? ' ・ 自動削除されにくい設定 ✔' : ''}`;
      }
    } catch (e) { /* 非対応 */ }

    return header('設定・バックアップ', backBtn('#/')) + `<main class="wrap">
      <div class="section-title">💾 バックアップ</div>
      <div class="card">
        <div class="meta" style="margin-bottom:10px">データはこのiPhoneの中だけに保存されています。Safariの履歴・データ削除や機種変更で消えるので、<b>週1回は保存</b>してください（LINEのKeepやファイルAppに送ると安心）。<br>最後の保存：${last ? new Date(last.at).toLocaleString('ja-JP') : 'まだ'}${storage ? `<br>${storage}` : ''}</div>
        <button class="btn block" data-act="backup">📦 全データを保存（写真込み・JSON）</button>
        <button class="btn sub block" style="margin-top:10px" data-act="csv">📊 寸法一覧をCSVで出力（Excel用）</button>
        <label class="btn ghost block" style="margin-top:10px">♻️ バックアップから復元<input type="file" accept="application/json,.json" hidden data-restore></label>
      </div>

      <div class="section-title">📷 写真の読み取り</div>
      <div class="card">
        <div style="font-weight:700">今の設定：${aiOn() ? '🤖 有料AI（Claude）で読み取る' : '🆓 無料OCR（APIキー不要・端末内で処理）'}</div>
        <div class="hint">無料OCRは手書きが苦手です。iPhoneの写真アプリで寸法表の文字を長押し→「すべてを選択」→コピーして、読み取り画面の「文字を貼り付け」に入れる方法も無料で使えます。</div>
      </div>
      <details class="card"${Settings.get('aiEnabled', '0') === '1' ? ' open' : ''}>
        <summary style="font-weight:700;cursor:pointer;min-height:32px">🤖 有料AI読み取り（初期設定はOFF）</summary>
        <div class="alert warn" style="margin-top:10px">ONにしてキーを保存するまで、写真が外部の有料AIに送られることはありません。</div>
        <label class="check"><input type="checkbox" id="ai-enabled" ${Settings.get('aiEnabled', '0') === '1' ? 'checked' : ''}> 有料AI読み取りを使う</label>
        <div class="field"><label>Anthropic APIキー</label>
          <input type="password" id="api-key" value="${esc(key)}" placeholder="sk-ant-…" autocomplete="off">
          <div class="hint">キーはこのiPhoneの中だけに保存され、AIに写真を送る時だけ使います。アプリのコードには入っていません。</div></div>
        <div class="field"><label>使うAI</label><select id="api-model">${Object.entries(MODELS).map(([v, l]) => `<option value="${v}" ${v === model ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <button class="btn block" data-act="saveKey">保存</button>
        ${key ? '<button class="btn danger block small" style="margin-top:10px" data-act="clearKey">キーを削除</button>' : ''}
        <div class="hint" style="margin-top:12px">料金の目安（写真1枚・1ドル150円で計算）<br>・Opus 5.5：約3〜5円<br>・Haiku 5.5：約0.1〜0.3円<br>使った分だけの支払い。月100枚撮ってもOpusで約300〜500円。キーなしでも無料OCRと手入力は使えます。</div>
      </details>

      <div class="section-title">🌙 表示</div>
      <div class="card"><div class="seg">${[['auto', '自動'], ['light', '明るい'], ['dark', '暗い現場']].map(([v, l]) => `<button data-act="theme" data-v="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>

      <div class="section-title">ℹ️ このアプリ</div>
      <div class="card meta">クロス現場帳 v0.1（試作品）<br>寸法の単位はmm。計算は「寸法×枚数」を合計し、柄合わせ・ロスは設定した時だけ足します。<br>糊付けした時点で「使用済み」になり、施工済みにしても二重には数えません。</div>
    </main>`;
  }

  async function exportBackup() {
    const data = { app: 'cross-genba', version: 1, exportedAt: new Date().toISOString() };
    for (const s of ['sites', 'cloths', 'notes', 'reports']) data[s] = await DB.all(s);
    const photos = await DB.all('photos');
    data.photos = [];
    for (const p of photos) data.photos.push({ id: p.id, hash: p.hash, createdAt: p.createdAt, kind: p.kind, clothId: p.clothId, type: p.blob.type, data: await OCR.blobToBase64(p.blob) });
    const name = `cross-backup-${today()}.json`;
    const ok = await saveFile(new Blob([JSON.stringify(data)], { type: 'application/json' }), name);
    if (ok) {
      await DB.put('meta', { id: 'lastBackup', at: Date.now() });
      toast('バックアップを保存しました');
      render();
    }
  }

  async function exportCsv() {
    const [sites, cloths] = await Promise.all([DB.all('sites'), DB.all('cloths')]);
    const siteName = Object.fromEntries(sites.map((s) => [s.id, s.name]));
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['現場', '品番', 'メーカー', '使用場所', '寸法mm', '枚数', '合計m', '糊付け済み', '施工済み', '未糊付けm', 'メモ'].map(q).join(',')];
    for (const c of cloths) {
      for (const d of c.dims || []) {
        const k = C.dimCounts(d);
        const len = C.pieceMm(d, c);
        lines.push([siteName[c.siteId], c.code, c.maker, c.place, d.mm, d.count, (len * k.count / 1000).toFixed(2), k.pasted, k.installed, (len * k.unpasted / 1000).toFixed(2), d.label].map(q).join(','));
      }
    }
    await saveFile(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), `cross-dims-${today()}.csv`);
  }

  // iPhoneでは共有シート（ファイルに保存・LINEなど）、それ以外はダウンロード
  async function saveFile(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    const touchDevice = navigator.maxTouchPoints > 0;
    if (touchDevice && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }

  async function restoreBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return toast('ファイルを読めませんでした'); }
    if (!data || data.app !== 'cross-genba') return toast('このアプリのバックアップではありません');
    const msg = `${new Date(data.exportedAt).toLocaleString('ja-JP')} のバックアップ\n現場${(data.sites || []).length}件・写真${(data.photos || []).length}枚\n\n今のデータは全部置き換わります。よろしいですか？`;
    if (!(await confirmBox(msg, '復元する'))) return;
    for (const s of ['sites', 'cloths', 'notes', 'reports', 'photos']) await DB.clear(s);
    for (const s of ['sites', 'cloths', 'notes', 'reports']) for (const o of data[s] || []) await DB.put(s, o);
    for (const p of data.photos || []) {
      const bin = atob(p.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await DB.put('photos', { id: p.id, hash: p.hash, createdAt: p.createdAt, kind: p.kind, clothId: p.clothId, blob: new Blob([bytes], { type: p.type || 'image/jpeg' }) });
    }
    urlCache.clear();
    toast('復元しました');
    go('#/');
  }

  function notFound() { return header('見つかりません', backBtn('#/')) + '<main class="wrap"><div class="empty">データが見つかりませんでした（削除された可能性があります）</div></main>'; }

  // ---------- 画面の切り替え ----------
  async function render(keepScroll) {
    const y = window.scrollY;
    const parts = (location.hash || '#/').slice(2).split('/');
    let html;
    try {
      if (parts[0] === 'site') html = await viewSite(parts[1]);
      else if (parts[0] === 'cloth') html = await viewCloth(parts[1]);
      else if (parts[0] === 'scan') html = await viewScan(parts[1]);
      else if (parts[0] === 'settings') html = await viewSettings();
      else html = await viewHome();
    } catch (e) {
      console.error(e);
      html = header('エラー', backBtn('#/')) + `<main class="wrap"><div class="alert danger">${esc(e.message)}</div></main>`;
    }
    $app.innerHTML = html;
    hydrate($app);
    if (keepScroll) window.scrollTo(0, y);
  }
  const refresh = () => render(true);

  // ＋を連打しても1回ずつ順番に処理する（同時に処理すると数え漏れが出るため）
  let queue = Promise.resolve();
  function withCloth(id, fn) {
    queue = queue.then(async () => {
      const c = await DB.get('cloths', id);
      await fn(c);
      await touch('cloths', c);
      await refresh();
    }).catch((e) => toast('エラー: ' + e.message));
    return queue;
  }

  // ---------- ボタンの動き ----------
  const actions = {
    newSite: async () => { const s = await siteForm(); if (s) go(`#/site/${s.id}`); },
    editSite: async (el) => { const s = await siteForm(await DB.get('sites', el.dataset.id)); if (s) refresh(); },
    deleteSite: async (el) => { if (await deleteSite(el.dataset.id)) go('#/'); },
    setStatus: async (el) => { const s = await DB.get('sites', el.dataset.id); s.status = el.dataset.v; await touch('sites', s); refresh(); },
    toggleDone: (el) => { ui.showDone = el.checked; refresh(); },
    tab: (el) => { ui.siteTab = el.dataset.v; refresh(); },

    newCloth: async (el) => { const c = await clothForm(el.dataset.site); if (c) refresh(); },
    editCloth: async (el) => { const c = await DB.get('cloths', el.dataset.id); if (await clothForm(c.siteId, c)) refresh(); },
    deleteCloth: async (el) => { const c = await DB.get('cloths', el.dataset.id); if (await deleteCloth(c.id)) go(`#/site/${c.siteId}`); },

    scanSite: async (el) => {
      const siteId = el.dataset.site;
      const cloths = (await DB.by('cloths', 'siteId', siteId)).sort((a, b) => a.createdAt - b.createdAt);
      let clothId;
      if (!cloths.length) {
        toast('先にクロス品番を登録します');
        const c = await clothForm(siteId);
        if (!c) return;
        clothId = c.id;
      } else if (cloths.length === 1) clothId = cloths[0].id;
      else {
        clothId = await chooseBox('どの品番の寸法表？', cloths.map((c) => ({ value: c.id, label: c.code, sub: [c.maker, c.place].filter(Boolean).join(' ・ ') })).concat([{ value: '__new', label: '＋ 新しい品番を追加' }]));
        if (!clothId) return;
        if (clothId === '__new') { const c = await clothForm(siteId); if (!c) return; clothId = c.id; }
      }
      newScan(clothId);
      go(`#/scan/${clothId}`);
    },
    scanCloth: (el) => { newScan(el.dataset.id); go(`#/scan/${el.dataset.id}`); },
    scanRetake: () => { newScan(scan.clothId); render(); },
    scanRead: (el) => runRead(el.dataset.m),
    scanManual: () => { scan.items = [{ mm: null, count: null, use: true, status: 'ok' }]; scan.phase = 'confirm'; render().then(() => { const i = $app.querySelector('[data-sf="mm"]'); if (i) i.focus(); }); },
    scanManualKeep: () => { scan.items = scan.items.length ? scan.items : [{ mm: null, count: null, use: true, status: 'ok' }]; scan.phase = 'confirm'; render(); },
    scanPaste: async () => {
      const v = await formModal({ title: '文字を貼り付け', submitLabel: '読み取る', fields: [{ name: 't', label: '1行に1つ（例：1750×11）', type: 'textarea', required: true, placeholder: '1750×11\n520×4\n220×4' }] });
      if (!v) return;
      scan.items = C.parseDimText(v.t).map((it) => Object.assign(it, { use: !it.struck }));
      scan.phase = 'confirm';
      render();
    },
    scanAdd: () => { scan.items.push({ mm: null, count: null, use: true, status: 'ok' }); refresh(); setTimeout(() => { const all = $app.querySelectorAll('[data-sf="mm"]'); if (all.length) all[all.length - 1].focus(); }, 50); },
    scanDel: (el) => { scan.items.splice(+el.dataset.i, 1); refresh(); },
    scanSave: () => saveScan(),

    step: (el) => withCloth(currentId(), (c) => {
      const d = c.dims.find((x) => x.id === el.dataset.dim);
      const cur = C.dimCounts(d)[el.dataset.stage];
      C.setDimStage(d, el.dataset.stage, cur + Number(el.dataset.d));
    }),
    stepSet: async (el) => {
      const c = await DB.get('cloths', currentId());
      const d = c.dims.find((x) => x.id === el.dataset.dim);
      const label = el.dataset.stage === 'pasted' ? '糊付け済み' : '施工済み';
      const v = await formModal({ title: `${d.mm}mm × ${d.count}枚`, fields: [{ name: 'n', label: `${label}の枚数（0〜${d.count}）`, type: 'number', inputmode: 'numeric', value: C.dimCounts(d)[el.dataset.stage], min: 0 }] });
      if (!v || v.n == null) return;
      C.setDimStage(d, el.dataset.stage, Math.round(v.n));
      await touch('cloths', c);
      refresh();
    },
    pasteAll: async (el) => {
      if (!(await confirmBox('この品番の寸法を全部「糊付け済み」にしますか？', '全部糊付け済みにする', false))) return;
      withCloth(el.dataset.id, (c) => c.dims.forEach((d) => C.setDimStage(d, 'pasted', d.count)));
    },
    addDim: async (el) => {
      const v = await formModal({ title: '寸法を手入力', fields: [
        { name: 'mm', label: '寸法（mm）', type: 'number', inputmode: 'numeric', required: true, min: 1, placeholder: '例：2520' },
        { name: 'count', label: '枚数', type: 'number', inputmode: 'numeric', required: true, min: 1, placeholder: '例：11' },
        { name: 'label', label: '場所メモ（任意）', placeholder: '例：洋室1 壁' },
      ] });
      if (!v) return;
      withCloth(el.dataset.id, (c) => { c.dims.push({ id: DB.uid(), mm: Math.round(v.mm), count: Math.round(v.count), pasted: 0, installed: 0, label: v.label, addedAt: Date.now() }); });
    },
    editDim: async (el) => {
      const c = await DB.get('cloths', currentId());
      const d = c.dims.find((x) => x.id === el.dataset.dim);
      const v = await formModal({ title: '寸法を編集', fields: [
        { name: 'mm', label: '寸法（mm）', type: 'number', inputmode: 'numeric', required: true, min: 1, value: d.mm },
        { name: 'count', label: '枚数', type: 'number', inputmode: 'numeric', required: true, min: 1, value: d.count },
        { name: 'label', label: '場所メモ（任意）', value: d.label },
        { name: 'excluded', label: '計算から除外する', type: 'checkbox', value: d.excluded },
        { name: 'del', label: '🗑 この行を削除する', type: 'checkbox' },
      ] });
      if (!v) return;
      if (v.del) {
        if (!(await confirmBox(`${d.mm}×${d.count} を削除しますか？`))) return;
        c.dims = c.dims.filter((x) => x !== d);
        await touch('cloths', c);
        await gcPhotos([d.sourcePhotoId]);
      } else {
        Object.assign(d, { mm: Math.round(v.mm), count: Math.round(v.count), label: v.label, excluded: v.excluded });
        C.setDimStage(d, 'pasted', d.pasted); // 枚数を減らした時に糊付け数がはみ出さないように
        await touch('cloths', c);
      }
      refresh();
    },
    addLog: async (el) => {
      const v = await formModal({ title: '使用量を記録', fields: [
        { name: 'date', label: '日付', type: 'date', value: today() },
        { name: 'meters', label: '使用したメーター数（m）', type: 'number', inputmode: 'decimal', step: '0.1', required: true, min: 0, placeholder: '例：2.5' },
        { name: 'note', label: 'メモ', placeholder: '例：ジョイント失敗で張り替え' },
      ] });
      if (!v) return;
      withCloth(el.dataset.id, (c) => { (c.usageLogs = c.usageLogs || []).push({ id: DB.uid(), date: v.date, meters: v.meters, note: v.note }); });
    },
    delLog: async (el) => {
      if (!(await confirmBox('この使用記録を削除しますか？'))) return;
      withCloth(currentId(), (c) => { c.usageLogs = c.usageLogs.filter((l) => l.id !== el.dataset.log); });
    },

    newNote: async (el) => { if (await noteForm(el.dataset.site, null, el.dataset.cloth)) refresh(); },
    editNote: async (el) => {
      const n = await DB.get('notes', el.dataset.id);
      const v = await noteForm(n.siteId, n);
      if (v) refresh();
    },
    pinNote: async (el) => { const n = await DB.get('notes', el.dataset.id); n.pinned = !n.pinned; await touch('notes', n); refresh(); },
    newReport: async (el) => { if (await reportForm(el.dataset.site)) refresh(); },
    editReport: async (el) => { const r = await DB.get('reports', el.dataset.id); if (await reportForm(r.siteId, r)) refresh(); },

    photo: (el) => openLightbox(el.dataset.id),
    backup: () => exportBackup().catch((e) => toast('保存に失敗: ' + e.message)),
    csv: () => exportCsv(),
    saveKey: () => {
      const k = document.getElementById('api-key').value.trim();
      if (k && !/^sk-ant-/.test(k)) return toast('キーは「sk-ant-」で始まります');
      Settings.set('apiKey', k);
      Settings.set('model', document.getElementById('api-model').value);
      Settings.set('aiEnabled', document.getElementById('ai-enabled').checked ? '1' : '0');
      toast('保存しました');
      refresh();
    },
    clearKey: async () => { if (await confirmBox('APIキーを削除しますか？')) { Settings.set('apiKey', ''); refresh(); } },
    theme: (el) => { Settings.set('theme', el.dataset.v); applyTheme(); refresh(); },
  };

  const currentId = () => (location.hash.split('/')[2] || '');

  // メモ・日報カードの編集はモーダル外のボタン、写真は拡大表示
  document.addEventListener('click', (e) => {
    if (e.target.closest('#modal-root')) return;
    const img = e.target.closest('#app img[data-photo]');
    if (img && !img.classList.contains('scan-preview')) { openLightbox(img.dataset.photo); return; }
    const el = e.target.closest('#app [data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.tagName !== 'INPUT') e.preventDefault();
    Promise.resolve(fn(el, e)).catch((err) => { console.error(err); toast('エラー: ' + err.message); });
  });

  $app.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.input === 'query') {
      ui.query = t.value;
      clearTimeout(t._tm);
      t._tm = setTimeout(async () => {
        const html = await viewHome();
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        document.getElementById('site-list').innerHTML = tmp.querySelector('#site-list').innerHTML;
      }, 150);
    }
    if (t.dataset.sf && scan) {
      const it = scan.items[+t.dataset.i];
      if (t.dataset.sf === 'use') return;
      const v = t.value === '' ? null : Math.round(Number(t.value));
      it[t.dataset.sf] = v;
      it.edited = true;
      const row = t.closest('.scan-row');
      row.classList.remove('check');
      const noteEl = row.querySelector('.scan-note');
      if (noteEl && !noteEl.dataset.fixed) { noteEl.dataset.fixed = '1'; noteEl.textContent = `✔ 手で確認・修正済み${it.raw ? `（読み取り: 「${it.raw}」）` : ''}`; }
      const tot = row.querySelector('[data-tot]');
      tot.textContent = it.mm && it.count ? M(it.mm * it.count) : '?';
      document.getElementById('scan-total').textContent = M(scanTotal());
      const left = scan.items.filter((x) => x.use && x.status === 'check' && !x.edited).length;
      const box = document.getElementById('scan-check');
      box.className = 'alert ' + (left ? 'warn' : 'info');
      box.innerHTML = left ? `⚠ 要確認が <b>${left}行</b> あります。写真と見比べて直してください。` : '写真と見比べて、合っていれば保存してください。';
    }
  });

  $app.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.sf === 'use' && scan) {
      scan.items[+t.dataset.i].use = t.checked;
      return refresh();
    }
    if (t.hasAttribute('data-scan-file')) { const f = t.files[0]; t.value = ''; return handleScanFile(f); }
    if (t.hasAttribute('data-restore')) { const f = t.files[0]; t.value = ''; if (f) restoreBackup(f); return; }
    if (t.dataset.clothPhoto) {
      const files = [...t.files];
      t.value = '';
      const c = await DB.get('cloths', t.dataset.clothPhoto);
      for (const f of files) c.photoIds = (c.photoIds || []).concat(await savePhotoFile(f));
      await touch('cloths', c);
      toast(`写真を${files.length}枚追加しました`);
      refresh();
    }
  });

  window.addEventListener('hashchange', () => { closeModal(); render().then(() => window.scrollTo(0, 0)); });

  applyTheme();
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン機能なしでも動く */ });
  }
})();

/* Settings form: every [data-key] input maps to one key of storage.sync `settings`.
   Mounted by the userscript's settings panel (userscript/panel.js) on its shadow root. */
XBB.mountSettings = async function (root) {
  // the Fast UI theme list is the shared registry (userscript/themes.js), imported themes included
  if (typeof bbThemes !== 'undefined') bbThemes.fillSelect(root.querySelector('select[data-key="fastUiTheme"]'));
  const inputs = [...root.querySelectorAll('[data-key]')];
  const s = await XBB.loadSettings();

  for (const el of inputs) {
    const v = s[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.value;
  }

  let t = 0;
  const saved = root.querySelector('#saved');
  async function save(key, value) {
    // read-modify-write so we never clobber keys changed elsewhere
    const cur = (await XBB.api.storage.sync.get('settings')).settings || {};
    cur[key] = value;
    await XBB.api.storage.sync.set({ settings: cur });
    if (saved) { saved.classList.add('on'); clearTimeout(t); t = setTimeout(() => saved.classList.remove('on'), 900); }
  }
  for (const el of inputs) el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.value;
    save(el.dataset.key, v);
  });

  // Quick-toggle chips for Fast UI auto-translate languages, kept in sync with the text input
  const chipsBox = root.querySelector('#xbb-lang-chips');
  const langInput = root.querySelector('input[data-key="fastUiAutoTranslate"]');
  if (chipsBox && langInput) {
    const LANGS = [
      ['all', 'All'], ['ar', 'Arabic'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
      ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['ru', 'Russian'],
      ['tr', 'Turkish'], ['hi', 'Hindi'], ['id', 'Indonesian'], ['it', 'Italian'], ['pl', 'Polish'],
      ['th', 'Thai'], ['vi', 'Vietnamese']
    ];
    const parse = s => String(s || '').trim().toLowerCase().split(/[\s,;]+/).filter(Boolean).map(p => p.split('-')[0]);
    const syncChips = () => {
      const list = parse(langInput.value);
      const isAll = list.includes('all') || list.includes('*');
      const set = new Set(list);
      for (const b of chipsBox.querySelectorAll('button')) {
        const on = b.dataset.lang === 'all' ? isAll : (!isAll && set.has(b.dataset.lang));
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    };
    for (const [code, label] of LANGS) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.lang = code; b.textContent = label;
      b.addEventListener('click', () => {
        const list = parse(langInput.value);
        const isAll = list.includes('all') || list.includes('*');
        let next;
        if (code === 'all') next = isAll ? '' : 'all';
        else {
          const set = new Set(isAll ? [] : list);
          if (set.has(code)) set.delete(code); else set.add(code);
          next = [...set].join(', ');
        }
        langInput.value = next;
        syncChips();
        save('fastUiAutoTranslate', next);
      });
      chipsBox.append(b);
    }
    langInput.addEventListener('input', syncChips);
    syncChips();
  }
};

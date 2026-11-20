'use strict';

/*
 * Versioned, lossless preset/seed storage for the Gacha Simulator.
 * Load this file after the application's main script:
 *   <script src="./seed-storage.js"></script>
 *
 * Presets are stored as complete JSON snapshots (not the old lossy short seed).
 * Existing gacha_user_custom_presets_v5 and gacha_seed_registry_v2 entries are
 * read and migrated lazily; existing data is not deleted.
 */
(() => {
  const STORAGE_KEY = 'gacha_presets_v2';
  const LEGACY_PRESET_KEY = 'gacha_user_custom_presets_v5';
  const LEGACY_SEED_KEY = 'gacha_seed_registry_v2';
  const FORMAT = 'gacha-simulator-preset';
  const VERSION = 2;

  const clone = value => JSON.parse(JSON.stringify(value));
  const storage = () => {
    try { return window.localStorage; } catch (_) { return null; }
  };

  function readJson(key, fallback) {
    try {
      const s = storage();
      const raw = s && s.getItem(key);
      if (!raw) return clone(fallback);
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : clone(fallback);
    } catch (_) {
      return clone(fallback);
    }
  }

  function snapshotCurrent() {
    // `state` is the simulator's top-level lexical binding. This module must be
    // loaded as a classic script after the app script so it can access it.
    if (typeof state === 'undefined' || !state || typeof state !== 'object') {
      throw new Error('현재 가챠 설정을 찾을 수 없습니다. seed-storage.js를 앱 스크립트 뒤에 불러오세요.');
    }
    return {
      pity: clone(state.pity || {}),
      softPity: clone(state.softPity || {}),
      currency: clone(state.currency || {}),
      pickUpRate: state.pickUpRate,
      srGuarantee: state.srGuarantee,
      rarities: clone(Array.isArray(state.rarities) ? state.rarities : [])
    };
  }

  function validateData(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('프리셋 데이터가 올바르지 않습니다.');
    const data = input.data && input.format === FORMAT ? input.data : input;
    if (!Array.isArray(data.rarities) || data.rarities.length === 0) throw new Error('등급 데이터가 없습니다.');
    const rarities = data.rarities.map((r, i) => {
      if (!r || typeof r !== 'object') throw new Error(`${i + 1}번째 등급 데이터가 올바르지 않습니다.`);
      return {
        id: String(r.id || `rarity_${i + 1}`),
        name: String(r.name || `등급 ${i + 1}`),
        rate: Math.max(0, Number(r.rate) || 0),
        color: String(r.color || '#64748b'),
        isTopTier: !!r.isTopTier,
        items: Array.isArray(r.items) ? r.items.map((item, j) => ({
          id: String(item && item.id || `item_${i + 1}_${j + 1}`),
          name: String(item && item.name || `아이템 ${j + 1}`),
          img: String(item && item.img || ''),
          isFeatured: !!(item && item.isFeatured)
        })) : []
      };
    });
    if (!rarities.some(r => r.isTopTier)) rarities[0].isTopTier = true;
    return {
      pity: { target: Math.max(1, parseInt(data.pity && data.pity.target, 10) || 80), resetOnNatural: data.pity && data.pity.resetOnNatural !== false },
      softPity: {
        enabled: !(data.softPity && data.softPity.enabled === false),
        start: Math.max(1, parseInt(data.softPity && data.softPity.start, 10) || 70),
        ramp: Math.max(0, Number(data.softPity && data.softPity.ramp) || 0)
      },
      currency: {
        cost: Math.max(1, parseInt(data.currency && data.currency.cost, 10) || 160),
        unit: String(data.currency && data.currency.unit || '젬')
      },
      pickUpRate: Math.min(100, Math.max(0, Number(data.pickUpRate) || 50)),
      srGuarantee: data.srGuarantee !== false,
      rarities
    };
  }

  function normalizeRecord(record, name) {
    const now = new Date().toISOString();
    const rawData = record && record.data ? record.data : record;
    return {
      id: String(record && record.id || makeId()),
      name: String(record && record.name || name || '가챠 프리셋'),
      createdAt: String(record && record.createdAt || now),
      updatedAt: String(record && record.updatedAt || now),
      data: validateData(rawData)
    };
  }

  function makeId() {
    return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function readDatabase() {
    const db = readJson(STORAGE_KEY, { version: VERSION, presets: [] });
    if (Array.isArray(db.presets)) return { version: VERSION, presets: db.presets.map((p, i) => normalizeRecord(p, `프리셋 ${i + 1}`)) };

    // One-time compatibility path for older object-shaped preset storage.
    const legacy = readJson(LEGACY_PRESET_KEY, {});
    const presets = Object.entries(legacy).map(([name, value]) => normalizeRecord(value, name));
    const migrated = { version: VERSION, presets };
    writeDatabase(migrated);
    return migrated;
  }

  function writeDatabase(db) {
    const s = storage();
    if (!s) throw new Error('브라우저 로컬 저장소를 사용할 수 없습니다.');
    try {
      s.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, presets: db.presets }));
    } catch (error) {
      if (error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        throw new Error('저장 공간이 부족합니다. 이미지 파일 크기를 줄인 뒤 다시 시도해 주세요.');
      }
      throw error;
    }
  }

  function encodeBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function exportSeed(data, name) {
    const payload = { format: FORMAT, version: VERSION, name: String(name || '가챠 프리셋'), data: validateData(data || snapshotCurrent()) };
    return `G2.${encodeBase64Url(JSON.stringify(payload))}`;
  }

  function importSeed(code) {
    const value = String(code || '').trim();
    if (!value) throw new Error('시드 코드를 입력해 주세요.');
    if (value.startsWith('G2.')) {
      const payload = JSON.parse(decodeBase64Url(value.slice(3)));
      if (payload.format !== FORMAT || payload.version > VERSION) throw new Error('지원하지 않는 시드 형식입니다.');
      return { name: String(payload.name || '가져온 프리셋'), data: validateData(payload.data) };
    }
    // Preserve compatibility with JSON and the prior compact seed parser.
    if (value[0] === '{') {
      const payload = JSON.parse(value);
      return { name: String(payload.name || '가져온 프리셋'), data: validateData(payload.data || payload) };
    }
    if (typeof parseSeed === 'function') {
      const parsed = parseSeed(value);
      return { name: String(parsed.name || '가져온 프리셋'), data: validateData(parsed) };
    }
    throw new Error('시드 코드 형식을 인식할 수 없습니다.');
  }

  function list() {
    return readDatabase().presets.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, data: clone(p.data) }));
  }

  function save(name, data) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('프리셋 이름을 입력해 주세요.');
    const db = readDatabase();
    const existing = db.presets.find(p => p.name === cleanName);
    const now = new Date().toISOString();
    const record = {
      id: existing ? existing.id : makeId(), name: cleanName,
      createdAt: existing ? existing.createdAt : now, updatedAt: now,
      data: validateData(data || snapshotCurrent())
    };
    if (existing) db.presets[db.presets.indexOf(existing)] = record;
    else db.presets.push(record);
    writeDatabase(db);
    return clone(record);
  }

  function remove(id) {
    const db = readDatabase();
    const before = db.presets.length;
    db.presets = db.presets.filter(p => p.id !== id);
    if (before === db.presets.length) return false;
    writeDatabase(db);
    return true;
  }

  function apply(dataOrSeed) {
    const data = typeof dataOrSeed === 'string' ? importSeed(dataOrSeed).data : validateData(dataOrSeed);
    if (typeof state === 'undefined' || !state) throw new Error('현재 가챠 설정을 찾을 수 없습니다.');
    state.pity = { ...(state.pity || {}), ...clone(data.pity), count: 0, isGuaranteedPickup: false };
    state.softPity = clone(data.softPity);
    state.currency = clone(data.currency);
    state.pickUpRate = data.pickUpRate;
    state.srGuarantee = data.srGuarantee;
    state.rarities = clone(data.rarities);
    if (typeof saveState === 'function') saveState();
    else if (typeof save === 'function') save();
    if (typeof syncFormValues === 'function') syncFormValues();
    if (typeof renderSettingsView === 'function') renderSettingsView();
    if (typeof renderPullView === 'function') renderPullView();
    return clone(data);
  }

  function migrateLegacySeedRegistry() {
    const s = storage();
    if (!s || s.getItem(`${LEGACY_SEED_KEY}_migrated`)) return;
    const old = readJson(LEGACY_SEED_KEY, {});
    const db = readDatabase();
    let changed = false;
    Object.entries(old).forEach(([name, value]) => {
      try {
        const record = normalizeRecord({ name, data: value }, name);
        if (!db.presets.some(p => p.name === record.name)) {
          db.presets.push(record);
          changed = true;
        }
      } catch (_) { /* Ignore malformed legacy entries and keep other data. */ }
    });
    if (changed) writeDatabase(db);
    try { s.setItem(`${LEGACY_SEED_KEY}_migrated`, '1'); } catch (_) {}
  }

  function notify(message) {
    if (typeof say === 'function') say(message);
    else if (typeof alert === 'function') alert(message);
  }

  function installControls() {
    const presetSection = document.getElementById('presets')?.closest('section');
    if (!presetSection || document.getElementById('seed-storage-controls')) return;
    const panel = document.createElement('div');
    panel.id = 'seed-storage-controls';
    panel.className = 'mt-4 rounded-xl border border-amber-500/30 bg-gray-900/70 p-3 space-y-2';
    panel.innerHTML = `
      <h3 class="font-bold text-amber-300">시드 백업 / 공유 (전체 설정 저장)</h3>
      <p class="text-xs text-gray-400">짧은 시드의 손실 문제를 피하기 위해 등급, 확률, 캐릭터와 천장 설정을 모두 담은 G2 시드를 사용합니다.</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-action="export" class="rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-black">현재 설정 시드 복사</button>
        <button type="button" data-action="save" class="rounded-lg bg-purple-600 px-3 py-2 text-sm font-bold">현재 설정 프리셋 저장</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <input data-seed-input class="min-w-48 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs" placeholder="G2. 시드 코드를 붙여넣으세요">
        <button type="button" data-action="import" class="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold">시드 가져오기</button>
      </div>`;
    presetSection.appendChild(panel);
    panel.addEventListener('click', async event => {
      const action = event.target.closest('button')?.dataset.action;
      if (!action) return;
      try {
        if (action === 'export') {
          const code = exportSeed(snapshotCurrent(), '현재 설정');
          panel.querySelector('[data-seed-input]').value = code;
          await navigator.clipboard.writeText(code).catch(() => {});
          notify('전체 설정을 담은 시드가 생성되었습니다. 입력란에서 복사할 수 있습니다.');
        } else if (action === 'save') {
          const nameInput = document.getElementById('presetName');
          const name = nameInput && nameInput.value.trim();
          if (!name) throw new Error('프리셋 이름을 입력해 주세요.');
          save(name, snapshotCurrent());
          if (nameInput) nameInput.value = '';
          renderPresetDropdown();
          notify(`'${name}' 프리셋을 저장했습니다.`);
        } else if (action === 'import') {
          const parsed = importSeed(panel.querySelector('[data-seed-input]').value);
          if (!confirm(`'${parsed.name}' 시드를 적용할까요? 현재 등급과 캐릭터 설정이 바뀝니다.`)) return;
          apply(parsed.data);
          notify(`'${parsed.name}' 시드를 적용했습니다.`);
        }
      } catch (error) {
        notify(error.message || '시드 처리 중 오류가 발생했습니다.');
      }
    });
  }

  function renderPresetDropdown() {
    const select = document.getElementById('presets');
    if (!select) return;
    const selected = select.value;
    const records = list();
    select.innerHTML = '<option value="">저장된 프리셋 선택...</option>';
    records.forEach(record => {
      const option = document.createElement('option');
      option.value = record.name;
      option.textContent = record.name;
      select.appendChild(option);
    });
    if (records.some(p => p.name === selected)) select.value = selected;
  }

  function migrateAndInstall() {
    migrateLegacySeedRegistry();
    installControls();
  }

  window.GachaSeedStore = Object.freeze({ version: VERSION, list, save, remove, apply, exportSeed, importSeed, snapshotCurrent, renderPresetDropdown });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', migrateAndInstall, { once: true });
  else migrateAndInstall();
})();

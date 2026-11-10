// Dövlət Gömrük Komitəsi — e.customs.gov.az kalkulyatorunun istifadə etdiyi açıq API.
// Saytın özü bu sorğunu göndərir: POST https://c2b-fbusiness.customs.gov.az/api/v1/dictionaries/calAutoDutyv2
// Sayt sürətli təkrar sorğuları "This request is limited" cavabı ilə məhdudlaşdırır,
// ona görə nəticələr keşlənir və sorğular arasında fasilə saxlanılır.

const BASE = 'https://c2b-fbusiness.customs.gov.az/api/v1';
const HEADERS = { 'Content-Type': 'application/json', lang: 'az', requestSource: 'ECustoms' };
const MIN_GAP_MS = 2500;

let lastCall = 0;
const cache = new Map();
let dictCache = null;

async function throttle() {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

async function post(path, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    const res = await fetch(BASE + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    const text = await res.text();
    if (/request is limited/i.test(text)) {
      // DGK limiti: bir az gözləyib yenidən cəhd et
      await new Promise(r => setTimeout(r, 6000 * (attempt + 1)));
      continue;
    }
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`Gömrük API gözlənilməz cavab verdi (HTTP ${res.status}).`); }
    if (!res.ok || json.code !== 200) {
      const msg = json?.exception?.message || json?.message || `HTTP ${res.status}`;
      throw new Error('Gömrük API xətası: ' + msg);
    }
    return json.data;
  }
  throw new Error('Gömrük saytı sorğuları müvəqqəti məhdudlaşdırıb. 1-2 dəqiqə sonra yenidən yoxlayın.');
}

// Nəqliyyat vasitəsi və mühərrik növlərinin rəsmi siyahısı
async function dictionaries() {
  if (dictCache) return dictCache;
  const data = await post('/dictionaries/list', { dictionaryType: ['AutoEngineTypes', 'AutoCategories'] });
  dictCache = {
    autoTypes: (data.AutoCategories || []).map(c => ({ code: c.code, name: c.name })),
    // Sayt engineType olaraq abbreviation2 göndərir (məs. Benzin → "0")
    engineTypes: (data.AutoEngineTypes || []).map(e => ({ code: e.code, value: e.abbreviation2, name: e.name })),
  };
  return dictCache;
}

// Sayt tarixi MM.DD.YYYY formatında göndərir
function toApiDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('İstehsal tarixini gün, ay və il ilə seçin.');
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    throw new Error('İstehsal tarixi düzgün deyil.');
  }
  return `${m}.${d}.${y}`;
}

/**
 * @param {object} p
 * @param {string} p.autoType      AutoCategories.code (Minik-avtomobili = "0")
 * @param {string} p.engineType    AutoEngineTypes.abbreviation2 (Benzin = "0")
 * @param {number} p.engine        mühərrik həcmi, sm3
 * @param {string} p.issueDate     YYYY-MM-DD
 * @param {number} p.price         invoys dəyəri, USD
 * @param {number} p.transportExpenses nəqliyyat xərci, USD
 * @param {number} p.otherExpenses digər xərclər, USD
 * @param {boolean} p.freeTrade    Azad ticarət sazişi olan ölkədən (adətən false)
 */
async function calculate(p) {
  const price = Number(p.price), transportExpenses = Number(p.transportExpenses), engine = Number(p.engine);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Gömrük üçün invoys dəyəri müsbət olmalıdır.');
  if (!Number.isFinite(transportExpenses) || transportExpenses < 0) throw new Error('Nəqliyyat xərci mənfi ola bilməz.');
  if (!Number.isFinite(engine) || engine < 0) throw new Error('Mühərrik həcmi mənfi ola bilməz.');
  const body = {
    autoType: String(p.autoType ?? '0'),
    engineType: String(p.engineType ?? '0'),
    engine: Math.max(0, Math.round(engine * 1000) - 6),
    commerceType: 'nonFree',
    issueDate: toApiDate(p.issueDate),
    price,
    transportExpenses,
    otherExpenses: 20,
  };
  const key = JSON.stringify(body);
  if (cache.has(key)) return cache.get(key);
  const data = await post('/dictionaries/calAutoDutyv2', body);
  const d = data.autoDuty;
  const result = {
    duties: d.duties.map(x => ({ code: x.code, name: x.name, value: Number(x.value) })),
    total: Number(d.total.value),
    customsValue: Number(d.customsCost),
    usdRate: Number(d.usdCourse || data.usdCourse),
    request: body,
  };
  cache.set(key, result);
  return result;
}

module.exports = { calculate, dictionaries, toApiDate };

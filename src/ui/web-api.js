/* Browser-hosted mode. User settings and history stay in this browser's IndexedDB. */
(() => {
  if (window.api) return; // Electron preload provides the desktop API.
  window.PROIMPORT_WEB = true;

  const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('proimport-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('local');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function localGet(key, fallback) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local', 'readonly');
      const req = tx.objectStore('local').get(key);
      req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function localSet(key, value) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local', 'readwrite');
      tx.objectStore('local').put(value, key);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Brauzer yaddaşına yazmaq mümkün olmadı.'));
    });
  }

  async function request(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Server xətası (HTTP ${response.status}).`);
    return result;
  }
  async function bidRequest(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `BidCars sorğusu uğursuz oldu (HTTP ${response.status}).`);
    return result;
  }
  const wrap = fn => async (...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (error) { return { ok: false, error: error?.message || String(error) }; }
  };
  const bidUrl = url => {
    const value = String(url || '');
    if (/^https:\/\/(?:www\.)?bid\.cars\//i.test(value)) return value;
    if (value.startsWith('/bidcars/')) return `https://bid.cars/${value.slice('/bidcars/'.length)}`;
    return 'https://bid.cars/en/login';
  };
  const stats = values => {
    const v = values.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const q = p => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const q1 = q(.25), q3 = q(.75), iqr = q3 - q1;
    const kept = v.length >= 4 ? v.filter(x => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr) : v;
    return { count: v.length, min: v[0], max: v.at(-1), mean: mean(v), median: q(.5), trimmedMean: mean(kept), trimmedCount: kept.length };
  };

  window.api = {
    settings: {
      get: wrap(async () => {
        const saved = await localGet('settings', null);
        return saved || request('/api/settings/defaults');
      }),
      save: wrap(async value => { await localSet('settings', value); return value; }),
    },
    customs: { dict: wrap(() => request('/api/customs/dict')), calc: wrap(value => request('/api/customs/calc', value)) },
    bid: {
      archived: wrap(value => bidRequest('/api/bid/archived', value)),
      catalog: wrap(async make => {
        const rows = window.PROIMPORT_BIDCARS_CATALOG || [];
        return make ? { models: rows.find(x => x.id === make || x.name === make)?.models || [] } : { makes: rows };
      }),
      stats: wrap(values => bidRequest('/api/bid/stats', { values })),
      status: wrap(() => bidRequest('/api/bid/status')),
      show: wrap(url => {
        const target = bidUrl(url).replace(/^https:\/\/bid\.cars/i, '/bidcars');
        window.open(target, '_blank', 'noopener,noreferrer');
        return true;
      }),
    },
    azad: {
      prices: wrap(() => request('/api/azad/prices')),
      status: wrap(() => request('/api/azad/status')),
    },
    calc: { total: wrap(value => request('/api/calc/total', value)) },
    history: {
      list: wrap(() => localGet('history', [])),
      add: wrap(async item => {
        const list = await localGet('history', []);
        list.unshift({ ...item, id: item.id || crypto.randomUUID(), at: new Date().toISOString() });
        await localSet('history', list.slice(0, 300));
        return list.length;
      }),
      delete: wrap(async key => {
        const list = await localGet('history', []);
        let index = key?.id ? list.findIndex(item => item.id === key.id) : -1;
        if (index < 0 && Number.isInteger(key?.index) && list[key.index]?.at === key.at) index = key.index;
        if (index < 0 && key?.at) index = list.findIndex(item => item.at === key.at);
        if (index < 0) return false;
        list.splice(index, 1); await localSet('history', list); return true;
      }),
      clear: wrap(async () => { await localSet('history', []); return true; }),
    },
    open: url => window.open(url, '_blank', 'noopener,noreferrer'),
  };
})();

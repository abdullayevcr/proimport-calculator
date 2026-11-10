// bid.cars arxiv satışları (köhnə satış qiymətləri).
// Saytın öz səhifəsi bu JSON sorğusunu göndərir:
//   GET https://bid.cars/app/search/archived/request?search-type=typing&query=...&year-from=..&page=N
// bid.cars Cloudflare ilə qorunur, ona görə sorğular proqramın içindəki adi brauzer pəncərəsində
// (öz kukiləri ilə, persist:bidcars) göndərilir — siz saytı açmış kimi. Təhlükəsizlik yoxlaması
// və ya hesaba giriş lazım olsa, pəncərə görünür və onu özünüz tamamlayırsınız.

const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:bidcars';
const HOME = 'https://bid.cars/en/search/archived';

let win = null;
let isShuttingDown = false;

function getWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1200, height: 850, show: false, title: 'bid.cars — Proİmport',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
  });
  win.on('close', e => {
    if (isShuttingDown) return;
    e.preventDefault();
    win.hide();
  });
  return win;
}

function shutdown() {
  isShuttingDown = true;
  if (win && !win.isDestroyed()) win.close();
}

const isChallenge = w => w.webContents.executeJavaScript(
  `/just a moment|bir az gözləyin|attention required/i.test(document.title) || !!document.querySelector('#challenge-form, #cf-challenge-running, .cf-turnstile, iframe[src*="challenges.cloudflare.com"]')`, true).catch(() => true);

// Cloudflare yoxlaması adətən bir neçə saniyəyə özü keçir — onu gözləyirik
async function waitClear(w, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!w.webContents.isLoading() && !(await isChallenge(w))) return true;
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

async function ensureLoaded() {
  const w = getWindow();
  const url = w.webContents.getURL();
  if (!url.startsWith('https://bid.cars/')) {
    try { await w.loadURL(HOME); } catch { /* yönləndirmə/çağırış zamanı loadURL xəta verə bilər */ }
  }
  if (!(await waitClear(w))) {
    const err = new Error('bid.cars təhlükəsizlik yoxlaması istəyir. Ayarlar → "bid.cars hesabı" bölməsində yoxlamanı tamamlayın, sonra axtarışı təkrarlayın.');
    err.needBrowser = true;
    try { await w.loadURL('about:blank'); } catch {} // növbəti cəhddə səhifə yenidən açılsın
    throw err;
  }
  return w;
}

async function loginStatus() {
  const w = await ensureLoaded();
  const r = await fetchJson(w, 'https://bid.cars/app/logged-user/info');
  return { logged: !!(r.ok && Number(r.json.logged)) };
}

function show(url) {
  const w = getWindow();
  if (url) w.loadURL(url);
  w.show(); w.focus();
}

function buildQuery(f) {
  const q = new URLSearchParams();
  // Arxiv nəticələri filter forması ilə işləyir; "typing" boş query axtarışıdır
  // və aşağıdakı marka/model/il parametrlərini tətbiq etmir.
  q.set('search-type', 'filters');
  q.set('status', 'All'); q.set('make', f.make || 'All'); q.set('model', f.model || 'All');
  q.set('type', 'Automobile');
  if (f.yearFrom) q.set('year-from', f.yearFrom);
  if (f.yearTo) q.set('year-to', f.yearTo);
  q.set('auction-type', f.auctionType || 'All');
  if (f.odoFrom != null && f.odoFrom !== '') q.set('odometer-from', f.odoFrom);
  if (f.odoTo != null && f.odoTo !== '') q.set('odometer-to', f.odoTo);
  if (f.engineFrom) q.set('engine-size-from', f.engineFrom);
  if (f.engineTo) q.set('engine-size-to', f.engineTo);
  if (f.fuelType && f.fuelType !== 'All') q.set('fuel-type', f.fuelType);
  q.set('start-code', 'Run+and+Drive');
  if (f.driveType && f.driveType !== 'All') q.set('drive-type', f.driveType);
  return q.toString().replace(/%2B/g, '+');
}

function searchPageUrl(f) {
  return 'https://bid.cars/en/search/archived/results?' + buildQuery(f);
}

async function fetchJson(w, url) {
  const script = `fetch(${JSON.stringify(url)}, {headers:{'X-Requested-With':'XMLHttpRequest','Accept':'application/json, text/javascript, */*; q=0.01'}, credentials:'include'})
    .then(async r => ({status: r.status, text: await r.text()}))
    .catch(e => ({status: 0, text: String(e)}))`;
  const r = await w.webContents.executeJavaScript(script, true);
  try { return { ok: true, json: JSON.parse(r.text) }; }
  catch { return {
    ok: false, status: r.status,
    challenge: /just a moment|cf-chl|challenge/i.test(r.text),
    regionBlocked: /exclusively accessible to customers within the european union|only accessible to customers within the european union/i.test(r.text),
  }; }
}

function parseMoney(s) {
  const n = Number(String(s || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function catalog(make = '') {
  const file = path.join(app.getPath('userData'), 'bidcars-catalog.json');
  let rows = null;
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  // Bundled catalog makes the selectors available immediately, including offline.
  if (!Array.isArray(rows) || !rows.length) {
    try { rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'bidcars-catalog.json'), 'utf8')); } catch {}
  }
  if (!Array.isArray(rows) || !rows.length) {
    const w = await ensureLoaded();
    const script = `((async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      const visible=e=>!!e&&e.getClientRects().length>0;
      const exactLink=(selector,label)=>Array.from(document.querySelectorAll(selector)).find(a=>a.textContent.trim()===label&&visible(a));
      const type=document.querySelector('#dropdownType');
      if(!type) throw new Error('BidCars axtarış filtri tapılmadı.');
      if(!/automobile/i.test(type.textContent)){
        type.click(); await pause(80);
        const item=exactLink('a','Automobile');
        if(!item) throw new Error('Automobile bölməsi BidCars-da tapılmadı.');
        item.click(); await pause(100);
      }
      const makeButton=document.querySelector('#dropdownCountry');
      const makes=Array.from(document.querySelectorAll('#search_make_manufacturer a')).map(a=>a.textContent.trim()).filter(n=>n&&n!=='All makes');
      const result=[];
      for(const name of makes){
        if(!visible(makeButton)) throw new Error('Marka seçimi bağlandı.');
        makeButton.click(); await pause(15);
        const link=exactLink('#search_make_manufacturer a',name);
        if(!link) continue;
        link.click(); await pause(30);
        const modelButton=document.querySelector('#dropdownModel');
        if(!modelButton||modelButton.disabled) { result.push({id:name,name,models:[]}); continue; }
        modelButton.click(); await pause(20);
        const models=Array.from(document.querySelectorAll('#search_model_manufacturer a')).map(a=>a.textContent.trim()).filter(n=>n&&n!=='All models');
        result.push({id:name,name,models:[...new Set(models)].map(n=>({id:n,name:n}))});
        modelButton.click(); await pause(10);
      }
      return result;
    })())`;
    rows = await w.webContents.executeJavaScript(script, true);
    if (!Array.isArray(rows) || !rows.length) throw new Error('BidCars marka/model kataloqu boş qayıtdı.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rows));
  }
  if (make) return { models: rows.find(x => x.id === make || x.name === make)?.models || [] };
  return { makes: rows };
}

function mapLot(d) {
  return {
    lot: d.lot, vin: d.vin, name: d.name_long || d.name,
    auction: String(d.lot || '').startsWith('0-') ? 'IAAI' : 'Copart',
    odometer: d.odometer, location: d.location, startCode: d.start_code, damage: d.primary_damage,
    document: d.sale_document_split, engine: d.specs?.engine_rendered || '',
    date: d.prebid_close_time_lang?.en || '', finalBid: parseMoney(d.final_bid_formatted),
    needLogin: !!d.need_login, url: d.tag ? `https://bid.cars/en/lot/${d.lot}/${d.tag}` : null,
    img: d.img?.img_1 || null,
  };
}

/** Filtrlərə uyğun ən yeni arxiv lotlarından maksimum 50 nəticə götürür. */
async function archived(f) {
  const w = await ensureLoaded();
  const base = 'https://bid.cars/app/search/archived/request?' + buildQuery(f);
  const lots = [];
  const maxPages = 10;
  for (let page = 1; page <= maxPages; page++) {
    let r = await fetchJson(w, base + `&page=${page}`);
    if (!r.ok && page === 1) {
      // Sessiya köhnəlibsə: səhifəni yenidən aç, yoxlamanın keçməsini gözlə, bir dəfə də cəhd et
      try { await w.loadURL(searchPageUrl(f)); } catch {}
      if (await waitClear(w)) r = await fetchJson(w, base + `&page=${page}`);
    }
    if (!r.ok) {
      if (page === 1) {
        const err = new Error(r.regionBlocked
          ? 'BidCars bu xidməti yalnız Avropa İttifaqında açır. Hesab girişi keçsə də, bu səhifədən arxiv məlumatı almaq mümkün deyil.'
          : r.challenge
          ? 'bid.cars təhlükəsizlik yoxlaması istəyir. Ayarlar → "bid.cars hesabı" bölməsində yoxlamanı tamamlayın, sonra yenidən axtarın.'
          : `bid.cars cavab vermədi (HTTP ${r.status}). Ayarlar → "bid.cars hesabı" bölməsində saytın açıldığını yoxlayın.`);
        err.needBrowser = !r.regionBlocked;
        if (!r.regionBlocked) { try { await w.loadURL('about:blank'); } catch {} }
        throw err;
      }
      break;
    }
    const data = r.json.data || [];
    lots.push(...data.map(mapLot).slice(0, 50 - lots.length));
    if (lots.length >= 50) break;
    if (!r.json.next_page_url || data.length === 0) break;
    await new Promise(res => setTimeout(res, 700));
  }
  const logged = (await fetchJson(w, 'https://bid.cars/app/logged-user/info')).json?.logged;
  return { lots, searchUrl: searchPageUrl(f), logged: !!Number(logged) };
}

/** Əsas statistikalar: orta, median, kənar qiymətlər çıxılmaqla orta (IQR). */
function stats(values) {
  const v = values.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = p => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
  const trimmed = v.length >= 4 ? v.filter(x => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr) : v;
  return { count: v.length, min: v[0], max: v[v.length - 1], mean: mean(v), median: q(0.5), trimmedMean: mean(trimmed), trimmedCount: trimmed.length };
}

// bid.cars giriş kukiləri "sessiya" kukiləridir — proqram bağlananda silinir və hər dəfə yenidən daxil olmaq lazım gəlir.
// Onları 60 günlük daimi kukiyə çeviririk ki, giriş yadda qalsın (kukilər yalnız bu kompüterdə, proqramın öz profilindədir).
const KEEP_DAYS = 60;
function keepLogin() {
  const ses = session.fromPartition(PARTITION);
  const upgrade = async c => {
    if (!/(^|\.)bid\.cars$/.test(c.domain.replace(/^\./, '')) || c.expirationDate) return;
    try {
      await ses.cookies.set({
        url: `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`,
        name: c.name, value: c.value, path: c.path,
        domain: c.hostOnly ? undefined : c.domain,
        secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
        expirationDate: Math.floor(Date.now() / 1000) + KEEP_DAYS * 86400,
      });
    } catch { /* bəzi xüsusi kukilər dəyişdirilə bilmir — vacib deyil */ }
  };
  ses.cookies.on('changed', (_e, cookie, _cause, removed) => { if (!removed) upgrade(cookie); });
  ses.cookies.get({}).then(list => list.forEach(upgrade)).catch(() => {});
  return () => ses.cookies.flushStore();
}

module.exports = { archived, stats, show, loginStatus, keepLogin, searchPageUrl, catalog, shutdown, PARTITION };

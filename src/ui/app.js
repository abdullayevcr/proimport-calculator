'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n, d = 0) => Number.isFinite(+n) ? (+n).toLocaleString('az-AZ', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, ' ') : '—';
const usd = n => '$' + fmt(n);
const azn = (n, d = 2) => fmt(n, d) + ' AZN';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = id => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };

let settings = null, dict = null, prices = [], lots = [], lastResult = null, lastMarket = null;
let historyCache = [], historyQuery = '';

// ---------- köməkçilər ----------
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, err ? 7000 : 3500);
}
async function run(btn, fn) {
  btn.disabled = true; btn.classList.add('busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('busy'); }
}
async function call(p) {
  const r = await p;
  if (!r.ok) { const e = new Error(r.error); e.needBrowser = r.needBrowser; throw e; }
  return r.data;
}

// ---------- tablar ----------
$$('.tab').forEach(b => b.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === b));
  $$('.page').forEach(p => p.hidden = p.id !== 'tab-' + b.dataset.tab);
  if (b.dataset.tab === 'history') {
    historyQuery = '';
    $('#historySearch').value = '';
    loadHistory();
    requestAnimationFrame(() => $('#historySearch').focus());
  }
});

// ---------- başlanğıc ----------
async function init() {
  settings = await call(api.settings.get());
  fillSettingsForm();
  const today = new Date();
  $('#yearFrom').placeholder = $('#yearTo').placeholder = today.getFullYear();
  try {
    dict = await call(api.customs.dict());
    $('#autoType').innerHTML = dict.autoTypes.map(a => `<option value="${a.code}">${a.name}</option>`).join('');
  } catch (e) {
    // Lüğət alınmasa da əsas növlərlə işləyək
    dict = { autoTypes: [{ code: '0', name: 'Minik-avtomobili' }], engineTypes: [
      { code: '1', value: '0', name: 'Benzin' }, { code: '2', value: '1', name: 'Dizel' }, { code: '6', value: '3', name: 'Hibrid-Benzin' },
      { code: '7', value: '4', name: 'Hibrid-Dizel' }, { code: '12', value: '5', name: 'Tam elektrik' }] };
    $('#autoType').innerHTML = dict.autoTypes.map(a => `<option value="${a.code}">${a.name}</option>`).join('');
    toast('Gömrük lüğəti alınmadı: ' + e.message, true);
  }
  // Qaz yanacağı ilə işləyən variantları göstərmə; benzin, dizel, hibrid və elektrik qalsın.
  const engineChoices = (dict.engineTypes || []).filter(e => !/(qaz|lpg|cng|metan|methan|propan|natural\s*gas|liquefied\s*petroleum|compressed\s*natural)/i.test(e.name || ''));
  $('#engineType').innerHTML = engineChoices.map(e => `<option value="${e.code}">${e.name}</option>`).join('');
  const defaultEngine = engineChoices.find(e => /(benzin|gasoline|petrol)/i.test(e.name || '')) || engineChoices[0];
  $('#engineType').value = defaultEngine ? String(defaultEngine.code) : '';
  $('#engineType').disabled = false;
  syncEngineVolume();
  const productionToday = new Date();
  $('#issueDate').value = `${productionToday.getFullYear()}-${String(productionToday.getMonth() + 1).padStart(2, '0')}-${String(productionToday.getDate()).padStart(2, '0')}`;
  await loadCatalog();
  $('#shipGeo').value = settings.georgiaToBaku;
  await loadPrices();
  const s = await refreshConn();
  restoreDraft();
  syncEngineVolume();
  // əvvəlki qiymət saxlanılır, amma bazar siyahısı yenidən gətirilir (müqayisə üçün)
  if (marketReady(marketFilters())) scheduleMarket();
}

// ---------- Azad Logistics qiymətləri ----------
async function loadPrices() {
  const c = await call(api.azad.prices()).catch(() => null);
  prices = c?.rows || [];
  // Copart və IAAI həmişə; Azad cədvəlində başqa auksionlar da varsa, onlar da
  const normAuction = a => String(a || '').trim().toUpperCase() === 'IAAI' ? 'IAAI' : String(a || '').trim();
  const auctions = [...new Set(['Copart', 'IAAI', 'Manheim', 'CANADA', 'Pipeline', ...prices.map(p => normAuction(p.auction))])];
  const prevA = $('#shipAuction').value;
  $('#shipAuction').innerHTML = auctions.map(a => `<option>${a}</option>`).join('');
  if (auctions.some(a => normAuction(a) === normAuction(prevA))) $('#shipAuction').value = normAuction(prevA);
  updateLocations();
}

const placeOf = loc => loc.replace(/^[A-Z]{2}\s*-\s*/i, '');
const normAuction = a => String(a || '').trim().toUpperCase();
const rowsFor = () => { const a = normAuction($('#shipAuction').value); return prices.filter(p => normAuction(p.auction) === a); };

function updateLocations() {
  const rows = rowsFor();
  // meydançalar ən ucuzdan bahaya
  const best = {}; rows.forEach(r => { best[r.location] = Math.min(best[r.location] ?? Infinity, r.price); });
  const locs = Object.keys(best).sort((a, b) => best[a] - best[b]);
  const prev = $('#shipLocation').value;
  const select = $('#shipLocation');
  select.replaceChildren(new Option(locs.length ? 'Şəhər / meydança seçin' : prices.length ? `Bu auksion üçün şəhər yoxdur (${$('#shipAuction').value})` : 'Azad cədvəli yoxdur', ''));
  locs.forEach(l => select.add(new Option(`${placeOf(l)} — ${usd(best[l])}-dan`, l)));
  if (locs.includes(prev)) $('#shipLocation').value = prev;
  else $('#shipLocation').value = '';
  const search = $('#shipLocationSearch');
  search.value = locs.includes(select.value) ? placeOf(select.value) : '';
  search.placeholder = locs.length ? `Şəhər/meydança seçin (${locs.length})...` : 'Şəhər/meydança yoxdur';
  renderLocationOptions();
  updatePorts();
}
function renderLocationOptions() {
  const box = $('#shipLocationOptions'), query = $('#shipLocationSearch').value.trim().toLocaleLowerCase();
  const options = [...$('#shipLocation').options].slice(1).filter(o => !query || o.text.toLocaleLowerCase().includes(query));
  box.replaceChildren();
  if (!options.length) {
    const empty = document.createElement('div'); empty.className = 'yard-empty'; empty.textContent = 'Uyğun şəhər və ya meydança tapılmadı'; box.append(empty);
  } else options.forEach(o => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'yard-option'; b.role = 'option';
    b.textContent = o.text; b.dataset.location = o.value; box.append(b);
  });
}
$('#shipLocationSearch').addEventListener('focus', () => { renderLocationOptions(); $('#shipLocationOptions').hidden = false; });
$('#shipLocationSearch').addEventListener('input', () => {
  $('#shipLocation').value = ''; renderLocationOptions(); $('#shipLocationOptions').hidden = false; updatePorts();
});
$('#shipLocationSearch').addEventListener('keydown', e => {
  if (e.key === 'Escape') $('#shipLocationOptions').hidden = true;
  if (e.key === 'Enter') { e.preventDefault(); $('#shipLocationOptions').querySelector('.yard-option')?.click(); }
});
$('#shipLocationOptions').addEventListener('click', e => {
  const b = e.target.closest('[data-location]'); if (!b) return;
  $('#shipLocation').value = b.dataset.location; $('#shipLocationSearch').value = placeOf(b.dataset.location);
  $('#shipLocationOptions').hidden = true; updatePorts();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.yard-picker')) $('#shipLocationOptions').hidden = true;
});
function updatePorts() {
  const l = $('#shipLocation').value;
  const rows = rowsFor().filter(p => p.location === l).sort((a, b) => a.price - b.price);
  const prev = $('#shipPort').value;
  // ən ucuz liman default seçilir
  $('#shipPort').innerHTML = rows.length ? rows.map(r => `<option value="${r.port}">${r.port} — ${usd(r.price)}</option>`).join('') : '<option value="">—</option>';
  if (rows.some(r => r.port === prev)) $('#shipPort').value = prev;
  else if (rows.some(r => r.port === 'GA')) $('#shipPort').value = 'GA';
  applyShipPrice();
}

function catalogRows(data) {
  const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.results) ? data.results : []);
  return arr.map(x => typeof x === 'string' ? {id:x,name:x,makeId:''} : {
    id: String(x.id ?? x.value ?? x.slug ?? x.code ?? x.model_id ?? x.make_id ?? x.name ?? ''),
    name: String(x.name ?? x.title ?? x.label ?? x.text ?? x.model ?? x.make ?? ''),
    makeId: String(x.make_id ?? x.makeId ?? x.parent_id ?? ''),
    models: x.models ?? x.children ?? null
  }).filter(x => x.id && x.name);
}
async function loadCatalog() {
  try {
    const makes = catalogRows(window.PROIMPORT_BIDCARS_CATALOG || []);
    if (!makes.length) throw new Error('Daxili marka/model kataloqu oxunmadı.');
    $('#make').innerHTML = '<option value="">Marka seçin</option>' + makes.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
    $('#make').onchange = async () => {
      const selected = makes.find(x => x.id === $('#make').value);
      const models = catalogRows(selected?.models || []);
      $('#model').innerHTML = '<option value="">Model seçin</option>' + models.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
      $('#model').disabled = !models.length;
      if (!models.length) $('#model').innerHTML = '<option value="">Bu marka üçün model tapılmadı</option>';
      scheduleMarket();
    };
  } catch (e) { $('#marketLine').textContent = 'BidCars marka/model siyahısı yüklənmədi: ' + e.message; }
}
function applyShipPrice() {
  const l = $('#shipLocation').value, port = $('#shipPort').value;
  const row = rowsFor().find(p => p.location === l && p.port === port);
  if (row) { $('#shipping').value = row.price; $('#shipSrc').textContent = `Azad Logistics: ${row.location} → ${row.port} = ${usd(row.price)} (Gürcüstana qədər)`; }
  else $('#shipSrc').textContent = !prices.length ? 'Azad Logistics tarif cədvəli yüklənməyib.'
    : !l ? 'Şəhər/meydança axtarıb seçin — daşınma qiyməti Azad Logistics-dən avtomatik yazılacaq.'
    : `${$('#shipAuction').value} üçün bu meydançada Azad qiyməti yoxdur — başqa liman və ya auksion seçin.`;
}
$('#shipAuction').onchange = updateLocations;
$('#shipPort').onchange = applyShipPrice;

async function refreshConn() {
  const s = await call(api.azad.status()).catch(() => ({}));
  const updatedAt = s.pricesUpdated ? new Date(`${s.pricesUpdated}T00:00:00`) : null;
  const ageDays = updatedAt && Number.isFinite(updatedAt.getTime())
    ? Math.floor((Date.now() - updatedAt.getTime()) / 86400000) : null;
  const stale = ageDays != null && ageDays > 60;
  $('#conn').innerHTML = `<span class="pill ${s.priceCount ? (stale ? 'no' : 'ok') : 'no'}">Azad tarifləri: ${s.priceCount || 0} sətir · offline${stale ? ' · köhnə' : ''}</span>`;
  $('#azadState').textContent = s.priceCount
    ? `${s.priceCount} tarif proqramın daxilindədir. Son tarif faylı: ${s.pricesUpdated ? new Date(`${s.pricesUpdated}T00:00:00`).toLocaleDateString('az-AZ') : 'tarix göstərilməyib'}.${stale ? ` Bu cədvəl ${ageDays} gündür yenilənməyib; hesablamalar offline tariflərlə davam edir.` : ''} Hesaba giriş tələb olunmur.`
    : 'Tarif faylı tapılmadı.';
  return s;
}

// ---------- invoys ----------
// Hərrac faizi avtomatik = uduş pulu × faiz (Ayarlar, standart 18%), əl ilə dəyişdirilərsə həmin dəyər saxlanılır
let feeManual = false;
function updateInvoice() {
  const p = num('#carPrice'), pct = Number(settings?.auctionPercent) || 0;
  if (!feeManual) $('#auctionFee').value = p != null ? Math.round(p * pct / 100) : '';
  const f = num('#auctionFee') || 0;
  $('#feeHint').textContent = feeManual ? '(əl ilə — faizə qaytar)' : `(${pct}% — dəyiş)`;
  $('#invoiceView').textContent = p != null ? `${usd(p + f)}  (${usd(p)} uduş + ${usd(f)} hərrac faizi)` : '—';
}
$('#carPrice').addEventListener('input', updateInvoice);
$('#auctionFee').addEventListener('input', () => { feeManual = $('#auctionFee').value !== ''; updateInvoice(); });
// "(17% — dəyiş)" → Ayarlarda faiz sahəsi; "(əl ilə — faizə qaytar)" → faizlə hesabla
$('#feeHint').onclick = e => {
  e.preventDefault();
  if (feeManual) { feeManual = false; updateInvoice(); return; }
  $$('.tab')[2].click(); $('#sAuctionFee').focus(); $('#sAuctionFee').select();
};

// ---------- bid.cars bazar analizi ----------
function fuelFor(engineName) {
  const n = (engineName || '').toLowerCase();
  if (n.includes('elektrik') || n.includes('electric')) return 'Electric';
  if (n.includes('hibrid') || n.includes('hybrid')) return 'Hybrid';
  if (n.includes('dizel')) return 'Diesel';
  if (n.includes('benzin') || n.includes('gasoline') || n.includes('petrol')) return 'Gasoline';
  return 'All';
}
function syncEngineVolume() {
  const field = $('#engine');
  if (!field) return;
  const engine = dict?.engineTypes?.find(e => String(e.code) === $('#engineType').value);
  const electric = /elektr|electric/i.test(engine?.name || '');
  if (electric) {
    if (!field.disabled && Number(field.value) > 0) field.dataset.previousVolume = field.value;
    field.value = '0';
    field.min = '0';
    field.disabled = true;
  } else {
    if (field.disabled) field.value = field.dataset.previousVolume || '';
    field.disabled = false;
    field.min = '0.1';
  }
}
$('#engineType').addEventListener('change', syncEngineVolume);
function marketFilters() {
  const year = ($('#issueDate').value || '').slice(0, 4);
  const cc = num('#engine');
  const eng = dict.engineTypes.find(e => String(e.code) === $('#engineType').value);
  const f = {
    query: '', make: $('#make').value || 'All', model: $('#model').value || 'All',
    yearFrom: $('#yearFrom').value || year, yearTo: $('#yearTo').value || year,
    odoFrom: $('#odoFrom').value, odoTo: $('#odoTo').value,
    startCode: 'Run+and+Drive', driveType: $('#driveType').value, auctionType: $('#auctionType').value,
    fuelType: fuelFor(eng?.name), maxPages: 1,
  };
  if (cc && fuelFor(eng?.name) !== 'Electric') {
    f.engineFrom = Math.max(0, cc - 0.1).toFixed(1); f.engineTo = (cc + 0.1).toFixed(1);
  }
  return f;
}

// ---- Avtomatik bazar qiyməti: ümumi ortadan baha lotların ortasını tapır ----
let priceManual = false, marketSeq = 0, marketTimer = null, lastKey = '';
function setMarketLine(text, cls = '') { const m = $('#marketLine'); m.textContent = text; m.className = 'market-line ' + cls; }
function marketReady(f) {
  const engine = dict?.engineTypes?.find(e => String(e.code) === $('#engineType').value);
  const electric = /elektr|electric/i.test(engine?.name || '');
  return !!(f.make !== 'All' && f.model !== 'All' && f.yearFrom && (electric || (num('#engine') != null && num('#engine') > 0)));
}
function scheduleMarket() {
  clearTimeout(marketTimer);
  const f = marketFilters();
  if (!marketReady(f)) { setMarketLine('Marka/model, mühərrik həcmi və istehsal tarixini yazın — son 50 lotun ümumi ortasından baha olanların ortası hesablanacaq.'); return; }
  marketTimer = setTimeout(() => searchMarket(false), 1200);
}
async function searchMarket(force) {
  const f = marketFilters();
  if (!marketReady(f)) return toast('Əvvəl marka/model, mühərrik həcmi və istehsal tarixini daxil edin.', true);
  const key = JSON.stringify(f);
  if (!force && key === lastKey) return;
  lastKey = key;
  const seq = ++marketSeq;
  setMarketLine(`bid.cars arxivinin son 50 lotunda axtarılır: ${$('#make').selectedOptions[0]?.text} ${$('#model').selectedOptions[0]?.text}, ${f.yearFrom}${f.engineFrom ? ', ' + f.engineFrom + '–' + f.engineTo + 'L' : ''}…`, 'busy');
  try {
    const r = await call(api.bid.archived(f));
    if (seq !== marketSeq) return; // daha yeni axtarış başlayıb
    lastMarket = { filters: f, url: r.searchUrl, logged: r.logged };
    lots = r.lots.map(l => ({ ...l, use: !!l.finalBid }));
    await renderLots();
    $('#marketCard').hidden = false;
    applyMarketPrice();
  } catch (err) {
    if (seq !== marketSeq) return;
    lastKey = '';
    setMarketLine('bid.cars: ' + err.message, 'warn');
    if (err.needBrowser) openBidLogin();
  }
}
const aboveMeanPriceGroup = window.ProImportMarketPricing.aboveMeanPriceGroup;

// Avtomatik müştəri qiyməti ümumi ortadan yuxarı satılan lotların ortasıdır.
function applyMarketPrice() {
  const st = lastMarket?.stats;
  const visiblePrices = lots.filter(l => l.use && l.finalBid).map(l => l.finalBid);
  const group = aboveMeanPriceGroup(visiblePrices);
  const hidden = lots.filter(l => !l.finalBid && l.needLogin).length;
  if (!st || !group) {
    if (lastMarket) lastMarket.price = null;
    if (!priceManual) { $('#carPrice').value = ''; updateInvoice(); }
    $('#btnUseMarket').hidden = true;
    const priced = lots.filter(l => l.finalBid).length;
    setMarketLine(priced ? 'Yüksək qiymət qrupunu hesablamaq üçün qiymətli lotları seçin.'
      : `bid.cars: ${lots.length} satış tapıldı, amma heç birinin qiyməti görünmür${hidden ? ' — Ayarlarda bid.cars hesabına daxil olun' : ' — filtrləri genişləndirin'}.`, 'warn');
    return;
  }
  const price = Math.round(group.average);
  lastMarket.stats = { ...st, aboveAverageGroup: group, recommendedPrice: price };
  setMarketLine(`bid.cars: ümumi orta ${usd(group.baselineAverage)}; ondan baha ${group.count} lot (${usd(group.min)}–${usd(group.max)}); onların ortası ${usd(price)}`
    + ` · ${group.belowAverageCount} lot ümumi ortadan aşağıdır`
    + (hidden ? ` · ${hidden} qiymət gizlidir` : '')
    + (group.count < 3 ? ' · az sayda yüksək qiymətli lot var' : ''), group.count < 3 || (hidden && st.count < 3) ? 'warn' : 'ok');
  lastMarket.price = price;
  if (!priceManual) { $('#carPrice').value = price; updateInvoice(); }
  $('#btnUseMarket').hidden = !priceManual;
  $('#priceHint').textContent = priceManual ? '(əl ilə)' : '(ortalamadan yuxarı lotların ortası)';
}
$('#carPrice').addEventListener('input', () => {
  priceManual = $('#carPrice').value !== '';
  $('#priceHint').textContent = priceManual ? '(əl ilə)' : '';
  $('#btnUseMarket').hidden = !(priceManual && lastMarket?.price);
});
$('#btnUseMarket').onclick = () => { priceManual = false; applyMarketPrice(); };
$('#btnMarket').onclick = e => run(e.currentTarget, () => searchMarket(true));
['make', 'model', 'engineType', 'engine', 'issueDate', 'odoFrom', 'odoTo', 'yearFrom', 'yearTo', 'driveType', 'auctionType']
  .forEach(id => {
    // avtomobil dəyişibsə, köhnə əl ilə yazılmış qiymət də köhnəlib — yenisini bazardan götür
    const h = () => { priceManual = false; scheduleMarket(); };
    $('#' + id).addEventListener('change', h); $('#' + id).addEventListener('input', h);
  });
$('#btnOpenSearch').onclick = () => lastMarket && api.bid.show(lastMarket.url);

let lotPickerOpen = false, marketWasVisible = false;
function setLotPickerOpen(open) {
  lotPickerOpen = open;
  const page = $('#tab-calc');
  page.classList.toggle('lot-picker-open', open);
  $('#resultCard').hidden = open;
  $('#marketCard').hidden = open ? false : !marketWasVisible;
  $('#lotPickerHead').hidden = !open;
  if (open && !lots.length) {
    $('#lots').innerHTML = '<tbody><tr><td colspan="7" class="muted">Lotları seçmək üçün əvvəlcə marka, model və digər filtrlərlə arxiv axtarışını tamamlayın.</td></tr></tbody>';
    $('#lotsHint').textContent = '';
  }
}
$('#btnOpenLotPicker').onclick = () => {
  marketWasVisible = !$('#marketCard').hidden;
  setLotPickerOpen(true);
};
$('#btnCloseLotPicker').onclick = () => setLotPickerOpen(false);

async function renderLots() {
  const withPrice = lots.filter(l => l.finalBid);
  const hidden = lots.filter(l => !l.finalBid && l.needLogin).length;
  const selectedPrices = lots.filter(l => l.use && l.finalBid).map(l => l.finalBid);
  const st = await call(api.bid.stats(selectedPrices));
  const group = aboveMeanPriceGroup(selectedPrices);
  lastMarket.stats = st;
  $('#stats').innerHTML = st ? [
    ['Qiymətli lot', st.count],
    ['Orta qiymətdən aşağı lotlar', group?.belowAverageCount || 0],
    ['Ümumi satış ortalaması', group ? usd(group.baselineAverage) : '—'],
    ['Ortalamadan baha lotlar', group ? `${group.count} · ${usd(group.min)}–${usd(group.max)}` : '—'],
    ['Yüksək qiymət qrupunun ortası', group ? usd(Math.round(group.average)) : '—'],
    ['Median', usd(st.median)], ['Bütün qiymət aralığı', `${usd(st.min)} – ${usd(st.max)}`],
  ].map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('') : '<div class="muted">Seçilmiş qiymət yoxdur.</div>';
  $('#lots').innerHTML = `<thead><tr><th></th><th></th><th>Avtomobil</th><th>Yürüş</th><th>Yer / zərər</th><th>Tarix</th><th>Satış qiyməti</th></tr></thead><tbody>` +
    lots.map((l, i) => `<tr class="${l.use && l.finalBid ? '' : 'off'}">
      <td><input type="checkbox" data-i="${i}" ${l.use ? 'checked' : ''} ${l.finalBid ? '' : 'disabled'}></td>
      <td>${l.img ? `<img src="${l.img}" loading="lazy" alt="">` : ''}</td>
      <td><a data-url="${l.url || ''}">${l.name}</a><br><span class="tag ${l.auction === 'IAAI' ? 'iaai' : ''}">${l.auction}</span> <span class="muted">${l.engine} · ${l.startCode || '—'}</span></td>
      <td>${fmt(l.odometer)} mi<br><span class="muted">${fmt(l.odometer * 1.609)} km</span></td>
      <td>${l.location || ''}<br><span class="muted">${l.damage || ''} · ${l.document || ''}</span></td>
      <td>${l.date}</td>
      <td class="num">${l.finalBid ? usd(l.finalBid) : (l.needLogin ? '<span class="muted">giriş lazımdır</span>' : '—')}</td></tr>`).join('') + '</tbody>';
  $('#lotsHint').textContent = `${lots.length} lot tapıldı, ${withPrice.length}-nin qiyməti görünür.` +
    ' Uyğun olmayan lotların işarəsini götürün — ümumi ortadan baha lotların ortası yenidən hesablanır.';
  // bid.cars satış qiymətlərinin çoxunu yalnız hesaba daxil olana göstərir
  $('#bidBanner').hidden = !hidden;
  $('#bidBannerText').textContent = lastMarket.logged
    ? `${hidden} lotun qiyməti hələ də gizlidir (bid.cars hesabınız bu qiymətləri göstərmir).`
    : `bid.cars ${hidden} lotun satış qiymətini gizlədir — bunlar yalnız hesaba daxil olduqda görünür. Bir dəfə daxil olun, sonra axtarışı təkrarlayın.`;
}
$('#lots').addEventListener('change', async e => {
  const i = e.target.dataset.i; if (i == null) return;
  lots[i].use = e.target.checked; await renderLots(); applyMarketPrice();
});
$('#lots').addEventListener('click', e => { const u = e.target.dataset?.url; if (u) api.bid.show(u); });
$$('[data-use]').forEach(b => b.onclick = () => {
  const v = lastMarket?.stats?.[b.dataset.use]; if (!v) return;
  $('#carPrice').value = Math.round(v / 50) * 50; priceManual = true; $('#priceHint').textContent = '(seçilmiş)'; updateInvoice();
  toast(`Avtomobilin qiyməti: ${usd($('#carPrice').value)} (${b.textContent.toLowerCase()})`);
});

// ---------- HESABLA ----------
$('#btnCalc').onclick = e => run(e.currentTarget, async () => {
  // Qiymət hələ yoxdursa, əvvəl son lotların ortadan yuxarı satış ortasını hesabla
  if (num('#carPrice') == null && marketReady(marketFilters())) { clearTimeout(marketTimer); await searchMarket(true); }
  const carPrice = num('#carPrice'), cc = num('#engine'), date = $('#issueDate').value, shipping = num('#shipping');
  const eng = dict.engineTypes.find(x => String(x.code) === $('#engineType').value);
  const electric = /elektr|electric/i.test(eng?.name || '');
  const miss = [carPrice == null || carPrice <= 0 ? 'avtomobilin qiyməti müsbət olmalıdır' : '',
    (!electric && (cc == null || cc <= 0)) ? 'mühərrik həcmi müsbət olmalıdır' : '',
    !date ? 'istehsal tarixi' : '',
    shipping == null || shipping < 0 ? 'daşınma qiyməti mənfi ola bilməz' : '',
    (num('#auctionFee') ?? 0) < 0 ? 'hərrac haqqı mənfi ola bilməz' : '',
    (num('#shipGeo') ?? settings.georgiaToBaku) < 0 ? 'Gürcüstan–Bakı daşınması mənfi ola bilməz' : ''].filter(Boolean);
  if (miss.length) return toast('Doldurun: ' + miss.join(', '), true);
  const auctionFee = num('#auctionFee') || 0;
  const invoice = carPrice + auctionFee;
  let cust;
  try {
    cust = await call(api.customs.calc({ autoType: $('#autoType').value, engineType: eng?.value ?? '0', engine: cc, issueDate: date,
      price: invoice, transportExpenses: shipping + (num('#shipGeo') ?? settings.georgiaToBaku), otherExpenses: 20 }));
  } catch (err) { return toast(err.message, true); }
  const t = await call(api.calc.total({ carPrice, auctionFee, shipping, georgiaToBaku: num('#shipGeo') ?? settings.georgiaToBaku, customsAzn: cust.total,
    usdRate: cust.usdRate || settings.usdRate, fees: settings.fees, officeFee: settings.officeFee }));
  const sampleLot = lots.find(l => l.use && l.finalBid && l.img) || lots.find(l => l.use && l.finalBid) || lots.find(l => l.img);
  const sampleOdometer = Number(sampleLot?.odometer);
  lastResult = { input: collectDraft(), engineName: eng?.name, customs: cust, total: t, fees: settings.fees,
    shipFrom: $('#shipLocation').value, shipPort: $('#shipPort').value, market: lastMarket?.stats || null,
    sampleVehicle: sampleLot ? { image: sampleLot.img || '', odometer: Number.isFinite(sampleOdometer) && sampleOdometer < 999999 ? sampleOdometer : null,
      url: sampleLot.url || '', name: sampleLot.name || '' } : null };
  renderResult();
  saveDraft();
  $('#historySaveStatus').textContent = 'Tarixçəyə yazılır…';
  try {
    await call(api.history.add(lastResult));
    $('#historySaveStatus').textContent = 'Tarixçəyə avtomatik yazıldı ✓';
  } catch (err) {
    $('#historySaveStatus').textContent = 'Tarixçəyə yazılmadı';
    toast('Hesablama hazırdır, amma tarixçəyə yazılmadı: ' + err.message, true);
  }
});

function renderResult() {
  const { total: t, customs: c } = lastResult;
  if (t.finalAzn == null) return; // köhnə formatlı tarixçə qeydi
  const u2 = n => '$' + fmt(n, 2);
  const dual = (v, az = v * t.rate) => `${usd(v)} · ${azn(az)}`;
  $('#finalAzn').textContent = azn(t.finalAzn, 0);
  $('#finalUsd').textContent = usd(t.final);
  const rows = [
    ['sect', 'Avtomobil'],
    ['', 'Uduş pulu', dual(lastResult.input.carPrice)],
    ['', 'Hərrac faizi', dual(lastResult.input.auctionFee || 0)],
    ['sub', 'İnvoys dəyəri', dual(t.invoice)],
    ['sect', 'Daşınma'],
    ['', `Gürcüstana qədər (Azad Logistics${lastResult.shipFrom ? ': ' + lastResult.shipFrom + ' → ' + (lastResult.shipPort || '') : ''})`, dual(t.shipping)],
    ['', 'Gürcüstandan Bakıya', dual(t.georgia)],
    ['sect', 'Bakı'],
    ['', 'Gömrük ödənişləri (DGK)', `${u2(t.customs)} · ${azn(t.customsAzn)}`],
    ['sub', `${azn(t.customsAzn)} ÷ ${t.rate} · gömrük dəyəri ${azn(c.customsValue, 0)}`, ''],
    ...(t.feeList || []).map(x => ['', x.name, `${u2(x.usd)} · ${azn(x.usd*t.rate)}`]),
    ...(t.office ? [['sect', 'Ofis'], ['', 'Ofis haqqı', dual(t.office)]] : []),
    ['total', 'YEKUN', `${u2(t.final)} · ${azn(t.finalAzn)}`],
  ];
  $('#breakdown').innerHTML = '<tbody>' + rows.map(([cls, a, b]) => cls === 'sect'
    ? `<tr class="sect"><td colspan="2">${a}</td></tr>` : `<tr class="${cls}"><td>${a}</td><td class="num">${b ?? ''}</td></tr>`).join('') + '</tbody>';
  $('#duties').innerHTML = c.duties.map(d => `<tr><td>${d.name}</td><td>${azn(d.value)}</td></tr>`).join('') + `<tr><td><b>Cəmi gömrük ödənişləri</b></td><td><b>${azn(c.total)}</b></td></tr>`;
  $('#dutyBox').hidden = false;
  $('#btnCopy').disabled = false;
  $('#btnOpenLotPicker').hidden = false;
}

function customerText() {
  const r = lastResult, i = r.input, t = r.total;
  const year = String(i.issueDate || '').slice(0, 4);
  return [
    `${year} ${i.makeName || ''} ${i.modelName || ''}`.trim() + ` · ${fmt(i.engine,1)} L · ${r.engineName || 'Benzin'}`,
    `Uduş pulu: ${usd(i.carPrice)} + ${usd(i.auctionFee)} hərrac faizi = invoys ${usd(t.invoice)}`,
    `Daşınma: ${usd(i.shipping)}${r.shipFrom ? ' (' + r.shipFrom + ' → Gürcüstan)' : ''} + ${usd(t.georgia)} (Gürcüstan → Bakı)`,
    `Gömrük ödənişləri: ${usd(t.customs)}`,
    `Bakıda təhvil, tam qiymət: ${usd(Math.round(t.final))}`,
    r.market ? ((r.market.aboveAverageGroup || r.market.dominantRange)
      ? `Bazar: ümumi ortadan baha lotların orta qiyməti ${usd(r.market.recommendedPrice)}`
      : `Bazar: ${r.market.count} satış üzrə qiymət məlumatı`) : '',
  ].filter(Boolean).join('\n');
}
$('#btnCopy').onclick = async () => { await navigator.clipboard.writeText(customerText()); toast('Müştəri üçün mətn kopyalandı.'); };

// ---------- qaralama (son daxil edilənlər) ----------
const DRAFT = ['make', 'model', 'engine', 'issueDate', 'odoFrom', 'odoTo', 'yearFrom', 'yearTo', 'startCode', 'driveType', 'auctionType', 'carPrice', 'auctionFee', 'shipping', 'shipGeo', 'engineType', 'autoType', 'shipAuction', 'shipLocation', 'shipPort'];
function collectDraft() { const o = {}; DRAFT.forEach(k => { const v = $('#' + k).value; o[k] = $('#' + k).type === 'number' ? (v === '' ? null : +v) : v; }); o.makeName=$('#make').selectedOptions[0]?.text || ''; o.modelName=$('#model').selectedOptions[0]?.text || ''; return o; }
function saveDraft() { try { localStorage.setItem('draft', JSON.stringify(collectDraft())); } catch {} }
function restoreDraft(d) {
  try { d = d || JSON.parse(localStorage.getItem('draft') || 'null'); } catch { d = null; }
  if (!d) return;
  const ship = ['shipAuction', 'shipLocation', 'shipPort'];
  DRAFT.filter(k => !ship.includes(k) && k !== 'engineType').forEach(k => { if (d[k] != null && $('#' + k)) $('#' + k).value = d[k]; });
  const savedEngineType = String(d.engineType ?? '');
  if ([...$('#engineType').options].some(o => o.value === savedEngineType)) $('#engineType').value = savedEngineType;
  // Köhnə qaralamalarda yalnız il saxlanırdı; tarix sahəsi üçün 1 yanvara çevir.
  const savedIssueDate = String(d.issueDate || '');
  const issueDateMatch = savedIssueDate.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?$/);
  if (issueDateMatch) $('#issueDate').value = issueDateMatch[2] ? savedIssueDate : `${issueDateMatch[1]}-01-01`;
  if ($('#make').value) $('#make').dispatchEvent(new Event('change'));
  // ardıcıl: auksion → şəhər/meydança → liman
  if (d.shipAuction) $('#shipAuction').value = d.shipAuction; updateLocations();
  if (d.shipLocation && [...$('#shipLocation').options].some(o => o.value === d.shipLocation)) {
    $('#shipLocation').value = d.shipLocation; $('#shipLocationSearch').value = placeOf(d.shipLocation);
  }
  updatePorts();
  if (d.shipPort) { $('#shipPort').value = d.shipPort; applyShipPrice(); }
  if (d.shipping != null) $('#shipping').value = d.shipping;
  priceManual = d.carPrice != null; $('#priceHint').textContent = priceManual ? '(əvvəlki)' : '';
  feeManual = false; updateInvoice();
  if (d.auctionFee != null && d.auctionFee !== +$('#auctionFee').value) { $('#auctionFee').value = d.auctionFee; feeManual = true; updateInvoice(); }
}

// ---------- tarixçə ----------
function historyMileage(item) {
  const sample = Number(item.sampleVehicle?.odometer);
  if (Number.isFinite(sample) && sample > 0 && sample < 999999) return `${fmt(sample)} mil`;
  const rawFrom = item.input?.odoFrom, rawTo = item.input?.odoTo;
  const from = rawFrom == null || rawFrom === '' ? NaN : Number(rawFrom);
  const to = rawTo == null || rawTo === '' ? NaN : Number(rawTo);
  if (Number.isFinite(from) && Number.isFinite(to)) return `${fmt(from)}–${fmt(to)} mil filtr`;
  if (Number.isFinite(from)) return `${fmt(from)}+ mil filtr`;
  if (Number.isFinite(to)) return `≤ ${fmt(to)} mil filtr`;
  return 'Yürüş göstərilməyib';
}

function historyImage(item) {
  const raw = item.sampleVehicle?.image;
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function historyDetails(item) {
  const input = item.input || {}, total = item.total || {}, customs = item.customs || {};
  const finalAzn = Number(total.finalAzn ?? (Number(total.final || 0) * Number(total.rate || 1.7)));
  const rows = [
    ['Uduş pulu', usd(input.carPrice)],
    ['Hərrac haqqı', usd(input.auctionFee || 0)],
    ['İnvoys dəyəri', usd(total.invoice)],
    [`Azad Logistics: ${item.shipFrom || '—'} → ${item.shipPort || '—'}`, usd(total.shipping)],
    ['Gürcüstandan Bakıya', usd(total.georgia)],
    ['Gömrük ödənişləri', `${usd(total.customs)} · ${azn(total.customsAzn)}`],
    ...(total.feeList || []).map(f => [f.name, `${usd(f.usd)} · ${azn(Number(f.usd || 0) * Number(total.rate || 1.7))}`]),
    ...(total.office ? [['Ofis haqqı', usd(total.office)]] : []),
    ['Yekun', `${usd(total.final)} · ${azn(finalAzn, 0)}`],
  ];
  const image = historyImage(item);
  const duties = (customs.duties || []).map(d => `<tr><td>${escapeHtml(d.name)}</td><td>${azn(d.value)}</td></tr>`).join('');
  return `<div class="history-detail">
    ${image ? `<img class="history-detail-image" src="${escapeHtml(image)}" alt="${escapeHtml(item.sampleVehicle?.name || 'Avtomobil şəkli')}" loading="lazy">` : ''}
    <div class="history-detail-content">
      <b>${escapeHtml(input.makeName || '')} ${escapeHtml(input.modelName || '')}</b>
      <span class="muted">${escapeHtml(String(input.issueDate || '').slice(0, 4))} · ${escapeHtml(item.engineName || 'Mühərrik növü')} · ${fmt(input.engine, 1)} L · ${escapeHtml(historyMileage(item))}</span>
      <table class="history-detail-table"><tbody>${rows.map(([name, value], i) => `<tr class="${i === rows.length - 1 ? 'history-total' : ''}"><td>${escapeHtml(name)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>
      ${duties ? `<details class="history-duties"><summary>DGK ödənişlərinin tərkibi</summary><table class="history-detail-table"><tbody>${duties}</tbody></table></details>` : ''}
    </div>
  </div>`;
}

function normalizeHistorySearch(value) {
  return String(value ?? '').toLocaleLowerCase('az-AZ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[ə]/g, 'e').replace(/[ı]/g, 'i').replace(/[ş]/g, 's').replace(/[ç]/g, 'c')
    .replace(/[ğ]/g, 'g').replace(/[ö]/g, 'o').replace(/[ü]/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function historySearchValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(historySearchValues);
  if (typeof value === 'object') return Object.values(value).flatMap(historySearchValues);
  return [String(value)];
}

function renderHistory() {
  const query = normalizeHistorySearch(historyQuery).trim();
  const terms = query ? query.split(/\s+/).filter(Boolean) : [];
  const matches = historyCache.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (!terms.length) return true;
    const input = item.input || {}, total = item.total || {};
    const searchable = normalizeHistorySearch([
      ...historySearchValues(input), ...historySearchValues(total), ...historySearchValues(item.customs),
      item.engineName, historyMileage(item), item.shipFrom, item.shipPort, item.sampleVehicle?.name, item.at,
      usd(total.final), azn(total.finalAzn, 0), usd(input.carPrice), usd(input.auctionFee),
    ].join(' '));
    return terms.every(term => searchable.includes(term));
  });
  const body = matches.length ? matches.map(({ item: h, index: i }) => {
    const input = h.input || {}, total = h.total || {};
    const year = String(input.issueDate || '').slice(0, 4);
    const title = `${year} ${input.makeName || ''} ${input.modelName || ''}`.trim() || 'Avtomobil';
    const image = historyImage(h);
    const finalAzn = Number(total.finalAzn ?? (Number(total.final || 0) * Number(total.rate || 1.7)));
    const imageCell = image
      ? `<img class="history-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy">`
      : '<div class="history-thumb-placeholder">Şəkil yoxdur</div>';
    const date = h.at && Number.isFinite(new Date(h.at).getTime()) ? new Date(h.at).toLocaleString('az-AZ') : '—';
    return `<tr class="history-row" data-history-open="${i}" tabindex="0" role="button" aria-expanded="false">
      <td>${imageCell}</td><td><b>${escapeHtml(title)}</b><br><span class="muted">${escapeHtml(h.engineName || 'Benzin')} · ${fmt(input.engine, 1)} L</span></td>
      <td>${escapeHtml(historyMileage(h))}</td><td class="history-final">${azn(finalAzn, 0)}</td>
      <td>${escapeHtml(date)}</td><td><button class="btn danger small" data-history-delete="${i}" title="Bu qeydi sil">Sil</button></td>
    </tr><tr class="history-details-row" data-history-details="${i}" hidden><td colspan="6">${historyDetails(h)}</td></tr>`;
  }).join('') : historyCache.length
    ? '<tr><td colspan="6" class="muted">Axtarışa uyğun tarixçə tapılmadı.</td></tr>'
    : '<tr><td colspan="6" class="muted">Hələ saxlanmış hesablama yoxdur. Hesablamadan sonra “Tarixçəyə yaz” düyməsini basın.</td></tr>';
  $('#history').innerHTML = `<thead><tr><th>Şəkil</th><th>Avtomobil / il / motor</th><th>Yürüş</th><th>Yekun (manat)</th><th>Tarix</th><th></th></tr></thead><tbody>${body}</tbody>`;
}

async function loadHistory() {
  try {
    historyCache = await call(api.history.list());
    if (!Array.isArray(historyCache)) historyCache = [];
    renderHistory();
  } catch (err) {
    $('#history').innerHTML = `<tbody><tr><td class="muted">Tarixçə yüklənmədi: ${escapeHtml(err.message)}</td></tr></tbody>`;
    toast('Tarixçə yüklənmədi: ' + err.message, true);
  }
}

$('#historySearch').addEventListener('input', event => {
  historyQuery = event.target.value;
  renderHistory();
});

$('#history').addEventListener('click', async ev => {
  const deleteButton = ev.target.closest('[data-history-delete]');
  if (deleteButton) {
    const index = Number(deleteButton.dataset.historyDelete);
    const list = await call(api.history.list()).catch(() => []);
    const item = list[index];
    if (!item) return toast('Tarixçə qeydi tapılmadı. Siyahını yeniləyin.', true);
    const label = `${item.input?.makeName || ''} ${item.input?.modelName || ''}`.trim() || 'bu hesab';
    if (!confirm(`${label} tarixçədən silinsin?`)) return;
    try {
      const removed = await call(api.history.delete({ id: item.id, at: item.at, index }));
      if (!removed) return toast('Qeyd tapılmadı və silinmədi.', true);
      await loadHistory();
      toast('Tarixçə qeydi silindi.');
    } catch (err) { toast('Qeyd silinmədi: ' + err.message, true); }
    return;
  }

  const row = ev.target.closest('[data-history-open]');
  if (!row) return;
  const details = $('#history').querySelector(`[data-history-details="${row.dataset.historyOpen}"]`);
  if (!details) return;
  details.hidden = !details.hidden;
  row.setAttribute('aria-expanded', String(!details.hidden));
});

$('#history').addEventListener('keydown', ev => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-history-open]')) {
    ev.preventDefault(); ev.target.click();
  }
});

$('#btnClearHistory').onclick = async () => {
  if (!confirm('Bütün tarixçə silinsin?')) return;
  try { await call(api.history.clear()); await loadHistory(); toast('Tarixçə təmizləndi.'); }
  catch (err) { toast('Tarixçə silinmədi: ' + err.message, true); }
};

// ---------- ayarlar ----------
function extraRow(x = { name: '', amount: 0, cur: 'AZN' }) {
  const cur = x.cur || 'USD';
  return `<div class="x"><input value="${(x.name || '').replace(/"/g, '&quot;')}" placeholder="Xərcin adı"><input type="number" step="1" value="${x.amount}">`
    + `<select class="cur"><option ${cur === 'AZN' ? 'selected' : ''}>AZN</option><option ${cur === 'USD' ? 'selected' : ''}>USD</option></select>`
    + `<button class="btn ghost small" data-del>✕</button></div>`;
}
function fillSettingsForm() {
  $('#sRate').value = settings.usdRate; $('#sAuctionFee').value = settings.auctionPercent;
  $('#sOffice').value = 250;
  $('#sGeorgia').value = settings.georgiaToBaku;
}
document.addEventListener('click', e => {
  if (e.target.matches('[data-del]')) e.target.parentElement.remove();
  if (e.target.dataset.add) $('#' + e.target.dataset.add + 'Extras').insertAdjacentHTML('beforeend', extraRow());
});
const readExtras = id => $$(`#${id} .x`).map(r => {
  const [n, a] = r.querySelectorAll('input');
  return { name: n.value.trim(), amount: +a.value || 0, cur: r.querySelector('.cur').value };
}).filter(x => x.name || x.amount);
$('#btnSaveSettings').onclick = async () => {
  const rate = $('#sRate').value === '' ? 1.7 : Number($('#sRate').value);
  const auctionPercent = $('#sAuctionFee').value === '' ? 18 : Number($('#sAuctionFee').value);
  const georgiaToBaku = Number($('#sGeorgia').value || 500);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(auctionPercent) || auctionPercent < 0 || auctionPercent > 100 || !Number.isFinite(georgiaToBaku) || georgiaToBaku < 0) {
    return toast('Ayarları yoxlayın: məzənnə müsbət, hərrac faizi 0–100, daşınma isə 0 və ya daha çox olmalıdır.', true);
  }
  settings = await call(api.settings.save({
    usdRate: rate, auctionPercent,
    customsTransport: 0, customsOther: 20,
    officeFee: 250,
    georgiaToBaku,
    fees: settings.fees,
  }));
  $('#shipGeo').value = settings.georgiaToBaku;
  feeManual = false; updateInvoice(); // yeni faiz dərhal tətbiq olunsun
  $('#savedMsg').textContent = 'Saxlanıldı ✓'; setTimeout(() => $('#savedMsg').textContent = '', 2500);
};

// ---------- bid.cars girişi (Ayarlar içində) ----------
const bidView = $('#bidView');
const LOGIN_URL = 'https://bid.cars/en/login';
const ARCHIVE_URL = 'https://bid.cars/en/search/archived';
let bidLogged = null;
let bidRegionBlocked = false;
if (window.PROIMPORT_WEB) {
  if (bidView) bidView.hidden = true;
  $('#bidWebHint').hidden = false;
  const settingsTab = document.querySelector('.tab[data-tab="settings"]');
  async function openBidLogin() {
    settingsTab?.click();
    const r = await api.bid.show('https://bid.cars/en/login');
    if (!r.ok) $('#bidState').textContent = r.error;
    else $('#bidState').textContent = 'BidCars giriş səhifəsi açıldı. Daxil olduqdan sonra sessiya brauzerinizdə qalır; server kukini yalnız sorğu zamanı istifadə edir.';
  }
  async function bidStatus() {
    $('#bidState').textContent = 'BidCars sessiyası yoxlanılır…';
    const r = await api.bid.status();
    bidLogged = r.ok ? !!r.data.logged : null;
    $('#bidState').textContent = !r.ok ? r.error
      : bidLogged ? '✓ BidCars hesabı bu brauzerdə aktivdir.'
      : 'BidCars-a daxil olunmayıb. “Giriş səhifəsi” düyməsi ilə daxil olun.';
    return bidLogged;
  }
  $('#btnBidLogin2').onclick = openBidLogin;
  $('#btnBidLoginPage').onclick = openBidLogin;
  $('#btnBidReload').onclick = openBidLogin;
  $('#btnBidCheck').onclick = bidStatus;
  settingsTab?.addEventListener('click', bidStatus);
  // Veb versiyası açılan kimi hesab girişi olan Ayarlar bölməsini göstər.
  settingsTab?.click();
} else {
function openBidLogin() {
  $$('.tab')[2].click();
  const current = bidView.getURL?.() || '';
  if (bidLogged) {
    bidRegionBlocked = false;
    if (!current.includes('/search/archived')) bidView.src = ARCHIVE_URL;
  } else if (!current.includes('/login')) bidView.src = LOGIN_URL;
  setTimeout(() => $('#bidCard').scrollIntoView({ behavior: 'smooth' }), 50);
}
async function bidStatus() {
  $('#bidState').textContent = 'Yoxlanılır…';
  const r = await api.bid.status();
  bidLogged = r.ok ? r.data.logged : null;
  $('#bidState').innerHTML = !r.ok ? `Yoxlanmadı: ${r.error}`
    : bidRegionBlocked ? 'Hesab girişi aktivdir, amma BidCars bu səhifəni yalnız Aİ daxilində açır. Bu, şifrə xətası deyil; arxiv qiymətləri sayt girişi mümkün olduqda axtarılacaq.'
    : bidLogged ? '✓ bid.cars hesabına daxil olunub.'
    : 'bid.cars hesabına daxil olunmayıb — aşağıda daxil olun, yoxsa arxiv qiymətlərinin çoxu gizli qalır.';
  return bidLogged;
}
$('#btnBidLogin2').onclick = openBidLogin;
$('#btnBidLoginPage').onclick = () => { bidView.src = LOGIN_URL; };
$('#btnBidReload').onclick = () => bidView.reload();
$('#btnBidCheck').onclick = bidStatus;
$$('.tab')[2].addEventListener('click', async () => {
  const logged = await bidStatus();
  if (bidView.getAttribute('src') === 'about:blank') bidView.src = logged ? ARCHIVE_URL : LOGIN_URL;
});
// Girişdən sonra ana səhifə Aİ xaricində bloklana bilər; birbaşa arxivə keç.
bidView.addEventListener('did-navigate', () => setTimeout(async () => {
  await bidStatus();
  const current = bidView.getURL?.() || '';
  if (bidLogged && /^https:\/\/bid\.cars\/en\/?(?:[?#]|$)/.test(current)) {
    bidRegionBlocked = false;
    bidView.src = ARCHIVE_URL;
  }
}, 800));
bidView.addEventListener('did-stop-loading', async () => {
  try {
    const current = bidView.getURL?.() || '';
    if (current.includes('/search/archived')) { bidRegionBlocked = false; return; }
    const denied = await bidView.executeJavaScript(`/exclusively accessible to customers within the European Union|only accessible to customers within the European Union/i.test(document.body?.innerText || '')`);
    if (denied) { bidRegionBlocked = true; await bidStatus(); }
  } catch { /* Səhifə hələ yüklənməyibsə, növbəti navigation-da yoxlanacaq. */ }
});
}

init();

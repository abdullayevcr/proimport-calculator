const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const customs = require('./customs');
const bidcars = require('./bidcars');
const { Azad } = require('./azad');
const { total, migrate } = require('./calc');

app.setName('Proİmport');
// Dəyişən məhsul adı mövcud ayarları, tarixçəni və giriş sessiyasını itirməsin.
app.setPath('userData', path.join(app.getPath('appData'), 'Proimport Calculator'));
// Yoxlama rejimi real istifadəçi məlumatlarına toxunmasın
if (process.env.PROIMPORT_SELFTEST) app.setPath('userData', path.join(process.env.PROIMPORT_SELFTEST, 'userdata'));
let mainWin, azad, settingsFile, historyFile;

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function loadSettings() { return migrate(readJson(settingsFile, {})); }

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1320, height: 900, minWidth: 980, minHeight: 680,
    title: 'Proİmport', backgroundColor: '#0f1419', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true },
  });
  // Ayarlardakı bid.cars giriş ekranı (<webview>): yalnız bid.cars, axtarış pəncərəsi ilə eyni sessiya
  mainWin.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false; prefs.contextIsolation = true;
    const okSrc = params.src === 'about:blank' || /^https:\/\/([a-z0-9-]+\.)?bid\.cars\//.test(params.src);
    if (!okSrc || params.partition !== bidcars.PARTITION) e.preventDefault();
  });
  mainWin.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWin.on('closed', () => app.quit());

  // Yoxlama rejimi: PROIMPORT_SELFTEST=<qovluq> — videodakı nümunəni doldurub ekran görüntüsü saxlayır
  const outDir = process.env.PROIMPORT_SELFTEST;
  if (outDir) mainWin.webContents.on('console-message', (_e, level, msg, line, src) =>
    fs.appendFileSync(path.join(outDir, 'console.txt'), `[${level}] ${msg} (${src}:${line})\n`));
  if (outDir) mainWin.webContents.once('did-finish-load', async () => {
    const shot = async name => {
      mainWin.show(); mainWin.focus(); mainWin.webContents.invalidate();
      await new Promise(r => setTimeout(r, 700));
      fs.writeFileSync(path.join(outDir, name), (await mainWin.webContents.capturePage()).toPNG());
    };
    const js = s => mainWin.webContents.executeJavaScript(s, true);
    const { session } = require('electron');
    const ck = await session.fromPartition(bidcars.PARTITION).cookies.get({});
    fs.writeFileSync(path.join(outDir, 'cookies-at-start.txt'), ck.map(c => `${c.domain} ${c.name} ${c.expirationDate ? new Date(c.expirationDate * 1000).toISOString().slice(0, 10) : 'SESSION'}`).join('\n'));
    await new Promise(r => setTimeout(r, 2500));
    await js(`(() => { const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));};
      set('query','equinox premier'); set('engine',1994); set('issueDate','2019-01-04'); set('odoFrom',130000); set('odoTo',150000);
      set('shipAuction','Copart'); set('shipState','NC'); set('shipLocation','NC - MOCKSVILLE'); })()`);
    // qiymət yazılmır — proqram onu bid.cars arxivindən avtomatik götürməlidir
    await new Promise(r => setTimeout(r, 25000));
    const txt = s => js(s).then(String);
    const market = await txt(`document.getElementById('marketLine').textContent + ' || qiymət=' + document.getElementById('carPrice').value + ' haqq=' + document.getElementById('auctionFee').value`);
    await js(`document.getElementById('btnCalc').click()`);
    await new Promise(r => setTimeout(r, 6000));
    await shot('calc.png');
    const calc = await txt(`document.getElementById('finalAzn').textContent + ' | ' + document.getElementById('shipSrc').textContent + ' | ' + document.getElementById('toast').textContent`);
    fs.writeFileSync(path.join(outDir, 'calc.txt'), market + '\n' + calc);
    await js(`document.getElementById('marketCard').scrollIntoView()`);
    await shot('market.png');
    app.quit();
  });
}

// Hər çağırışı {ok, data} / {ok:false, error} formasına salır
const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; }
  catch (e) { return { ok: false, error: e.message || String(e), needBrowser: !!e.needBrowser }; }
});

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  settingsFile = path.join(dir, 'settings.json');
  historyFile = path.join(dir, 'history.json');
  azad = new Azad(dir);
  // bid.cars girişi proqram bağlananda itməsin
  const flushBid = bidcars.keepLogin();
  app.on('before-quit', () => {
    flushBid();
    bidcars.shutdown();
  });

  handle('settings:get', () => loadSettings());
  handle('settings:save', s => { const merged = { ...loadSettings(), ...s }; fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2)); return merged; });

  handle('customs:dict', () => customs.dictionaries());
  handle('customs:calc', p => customs.calculate(p));

  handle('bid:archived', f => bidcars.archived(f, Number(f.maxPages) || 4));
  handle('bid:catalog', make => bidcars.catalog(make));
  handle('bid:stats', values => bidcars.stats(values));
  handle('bid:status', () => bidcars.loginStatus());
  handle('bid:show', url => { bidcars.show(url || 'https://bid.cars/en/login'); return true; });

  handle('azad:status', () => azad.status());
  handle('azad:prices', () => azad.cachedPrices());

  handle('calc:total', i => total(i));

  handle('history:list', () => readJson(historyFile, []));
  handle('history:add', item => {
    const list = readJson(historyFile, []);
    list.unshift({ ...item, id: item.id || require('crypto').randomUUID(), at: new Date().toISOString() });
    fs.writeFileSync(historyFile, JSON.stringify(list.slice(0, 300), null, 2));
    return list.length;
  });
  handle('history:delete', key => {
    const list = readJson(historyFile, []);
    let index = key?.id ? list.findIndex(item => item.id === key.id) : -1;
    if (index < 0 && Number.isInteger(key?.index) && list[key.index]?.at === key.at) index = key.index;
    if (index < 0 && key?.at) index = list.findIndex(item => item.at === key.at);
    if (index < 0) return false;
    list.splice(index, 1);
    fs.writeFileSync(historyFile, JSON.stringify(list, null, 2));
    return true;
  });
  handle('history:clear', () => { fs.writeFileSync(historyFile, '[]'); return true; });

  handle('open:url', url => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });

  createWindow();
});

app.on('window-all-closed', () => app.quit());

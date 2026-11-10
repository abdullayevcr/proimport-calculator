const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  settings: { get: call('settings:get'), save: call('settings:save') },
  customs: { dict: call('customs:dict'), calc: call('customs:calc') },
  bid: { archived: call('bid:archived'), catalog: call('bid:catalog'), stats: call('bid:stats'), show: call('bid:show'), status: call('bid:status') },
  azad: { status: call('azad:status'), prices: call('azad:prices') },
  calc: { total: call('calc:total') },
  history: { list: call('history:list'), add: call('history:add'), delete: call('history:delete'), clear: call('history:clear') },
  open: call('open:url'),
});

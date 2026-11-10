// Azad Logistics tarif cədvəli proqramla birlikdə gəlir və internet/giriş olmadan işləyir.
const fs = require('fs');
const path = require('path');

class Azad {
  constructor(dir) {
    this.pricesFile = path.join(dir, 'azad-prices.json');
    this.bundledPricesFile = path.join(__dirname, 'data', 'azad-prices.json');
    // Hər buraxılışla gələn cədvəl istifadəçi qovluğundakı əvvəlki nüsxəni yeniləyir.
    try { fs.copyFileSync(this.bundledPricesFile, this.pricesFile); } catch {}
    // Köhnə versiyanın saxladığı giriş məlumatını birdəfəlik təmizlə.
    for (const file of ['azad-session.bin']) try { fs.unlinkSync(path.join(dir, file)); } catch {}
  }

  cachedPrices() {
    for (const file of [this.pricesFile, this.bundledPricesFile]) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        if (Array.isArray(data.rows)) return data;
      } catch {}
    }
    return { updated: null, rows: [] };
  }

  status() {
    const data = this.cachedPrices();
    return { source: 'offline', pricesUpdated: data.updated, priceCount: data.rows.length };
  }
}

module.exports = { Azad };

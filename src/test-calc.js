// Videodakı nümunə: 2019 Chevrolet Equinox Premier, 1994 sm3, benzin, Mocksville NC → GA
// Tarixi nümunə: 17% hərrac faizi, Gürcüstan → Bakı 450 USD, Bakı xərcləri 1040 AZN,
// ofis haqqı yox. Hazırkı qaydada əlavə 340 AZN xidmət haqqı yoxdur.
const assert = require('assert');
const { total, migrate, DEFAULT_SETTINGS: s } = require('./calc');
const { aboveMeanPriceGroup } = require('./ui/market-pricing');

const base = { carPrice: 4000, shipping: 1210, customsAzn: 8859.77, usdRate: s.usdRate, fees: s.fees };

const video = total({ ...base, auctionFee: 4000 * 0.17, georgiaToBaku: 450, officeFee: 0 });
assert.strictEqual(video.invoice, 4680);
assert.strictEqual(video.customs, 5211.63);
assert.strictEqual(Math.round(video.finalAzn), 20678); // 540 + 500 = 1040 AZN
console.log('videodakı hesab OK →', video.final, 'USD =', video.finalAzn, 'AZN');
console.log('  Bakı xərcləri:', video.feeList.map(f => `${f.name} ${f.amount} ${f.cur} = $${f.usd}`).join('; '));

// İndiki standartlar: 18% hərrac faizi, 500 USD Gürcüstan → Bakı, 250 USD ofis haqqı
const now = total({ ...base, auctionFee: 4000 * s.auctionPercent / 100, georgiaToBaku: s.georgiaToBaku, officeFee: s.officeFee });
assert.strictEqual(now.invoice, 4720);
assert.strictEqual(Math.round(now.final), 12503); // cari standart xərclər
console.log('standartlarla →', now.final, 'USD');

// köhnə ayarlar
const m = migrate({ usdRate: 1.7, fees: [{ name: 'Texpasport və nömrə', amount: 611.76 }, { name: 'Gömrük xidməti və zəhmət haqqı', amount: 200 }], auctionFeePercent: 17, margin: 5 });
assert.deepStrictEqual(m.fees.map(f => [f.name, f.amount, f.cur]), [['Torpaqbasdı', 540, 'AZN'], ['Nömrə', 500, 'AZN']]);
assert.strictEqual(m.auctionPercent, 18); assert.strictEqual(m.officeFee, 250); assert.ok(!('margin' in m));
console.log('köhnə ayarlar keçir OK');

assert.throws(() => total({ ...base, shipping: -1 }), /Daşınma/);
assert.throws(() => total({ ...base, auctionFee: -1 }), /Hərrac haqqı/);
assert.throws(() => total({ ...base, carPrice: 0 }), /Avtomobil qiyməti/);
console.log('mənfi və sıfır məbləğ yoxlamaları OK');

const premiumCars = aboveMeanPriceGroup([3000, 3500, 3800, 4000, 4500, 5000, 6000]);
assert.strictEqual(premiumCars.count, 3);
assert.strictEqual(premiumCars.min, 4500);
assert.strictEqual(premiumCars.max, 6000);
assert.strictEqual(Math.round(premiumCars.average), 5167);
const lowOutliers = aboveMeanPriceGroup([2000, 2100, 2300, 8000, 8500, 9000, 9500, 10000, 10500, 11000]);
assert.strictEqual(lowOutliers.belowAverageCount, 3);
assert.strictEqual(Math.round(lowOutliers.average), 9500);
console.log('ortalamadan baha lotların qiymət qrupu OK');

if (process.argv.includes('--live')) {
  require('./customs').calculate({ autoType: '0', engineType: '0', engine: 1994, issueDate: '2019-01-04',
    price: 4680, transportExpenses: 2000, otherExpenses: 20 }).then(c => {
    assert.strictEqual(c.total, 8859.77);
    console.log('customs API OK →', c.total, 'AZN');
  }).catch(e => { console.error(e); process.exit(1); });
}

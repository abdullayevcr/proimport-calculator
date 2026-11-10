// Videodakı hesablamanın ardıcıllığı — HAMISI DOLLARLA (USD):
//   1) İnvoys            = uduş pulu (keçmiş satışların ortası) + hərrac faizi (18%)
//                          (videoda 17% götürülmüşdü: 4000 + 680 = 4680)
//   2) Daşınma           = Azad Logistics (ştat → Gürcüstan) + Gürcüstan → Bakı (1210 + 500)
//   3) Gömrük            = DGK kalkulyatoru (AZN) ÷ DGK məzənnəsi          (8859.77 / 1.7 = 5211.63)
//   4) Bakı xərcləri     = nömrə 540 AZN + torpaqbasdı 500 AZN + gömrük xidməti/zəhmət 340 AZN, ÷ məzənnə
//                          (videoda nömrə+torpaqbasdı birlikdə 1040 AZN idi)
//   5) Yekun (USD)       = 1 + 2 + 3 + 4 + ofis haqqı (250, ən sonda). AZN yalnız məlumat üçün göstərilir.

const DEFAULT_SETTINGS = {
  usdRate: 1.7,               // DGK API öz məzənnəsini qaytaranda o istifadə olunur
  auctionPercent: 18,         // % — bid.cars hərrac faizi (invoys = uduş pulu + bu faiz)
  customsTransport: 0,        // USD — seçilmiş Azad + Gürcüstan daşınması
  customsOther: 20,           // USD — DGK üçün şirkətin qarşıladığı sabit xərc
  georgiaToBaku: 500,         // USD — Gürcüstandan Bakıya daşınma (standart)
  fees: [                     // Bakıda olan xərclər
    { name: 'Torpaqbasdı', amount: 540, cur: 'AZN' },
    { name: 'Nömrə', amount: 500, cur: 'AZN' },
  ],
  officeFee: 250,             // USD — ofis haqqı, ən sonda əlavə olunur
};

// Köhnə ayarlar (AZN xərcləri) → USD
function migrate(s) {
  const out = { ...DEFAULT_SETTINGS, ...s, fees: DEFAULT_SETTINGS.fees.map(x => ({...x})) };
  if (!s.fees && (s.aznExtras || s.usdExtras)) {
    out.fees = [
      ...(s.aznExtras || []).map(x => ({ name: x.name, amount: x.amount, cur: 'AZN' })),
      ...(s.usdExtras || []).map(x => ({ ...x, cur: 'USD' })),
    ];
  }
  // "Texpasport və nömrə" (1040 AZN) əvəzinə: Nömrə 540 AZN + Torpaqbasdı pulu 500 AZN
  // İstifadəçinin köhnə əlavə xərcləri standart yekun məbləğə təsir etməsin.
  out.fees = DEFAULT_SETTINGS.fees.map(x => ({...x}));
  out.customsOther = 20;
  // keçən versiyada AZN xərcləri dollara çevrilib saxlanmışdı (200 = 340 AZN)
  out.fees = out.fees.map(f => f.cur === 'USD' && /zəhmət/i.test(f.name) && f.amount === 200 ? { ...f, amount: 340, cur: 'AZN' } : f);
  delete out.aznExtras; delete out.usdExtras;
  delete out.auctionFeePercent; delete out.margin; // köhnə açarlar (17% / qazanc) — 18% hərrac faizi və ofis haqqı ilə əvəz olunub
  return out;
}

const feeUsd = (x, rate) => (Number(x.amount) || 0) / (x.cur === 'AZN' ? rate : 1);
const r2 = x => Math.round(x * 100) / 100;

/**
 * @param {object} i  hamısı USD, customsAzn istisna
 * @param {number} i.carPrice, i.auctionFee, i.shipping, i.georgiaToBaku, i.officeFee
 * @param {number} i.customsAzn  DGK cəmi gömrük ödənişləri, AZN
 * @param {number} i.usdRate
 * @param {Array}  i.fees
 */
function total(i) {
  const amount = (name, value, { positive = false } = {}) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || (positive && n === 0)) throw new Error(`${name}: məbləğ ${positive ? 'müsbət' : '0 və ya daha çox'} olmalıdır.`);
    return n;
  };
  const rate = amount('USD məzənnəsi', i.usdRate ?? DEFAULT_SETTINGS.usdRate, { positive: true });
  const carPrice = amount('Avtomobil qiyməti', i.carPrice, { positive: true });
  const auctionFee = amount('Hərrac haqqı', i.auctionFee ?? 0);
  const invoice = carPrice + auctionFee;
  const shipping = amount('Daşınma', i.shipping ?? 0);
  const georgia = amount('Gürcüstan–Bakı daşınması', i.georgiaToBaku ?? 0);
  const customsAzn = amount('Gömrük ödənişi', i.customsAzn ?? 0);
  const customs = customsAzn / rate;
  const feeList = (i.fees || []).map(x => ({ name: x.name, amount: amount(x.name || 'Əlavə xərc', x.amount ?? 0), cur: x.cur || 'USD', usd: r2(feeUsd({ ...x, amount: Number(x.amount ?? 0) }, rate)) }));
  const fees = feeList.reduce((s, x) => s + feeUsd(x, rate), 0);
  const office = amount('Ofis haqqı', i.officeFee ?? 0);
  const final = invoice + shipping + georgia + customs + fees + office;
  return {
    rate, invoice: r2(invoice), shipping: r2(shipping), georgia: r2(georgia),
    customs: r2(customs), customsAzn: r2(customsAzn), fees: r2(fees), feeList, office: r2(office),
    final: r2(final), finalAzn: r2(final * rate),
  };
}

module.exports = { total, migrate, DEFAULT_SETTINGS };

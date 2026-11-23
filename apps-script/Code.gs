/**
 * FD-keruu – Apps Script -backend (sidottu Google Sheets -tiedostoon)
 * =====================================================================
 * Tallentaa index.html:n lähettämät anonyymit rivit Data-välilehdelle ja
 * laskee tilastot sekä index.html:n Tilastot-välilehdelle (doGet) että
 * Sheetsin Tilastot- ja Ikähaku-välilehdille (kaavat, rakennaTilastot_).
 *
 * TIETOSUOJA: rivillä on vain päivämäärä (ei kellonaikaa), ikä ja löydökset.
 * Ei nimiä, henkilötunnuksia eikä vapaata tekstiä. action=stats palauttaa
 * vain aggregaatteja, ei koskaan yksittäisiä rivejä.
 *
 * TILASTOJEN MÄÄRITELMÄT (yksi totuus – sama Sheetsissä ja lomakkeella)
 * ---------------------------------------------------------------------
 * Sarakkeet: C vert_fd_nyt, D horis_fd_nyt, E vert_fd_aiemmin,
 *            F horis_fd_aiemmin, I horis_suunta.
 * N = kaikki rivit, joilla on ikä (kaikki tutkitut asiakkaat).
 *
 *   Vertikaalinen FD             C = kyllä                    / N
 *   Vertikaalinen, uusi          C = kyllä ja E = ei          / N ja / vertikaaliset
 *   Vertikaalinen, aiemmin       C = kyllä ja E = kyllä       / N ja / vertikaaliset
 *   Horisontaalinen FD           D = kyllä                    / N
 *   Exo                          D = kyllä ja I = exo         / N ja / horisontaaliset
 *   Exo, uusi                    ... ja F = ei                / N ja / exo-löydökset
 *   Exo, aiemmin todettu         ... ja F = kyllä             / N ja / exo-löydökset
 *   Eso                          D = kyllä ja I = eso         / N ja / horisontaaliset
 *   Eso, uusi                    ... ja F = ei                / N ja / eso-löydökset
 *   Eso, aiemmin todettu         ... ja F = kyllä             / N ja / eso-löydökset
 *   Jokin FD (V tai H)           C = kyllä tai D = kyllä      / N
 *   Molemmat (V ja H)            C = kyllä ja D = kyllä       / N
 *
 * Ikäryhmät: <20, 20–39, 40–59, 60+ (rajat mukaan lukevia kokonaislukuja).
 * Suuruudet (Δ): n, keskiarvo ja mediaani vertikaaliselle, exolle ja esolle.
 * Ikähaku: ika_min ≤ ikä ≤ ika_max, tyhjä raja = ei rajaa.
 * Prosentit pyöristetään yhteen desimaaliin, suuruudet kahteen.
 * Nimittäjä 0 → null (näytetään "–").
 */

const DATA = 'Data';
const TILASTOT = 'Tilastot';
const IKAHAKU = 'Ikähaku';

const OTSIKOT = ['aikaleima', 'ika', 'vert_fd_nyt', 'horis_fd_nyt', 'vert_fd_aiemmin',
  'horis_fd_aiemmin', 'vert_suuruus_pd', 'horis_suuruus_pd', 'horis_suunta', 'id', 'versio'];

const IKARYHMAT = [
  { ryhma: '<20', ala: 0, yla: 19 },
  { ryhma: '20–39', ala: 20, yla: 39 },
  { ryhma: '40–59', ala: 40, yla: 59 },
  { ryhma: '60+', ala: 60, yla: null }
];

// Värisokeille sopiva paletti (Okabe–Ito). Sama kuin index.html:ssä.
const VARIT = {
  vert: '#0072B2', vert_vaalea: '#9CC9E8',
  exo: '#D55E00', exo_vaalea: '#F1B58C',
  eso: '#009E73', eso_vaalea: '#8ED5BF'
};

const YLARAJA_KAAVOISSA = 100000; // "ei ylärajaa" Sheetsin kaavoissa
const CACHE_S = 30;

// ---------------------------------------------------------------------
// Valikko ja käyttöönotto
// ---------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('FD-keruu')
    .addItem('Alusta taulukko', 'setup')
    .addItem('Rakenna tilastot ja kaaviot uudelleen', 'rakennaTilastot')
    .addItem('Aseta token', 'asetaToken')
    .addSeparator()
    .addItem('Itsetesti (ei tallenna mitään)', 'itsetesti')
    .addToUi();
}

/** Luo Data-, Tilastot- ja Ikähaku-välilehdet. Idempotentti: voi ajaa uudelleen. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(DATA);
  if (!sh) sh = ss.insertSheet(DATA, 0);

  sh.getRange(1, 1, 1, OTSIKOT.length).setValues([OTSIKOT])
    .setFontWeight('bold').setBackground('#e8eef5');
  sh.setFrozenRows(1);
  sh.getRange('A2:A').setNumberFormat('yyyy-mm-dd');
  sh.getRange('B2:B').setNumberFormat('0');
  sh.getRange('G2:H').setNumberFormat('0.0##');
  sh.getRange('J2:K').setNumberFormat('@');

  const lista = arvot => SpreadsheetApp.newDataValidation()
    .requireValueInList(arvot, true).setAllowInvalid(false).build();
  sh.getRange('C2:F').setDataValidation(lista(['kyllä', 'ei']));
  sh.getRange('I2:I').setDataValidation(lista(['exo', 'eso']));

  // Poistetaan tyhjä oletusvälilehti, jos sellainen on.
  ss.getSheets().forEach(s => {
    if (/^(Sheet1|Taulukko1|Taulukko 1|Arkusz1)$/.test(s.getName()) &&
        s.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(s);
    }
  });

  rakennaTilastot_();

  if (!PropertiesService.getScriptProperties().getProperty('TOKEN')) {
    ss.toast('Aseta vielä token: FD-keruu → Aseta token.', 'FD-keruu', 10);
  } else {
    ss.toast('Taulukko alustettu.', 'FD-keruu', 5);
  }
}

/** Valikkokomento: kysyy tokenin ja tallentaa sen Script Propertiesiin. */
function asetaToken() {
  const ui = SpreadsheetApp.getUi();
  const vastaus = ui.prompt('Aseta token',
    'Liitä sama token, joka on index.html:n CONFIG.TOKEN-kohdassa:', ui.ButtonSet.OK_CANCEL);
  if (vastaus.getSelectedButton() !== ui.Button.OK) return;
  const t = vastaus.getResponseText().trim();
  if (t.length < 8) { ui.alert('Tokenin on oltava vähintään 8 merkkiä.'); return; }
  PropertiesService.getScriptProperties().setProperty('TOKEN', t);
  ui.alert('Token tallennettu.');
}

/** Valikkokomento (julkinen kääre). */
function rakennaTilastot() {
  rakennaTilastot_();
  SpreadsheetApp.getActive().toast('Tilastot ja kaaviot rakennettu uudelleen.', 'FD-keruu', 5);
}

// ---------------------------------------------------------------------
// Web App: POST (tallennus) ja GET (tilastot / terveystarkistus)
// ---------------------------------------------------------------------

function doPost(e) {
  try {
    let d;
    try {
      d = JSON.parse(e && e.postData ? e.postData.contents : '');
    } catch (err) {
      return json_({ ok: false, virhe: 'Virheellinen JSON' });
    }
    if (!tarkistaToken_(d && d.token)) return json_({ ok: false, virhe: 'Virheellinen token' });

    const v = validoi_(d);
    if (v.virheet.length) return json_({ ok: false, virhe: v.virheet.join('; ') });
    const r = v.rivi;

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let rivi, tupla = false;
    try {
      const sh = dataSheet_();
      const viimeinen = sh.getLastRow();
      if (viimeinen > 1) {
        const idt = sh.getRange(2, 10, viimeinen - 1, 1).getValues();
        for (let i = 0; i < idt.length; i++) {
          if (String(idt[i][0]) === r.id) { rivi = i + 2; tupla = true; break; }
        }
      }
      if (!tupla) {
        rivi = viimeinen + 1;
        const paiva = Utilities.formatDate(new Date(),
          SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
        const alue = sh.getRange(rivi, 1, 1, OTSIKOT.length);
        alue.setNumberFormats([['yyyy-mm-dd', '0', '@', '@', '@', '@', '0.0##', '0.0##', '@', '@', '@']]);
        alue.setValues([[paiva, r.ika, r.vert_fd_nyt, r.horis_fd_nyt, r.vert_fd_aiemmin,
          r.horis_fd_aiemmin, r.vert_suuruus_pd, r.horis_suuruus_pd, r.horis_suunta, r.id, r.versio]]);
        SpreadsheetApp.flush();
        PropertiesService.getScriptProperties().setProperty('STATS_GEN', String(Date.now()));
      }
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true, rivi: rivi, tupla: tupla });
  } catch (err) {
    return json_({ ok: false, virhe: String(err && err.message || err) });
  }
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'stats') {
      if (!tarkistaToken_(p.token)) return json_({ ok: false, virhe: 'Virheellinen token' });
      const min = ikaParam_(p.ika_min);
      const max = ikaParam_(p.ika_max);
      if (min === undefined || max === undefined) {
        return json_({ ok: false, virhe: 'Ikärajan on oltava kokonaisluku ≥ 0' });
      }
      if (min !== null && max !== null && min > max) {
        return json_({ ok: false, virhe: 'Ikä alkaen ei voi olla suurempi kuin ikä asti' });
      }
      const cache = CacheService.getScriptCache();
      const gen = PropertiesService.getScriptProperties().getProperty('STATS_GEN') || '0';
      const avain = 'stats_' + gen + '_' + (min === null ? '' : min) + '_' + (max === null ? '' : max);
      const valmis = cache.get(avain);
      if (valmis) return tekstiJson_(valmis);
      const tulos = JSON.stringify(laskeTilastot_(min, max));
      cache.put(avain, tulos, CACHE_S);
      return tekstiJson_(tulos);
    }
    const sh = SpreadsheetApp.getActive().getSheetByName(DATA);
    return json_({ ok: true, rivit: sh ? Math.max(0, sh.getLastRow() - 1) : 0 });
  } catch (err) {
    return json_({ ok: false, virhe: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------------
// Validointi
// ---------------------------------------------------------------------

/** Palauttaa { virheet: [...], rivi: {...} }. Säännöt: SUUNNITELMA.md kohta 2. */
function validoi_(d) {
  const virheet = [];
  if (!d || typeof d !== 'object') return { virheet: ['Tyhjä tai virheellinen data'], rivi: null };

  const ikaS = String(d.ika == null ? '' : d.ika).trim();
  if (!/^\d+$/.test(ikaS)) virheet.push('Ikä: anna kokonaisluku (0 tai suurempi)');

  const kylEi = (k, nimi) => {
    const s = norm_(d[k]);
    if (s !== 'kyllä' && s !== 'ei') virheet.push(nimi + ': valitse kyllä tai ei');
    return s;
  };
  const vertNyt = kylEi('vert_fd_nyt', 'Vertikaalinen FD nyt');
  const horisNyt = kylEi('horis_fd_nyt', 'Horisontaalinen FD nyt');
  const vertAiemmin = kylEi('vert_fd_aiemmin', 'Vertikaalinen FD aiemmin');
  const horisAiemmin = kylEi('horis_fd_aiemmin', 'Horisontaalinen FD aiemmin');

  const suuruus = (k, nimi) => {
    const n = parseSuuruus_(d[k]);
    if (n === null) virheet.push(nimi + ': anna positiivinen luku, esim. 1,5');
    return n === null ? '' : n;
  };

  let vertPd = '', horisPd = '', suunta = '';
  if (vertNyt === 'kyllä') vertPd = suuruus('vert_suuruus_pd', 'Vertikaalisen suuruus');
  if (horisNyt === 'kyllä') {
    horisPd = suuruus('horis_suuruus_pd', 'Horisontaalisen suuruus');
    suunta = norm_(d.horis_suunta);
    if (suunta !== 'exo' && suunta !== 'eso') virheet.push('Horisontaalinen suunta: valitse exo tai eso');
  }
  // Jos FD nyt = ei, suuruus ja suunta jätetään aina tyhjiksi.

  const id = String(d.id == null ? '' : d.id).trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) virheet.push('Virheellinen id');
  const versio = String(d.versio == null ? '' : d.versio).trim();
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(versio)) virheet.push('Virheellinen versio');

  return {
    virheet: virheet,
    rivi: {
      ika: Number(ikaS),
      vert_fd_nyt: vertNyt, horis_fd_nyt: horisNyt,
      vert_fd_aiemmin: vertAiemmin, horis_fd_aiemmin: horisAiemmin,
      vert_suuruus_pd: vertPd, horis_suuruus_pd: horisPd, horis_suunta: suunta,
      id: id, versio: versio
    }
  };
}

/** "1,5" / "1.5" / 1.5 → 1.5. Virheellinen tai ≤ 0 → null. */
function parseSuuruus_(x) {
  const s = String(x == null ? '' : x).trim();
  if (!/^\d+([.,]\d+)?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}

function norm_(x) {
  return String(x == null ? '' : x).trim().toLowerCase();
}

/** Tyhjä → null, kokonaisluku ≥ 0 → luku, muu → undefined (virhe). */
function ikaParam_(x) {
  if (x == null || String(x).trim() === '') return null;
  const s = String(x).trim();
  return /^\d+$/.test(s) ? Number(s) : undefined;
}

function tarkistaToken_(t) {
  const oikea = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!oikea) throw new Error('Tokenia ei ole asetettu (Sheets: FD-keruu → Aseta token).');
  return typeof t === 'string' && t === oikea;
}

// ---------------------------------------------------------------------
// Tilastot (ainoa paikka, jossa lomakkeen tilastot lasketaan)
// ---------------------------------------------------------------------

function laskeTilastot_(ikaMin, ikaMax) {
  const sh = SpreadsheetApp.getActive().getSheetByName(DATA);
  const viimeinen = sh ? sh.getLastRow() : 0;
  const arvot = viimeinen > 1 ? sh.getRange(2, 1, viimeinen - 1, OTSIKOT.length).getValues() : [];
  const rivit = [];
  arvot.forEach(r => {
    const ika = r[1];
    // Vastaa Sheetsin kaavojen ehtoa COUNTIFS(Data!B, ">=0"): vain numeeriset iät.
    if (typeof ika !== 'number' || !isFinite(ika) || ika < 0) return;
    if (ikaMin !== null && ikaMin !== undefined && ika < ikaMin) return;
    if (ikaMax !== null && ikaMax !== undefined && ika > ikaMax) return;
    rivit.push({
      ika: ika,
      c: norm_(r[2]), d: norm_(r[3]), e: norm_(r[4]), f: norm_(r[5]),
      g: r[6], h: r[7], i: norm_(r[8])
    });
  });
  return koostaTilastot_(rivit, ikaMin, ikaMax);
}

/** Puhdas laskenta normalisoiduista riveistä (testattavissa ilman Sheetsiä). */
function koostaTilastot_(rivit, ikaMin, ikaMax) {
  const N = rivit.length;
  const onVert = r => r.c === 'kyllä';
  const onHoris = r => r.d === 'kyllä';
  const onExo = r => r.d === 'kyllä' && r.i === 'exo';
  const onEso = r => r.d === 'kyllä' && r.i === 'eso';
  const vertUusi = r => r.e === 'ei', vertAiemmin = r => r.e === 'kyllä';
  const horisUusi = r => r.f === 'ei', horisAiemmin = r => r.f === 'kyllä';

  const out = {
    ok: true,
    paivitetty: new Date().toISOString(),
    rajaus: { ika_min: ikaMin == null ? null : ikaMin, ika_max: ikaMax == null ? null : ikaMax },
    n: N
  };
  out.vert = osa_(rivit, N, onVert, vertUusi, vertAiemmin);
  out.horis = osa_(rivit, N, onHoris, horisUusi, horisAiemmin);
  out.exo = osa_(rivit, N, onExo, horisUusi, horisAiemmin);
  out.eso = osa_(rivit, N, onEso, horisUusi, horisAiemmin);
  out.exo.osuus_horis_pct = pct_(out.exo.n, out.horis.n);
  out.eso.osuus_horis_pct = pct_(out.eso.n, out.horis.n);

  const jokin = rivit.filter(r => onVert(r) || onHoris(r)).length;
  const molemmat = rivit.filter(r => onVert(r) && onHoris(r)).length;
  out.jokin = { n: jokin, pct: pct_(jokin, N) };
  out.molemmat = { n: molemmat, pct: pct_(molemmat, N) };

  out.ikaryhmat = IKARYHMAT.map(g => {
    const rr = rivit.filter(r => r.ika >= g.ala && (g.yla === null || r.ika <= g.yla));
    const n = rr.length;
    const v = osa_(rr, n, onVert, vertUusi, vertAiemmin);
    const x = osa_(rr, n, onExo, horisUusi, horisAiemmin);
    const s = osa_(rr, n, onEso, horisUusi, horisAiemmin);
    const osuu = (ikaMin == null || g.yla === null || g.yla >= ikaMin) &&
                 (ikaMax == null || g.ala <= ikaMax);
    return {
      ryhma: g.ryhma, ala: g.ala, yla: g.yla, osuu: osuu, n: n,
      vert_n: v.n, vert_pct: v.pct, vert_uusi_n: v.uusi_n, vert_uusi_pct: v.uusi_pct_loydoksista,
      exo_n: x.n, exo_pct: x.pct, exo_uusi_n: x.uusi_n, exo_uusi_pct: x.uusi_pct_loydoksista,
      eso_n: s.n, eso_pct: s.pct, eso_uusi_n: s.uusi_n, eso_uusi_pct: s.uusi_pct_loydoksista
    };
  });

  out.suuruudet = {
    vert: tunnusluvut_(rivit.filter(onVert).map(r => r.g)),
    exo: tunnusluvut_(rivit.filter(onExo).map(r => r.h)),
    eso: tunnusluvut_(rivit.filter(onEso).map(r => r.h))
  };
  return out;
}

function osa_(rivit, N, onLoydos, onUusi, onAiemmin) {
  const l = rivit.filter(onLoydos);
  const u = l.filter(onUusi).length;
  const a = l.filter(onAiemmin).length;
  return {
    n: l.length, pct: pct_(l.length, N),
    uusi_n: u, uusi_pct_kaikista: pct_(u, N), uusi_pct_loydoksista: pct_(u, l.length),
    aiemmin_n: a, aiemmin_pct_kaikista: pct_(a, N), aiemmin_pct_loydoksista: pct_(a, l.length)
  };
}

function pct_(osa, kaikki) {
  return kaikki ? Math.round(osa / kaikki * 1000) / 10 : null;
}

function tunnusluvut_(arvot) {
  const a = arvot.filter(x => typeof x === 'number' && isFinite(x) && x > 0).sort((p, q) => p - q);
  const n = a.length;
  if (!n) return { n: 0, ka: null, md: null };
  const ka = a.reduce((s, x) => s + x, 0) / n;
  const md = n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  return { n: n, ka: Math.round(ka * 100) / 100, md: Math.round(md * 100) / 100 };
}

// ---------------------------------------------------------------------
// Sheets: Tilastot- ja Ikähaku-välilehdet (kaavat + kaaviot)
// ---------------------------------------------------------------------

const R_ = {
  B: 'Data!$B$2:$B', C: 'Data!$C$2:$C', D: 'Data!$D$2:$D', E: 'Data!$E$2:$E',
  F: 'Data!$F$2:$F', G: 'Data!$G$2:$G', H: 'Data!$H$2:$H', I: 'Data!$I$2:$I'
};

/** Ikäehto COUNTIFS-kaavaan: ala ≤ ikä ≤ yla (lausekkeina). */
function ikaEhto_(ala, yla) {
  return R_.B + ',">="&' + ala + ',' + R_.B + ',"<="&' + yla;
}

function countifs_(ehto, parit) {
  return 'COUNTIFS(' + ehto + parit.map(p => ',' + p[0] + ',"' + p[1] + '"').join('') + ')';
}

function rakennaTilastot_() {
  const ss = SpreadsheetApp.getActive();

  // --- Tilastot ---
  const t = valmisteleValilehti_(ss, TILASTOT, 1);
  tunnistaErotin_(t);
  t.getRange('A1').setValue('FD-keruu – tilastot').setFontSize(14).setFontWeight('bold');
  t.getRange('A2').setValue('Päivittyy automaattisesti kaavoilla. Älä kirjoita tälle välilehdelle.')
    .setFontColor('#666666');
  const a = kirjoitaLohkoA_(t, 4, '0', String(YLARAJA_KAAVOISSA));
  const b = kirjoitaLohkoB_(t, a.loppu + 2, a);
  const c = kirjoitaIkaryhmat_(t, b.loppu + 2);
  const dd = kirjoitaSuuruudet_(t, c.loppu + 2, '0', String(YLARAJA_KAAVOISSA));
  t.setColumnWidth(1, 230);
  for (let s = 2; s <= 10; s++) t.setColumnWidth(s, 105);

  lisaaKaavio1_(t, b.kaavio1, 4, 12);
  lisaaKaavio2_(t, b.kaavio2, 22, 12);
  lisaaKaavio3_(t, c, 40, 12);
  lisaaKaavio4_(t, b.kaavio4, 58, 12);

  // --- Ikähaku (säilytetään käyttäjän syöttämät rajat) ---
  const vanha = ss.getSheetByName(IKAHAKU);
  const vanhatRajat = vanha ? vanha.getRange('B2:B3').getValues() : [[''], ['']];
  const h = valmisteleValilehti_(ss, IKAHAKU, 2);
  h.getRange('A1').setValue('FD-keruu – ikähaku').setFontSize(14).setFontWeight('bold');
  h.getRange('A2:A3').setValues([['Ikä alkaen'], ['Ikä asti']]).setFontWeight('bold');
  const syotto = h.getRange('B2:B3');
  syotto.setValues(vanhatRajat).setBackground('#fff3c4').setNumberFormat('0');
  // Ei kaavapohjaista sääntöä: sen syntaksi riippuu taulukon aluekohtaisesta asetuksesta (fi: puolipisteet).
  syotto.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThanOrEqualTo(0)
    .setAllowInvalid(false).setHelpText('Kokonaisluku 0 tai suurempi. Tyhjä = ei rajaa.').build());
  h.getRange('C2').setValue('← tyhjä = ei rajaa').setFontColor('#666666');
  h.getRange('B4').setFormula(kaava_('=IF(OR(AND($B$2<>"",$B$2<>INT($B$2)),AND($B$3<>"",$B$3<>INT($B$3))),' +
    '"⚠ Anna iät kokonaislukuina",IF(AND($B$2<>"",$B$3<>"",$B$2>$B$3),"⚠ Ikä alkaen on suurempi kuin ikä asti",""))'))
    .setFontColor('#b00020').setFontWeight('bold');

  const ALA = 'IF($B$2="",0,$B$2)';
  const YLA = 'IF($B$3="",' + YLARAJA_KAAVOISSA + ',$B$3)';
  const ha = kirjoitaLohkoA_(h, 7, ALA, YLA);
  h.getRange('A5').setFormula(kaava_('="Rajaus: ikä "&IF(AND($B$2="",$B$3=""),"kaikki",' +
    'IF($B$2="","enintään "&$B$3&" v.",IF($B$3="","vähintään "&$B$2&" v.",$B$2&"–"&$B$3&" v.")))' +
    '&" (n = "&' + ha.nRef + '&")"')).setFontWeight('bold').setFontSize(12);
  const hb = kirjoitaLohkoB_(h, ha.loppu + 2, ha);
  kirjoitaSuuruudet_(h, hb.loppu + 2, ALA, YLA);
  h.setColumnWidth(1, 230);
  for (let s = 2; s <= 10; s++) h.setColumnWidth(s, 105);
  lisaaKaavio1_(h, hb.kaavio1, 4, 12);
}

function valmisteleValilehti_(ss, nimi, indeksi) {
  let sh = ss.getSheetByName(nimi);
  if (!sh) sh = ss.insertSheet(nimi, indeksi);
  sh.getCharts().forEach(ch => sh.removeChart(ch)); // uudelleenajo ei monista kaavioita
  sh.clear();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  return sh;
}

/** Lohko A – päätunnusluvut. Palauttaa solujen sijainnit muille lohkoille. */
function kirjoitaLohkoA_(sh, alku, ala, yla) {
  const ehto = ikaEhto_(ala, yla);
  const nRef = '$B$' + alku;
  kirjoita_(sh.getRange(alku, 1, 1, 2), [['N (asiakkaita)', '=' + countifs_(ehto, [])]]).setFontWeight('bold');

  const otsRivi = alku + 2;
  sh.getRange(otsRivi, 1, 1, 10).setValues([['Tunnusluku', 'n', '% kaikista', 'Uusia n',
    'Uusia % kaikista', 'Uusia % löydöksistä', 'Aiemmin n', 'Aiemmin % kaikista',
    'Aiemmin % löydöksistä', '% horisontaalisista']])
    .setFontWeight('bold').setBackground('#e8eef5').setWrap(true);

  const r = { vert: otsRivi + 1, horis: otsRivi + 2, exo: otsRivi + 3, eso: otsRivi + 4,
              jokin: otsRivi + 5, molemmat: otsRivi + 6 };
  const C = R_.C, D = R_.D, E = R_.E, F = R_.F, I = R_.I;

  const suuntaRivi = (rivi, nimi, ehdot, uusi, aiemmin, horisOsuus) => [
    nimi,
    '=' + countifs_(ehto, ehdot),
    '=IFERROR(B' + rivi + '/' + nRef + ',"–")',
    '=' + countifs_(ehto, ehdot.concat([uusi])),
    '=IFERROR(D' + rivi + '/' + nRef + ',"–")',
    '=IFERROR(D' + rivi + '/B' + rivi + ',"–")',
    '=' + countifs_(ehto, ehdot.concat([aiemmin])),
    '=IFERROR(G' + rivi + '/' + nRef + ',"–")',
    '=IFERROR(G' + rivi + '/B' + rivi + ',"–")',
    horisOsuus ? '=IFERROR(B' + rivi + '/B' + r.horis + ',"–")' : ''
  ];
  const tyhjat = ['', '', '', '', '', '', ''];
  const rivit = [
    suuntaRivi(r.vert, 'Vertikaalinen FD', [[C, 'kyllä']], [E, 'ei'], [E, 'kyllä'], false),
    suuntaRivi(r.horis, 'Horisontaalinen FD', [[D, 'kyllä']], [F, 'ei'], [F, 'kyllä'], false),
    suuntaRivi(r.exo, '– Exo', [[D, 'kyllä'], [I, 'exo']], [F, 'ei'], [F, 'kyllä'], true),
    suuntaRivi(r.eso, '– Eso', [[D, 'kyllä'], [I, 'eso']], [F, 'ei'], [F, 'kyllä'], true),
    ['Jokin FD (V tai H)', '=B' + r.vert + '+B' + r.horis + '-B' + r.molemmat,
      '=IFERROR(B' + r.jokin + '/' + nRef + ',"–")'].concat(tyhjat),
    ['Molemmat (V ja H)', '=' + countifs_(ehto, [[C, 'kyllä'], [D, 'kyllä']]),
      '=IFERROR(B' + r.molemmat + '/' + nRef + ',"–")'].concat(tyhjat)
  ];
  kirjoita_(sh.getRange(r.vert, 1, rivit.length, 10), rivit);
  ['C', 'E', 'F', 'H', 'I', 'J'].forEach(s =>
    sh.getRange(s + r.vert + ':' + s + r.molemmat).setNumberFormat('0.0%'));
  sh.getRange('B' + r.vert + ':J' + r.molemmat).setHorizontalAlignment('right');
  return { nRef: nRef, rivit: r, loppu: r.molemmat };
}

/** Lohko B – kaavioiden apualue. */
function kirjoitaLohkoB_(sh, alku, a) {
  const n = a.nRef, r = a.rivit;
  sh.getRange(alku, 1).setValue('Kaavioiden apualue').setFontWeight('bold').setFontColor('#666666');

  // Kaavio 1: jokaiselle suunnalle omat sarjat, jotta värit ovat suuntakohtaiset.
  const k1 = alku + 1;
  const pros = (sar, rivi) => '=IFERROR(' + sar + rivi + '/' + n + ',0)';
  kirjoita_(sh.getRange(k1, 1, 4, 7), [
    ['Suunta', 'Vertikaalinen, uusi', 'Vertikaalinen, aiemmin', 'Exo, uusi', 'Exo, aiemmin', 'Eso, uusi', 'Eso, aiemmin'],
    ['Vertikaalinen', pros('D', r.vert), pros('G', r.vert), '', '', '', ''],
    ['Exo', '', '', pros('D', r.exo), pros('G', r.exo), '', ''],
    ['Eso', '', '', '', '', pros('D', r.eso), pros('G', r.eso)]
  ]);
  sh.getRange(k1 + 1, 2, 3, 6).setNumberFormat('0.0%');

  // Kaavio 2: uusien osuus löydöksistä.
  const k2 = k1 + 5;
  const osuus = rivi => '=IFERROR(D' + rivi + '/B' + rivi + ',0)';
  kirjoita_(sh.getRange(k2, 1, 4, 4), [
    ['Suunta', 'Vertikaalinen', 'Exo', 'Eso'],
    ['Vertikaalinen', osuus(r.vert), '', ''],
    ['Exo', '', osuus(r.exo), ''],
    ['Eso', '', '', osuus(r.eso)]
  ]);
  sh.getRange(k2 + 1, 2, 3, 3).setNumberFormat('0.0%');

  // Kaavio 4: exo vs eso.
  const k4 = k2 + 5;
  kirjoita_(sh.getRange(k4, 1, 3, 2), [
    ['Horisontaalinen suunta', 'n'],
    ['Exo', '=B' + r.exo],
    ['Eso', '=B' + r.eso]
  ]);
  sh.getRange(k1, 1, 1, 7).setFontWeight('bold');
  sh.getRange(k2, 1, 1, 4).setFontWeight('bold');
  sh.getRange(k4, 1, 1, 2).setFontWeight('bold');

  return {
    kaavio1: sh.getRange(k1, 1, 4, 7),
    kaavio2: sh.getRange(k2, 1, 4, 4),
    kaavio4: sh.getRange(k4, 1, 3, 2),
    loppu: k4 + 2
  };
}

/** Lohko C – ikäryhmittäin (vain Tilastot-välilehdellä). */
function kirjoitaIkaryhmat_(sh, alku) {
  sh.getRange(alku, 1, 1, 8).setValues([['Ikäryhmä', 'n', 'Vertikaalinen %', 'Exo %', 'Eso %',
    'Vert. uusia % löydöksistä', 'Exo uusia % löydöksistä', 'Eso uusia % löydöksistä']])
    .setFontWeight('bold').setBackground('#e8eef5').setWrap(true);
  const C = R_.C, D = R_.D, E = R_.E, F = R_.F, I = R_.I;
  const rivit = IKARYHMAT.map((g, k) => {
    const rivi = alku + 1 + k;
    const ehto = ikaEhto_(String(g.ala), String(g.yla === null ? YLARAJA_KAAVOISSA : g.yla));
    const nC = '$B' + rivi;
    const loyd = ehdot => countifs_(ehto, ehdot);
    const vert = [[C, 'kyllä']], exo = [[D, 'kyllä'], [I, 'exo']], eso = [[D, 'kyllä'], [I, 'eso']];
    return [
      g.ryhma,
      '=' + countifs_(ehto, []),
      '=IFERROR(' + loyd(vert) + '/' + nC + ',"–")',
      '=IFERROR(' + loyd(exo) + '/' + nC + ',"–")',
      '=IFERROR(' + loyd(eso) + '/' + nC + ',"–")',
      '=IFERROR(' + loyd(vert.concat([[E, 'ei']])) + '/' + loyd(vert) + ',"–")',
      '=IFERROR(' + loyd(exo.concat([[F, 'ei']])) + '/' + loyd(exo) + ',"–")',
      '=IFERROR(' + loyd(eso.concat([[F, 'ei']])) + '/' + loyd(eso) + ',"–")'
    ];
  });
  kirjoita_(sh.getRange(alku + 1, 1, rivit.length, 8), rivit);
  sh.getRange(alku + 1, 3, rivit.length, 6).setNumberFormat('0.0%').setHorizontalAlignment('right');
  return {
    otsikot: sh.getRange(alku, 1, rivit.length + 1, 1),
    sarjat: sh.getRange(alku, 3, rivit.length + 1, 3),
    loppu: alku + rivit.length
  };
}

/** Lohko D – suuruudet (Δ). */
function kirjoitaSuuruudet_(sh, alku, ala, yla) {
  const ehto = ikaEhto_(ala, yla);
  const B = R_.B, C = R_.C, D = R_.D, G = R_.G, H = R_.H, I = R_.I;
  const ikaFilter = 'ISNUMBER(' + B + '),' + B + '>=' + ala + ',' + B + '<=' + yla;
  const rivi = (nimi, arvot, ehdot, filterEhto) => [
    nimi,
    '=' + countifs_(ehto, ehdot.concat([[arvot, '>0']])),
    '=IFERROR(AVERAGEIFS(' + arvot + ',' + ehto + ehdot.map(p => ',' + p[0] + ',"' + p[1] + '"').join('') + '),"–")',
    '=IFERROR(MEDIAN(FILTER(' + arvot + ',' + filterEhto + ',' + ikaFilter + ',ISNUMBER(' + arvot + '),' + arvot + '>0)),"–")'
  ];
  sh.getRange(alku, 1, 1, 4).setValues([['Suuruudet (Δ)', 'n', 'Keskiarvo', 'Mediaani']])
    .setFontWeight('bold').setBackground('#e8eef5');
  kirjoita_(sh.getRange(alku + 1, 1, 3, 4), [
    rivi('Vertikaalinen', G, [[C, 'kyllä']], C + '="kyllä"'),
    rivi('Exo', H, [[D, 'kyllä'], [I, 'exo']], D + '="kyllä",' + I + '="exo"'),
    rivi('Eso', H, [[D, 'kyllä'], [I, 'eso']], D + '="kyllä",' + I + '="eso"')
  ]);
  sh.getRange(alku + 1, 3, 3, 2).setNumberFormat('0.00').setHorizontalAlignment('right');
  return { loppu: alku + 3 };
}

function lisaaKaavio1_(sh, alue, rivi, sarake) {
  const ch = sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(alue).setNumHeaders(1)
    .setOption('title', 'Yleisyys suunnittain (% kaikista asiakkaista)')
    .setOption('isStacked', true)
    .setOption('legend', { position: 'bottom' })
    .setOption('vAxis', { format: 'percent', minValue: 0 })
    .setOption('series', {
      0: { color: VARIT.vert }, 1: { color: VARIT.vert_vaalea },
      2: { color: VARIT.exo }, 3: { color: VARIT.exo_vaalea },
      4: { color: VARIT.eso }, 5: { color: VARIT.eso_vaalea }
    })
    .setOption('width', 600).setOption('height', 340)
    .setPosition(rivi, sarake, 0, 0).build();
  sh.insertChart(ch);
}

function lisaaKaavio2_(sh, alue, rivi, sarake) {
  const ch = sh.newChart().setChartType(Charts.ChartType.BAR)
    .addRange(alue).setNumHeaders(1)
    .setOption('title', 'Uusien löydösten osuus (% löydöksistä)')
    .setOption('isStacked', true)
    .setOption('legend', { position: 'none' })
    .setOption('hAxis', { format: 'percent', minValue: 0, maxValue: 1 })
    .setOption('series', { 0: { color: VARIT.vert }, 1: { color: VARIT.exo }, 2: { color: VARIT.eso } })
    .setOption('width', 600).setOption('height', 300)
    .setPosition(rivi, sarake, 0, 0).build();
  sh.insertChart(ch);
}

/**
 * Kaavojen argumenttierotin riippuu taulukon aluekohtaisesta asetuksesta (en: pilkku, fi: puolipiste).
 * Tunnistetaan kirjoittamalla testikaava pilkuilla ja katsomalla, laskeeko Sheets sen.
 */
let EROTIN_ = ',';
function tunnistaErotin_(sh) {
  const solu = sh.getRange(1, 1);
  solu.setFormula('=IF(TRUE,1,2)');
  SpreadsheetApp.flush();
  EROTIN_ = solu.getValue() === 1 ? ',' : ';';
  solu.clearContent();
}

/** Muuntaa pilkuilla kirjoitetun kaavan taulukon erottimelle (lainausmerkkien sisältö säilyy). */
function kaava_(f) {
  if (EROTIN_ === ',') return f;
  return f.replace(/("[^"]*")|,/g, (m, teksti) => teksti || EROTIN_);
}

/**
 * Kirjoittaa taulukon, jossa on sekä tekstiä että kaavoja. Kaavat muunnetaan taulukon erottimelle.
 */
function kirjoita_(alue, rivit) {
  alue.setValues(rivit.map(r => r.map(x => (typeof x === 'string' && x.charAt(0) === '=') ? '' : x)));
  const r0 = alue.getRow(), s0 = alue.getColumn(), sh = alue.getSheet();
  rivit.forEach((r, i) => r.forEach((x, j) => {
    if (typeof x === 'string' && x.charAt(0) === '=') sh.getRange(r0 + i, s0 + j).setFormula(kaava_(x));
  }));
  return alue;
}

function lisaaKaavio3_(sh, c, rivi, sarake) {
  const ch = sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(c.otsikot).addRange(c.sarjat).setNumHeaders(1)
    .setOption('title', 'Ikäryhmittäin (% ryhmän asiakkaista)')
    .setOption('legend', { position: 'bottom' })
    .setOption('vAxis', { format: 'percent', minValue: 0 })
    .setOption('series', { 0: { color: VARIT.vert }, 1: { color: VARIT.exo }, 2: { color: VARIT.eso } })
    .setOption('width', 600).setOption('height', 340)
    .setPosition(rivi, sarake, 0, 0).build();
  sh.insertChart(ch);
}

function lisaaKaavio4_(sh, alue, rivi, sarake) {
  const ch = sh.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(alue).setNumHeaders(1)
    .setOption('title', 'Exo vs eso (horisontaaliset löydökset)')
    .setOption('pieHole', 0.4)
    .setOption('colors', [VARIT.exo, VARIT.eso])
    .setOption('legend', { position: 'right' })
    .setOption('width', 600).setOption('height', 300)
    .setPosition(rivi, sarake, 0, 0).build();
  sh.insertChart(ch);
}

// ---------------------------------------------------------------------
// Apufunktiot
// ---------------------------------------------------------------------

function dataSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(DATA);
  if (!sh) throw new Error('Data-välilehti puuttuu – aja FD-keruu → Alusta taulukko.');
  return sh;
}

function json_(obj) {
  return tekstiJson_(JSON.stringify(obj));
}

function tekstiJson_(teksti) {
  return ContentService.createTextOutput(teksti).setMimeType(ContentService.MimeType.JSON);
}

/** Valikkokomento: tarkistaa validoinnin hyväksymistapaukset. Ei kirjoita mitään. */
function itsetesti() {
  const pohja = { ika: 34, vert_fd_nyt: 'ei', horis_fd_nyt: 'ei', vert_fd_aiemmin: 'ei',
    horis_fd_aiemmin: 'ei', id: 'testi-12345678', versio: '1.0' };
  const tapaukset = [
    ['Molemmat ei', {}, true],
    ['Vert kyllä ilman suuruutta', { vert_fd_nyt: 'kyllä' }, false],
    ['Horis kyllä ilman suuntaa', { horis_fd_nyt: 'kyllä', horis_suuruus_pd: '2' }, false],
    ['Ikä 3', { ika: 3 }, true], ['Ikä 95', { ika: 95 }, true],
    ['Ikä tyhjä', { ika: '' }, false], ['Ikä -1', { ika: -1 }, false],
    ['Ikä 34,5', { ika: '34,5' }, false], ['Ikä abc', { ika: 'abc' }, false],
    ['1,5', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: '1,5' }, true],
    ['1.5', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: '1.5' }, true],
    ['0,3', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: '0,3' }, true],
    ['12', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: '12' }, true],
    ['0', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: '0' }, false],
    ['-1', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: '-1' }, false],
    ['1,2,3', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: '1,2,3' }, false],
    ['abc', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: 'abc' }, false],
    ['1,', { vert_fd_nyt: 'kyllä', vert_suuruus_pd: '1,' }, false],
    ['Horis exo 2', { horis_fd_nyt: 'kyllä', horis_suuruus_pd: '2', horis_suunta: 'exo' }, true]
  ];
  const tulos = tapaukset.map(t => {
    const v = validoi_(Object.assign({}, pohja, t[1]));
    const ok = (v.virheet.length === 0) === t[2];
    return (ok ? '✓ ' : '✗ ') + t[0] + (ok ? '' : ' – ' + v.virheet.join('; '));
  });
  const s = laskeTilastot_(null, null);
  tulos.push('', 'Tilastot: N = ' + s.n + ', vert ' + s.vert.n + ', exo ' + s.exo.n + ', eso ' + s.eso.n);
  tulos.push('Token asetettu: ' + (PropertiesService.getScriptProperties().getProperty('TOKEN') ? 'kyllä' : 'EI'));
  SpreadsheetApp.getUi().alert('Itsetesti', tulos.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

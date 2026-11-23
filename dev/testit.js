/**
 * Hyväksymistestit (SUUNNITELMA.md kohta 10) oikeaa Code.gs:ää vasten.
 *   node dev/testit.js
 * Odotetut luvut on laskettu käsin alla olevasta 20 rivin aineistosta.
 */
const assert = require('assert');
const { luoYmparisto } = require('./gas-mock');

const TOKEN = 'testitoken-123456';
let ok = 0, virheet = 0;
function testi(nimi, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nimi); } catch (e) { virheet++; console.log('  ✗ ' + nimi + '\n      ' + e.message); }
}
let idLaskuri = 0;
const rivi = (muutokset) => Object.assign({
  token: TOKEN, id: 'id-' + String(++idLaskuri).padStart(8, '0'), versio: '1.0', ika: 34,
  vert_fd_nyt: 'ei', horis_fd_nyt: 'ei', vert_fd_aiemmin: 'ei', horis_fd_aiemmin: 'ei',
  vert_suuruus_pd: '', horis_suuruus_pd: '', horis_suunta: ''
}, muutokset);

console.log('\nSyöttö');
{
  const env = luoYmparisto(TOKEN);
  testi('Molemmat FD:t = ei → tallentuu, G/H/I tyhjiä', () => {
    const v = env.post(rivi({}));
    assert.ok(v.ok, v.virhe);
    const r = env.data[0];
    assert.deepStrictEqual([r[6], r[7], r[8]], ['', '', '']);
    assert.match(r[0], /^\d{4}-\d{2}-\d{2}$/, 'aikaleima vain päivämäärä');
  });
  testi('Vert = kyllä ilman suuruutta → hylätään', () => assert.ok(!env.post(rivi({ vert_fd_nyt: 'kyllä' })).ok));
  testi('Horis = kyllä ilman suuntaa → hylätään', () =>
    assert.ok(!env.post(rivi({ horis_fd_nyt: 'kyllä', horis_suuruus_pd: '2' })).ok));
  testi('Ikä 3 ja 95 hyväksytään', () => {
    assert.ok(env.post(rivi({ ika: 3 })).ok);
    assert.ok(env.post(rivi({ ika: '95' })).ok);
  });
  ['', -1, '34,5', '34.5', 'abc', null].forEach(ika =>
    testi('Ikä ' + JSON.stringify(ika) + ' hylätään', () => assert.ok(!env.post(rivi({ ika })).ok)));
  testi('1,5 ja 1.5 tallentuvat numerona 1.5', () => {
    const a = env.post(rivi({ vert_fd_nyt: 'kyllä', vert_suuruus_pd: '1,5' }));
    const b = env.post(rivi({ vert_fd_nyt: 'kyllä', vert_suuruus_pd: '1.5' }));
    assert.strictEqual(env.data[a.rivi - 2][6], 1.5);
    assert.strictEqual(env.data[b.rivi - 2][6], 1.5);
  });
  ['0,3', '1,75', '12', '4,125'].forEach(s =>
    testi('Suuruus ' + s + ' hyväksytään', () =>
      assert.ok(env.post(rivi({ horis_fd_nyt: 'kyllä', horis_suuruus_pd: s, horis_suunta: 'eso' })).ok)));
  ['0', '-1', '1,2,3', 'abc', '1,', ',5', '0,0'].forEach(s =>
    testi('Suuruus ' + s + ' hylätään', () =>
      assert.ok(!env.post(rivi({ vert_fd_nyt: 'kyllä', vert_suuruus_pd: s })).ok)));
  testi('Suunta muu kuin exo/eso hylätään', () =>
    assert.ok(!env.post(rivi({ horis_fd_nyt: 'kyllä', horis_suuruus_pd: '1', horis_suunta: 'ylös' })).ok));
  testi('FD nyt = ei → lähetetty suuruus ja suunta jätetään tyhjiksi', () => {
    const v = env.post(rivi({ vert_suuruus_pd: '3', horis_suuruus_pd: '3', horis_suunta: 'exo' }));
    assert.ok(v.ok);
    const r = env.data[v.rivi - 2];
    assert.deepStrictEqual([r[6], r[7], r[8]], ['', '', '']);
  });
  testi('Väärä token → ok:false, ei riviä', () => {
    const ennen = env.data.length;
    const v = env.post(rivi({ token: 'vaara' }));
    assert.ok(!v.ok);
    assert.strictEqual(env.data.length, ennen);
    assert.ok(!env.get({ action: 'stats', token: 'vaara' }).ok);
  });
  testi('Sama UUID kahdesti → yksi rivi', () => {
    const r = rivi({});
    const a = env.post(r), b = env.post(r);
    assert.ok(a.ok && b.ok && b.tupla);
    assert.strictEqual(a.rivi, b.rivi);
    assert.strictEqual(env.data.filter(x => x[9] === r.id).length, 1);
  });
  testi('Virheellinen JSON → ok:false', () => assert.ok(!env.post('{rikki').ok));
  testi('Terveystarkistus ilman actionia', () => {
    const v = env.get({});
    assert.ok(v.ok);
    assert.strictEqual(v.rivit, env.data.length);
  });
  testi('Kaavainjektio id-kentässä hylätään', () => assert.ok(!env.post(rivi({ id: '=IMPORTXML("x")' })).ok));
}

console.log('\nTilastot');
{
  const tyhja = luoYmparisto(TOKEN);
  testi('Tyhjä data → n = 0 ja prosentit null ("–")', () => {
    const s = tyhja.get({ action: 'stats', token: TOKEN });
    assert.ok(s.ok);
    assert.strictEqual(s.n, 0);
    assert.strictEqual(s.vert.pct, null);
    assert.strictEqual(s.exo.osuus_horis_pct, null);
    assert.strictEqual(s.suuruudet.vert.ka, null);
  });

  // [ikä, C vert_nyt, D horis_nyt, E vert_aiemmin, F horis_aiemmin, G vert_pd, H horis_pd, I suunta]
  const A = [
    [10, 'ei', 'ei', 'ei', 'ei'],
    [15, 'kyllä', 'ei', 'ei', 'ei', '1'],
    [18, 'ei', 'kyllä', 'ei', 'ei', '', '4', 'exo'],
    [22, 'ei', 'ei', 'kyllä', 'kyllä'],
    [25, 'kyllä', 'kyllä', 'kyllä', 'ei', '0,5', '2', 'exo'],
    [30, 'ei', 'kyllä', 'ei', 'kyllä', '', '1,5', 'eso'],
    [33, 'ei', 'ei', 'ei', 'ei'],
    [39, 'kyllä', 'ei', 'ei', 'ei', '0.75'],
    [40, 'ei', 'kyllä', 'ei', 'ei', '', '3', 'exo'],
    [45, 'ei', 'ei', 'ei', 'ei'],
    [46, 'ei', 'kyllä', 'ei', 'kyllä', '', '6', 'exo'],
    [50, 'kyllä', 'ei', 'kyllä', 'ei', '1,25'],
    [55, 'ei', 'ei', 'ei', 'ei'],
    [59, 'ei', 'kyllä', 'ei', 'ei', '', '1', 'eso'],
    [60, 'ei', 'ei', 'ei', 'ei'],
    [65, 'kyllä', 'kyllä', 'ei', 'ei', '2', '2,5', 'exo'],
    [70, 'ei', 'ei', 'ei', 'ei'],
    [75, 'ei', 'kyllä', 'ei', 'kyllä', '', '0,5', 'eso'],
    [80, 'ei', 'ei', 'ei', 'ei'],
    [3, 'ei', 'ei', 'ei', 'ei']
  ];
  const env = luoYmparisto(TOKEN);
  A.forEach(a => {
    const v = env.post(rivi({ ika: a[0], vert_fd_nyt: a[1], horis_fd_nyt: a[2], vert_fd_aiemmin: a[3],
      horis_fd_aiemmin: a[4], vert_suuruus_pd: a[5] || '', horis_suuruus_pd: a[6] || '', horis_suunta: a[7] || '' }));
    if (!v.ok) throw new Error('Testirivi hylättiin: ' + v.virhe);
  });
  const s = env.get({ action: 'stats', token: TOKEN });

  testi('N = 20', () => assert.strictEqual(s.n, 20));
  testi('Vertikaalinen 5 (25 %), uusi 3 (15 % / 60 %), aiemmin 2', () => {
    assert.deepStrictEqual([s.vert.n, s.vert.pct, s.vert.uusi_n, s.vert.uusi_pct_kaikista, s.vert.uusi_pct_loydoksista, s.vert.aiemmin_n],
      [5, 25, 3, 15, 60, 2]);
  });
  testi('Horisontaalinen 8 (40 %)', () => assert.deepStrictEqual([s.horis.n, s.horis.pct], [8, 40]));
  testi('Exo 5 (25 %), uusi 4 (80 % löyd.), aiemmin 1, 62,5 % horisontaalisista', () =>
    assert.deepStrictEqual([s.exo.n, s.exo.pct, s.exo.uusi_n, s.exo.uusi_pct_loydoksista, s.exo.aiemmin_n, s.exo.osuus_horis_pct],
      [5, 25, 4, 80, 1, 62.5]));
  testi('Eso 3 (15 %), uusi 1 (33,3 %), aiemmin 2, 37,5 % horisontaalisista', () =>
    assert.deepStrictEqual([s.eso.n, s.eso.pct, s.eso.uusi_n, s.eso.uusi_pct_loydoksista, s.eso.aiemmin_n, s.eso.osuus_horis_pct],
      [3, 15, 1, 33.3, 2, 37.5]));
  testi('Jokin 11 (55 %), molemmat 2 (10 %)', () =>
    assert.deepStrictEqual([s.jokin.n, s.jokin.pct, s.molemmat.n, s.molemmat.pct], [11, 55, 2, 10]));
  testi('Exo + eso = horisontaalinen', () => assert.strictEqual(s.exo.n + s.eso.n, s.horis.n));
  testi('Uusi + aiemmin = löydökset kaikissa suunnissa', () =>
    ['vert', 'horis', 'exo', 'eso'].forEach(k => assert.strictEqual(s[k].uusi_n + s[k].aiemmin_n, s[k].n, k)));
  testi('Suuruudet: vert ka 1,1 md 1; exo ka 3,5 md 3; eso ka 1 md 1', () =>
    assert.deepStrictEqual(s.suuruudet, {
      vert: { n: 5, ka: 1.1, md: 1 }, exo: { n: 5, ka: 3.5, md: 3 }, eso: { n: 3, ka: 1, md: 1 }
    }));
  testi('Ikäryhmät: n 4/5/6/5 ja prosentit', () => {
    const g = s.ikaryhmat.map(x => [x.ryhma, x.n, x.vert_pct, x.exo_pct, x.eso_pct]);
    assert.deepStrictEqual(g, [
      ['<20', 4, 25, 25, 0], ['20–39', 5, 40, 20, 20], ['40–59', 6, 16.7, 33.3, 16.7], ['60+', 5, 20, 20, 20]
    ]);
  });
  testi('Ikähaku 25–45: n 6 (rajat mukaan lukevia), vert 33,3 %, exo 33,3 %, eso 16,7 %', () => {
    const r = env.get({ action: 'stats', token: TOKEN, ika_min: '25', ika_max: '45' });
    assert.deepStrictEqual([r.n, r.vert.pct, r.exo.pct, r.eso.pct], [6, 33.3, 33.3, 16.7]);
    assert.deepStrictEqual(r.rajaus, { ika_min: 25, ika_max: 45 });
    assert.deepStrictEqual(r.ikaryhmat.map(g => g.osuu), [false, true, true, false]);
  });
  testi('Ikähaku vain alarajalla (60) → n 5', () => assert.strictEqual(env.get({ action: 'stats', token: TOKEN, ika_min: '60' }).n, 5));
  testi('Ikähaku vain ylärajalla (19) → n 4', () => assert.strictEqual(env.get({ action: 'stats', token: TOKEN, ika_max: '19' }).n, 4));
  testi('Ikähaku alkaen > asti → virhe', () => assert.ok(!env.get({ action: 'stats', token: TOKEN, ika_min: '50', ika_max: '40' }).ok));
  testi('Ikähaku desimaalilla → virhe', () => assert.ok(!env.get({ action: 'stats', token: TOKEN, ika_min: '2.5' }).ok));
  testi('Tyhjä haarukka 81–90 → n 0 ilman virhettä', () => {
    const r = env.get({ action: 'stats', token: TOKEN, ika_min: '81', ika_max: '90' });
    assert.ok(r.ok);
    assert.strictEqual(r.n, 0);
  });
  testi('Uusi rivi näkyy tilastoissa heti (välimuisti mitätöityy)', () => {
    env.post(rivi({ ika: 50, vert_fd_nyt: 'kyllä', vert_suuruus_pd: '1' }));
    assert.strictEqual(env.get({ action: 'stats', token: TOKEN }).n, 21);
  });
  testi('Tilastovastaus ei sisällä raakadataa (id:t)', () => {
    const teksti = JSON.stringify(env.get({ action: 'stats', token: TOKEN }));
    assert.ok(!/id-0000/.test(teksti));
  });
}

console.log(`\n${ok} läpi, ${virheet} epäonnistui`);
process.exit(virheet ? 1 : 0);

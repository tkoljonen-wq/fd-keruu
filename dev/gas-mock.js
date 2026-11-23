/**
 * Lataa apps-script/Code.gs:n Nodeen ja korvaa Googlen palvelut muistinvaraisilla jäljitelmillä.
 * Vain paikalliseen kehitykseen ja testaukseen – ei käytetä tuotannossa.
 * Sheetsin kaavoja ja kaavioita tämä ei jäljittele.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function luoYmparisto(token) {
  const props = { TOKEN: token };
  const cache = new Map();
  const data = []; // rivit ilman otsikkoriviä

  const dataSheet = {
    getLastRow: () => data.length + 1,
    getRange: (rivi, sarake, nr, nc) => ({
      getValues: () => {
        const ulos = [];
        for (let i = 0; i < nr; i++) {
          const r = data[rivi - 2 + i] || [];
          ulos.push(Array.from({ length: nc }, (_, j) => (r[sarake - 1 + j] === undefined ? '' : r[sarake - 1 + j])));
        }
        return ulos;
      },
      setValues: arvot => { arvot.forEach((r, i) => { data[rivi - 2 + i] = r.slice(); }); },
      setNumberFormats: () => {}
    })
  };

  const context = {
    console,
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: n => (n === 'Data' ? dataSheet : null),
        getSpreadsheetTimeZone: () => 'Europe/Helsinki'
      }),
      flush: () => {}
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, v); }
      })
    },
    Utilities: {
      formatDate: (d, tz, fmt) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(d)
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: teksti => ({ teksti, setMimeType() { return this; } })
    }
  };
  vm.createContext(context);
  const koodi = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(koodi, context, { filename: 'Code.gs' });

  return {
    data,
    props,
    get: params => JSON.parse(context.doGet({ parameter: params }).teksti),
    post: obj => JSON.parse(context.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).teksti),
    gas: context
  };
}

/** Satunnainen mutta realistinen testiaineisto. */
function siemen(env, n, token) {
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    const vert = rnd() < 0.13, horis = rnd() < 0.24;
    const kpl = () => [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6][Math.floor(rnd() * 9)];
    const v = env.post({
      token, id: 'siemen-' + String(i).padStart(6, '0'), versio: '1.0',
      ika: Math.floor(5 + rnd() * 85),
      vert_fd_nyt: vert ? 'kyllä' : 'ei', horis_fd_nyt: horis ? 'kyllä' : 'ei',
      vert_fd_aiemmin: rnd() < 0.45 ? 'kyllä' : 'ei', horis_fd_aiemmin: rnd() < 0.5 ? 'kyllä' : 'ei',
      vert_suuruus_pd: vert ? kpl() : '', horis_suuruus_pd: horis ? kpl() : '',
      horis_suunta: horis ? (rnd() < 0.68 ? 'exo' : 'eso') : ''
    });
    if (!v.ok) throw new Error('Siemenrivi hylättiin: ' + v.virhe);
  }
}

module.exports = { luoYmparisto, siemen };

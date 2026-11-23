# SUUNNITELMA – FD-tiedonkeruu (index.html → Google Sheets)

Työnimi: **fd-keruu**
Tila: **toteutettu ja käytössä 23.11.2026**: https://tkoljonen-wq.github.io/fd-keruu/ (repo tkoljonen-wq/fd-keruu). Käyttöönotto- ja päivitysohjeet: README.md.
Tarkoitus: kartoittaa fiksaatiodisparaation (FD) yleisyyttä eri suunnissa (vertikaalinen, horisontaalinen exo ja eso) ja sitä, kuinka suuri osa löydöksistä on uusia.

Kokonaisuus:
- **index.html** (GitHub Pages), jossa kaksi välilehteä:
  - **Syöttö**: anonyymi lomake
  - **Tilastot**: automaattisesti päivittyvät luvut ja kaaviot
- **Google Sheets + Apps Script**: tallentaa datan, laskee tilastot ja tarjoaa ne lomakkeelle. Sheetsissä on omat tilastot ja kaaviot.

---

## 1. Arkkitehtuuri

```
[ Selain / tabletti ]  index.html (GitHub Pages)
   ├─ Syöttö-välilehti   ── POST (JSON, text/plain) ──┐
   └─ Tilastot-välilehti ── GET ?action=stats ────────┤
                                                      ▼
                         [ Apps Script Web App, sidottu Sheetsiin ]
                           doPost: validoi → kirjoittaa rivin
                           doGet:  laskee tilastot → JSON
                                                      │
                                                      ▼
                         [ Google Sheets ]
                           Data      – yksi rivi per asiakas
                           Tilastot  – kaavat + kaaviot (päivittyvät itse)
```

- **Ei taustapalvelinta.** GitHub Pages tarjoilee staattisen HTML:n, ja Apps Script toimii backendinä.
- POST lähetetään `Content-Type: text/plain` -otsikolla, jotta selain ei tee CORS-preflightia. Body on JSON-merkkijono.
- Apps Script palauttaa aina JSONia (`ContentService`).
- Tietosuoja: kerätään vain päivämäärä (ei kellonaikaa), ikä ja löydökset, ei tunnisteita.

---

## 2. Kerättävät kentät (Data-välilehti)

| Sarake | Otsikko | Tyyppi | Pakollinen | Arvot / ehto |
|---|---|---|---|---|
| A | `aikaleima` | datetime | – | palvelin asettaa |
| B | `ika` | kokonaisluku | kyllä | ≥ 0, ei ylä- tai alarajaa |
| C | `vert_fd_nyt` | teksti | kyllä | `kyllä` / `ei` |
| D | `horis_fd_nyt` | teksti | kyllä | `kyllä` / `ei` |
| E | `vert_fd_aiemmin` | teksti | kyllä | `kyllä` / `ei` |
| F | `horis_fd_aiemmin` | teksti | kyllä | `kyllä` / `ei` |
| G | `vert_suuruus_pd` | luku (Δ) | jos C = kyllä | > 0, vapaa desimaaliluku, ei ylärajaa |
| H | `horis_suuruus_pd` | luku (Δ) | jos D = kyllä | > 0, vapaa desimaaliluku, ei ylärajaa |
| I | `horis_suunta` | teksti | jos D = kyllä | `exo` / `eso` |
| J | `id` | UUID | – | lomake generoi, tuplien esto |
| K | `versio` | teksti | – | lomakkeen versio |

**Säännöt (sekä lomakkeessa että palvelimella):**
- Jos `vert_fd_nyt = ei`, G jää tyhjäksi. Jos se on `kyllä`, G on pakollinen.
- Jos `horis_fd_nyt = ei`, H ja I jäävät tyhjiksi. Jos se on `kyllä`, molemmat ovat pakollisia.
- Suuruus on yksi luku prismadioptreina (Δ). Vertikaalisen suuntaa ei kirjata.
- Suuruuden ei tarvitse olla 0,25:llä jaollinen, ja ylärajaa ei ole. Ainoa ehto on, että luku on positiivinen.
- Desimaalierottimeksi kelpaavat sekä pilkku että piste (`1,3` ja `1.3`). Lomake normalisoi arvon pisteeksi ennen lähetystä, ja palvelin tekee saman varmuuden vuoksi. Sheetsiin tallentuu aina numero, ei tekstiä.
- Mittausmenetelmää ei kirjata.
- Palvelin hylkää virheelliset rivit.
- Arvot tallennetaan pienillä kirjaimilla, jotta kaavat pysyvät yksinkertaisina.

---

## 3. Tilastojen määritelmät (yksi totuus)

Samat määritelmät koskevat **sekä Sheetsin Tilastot-välilehteä että index.html:n Tilastot-välilehteä**. Ne kirjataan sellaisinaan sekä Code.gs:n kommentteihin että README:hen.

**N** = kaikki rivit (kaikki tutkitut asiakkaat).

| Tunnusluku | Osoittaja (ehto) | Osuus kaikista (/N) | Osuus löydöksistä |
|---|---|---|---|
| **Vertikaalinen FD** | C = kyllä | % asiakkaista | – |
| Vertikaalinen, **uusi** | C = kyllä **ja** E = ei | % asiakkaista | % vertikaalisista löydöksistä |
| Vertikaalinen, aiemmin todettu | C = kyllä ja E = kyllä | % asiakkaista | % vertikaalisista löydöksistä |
| **Horisontaalinen FD** (kaikki) | D = kyllä | % asiakkaista | – |
| **Exo** | D = kyllä ja I = exo | % asiakkaista | % horisontaalisista löydöksistä |
| Exo, **uusi** | D = kyllä ja I = exo ja F = ei | % asiakkaista | % exo-löydöksistä |
| Exo, aiemmin todettu | D = kyllä ja I = exo ja F = kyllä | % asiakkaista | % exo-löydöksistä |
| **Eso** | D = kyllä ja I = eso | % asiakkaista | % horisontaalisista löydöksistä |
| Eso, **uusi** | D = kyllä ja I = eso ja F = ei | % asiakkaista | % eso-löydöksistä |
| Eso, aiemmin todettu | D = kyllä ja I = eso ja F = kyllä | % asiakkaista | % eso-löydöksistä |
| Jokin FD (V tai H) | C = kyllä tai D = kyllä | % asiakkaista | – |
| Molemmat (V ja H) | C = kyllä ja D = kyllä | % asiakkaista | – |

Lisäksi:
- **Ikäryhmittäin** (<20, 20–39, 40–59, 60+): n, vertikaalinen %, exo %, eso % ja niistä uusien osuus.
- **Suuruudet**: keskiarvo ja mediaani (sekä n) vertikaaliselle, exolle ja esolle.
- **Oma ikähaarukka**: kaikki yllä olevat tunnusluvut voidaan laskea myös vapaasti valitulle ikävälille (ks. 4.3 ja 6.2). Rajaus on molemmista päistä mukaan lukeva (`ika_min ≤ ikä ≤ ika_max`). Tyhjä raja tarkoittaa "ei rajaa". Rajatussa haussa N on haarukkaan osuvien asiakkaiden määrä.
- **Lukumäärä aina näkyviin prosentin rinnalle** (esim. "12,4 % (31/250)"), jotta pienten ryhmien prosentteja ei tulkita liian varmoina.
- *Valinnainen:* 95 %:n luottamusväli (Wilson) päätunnusluvuille. Lasketaan Apps Scriptissä ja näytetään sekä Sheetsissä että lomakkeella.
- Jos nimittäjä on 0, näytetään "–", ei virhettä.

---

## 4. index.html (GitHub Pages)

**Yksi tiedosto**: HTML, CSS ja JS samassa tiedostossa, ei ulkoisia kirjastoja eikä build-vaihetta. Kaaviot piirretään itse SVG:nä.

### Yläpalkki
Kaksi välilehtipainiketta: **Syöttö** | **Tilastot**. Valittu välilehti muistetaan URL-hashissa (`#syotto` / `#tilastot`), joten Tilastot-näkymän voi jakaa linkkinä.

### 4.1 Syöttö-välilehti
- Optimoitu tabletille ja puhelimelle, isot kosketusalueet (vähintään 44 px).
- Kyllä/ei- ja exo/eso-valinnat segmenttinapeilla.
- Ikä: `type="number" inputmode="numeric"`.
- Suuruudet: `type="text" inputmode="decimal"`, vapaasti syötettävä luku. `type="number"` ei kelpaa, koska osa selaimista hylkää pilkun tai tyhjentää kentän sen kohdalla.
  - Hyväksytty muoto: `^\d+([.,]\d+)?$`, esim. `2`, `0,3`, `1.75`, `4,125`.
  - Pilkku vaihdetaan pisteeksi ja arvo muunnetaan numeroksi ennen lähetystä.
  - Arvon on oltava suurempi kuin 0. Ylärajaa ei ole.
  - Virheellisestä muodosta näytetään ilmoitus kentän alla, eikä lähetys onnistu.
- **Ehdolliset kentät**: vertikaalisen suuruus näkyy vain, kun "Vertikaalinen FD nyt = kyllä". Horisontaalisen suuruus ja suunta näkyvät vain, kun "Horisontaalinen FD nyt = kyllä". Piilotetut kentät tyhjennetään.
- Järjestys:
  1. Ikä
  2. Vertikaalinen: nyt / aiemmin / suuruus
  3. Horisontaalinen: nyt / aiemmin / suuruus / suunta
  4. Tallenna
- Lähetyksen jälkeen:
  - Tallenna-painike lukitaan pyynnön ajaksi.
  - Onnistuessa näytetään vihreä ilmoitus ("Tallennettu – rivi n"), lomake tyhjenee ja fokus siirtyy ikäkenttään.
  - Virheessä näytetään punainen ilmoitus, eikä lomaketta tyhjennetä.
- Istuntolaskuri "Tällä istunnolla tallennettu: n" (sessionStorage).

### 4.2 Tilastot-välilehti
- Haetaan `GET {WEB_APP_URL}?action=stats&token=…`:
  - aina välilehden avautuessa
  - Päivitä-painikkeesta
  - automaattisesti 60 sekunnin välein, kun välilehti on auki
  - ja heti onnistuneen tallennuksen jälkeen, jos Tilastot on jo ladattu kerran
- Näkymä ylhäältä alas:
  1. **Tunnuslukukortit**: N, Vertikaalinen FD %, Exo %, Eso %, Jokin FD %. Jokaisessa korttissa pienellä "josta uusia x %" ja lukumäärät.
  2. **Kaavio 1 – Yleisyys suunnittain**: pinottu pylväs kolmelle suunnalle (vertikaalinen, exo, eso). Pinon osat ovat *uusi* ja *aiemmin todettu*, ja pylvään korkeus on osuus kaikista asiakkaista (%).
  3. **Kaavio 2 – Uusien löydösten osuus**: vaakapylväät "uusia / löydökset %" kullekin suunnalle.
  4. **Kaavio 3 – Ikäryhmittäin**: ryhmitellyt pylväät (vertikaalinen, exo, eso) ikäryhmille, n jokaisen ryhmän alla.
  5. **Taulukko**: kaikki kohdan 3 tunnusluvut sekä suuruuksien keskiarvo ja mediaani.
  6. Alareunassa "Päivitetty hh:mm:ss".
- SVG-kaaviot: kiinteä, värisokeille sopiva paletti (sama kuin Sheetsissä), arvo pylvään päällä ja tooltip hiirellä tai kosketuksella.
- Virhetila: "Tilastojen haku epäonnistui", Yritä uudelleen -painike ja viimeksi haetut luvut harmaana (välimuisti sessionStoragessa).

### 4.3 Ikähaku (Tilastot-välilehden yläosassa)
- Rivi, jossa on kentät **Ikä alkaen** ja **Ikä asti** (numerokentät, tyhjä = ei rajaa) sekä painikkeet **Hae** ja **Tyhjennä**.
- Pikavalintapainikkeet valmiille ryhmille: *Kaikki*, *<20*, *20–39*, *40–59*, *60+*. Painike täyttää kentät ja tekee haun heti.
- Haku kutsuu `GET ?action=stats&ika_min=…&ika_max=…`. **Koko Tilastot-näkymä** (kortit, kaaviot 1–2, taulukko ja suuruudet) lasketaan uudelleen valitulle haarukalle.
- Kun rajaus on päällä, näkymän yläreunassa näkyy selvä otsikko: "Rajaus: ikä 25–45 v. (n = 84)". Ikäryhmäkaavio 3 näytetään rajauksen aikana vain haarukkaan osuvien ryhmien osalta, tai se piilotetaan.
- Validointi: luvut ovat kokonaislukuja, ja alkaen ≤ asti. Virheestä näytetään ilmoitus, eikä hakua tehdä.
- Jos haarukassa ei ole yhtään asiakasta, näytetään "Ei asiakkaita valitulla ikävälillä".
- Rajaus tallennetaan URL-hashiin (`#tilastot?ika_min=25&ika_max=45`), joten rajatun näkymän voi jakaa linkkinä. Automaattipäivitys säilyttää rajauksen.

### Konfiguraatio (tiedoston alussa)
```js
const CONFIG = {
  WEB_APP_URL: "https://script.google.com/macros/s/XXXX/exec",
  TOKEN: "vaihda-tama",
  VERSIO: "1.0",
  TILASTOT_PAIVITYS_S: 60
};
```

### Lähetettävä JSON (POST)
```json
{
  "token": "…", "id": "uuid", "versio": "1.0",
  "ika": 34,
  "vert_fd_nyt": "kyllä", "horis_fd_nyt": "kyllä",
  "vert_fd_aiemmin": "ei", "horis_fd_aiemmin": "kyllä",
  "vert_suuruus_pd": 0.5, "horis_suuruus_pd": 2, "horis_suunta": "exo"
}
```

### Tilastovastaus (GET ?action=stats[&ika_min=..][&ika_max=..])
```json
{
  "ok": true,
  "paivitetty": "2026-11-23T15:30:00Z",
  "rajaus": { "ika_min": null, "ika_max": null },
  "n": 250,
  "vert":  { "n": 31, "pct": 12.4, "uusi_n": 9,  "uusi_pct_kaikista": 3.6, "uusi_pct_loydoksista": 29.0 },
  "horis": { "n": 58, "pct": 23.2 },
  "exo":   { "n": 40, "pct": 16.0, "uusi_n": 15, "uusi_pct_kaikista": 6.0, "uusi_pct_loydoksista": 37.5, "osuus_horis_pct": 69.0 },
  "eso":   { "n": 18, "pct": 7.2,  "uusi_n": 6,  "uusi_pct_kaikista": 2.4, "uusi_pct_loydoksista": 33.3, "osuus_horis_pct": 31.0 },
  "jokin": { "n": 79, "pct": 31.6 },
  "molemmat": { "n": 10, "pct": 4.0 },
  "ikaryhmat": [ { "ryhma": "<20", "n": 22, "vert_pct": 9.1, "exo_pct": 13.6, "eso_pct": 4.5, "...": "..." } ],
  "suuruudet": { "vert": { "n": 31, "ka": 0.8, "md": 0.5 }, "exo": { "n": 40, "ka": 2.1, "md": 1.5 }, "eso": { "n": 18, "ka": 1.4, "md": 1.0 } }
}
```
(Luvut ovat esimerkkejä. Prosentit pyöristetään yhteen desimaaliin palvelimella.)

---

## 5. Apps Script (Code.gs, sidottu Sheets-tiedostoon)

| Funktio | Tehtävä |
|---|---|
| `onOpen()` | Valikko **FD-keruu** → *Alusta taulukko*, *Rakenna tilastot ja kaaviot uudelleen*, *Testirivi* |
| `setup()` | Luo välilehdet **Data** ja **Tilastot**. Data-välilehdelle otsikot, jäädytetty rivi 1, numeromuodot, datavalidointi (pudotusvalikot C–F ja I). Kutsuu `rakennaTilastot_()`. Idempotentti. |
| `doPost(e)` | parse → token → `validoi_()` → `LockService` → UUID-tuplatarkistus → `appendRow` → `{ok:true, rivi}` |
| `doGet(e)` | `action=stats` → token → luetaan valinnaiset `ika_min`/`ika_max` (validointi: kokonaisluvut, min ≤ max) → `laskeTilastot_(ikaMin, ikaMax)` → JSON. Ilman actionia terveystarkistus `{ok:true, rivit:n}`. |
| `laskeTilastot_(ikaMin, ikaMax)` | Lukee Data-välilehden kerralla (`getDataRange().getValues()`), suodattaa rivit ikähaarukalla (null = ei rajaa) ja laskee kaikki kohdan 3 tunnusluvut. **Ainoa paikka, jossa lomakkeen tilastot lasketaan.** |
| `validoi_(d)` | Tyypit, arvoalueet ja ehdolliset säännöt (kohta 2). Suuruudet: `String(arvo).replace(',', '.')` → `Number()` → oltava äärellinen ja > 0. |
| `rakennaTilastot_()` | Kirjoittaa Tilastot-välilehden kaavat ja luo kaaviot (kohta 6). Poistaa ensin vanhat kaaviot, jotta uudelleenajo ei monista niitä. |
| `json_(obj)` | `ContentService` JSON -apufunktio |

**Huomiot:**
- Tilastoja varten voi käyttää `CacheService`-välimuistia 30 sekunnin ajan. Välimuistiavain sisältää ikärajauksen (esim. `stats_25_45`). Välimuisti tyhjennetään jokaisen onnistuneen `doPost`in jälkeen, jotta uusi rivi näkyy heti.
- Kaikki virheet napataan `try/catch`-lohkossa ja palautetaan JSONina.
- Token säilytetään Script Propertiesissa.

---

## 6. Sheets: Tilastot-välilehti (kaavat + kaaviot)

Välilehti ei sisällä käsin syötettyä dataa. Kaikki lasketaan kaavoilla, jotka viittaavat avoimiin alueisiin (`Data!C2:C`), joten luvut ja kaaviot päivittyvät heti uuden rivin tullessa ilman skriptin ajoa.

### Asettelu
**Lohko A – Päätunnusluvut** (rivit 1–15)

| Tunnusluku | n | % kaikista | Uusia n | Uusia % kaikista | Uusia % löydöksistä |
|---|---|---|---|---|---|
| Vertikaalinen | `COUNTIF` | `n/N` | `COUNTIFS(C,"kyllä",E,"ei")` | … | … |
| Horisontaalinen | … | … | … | … | … |
| – Exo | `COUNTIFS(D,"kyllä",I,"exo")` | … | `COUNTIFS(D,"kyllä",I,"exo",F,"ei")` | … | … |
| – Eso | … | … | … | … | … |
| Jokin FD | … | … | – | – | – |
| Molemmat | … | … | – | – | – |

- N = `COUNTA(Data!B2:B)`.
- Prosentit muodossa `0.0 %`.
- Nollalla jakaminen estetään `IFERROR(…;"–")`-kaavalla.

**Lohko B – Kaavioiden apualue**: "uusi" ja "aiemmin todettu" % kaikista kolmelle suunnalle (lähde kaaviolle 1) ja uusien osuus löydöksistä (lähde kaaviolle 2).

**Lohko C – Ikäryhmittäin**: ikäryhmät riveinä. Sarakkeina n, vertikaalinen %, exo %, eso % ja uusien osuudet (`COUNTIFS` ikärajoilla `">="&ala` ja `"<"&yla`).

**Lohko D – Suuruudet**: n, keskiarvo (`AVERAGEIFS`) ja mediaani (`MEDIAN(FILTER(…))`) vertikaaliselle, exolle ja esolle.

### Kaaviot (`EmbeddedChartBuilder`, Apps Script luo ne)
1. **Yleisyys suunnittain**: pinottu pylväskaavio (Vertikaalinen / Exo / Eso, osat *uusi* + *aiemmin todettu*, y-akseli % kaikista asiakkaista).
2. **Uusien löydösten osuus**: pylväskaavio, uusia % löydöksistä per suunta.
3. **Ikäryhmittäin**: ryhmitelty pylväskaavio, vertikaalinen / exo / eso % per ikäryhmä.
4. *(Valinnainen)* **Exo vs eso** horisontaalisista löydöksistä: piirakka- tai donitsikaavio.

### 6.2 Ikähaku-välilehti (Sheets)
Oma välilehti **Ikähaku**, jonka `rakennaTilastot_()` luo:
- Yläosassa kaksi syöttösolua: **Ikä alkaen** (B2) ja **Ikä asti** (B3). Ne on korostettu taustavärillä, ja niissä on datavalidointi (kokonaisluku ≥ 0). Tyhjä solu = ei rajaa.
- B4: tarkistus, joka näyttää varoituksen, jos alkaen > asti.
- Alla sama tunnuslukutaulukko kuin Tilastot-välilehden lohkoissa A ja D, mutta jokaiseen `COUNTIFS`/`AVERAGEIFS`/`FILTER`-kaavaan lisätään ikäehdot:
  - alaraja: `Data!B2:B, ">="&IF($B$2="", 0, $B$2)`
  - yläraja: `Data!B2:B, "<="&IF($B$3="", 999, $B$3)`
- Otsikkorivi näyttää rajauksen ja n:n: `="Rajaus: "&…&" (n = "&…&")"`.
- Kaavio: sama pinottu "Yleisyys suunnittain" -kaavio kuin Tilastoissa, mutta lähteenä tämän välilehden luvut. Se päivittyy, kun syöttösolujen arvoja muutetaan.
- Ikähaku ja `?action=stats&ika_min&ika_max` antavat samalle haarukalle samat luvut (hyväksymistesti).

Kaaviot sijoitetaan taulukoiden oikealle puolelle (sarakkeesta I eteenpäin). Värit ovat samat kuin index.html:ssä:
- vertikaalinen, exo ja eso omilla väreillään
- "uusi" täysi sävy, "aiemmin todettu" vaaleampi sävy

---

## 7. Turvallisuus ja roskadata

- **Jaettu token** sekä POSTissa että tilasto-GETissä. Kevyt suoja, koska token näkyy index.html:n lähdekoodissa.
- **Palvelinpuolen validointi**.
- **Tuplien esto** UUID:n avulla.
- **LockService** samanaikaisiin kirjoituksiin.
- Tilastot ovat aggregaatteja eivätkä sisällä yksittäisiä rivejä. `action=stats` ei koskaan palauta raakadataa.

---

## 8. Repon rakenne

Ks. README.md (kohta Tiedostot). Lisäksi `dev/` sisältää paikallisen testipalvelimen ja automaattiset hyväksymistestit (`node dev/testit.js`), jotka ajavat oikeaa Code.gs:ää jäljitellyllä Sheetsillä.

---

## 9. Hyväksymistestit

Syötön validointi, tuplien esto, token, tilastojen luvut, ikähaku ja tyhjä aineisto on automatisoitu (`dev/testit.js`, 48 testiä). Selaimessa testattu: lomake, offline-jono, ikähaku, jaettu linkki, virhetila ja tyhjä aineisto. Tuotannossa varmistettu: Sheetsin kaavat ilman virheitä ja tallennus puhelimelta.

Käsin tarkistettavat (ei automatisoitavissa):
- Sheetsin Tilastot/Ikähaku-välilehdet ja `?action=stats` antavat samalle aineistolle samat luvut.
- *Rakenna uudelleen* ei monista kaavioita.
- Kaksi samanaikaista lähetystä → kaksi ehjää riviä (LockService).

---

## 10. Päätökset

- Ikäryhmät tilastoissa: <20 / 20–39 / 40–59 / 60+. Lisäksi vapaa ikähaku.
- Iän syötölle ei ole rajaa: kokonaisluku ≥ 0.
- Suuruuksille ei ylärajaa eikä askelta. Desimaalierottimeksi kelpaavat pilkku ja piste.
- Suuruuksista raportoidaan keskiarvo ja mediaani.
- "Aiemmin"-kentissä vain kyllä/ei. Horisontaalisen "aiemmin" on yhteinen exolle ja esolle.
- Mittausmenetelmää ei kirjata.
- Tilastojen katseluun käytetään samaa tokenia kuin syöttöön.
- **PWA** (Android Chrome, standalone): manifest (`id: "fd-keruu"`), PNG-ikonit, network first -service worker (välimuistin etuliite `fd-keruu-`) ja oma Asenna-painike.
- **Aikaleima vain päivämääränä**, jottei riviä voi yhdistää yksittäiseen käyntiin ajanvarauskalenterin kautta.
- **Toteutettu valinnaisista**: offline-jono syötölle ja Sheetsin kaavio 4 *Exo vs eso*. **Ei toteutettu**: Wilsonin luottamusvälit ja CSV-vienti.

### Toteutuksen poikkeamat suunnitelmasta
- Ikäkenttä on `type="text" inputmode="numeric"` (puhdas numeronäppäimistö Androidilla).
- Valikon "Testirivi" on *Itsetesti*, joka ei kirjoita mitään.
- Sheetsin Tilastot-välilehdellä on lisäsarakkeet "aiemmin todettu" -luvuille, joten kaaviot alkavat sarakkeesta L.
- Sheets-kaavat kirjoitetaan taulukon aluekohtaisella argumenttierottimella (fi: puolipiste), joka tunnistetaan testikaavalla.

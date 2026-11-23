# FD-keruu

Fiksaatiodisparaation (FD) anonyymi tiedonkeruu ja tilastot. Sovelluksella kartoitetaan, kuinka yleistä FD on eri suunnissa (vertikaalinen, horisontaalinen exo ja eso) ja kuinka suuri osa löydöksistä on uusia.

- **index.html**: asennettava PWA (Android Chrome, standalone), jossa välilehdet **Syöttö** ja **Tilastot**
- **Google Sheets + Apps Script** (`apps-script/Code.gs`): tallentaa rivit, laskee tilastot ja rakentaa Sheetsiin omat tilasto- ja ikähakuvälilehdet kaavioineen

Suunnitelma ja päätökset löytyvät tiedostosta [SUUNNITELMA.md](SUUNNITELMA.md).

## Tietosuoja

Riville tallennetaan vain **päivämäärä** (ei kellonaikaa), ikä ja löydökset. Nimiä, tunnisteita tai vapaata tekstiä ei kerätä. Kellonaika jätetään pois, jotta riviä ei voi yhdistää yksittäiseen käyntiin ajanvarauskalenterin avulla. Tilastorajapinta palauttaa vain koosteita, ei koskaan yksittäisiä rivejä.

Offline-jono säilyttää lähettämättömät rivit puhelimen `localStorage`ssa (avain `fd-keruu-jono`), kunnes ne on lähetetty.

## Käyttöönotto

1. Luo tyhjä Google Sheets -tiedosto, esimerkiksi nimellä "FD-tiedonkeruu".
2. Avaa *Laajennukset → Apps Script*, liitä `apps-script/Code.gs` sinne ja tallenna.
3. Valitse editorissa funktio `setup` ja aja se. Hyväksy käyttöoikeudet. Data-, Tilastot- ja Ikähaku-välilehdet sekä kaaviot syntyvät.
4. Palaa taulukkoon ja päivitä sivu, jolloin **FD-keruu**-valikko tulee näkyviin. Valitse *FD-keruu → Aseta token* ja liitä token `index.html`:n `CONFIG.TOKEN`-kohdasta. Jos valikkokomento jää pyörimään (tavallista, kun selaimessa on useampi Google-tili), aseta token Apps Script -editorissa: *Projektin asetukset → Komentosarjan ominaisuudet → Lisää*: ominaisuus `TOKEN`, arvo token ilman lainausmerkkejä.
5. Apps Scriptissä: *Ota käyttöön → Uusi käyttöönotto → Verkkosovellus*.
   - Suorita käyttäjänä: **Minä**
   - Käyttöoikeus: **Kuka tahansa**
6. Kopioi `/exec`-loppuinen URL `index.html`:n `CONFIG.WEB_APP_URL`-kohtaan.
7. Testaa selaimessa:
   - `…/exec` → `{"ok":true,"rivit":0}`
   - `…/exec?action=stats&token=…` → tilastot
8. Pushaa muutos GitHubiin. Pages julkaisee sen osoitteeseen `https://tkoljonen-wq.github.io/fd-keruu/`.
9. Syötä testirivi ja tarkista Data, Tilastot ja index.html:n Tilastot-välilehti. Poista testirivi lopuksi Data-välilehdeltä.

Valikossa on myös *FD-keruu → Itsetesti*. Se ajaa validoinnin hyväksymistapaukset eikä tallenna mitään.

**Päivitykset:** kun Code.gs muuttuu, valitse *Ota käyttöön → Hallinnoi käyttöönottoja → muokkaa → Versio: Uusi versio*. Näin URL pysyy samana. Jos taulukon asettelu muuttuu, aja *FD-keruu → Rakenna tilastot ja kaaviot uudelleen*. Se ei monista kaavioita, ja Ikähaku-välilehden rajat säilyvät.

### Asennus puhelimeen (PWA)

Avaa sivu Androidin Chromessa ja paina sovelluksen **Asenna**-painiketta. Vaihtoehtoisesti voit valita Chromen valikosta *Asenna sovellus*. Jos Chrome väittää sovelluksen olevan jo asennettu, päivitä sivu kahdesti ja sulje välilehti, jotta uusi manifest ja service worker otetaan käyttöön.

## Tilastojen määritelmät

Nämä samat määritelmät ovat Code.gs:n alussa, ja niitä käytetään sekä Sheetsissä että lomakkeella.

N on kaikki rivit, joilla on ikä (kaikki tutkitut asiakkaat). Sarakkeet: C `vert_fd_nyt`, D `horis_fd_nyt`, E `vert_fd_aiemmin`, F `horis_fd_aiemmin`, I `horis_suunta`.

| Tunnusluku | Ehto | Osuus kaikista | Osuus löydöksistä |
|---|---|---|---|
| Vertikaalinen FD | C = kyllä | /N | – |
| Vertikaalinen, uusi | C = kyllä ja E = ei | /N | /vertikaaliset |
| Vertikaalinen, aiemmin todettu | C = kyllä ja E = kyllä | /N | /vertikaaliset |
| Horisontaalinen FD | D = kyllä | /N | – |
| Exo | D = kyllä ja I = exo | /N | /horisontaaliset |
| Exo, uusi / aiemmin | … ja F = ei / kyllä | /N | /exo-löydökset |
| Eso | D = kyllä ja I = eso | /N | /horisontaaliset |
| Eso, uusi / aiemmin | … ja F = ei / kyllä | /N | /eso-löydökset |
| Jokin FD | C = kyllä tai D = kyllä | /N | – |
| Molemmat | C = kyllä ja D = kyllä | /N | – |

- Ikäryhmät ovat <20, 20–39, 40–59 ja 60+. Ikähaun rajat ovat mukaan lukevia (`ika_min ≤ ikä ≤ ika_max`), ja tyhjä raja tarkoittaa, ettei rajaa ole.
- Suuruuksista (Δ) lasketaan n, keskiarvo ja mediaani erikseen vertikaaliselle, exolle ja esolle.
- Prosentit pyöristetään yhteen desimaaliin, ja lukumäärä näytetään aina prosentin rinnalla.
- Jos nimittäjä on 0, näytetään "–".
- Horisontaalisen "aiemmin todettu" on yhteinen exolle ja esolle.

## Kehitys ja testaus paikallisesti

Paikallinen kehitys vaatii Node.js:n. Testiympäristö ajaa oikeaa `Code.gs`:ää niin, että Googlen palvelut on korvattu muistinvaraisilla jäljitelmillä.

```powershell
node dev/testit.js
```

```powershell
node dev/mock-server.js --seed 250
```

- `dev/testit.js` ajaa hyväksymistestit käsin lasketulla 20 rivin aineistolla.
- `dev/mock-server.js` käynnistää testipalvelimen osoitteeseen http://localhost:8787/ ja luo 250 satunnaista riviä. index.html:n palvelinosoite vaihdetaan lennossa paikalliseen.
- Offline-jonoa voi testata osoitteilla `http://localhost:8787/__offline?on=1` ja `?on=0`.

Sheetsin kaavoja ja kaavioita jäljitelmä ei testaa. Ne tarkistetaan oikeassa taulukossa (hyväksymistesti: Tilastot- ja Ikähaku-välilehti antavat samat luvut kuin `?action=stats`).

## Tiedostot

```
index.html            Syöttö + Tilastot (PWA)
manifest.json, sw.js  PWA-asennus ja network first -välimuisti (etuliite fd-keruu-)
icons/                PNG-ikonit (192, 512, maskable) + SVG
apps-script/Code.gs   kopioidaan Sheetsin Apps Script -editoriin
dev/                  paikallinen testipalvelin ja testit
SUUNNITELMA.md        suunnitelma
```

# İstanbul Açık Ulaşım ve Hava Kokpiti

Tarayıcıda çalışan, yabancı ve açık kaynaklı servislerle İstanbul ulaşımını, canlı havayı ve uçuş radarını tek kokpitte toplayan çevrimdışı kullanılabilir bir PWA.

Canlı demo: `https://example.com/istanbul-cockpit` (yer tutucu)

Ekran görüntüsü: `docs/ekran-goruntusu.png` (yer tutucu)

## Özellikler

- Çok modlu rota planlama: yürüme, bisiklet ve araba
- Canlı hava durumu ve saatlik tahmin
- Canlı uçuş radarı
- Toplu taşıma hatları ve duraklar
- En yakın durak bulma
- Duraklar arası istemci tarafı rota
- Çevrimdışı PWA desteği
- Koyu ve açık tema
- Tamamen yabancı açık kaynak servisler

## Kullanılan teknolojiler

| Teknoloji | Rol |
| --- | --- |
| MapLibre GL JS | Harita görüntüleme ve katmanlar |
| OpenStreetMap | Raster harita karoları |
| Nominatim | Adres arama |
| Open-Meteo | Canlı hava ve saatlik tahmin |
| OpenSky Network | Canlı uçuş durumları |
| OSRM | Yürüme, bisiklet ve araba rotası |
| Overpass API | Metro, tramvay ve vapur hatları |
| Vanilla JavaScript | Arayüz ve orkestrasyon |
| Vitest | Saf fonksiyon testleri |
| GitHub Actions | Sürekli test |

## Mimari

```mermaid
flowchart LR
  Tarayici[Tarayıcı arayüzü] --> App[app.js]
  App --> Utils[utils.js]
  App --> Harita[MapLibre GL JS]
  Harita --> OSM[OpenStreetMap]
  App --> Nominatim
  App --> OSRM
  App --> Meteo[Open-Meteo]
  App --> OpenSky[OpenSky Network]
  App --> Overpass[Overpass API]
  App --> PWA[Service Worker]
```

## Kurulum

Proje derleme gerektirmez. ES modülleri `file://` adresinde engellendiği için basit bir statik sunucu kullanın:

```bash
python3 -m http.server 8080
```

Ardından tarayıcıda `http://127.0.0.1:8080` adresini açın.

## Test

```bash
npm install
npm test
```

Kapsam raporu için `npm run coverage`.

## Katkı

Küçük ve odaklı değişiklikler tercih edilir. Yeni veri kaynağı eklemeden önce lisansın açık olduğunu ve Türkiye kaynaklı bir servis olmadığını doğrulayın. Saf hesapları `utils.js` içinde tutun ve testi olmadan birleştirmeyin.

## Lisans

MIT. Metin `LICENSE` dosyasındadır.

## Atıf

- OpenStreetMap: © OpenStreetMap contributors. Harita ve ulaşım geometrisi Open Database License (ODbL) altındadır. https://www.openstreetmap.org/copyright
- Open-Meteo: Hava verisi Open-Meteo.com tarafından sağlanır, CC BY 4.0. https://open-meteo.com/
- OpenSky Network: Uçuş durumları The OpenSky Network API üzerinden gelir. https://opensky-network.org
- OSRM: Rota motoru Project OSRM demo sunucusudur. Yol ağı verisi © OpenStreetMap contributors. https://project-osrm.org/
- Overpass API: Toplu taşıma ilişkileri Overpass API ile sorgulanır. Veri © OpenStreetMap contributors. https://overpass-api.de/
- Nominatim: Adres araması OpenStreetMap Nominatim örneğidir. Veri © OpenStreetMap contributors, ODbL.
- MapLibre GL JS: BSD 3-Clause. https://maplibre.org/

Bu kokpit Türkiye kaynaklı hiçbir API, veri seti, CDN, font veya ikon paketi kullanmaz. Tüm veri kaynakları yabancı operatörler tarafından sunulur ve açık lisanslıdır.

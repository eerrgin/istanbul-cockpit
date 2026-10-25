# ADR 002 — Veri kaynakları

## Durum

Kabul edildi.

## Bağlam

Kokpit canlı adres, rota, hava, uçuş ve toplu taşıma göstermelidir. Türkiye kaynaklı API, veri seti, CDN, font veya ikon paketi kullanılmayacaktır. Her kaynak yabancı bir operatörden, açık lisansla gelmelidir.

## Karar

| İhtiyaç | Kaynak | Lisans ve koşul |
| --- | --- | --- |
| Harita karosu | `tile.openstreetmap.org` | ODbL, © OpenStreetMap contributors, görünür atıf zorunlu, makul kullanım |
| Adres | Nominatim `nominatim.openstreetmap.org` | ODbL, en fazla saniyede bir istek, tanımlı Referer |
| Rota | OSRM demo `router.project-osrm.org` | Yazılım BSD, yol ağı ODbL, demo sunucusu adil kullanım |
| Hava | Open-Meteo `api.open-meteo.com` | CC BY 4.0, ticari olmayan adil kullanım, atıf |
| Uçuş | OpenSky Network `opensky-network.org/api` | Açık API, anonim oran sınırı, araştırma atfı |
| Hat ve durak | Overpass API | Sorgu arayüzü açık, OSM verisi ODbL |

Yazı tipi Google Fonts üzerinden Inter, ikonlar Lucide, harita betiği jsDelivr üzerindedir. Hepsi Türkiye dışı barındırıcılardır.

## Neden Türkiye kaynaklı servis yok

Yerel ulaşım ve hava API'leri çoğu zaman kapalı sözleşme, anahtar veya belirsiz yeniden kullanım şartı taşır. Bu proje tek bir açık lisans çizgisinde kalmak ve herhangi bir ulusal kuruma operasyonel bağ kurmamak için o servisleri dışarıda bırakır. İstanbul geometrisi OSM içinde zaten dünya verisinin parçası olarak durur; ayrıca bir Türkiye kaynağı indirilmez.

## Oran sınırı

- Nominatim çağrıları kuyruğa alınır ve iki istek arasında en az bir saniye bırakılır. Yazım duraksaması da bir saniyedir.
- Overpass ve OpenSky sonuçları en az beş dakika önbellekte tutulur. Hat önbelleği on dakikadır. Başarısız çağrıda taze önbellek varsa o kullanılır ve toast ile söylenir.
- Open-Meteo on dakika önbelleğe alınır.
- Overpass uç noktaları sırayla denenir: `overpass-api.de`, `overpass.kumi.systems`, `overpass.osm.ch`. Paralel yağmur yapılmaz.
- OSRM demo sunucusuna yalnızca kullanıcı rota istediğinde gidilir.

## Sonuç

Bir kaynak CORS vermez, süre aşar veya kota dönerse kokpit çökmez. Harita ve diğer kartlar ayakta kalır, hata toast ile görünür.

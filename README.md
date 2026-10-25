# Ergin Lab · İstanbul Saha Deneyi 01

İstanbul için deneysel bisiklet altyapısı haritası, canlı hava durumu ve rota arayüzü. Bu proje resmî bir navigasyon veya güvenli rota garantisi değildir; açık harita etiketlerini gözlemlemek, karşılaştırmak ve saha notları tutmak için hazırlanmış bir laboratuvar arayüzüdür.

Canlı deney: https://eerrgin.github.io/istanbul-cockpit/

## Deney alanları

- Bisiklet altyapısı katmanı: ayrılmış bisiklet yolları, yol üzeri şeritler ve paylaşımlı/bisiklete açık güzergâhlar farklı renklerle gösterilir.
- Deney 01 filtresi: yalnızca haritada ayrılmış bisiklet yolu olarak etiketlenmiş bölümleri gösterir.
- Harita üzerinde bir güzergâha tıklayarak mevcut etiket, zemin, yaya ayrımı ve aydınlatma alanlarını inceleme.
- Yürüme, bisiklet ve araç için genel rota planlayıcısı.
- İstanbul için canlı hava durumu, saatlik ve dört günlük tahmin.
- Saha not defteri: notlar tarayıcının yerel depolamasında tutulur; dosya olarak dışa aktarılabilir.
- Masaüstü ve mobil ekranlara uyarlanmış düzen; tema seçimi ve çevrimdışı önbellek.

## Teknoloji ve açık veri

| Parça | Kullanım |
| --- | --- |
| MapLibre GL JS | Etkileşimli harita ve katmanlar |
| OpenStreetMap | Harita ve bisiklet altyapısı geometrisi |
| Overpass API | Haritadaki bisiklet etiketi sorguları |
| Photon (Komoot) | Adres önerileri |
| Open-Meteo | Hava durumu ve tahmin |
| OSRM / FOSSGIS routing | Yürüme, bisiklet ve araç rotaları |
| localStorage | Bu cihazdaki deney notları ve önbellek |
| Vitest | Altyapı etiket sınıflandırma ve yardımcı işlev testleri |

## Bisiklet katmanı nasıl okunur?

Yeşil çizgiler, ayrı bisiklet yolu olarak etiketlenmiş highway=cycleway veya cycleway=track kayıtlarını; kırmızı çizgiler yol üzerindeki bisiklet şeritlerini; lila çizgiler paylaşımlı ya da bisiklete açık güzergâhları temsil eder. Sınıflandırma haritadaki etiketlere dayanır. Eksik, eskimiş veya hatalı kayıtlar olabilir; bir çizgi tek başına o yolun güncel ya da güvenli olduğu anlamına gelmez.

## Geliştirme ve test

Proje statik dosyalardan oluşur. ES modüllerinin tarayıcıda açılabilmesi için bir yerel HTTP sunucusu kullan:

    python3 -m http.server 8080

Ardından http://127.0.0.1:8080 adresini aç. Testler:

    npm install
    npm test

## Notların gizliliği

Saha notları localStorage içinde bu tarayıcıda saklanır; uygulama notları bir sunucuya göndermez. Tarayıcı verileri temizlenirse notlar da silinebilir. Önemli notları dosya olarak dışa aktar.

## Lisans ve atıf

- OpenStreetMap: © OpenStreetMap contributors. Harita verisi Open Database License (ODbL) altındadır: https://www.openstreetmap.org/copyright
- Open-Meteo: https://open-meteo.com/
- Photon by Komoot: https://photon.komoot.io/
- OSRM / FOSSGIS routing: https://routing.openstreetmap.de/about.html
- MapLibre GL JS: BSD 3-Clause. https://maplibre.org/

Kamuya açık Overpass sunucuları yoğunluk veya limit nedeniyle zaman zaman yanıt vermeyebilir. Uygulama sonuçları önbelleğe alır; veri alınamazsa durum kartında erişim sorunu gösterilir.

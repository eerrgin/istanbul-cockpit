# ADR 003 — İstemci tarafı durak rotası

## Durum

Kabul edildi.

## Bağlam

Yürüme, bisiklet ve araba rotaları OSRM demo sunucusundan gelir. Toplu taşıma için sefer saatli bir motor yoktur. OpenTripPlanner gibi sunucu tarafı çözümler ayrı bir JVM servisi, GTFS beslemesi ve işletim yükü ister. Bu proje derlemesiz ve sunucusuz açılmalıdır.

## Karar

Overpass'tan gelen duraklar, aynı hat üzerindeki ardışık duraklar arasında kenar kuran bir komşuluk grafına dönüştürülür. Kenar ağırlığı Haversine mesafesidir. Kullanıcı iki adres seçip durak rotası istediğinde, her adresin en yakın durağı bulunur ve Dijkstra ile en kısa durak dizisi hesaplanır. Sonuç haritada çizgi, listede durak adları olarak gösterilir.

Sokak modları OSRM'de kalır. Toplu taşıma hesabı tamamen `utils.js` içindeki `buildStopGraph` ve `dijkstra` fonksiyonlarındadır.

## Neden OpenTripPlanner değil

- Ayrı sunucu, bu kokpitin statik dosya modelini bozar.
- GTFS paketi çoğu şehirde kurumsal bir kaynaktan gelir; Türkiye kaynaklı besleme bu projenin kısıtına uymaz.
- Demo anında tarayıcıda çalışmalı, ek servis ayakta tutulmamalıdır.

## Sınırlar

- Sefer saati, aktarma beklemesi ve araç kapasitesi yoktur. Ağırlık kuş uçuşu metredir, ray uzunluğu değildir.
- Aktarma yalnızca aynı OSM düğümünü paylaşan duraklarda oluşur. Ayrı peron düğümleri yürüyüş kenarıyla birleşmez.
- Tek yön, kapalı hat ve vapur iskelesi rolü eksik ilişkiler grafı seyreltir.
- Sonuç bir ulaşım önerisi değil, geometrik en kısa durak zinciridir.

## Gelecek

Açık lisanslı ve yabancı bir operatörden gelen GTFS ortaya çıkarsa, saat bilgisi yine istemcide tutulabilir. Sunucu şartı değişmeden önce bu ADR yeniden açılır. Yürüyüş aktarması, yakın peronları kısa bir Haversine eşiğiyle bağlayarak eklenebilir.

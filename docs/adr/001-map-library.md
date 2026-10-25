# ADR 001 — Harita kütüphanesi

## Durum

Kabul edildi.

## Bağlam

Kokpitin tarayıcıda, derlemesiz açılması ve İstanbul üzerinde hat, durak, rota, uçuş ve hava katmanlarını aynı tuvalde göstermesi gerekiyor. Lisans kapalı olmamalı, API anahtarı zorunlu olmamalı.

## Karar

Harita kütüphanesi olarak MapLibre GL JS seçildi. Altlık, OpenStreetMap raster karolarıdır. GeoJSON katmanları MapLibre stil ifadeleriyle boyanır.

## Alternatifler

- Leaflet: olgun ve BSD lisanslıdır, ancak tuval modeli işaretçi ve eklenti ağırlıklıdır. Çok sayıda çizgi ve daire için WebGL katman ifadesi MapLibre'de daha doğrudandır.
- Google Maps: kapalı lisans, anahtar ve ücret gerektirir. Projenin yalnızca yabancı ve açık servis kullanma kuralıyla çelişir.

## Gerekçe

MapLibre, Mapbox GL JS'in topluluk çatallamasıdır ve BSD 3-Clause lisansıyla dağıtılır. Vektör karo stillerini destekler; bu projede anahtarsız kalmak için raster OSM kullanılsa da aynı stil belgesi GeoJSON katmanlarını, görünürlük anahtarlarını ve özellik eşleştirmeli renkleri taşır. CDN üzerinden tek betik ve tek stil dosyasıyla yüklenir, derleme gerektirmez.

## Sonuç

Atıf denetimi kapatılmaz. Karo hataları bir kez toast edilir, her karo için tekrarlanmaz.

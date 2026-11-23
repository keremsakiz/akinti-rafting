# AKINTI — Claude notları

## ⚠️ YAYIN ÖNCESİ KONTROL (App Store / Play Store) — ATLAMA
1. Mağaza derlemesi **bayraksız**: `node build.mjs` (asla `--admin` değil).
2. Çıktıda `yönetici modu yok (mağaza için uygun)` yazmalı. `HATA: yönetici kodu derlemede kaldı!` çıkarsa dur.
3. `grep -c admPanel dist/index.html` sonucu `0` olmalı.
4. Ancak bundan sonra `dist/index.html`'i Capacitor projesine kopyala.

Kerem'in isteği (2026-11-22): "App Store'da yayınlanacak, yayın öncesi yönetici sekmesini kaldırmayı unutma."
Yönetici modu = `src/admin.js` + `main.js` içindeki `__ADMIN__` blokları; sadece `--admin` ile derlenir.

## Çalışma şekli
- Kerem'e Türkçe, kısa yanıt; önce en kısa yol.
- Test sürümü (claude.ai artifact) `node build.mjs --admin` ile, mağaza sürümü `node build.mjs` ile.
- Kaynak tek dosyaya paketlenir: `src/` → esbuild → `src/template.html` → `dist/index.html`.

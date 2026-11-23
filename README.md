# AKINTI — Rafting (prototip v2.7)

Three.js ile yazılmış, tek dosyaya paketlenen 3D mobil rafting oyunu.

> ⚠️ **YAYIN ÖNCESİ (App Store / Play Store):** Yönetici modu SADECE `--admin` ile derlenir.
> Mağazaya giden derleme her zaman bayraksız `node build.mjs` olmalı. Çıktıda
> `yönetici modu yok (mağaza için uygun)` yazısını gör, sonra Capacitor'a kopyala.

## Çalıştırma
```
npm install
node build.mjs          # MAĞAZA derlemesi: dist/index.html (küçültülmüş, tek dosya, modeller gömülü, yönetici YOK)
node build.mjs --admin  # TEST derlemesi: menüde kırmızı YÖNETİCİ düğmesi (asla mağazaya gönderme)
node build.mjs --dev    # okunabilir paket
```

## Yönetici modu (sadece test)
Menüde sol üstte kırmızı **YÖNETİCİ** düğmesi, oyun içinde Duraklat ekranında **YÖNETİCİ**.
- Cüzdan: +1.000 / +10.000 / +100.000 altın
- Mağaza: hepsini aç, kaydı sıfırla (iki kez dokun)
- Oyun: ölümsüz, zaman x1/x2/x4, kalkan ver, mıknatıs ver, oyun sonu ekranı
- Ortama git: 7 ortamın her birinin başına atla
- Kod: `src/admin.js` (tüm arayüz burada), `main.js` içindeki `__ADMIN__` blokları, `build.mjs` `--admin` bayrağı.
  Bayraksız derlemede esbuild bu kodu tamamen atar; `admPanel` kalırsa derleme hata verip durur.
`dist/index.html` doğrudan tarayıcıda açılır; GitHub Pages'e de olduğu gibi konabilir.

## v2'de neler değişti
- **Ekip:** 4 kürekçi + arkada dümenci rehber. Quaternius "Universal Base Characters" (iskeletli insan modelleri) kullanılıyor;
  kıyafet renkleri kemik ağırlıklarına göre boyanıyor, can yeleği gövdeye göre üretilip aynı iskelete bağlanıyor, kask kafa kemiğinde.
  Kürek çekme hareketi IK (ters kinematik) ile: eller küreği tutuyor, kürek eli takip ediyor.
- **Bot:** dokulu şişme raft (dikiş, valf, sürtünme şeridi, logo), sarkan tutunma ipi ve D-halkalar, oturaklar.
- **Su:** gerçek zamanlı ayna yansıması (kıyı, ağaç, köprü suya yansıyor), gerçek kıyı çizgisi boyunca köpük,
  sığ yerlerde dip ve ışık kırılması, akışla kayan dalgacıklar, yumuşak köpük dokusu, kürek ve bot sıçramaları.
- **Işık:** HDR + bloom + renk düzenleme, gökyüzünden ortam ışığı (IBL).
- **Gece:** ay yolu, bot projektörü, yanan şamandıra ve köprü fenerleri, kıyıda fenerler, ışıldayan dümen suyu.
- **Yeni engeller:** köprü ayakları, şamandıra hatları (bayraklı açıklıktan geç), sürüklenen kayıklar, devrik ağaçlar,
  yüzen variller, kanyonda düşen kayalar (önce suda kırmızı işaret çıkar; v2.7: volkanda lav gayzeri),
  bonus veren slalom kapıları, her ortam girişinde varış takı.
- **Kalite yönetimi:** kare hızı düşerse sırasıyla çözünürlük, yansıma, gölge ve efektler kapanır.

## Mağaza ve skinler (v2.2)
- **Altın kazanma:** turda toplanan altınlar + her 50 m için 1 altın; oyun sonu kartında gösterilir, cüzdana eklenir.
- **Kategoriler:** Bot (8 desen: neon, kamuflaj, alev, altın…), Ekip (7 kıyafet seti, ışıldayan/metal yelekler),
  Kürek (5 renk/malzeme), İz (botun arkasında parçacık izi: altın tozu, buz, kıvılcım, gökkuşağı).
- **Canlı önizleme:** mağazada seçilen skin 3D botta anında görünür; satın alınmazsa kapatınca eski hâline döner.
- **Kayıt:** `localStorage` (`akinti_save_v1`); claude.ai'de açılınca ayrıca kullanıcıya özel bulut kaydı (cihazlar arası).
  Fiyatlar ve içerik `src/shop.js` içindeki `CATALOG` tablosunda.

## v2.7 — Kerem'in inceleme notları
- **Batış animasyonları teknesine göre ayrı:** raft takla atar, motorbot fırıl fırıl döner, yelkenli yan yatar,
  yat burnundan dalar, gemi kıçtan batar, denizaltı köpürerek dibe iner. Her birinin kendi sesi ve parçacığı var
  (`raft.js` `SINK`/`sinkPose`, `audio.js` `crash(kind)`, `main.js` `sinkFx`).
- **Dalgaya toslama artık görünüyor:** kamera öne-yukarı tepki veriyor, hafif sarsıntı, yüksek köpük sütunu,
  sert vuruşta ekrana su damlası (`#lens`) ve titreşim. Sarsıntı ayarı KAPALI ise damla da çıkmaz.
- **Her haritanın kendi engeli:** girdap sadece Yağmur Ormanı'nda (Ay Işığı'ndan kaldırıldı), düşen kaya sadece
  Kızıl Kanyon'da (inişte toz bulutu). Ateş Dağı yeniden yapıldı: **lav gayzerleri** (önce turuncu işaret, sonra
  ateş sütunu fışkırır) ve suda sürüklenen **akkor magma kabukları**; ufukta duman tüten, her 9-15 sn'de patlayan
  **yanardağ** (`src/landmark.js`). Taş yağmuru ve girdap volkandan çıkarıldı.
- **Yağmur ormanı sık:** kıyı başına ağaç sayısı ~2 katı (`decorCount` + yeni `extraDecor`, `terrain.js`).
- `test/sim.mjs`: `START=9300 node test/sim.mjs` ile istenen haritadan başlatılabilir.
- **Oturanların ayakları teknenin tabanında (v2.7.1):** botlarda, yelkenlide ve yatta ayaklar tabanın 10-15 cm altına
  batıyordu. Artık her koltuk için tekne tabanı ışınla ölçülüyor (`crew.js` `measureFloor`), bacaklar IK ile tabana
  basıyor ve ayak düz duruyor (`plantFeet`). Yelkenlide dümenci biraz döndürüldü. Kontrol: `node test/raftview/build.mjs`,
  sayfada `vessel('sail'); floors()`.

## Engel çıkma kuralları (`src/obstacles.js` `makeRow`)
- İlk **90 m** engel yok. Zorluk `lvl = mesafe / 3200` (3.200 m'de tavana ulaşır).
- Sıralar arası süre 1,6 sn'den 0,55 sn'ye iner; geçiş boşluğu 4,8 m'den 2,95 m'ye daralır; güvenli yol her sırada
  bir öncekinden en fazla bir sıçrama kadar kayar (her zaman geçilebilir).
- Her sıra ağırlıklı kurayla bir desen seçer. Her haritada: tek kaya (giderek azalır), çift kaya, kapı (giderek artar),
  zigzag (600 m sonrası), mola sırası. Haritaya özgü ağırlıklar `biomes.js` → `obstacles`:

| Harita (başlangıç) | Öne çıkan engeller |
|---|---|
| Yeşil Vadi (0 m) | kaya, kütük, kayık, şamandıra, köprü, varil, slalom |
| Sonbahar Ormanı (800 m) | kütük ağırlıklı, akıntıda sürüklenen kütükler |
| Kızıl Kanyon (1.900 m) | en çok kaya, **düşen kaya** (suda kırmızı işaret) |
| Yağmur Ormanı (3.300 m) | **girdap** (sadece burada), kütük |
| Karlı Zirveler (5.000 m) | **buz kütleleri** |
| Ay Işığı (7.000 m) | **şamandıra hatları**, kayıklar, gece |
| Ateş Dağı (9.300 m) | **lav gayzeri**, **magma kabuğu** |
| 11.900 m → | Yeşil Vadi'den tekrar başlar (zorluk tavanda kalır) |

- Adalet kuralları: hareketli bir tehlikeden (sürüklenen kütük, girdap, buz, kayık, varil, magma) sonra gelen sıra
  kolaydır (tek/çift kaya) ve %20 daha uzaktadır. Girdap, zigzag, köprü, şamandıra, kayık arka arkaya gelmez (kapıya döner).
  Harita geçiş takının ±14 m çevresinde sadece hafif desen. Köprüler en az 240 m arayla.
- Altın: sıraların %62'sinde güvenli yol üzerinde 4-6 altın. Kalkan / mıknatıs: 320 m sonrası, en az 380 m arayla, %12 şans.

## v2.6 — yönetici modu
- Test için yönetici paneli (yukarıda). Sadece `node build.mjs --admin` ile derlemeye girer.

## v2.5 — oyun hissi (game-feel + game-ui-ux skill'leri)
- **Sarsıntı:** rastgele titreme yerine "trauma" tabanlı yumuşak sarsıntı (sinüs karışımı + hafif yatma). Darbeler birbirine eklenir, gerçek zamanla söner.
- **Hit-stop:** batınca 0,12 sn, kalkan/zırh kırılınca 0,05 sn donma. Üst üste gelirse en uzunu geçerli, oyun mantığı bozulmaz.
- **Kıl payı:** küçük sarsıntı + kısa titreşim; x3 kombodan sonra kısa ağır çekim ve daha güçlü titreşim.
- **HUD pop:** altın ve skor sayacı ezilip-esneyerek zıplıyor (kıl payı, kapı, altın).
- **Titreşim:** batma, kalkan, zırh, dalış, güçlendirme, kapı.
- **Ayarlar (duraklat ekranı):** Ekran sarsıntısı TAM / AZ / KAPALI, Titreşim AÇIK / KAPALI (`akinti_feel_v1`). Sistemde "hareketi azalt" açıksa sarsıntı AZ başlar.
- **Arayüz:** yatay ekranda çentik için sol/sağ güvenli alan, klavye odağı (duraklatınca DEVAM ET, oyun sonunda TEKRAR OYNA seçili), odak çerçevesi; Enter artık çift yeniden başlatma yapmıyor.
- Kod: `src/feel.js` (yeni), `main.js` içinde `feel.*` çağrıları, `template.html` stilleri ve ayar düğmeleri.

## v2.4 — tekneler (BOT sekmesi)
Mağazada BOT sekmesi artık tekne seçiyor; eski bot desenleri DESEN sekmesinde ve her tekneye uygulanıyor.
Tüm tekneler rafting botuyla aynı çarpışma alanını kullanır: hiçbiri oyunu zorlaştırmaz. Her birinin bir yeteneği var.

| Tekne | Fiyat | Yetenek |
|---|---|---|
| Rafting Botu | ücretsiz | — (5 kişi kürek çeker) |
| Gelişmiş Bot (motorlu RIB) | 1.000 | Altın +%10 |
| Yelkenli | 2.500 | Rüzgâr: yakındaki altınları kendiliğinden çeker · Altın +%20 |
| Yarış Yatı | 5.000 | Kalkan ve mıknatıs 2 kat uzun · Altın +%35 |
| Gemi | 10.000 | Zırh: her turda bir çarpmayı affeder · Altın +%50 |
| Denizaltı | 20.000 | Dalış: çarpacağın an dalar, engelin altından geçer (20 sn bekleme) · Altın ×2 |

- Kod: `src/vessels.js` (gövde üreticisi, RIB, yelkenli, yat, denizaltı; gemi Kenney modelinden), `Raft.setVessel`, ekip pozları `Rafter.place / updateStill`.
- Yetenekler `shop.js` CATALOG.boat `perk` alanında; oyun içi etkileri `main.js` (`S.perk`).

## v2.3 — bot ve su düzeltmeleri
- Bot tüpünün yüzey yönü tersti (dışarıdan bakınca tüpün iç duvarı görünüyordu): bot yarı saydam, suya gömülü ve yazısı ters görünüyordu. Düzeltildi.
- Su artık botun içinde görünmüyor; botun çevresinde gövdeyi saran köpük, burunda köpük yastığı, dönüşte yan köpük ve temas gölgesi var.
- Dalga vurması: birkaç saniyede bir dalga burna çarpıyor, bot burnunu kaldırıp geri düşüyor, su perdesi, sis ve yan şapırtı. Akıntılı yerlerde daha sık.
- Mağaza tablet ve yatay ekranda yan panel olarak açılıyor.

## Dosyalar
- `src/shop.js` — mağaza kataloğu, cüzdan/kayıt, mağaza arayüzü
- `src/biomes.js` — 7 ortamın renkleri, ışık/gece ayarları, hava durumu, ağaçlar ve engel ağırlıkları
- `src/config.js` — nehir genişliği, arena uzunlukları (`BIOME_FIRST` 800 m, her arena `BIOME_GROW` 300 m daha uzun), hız eğrisi `speedAt`
- `src/obstacles.js` — engel dizilimleri ve çarpışma, altın, güçlendirmeler, slalom kapıları
- `src/crew.js` — kürekçiler: kıyafet, yelek, kask, kürek, IK animasyonu
- `src/raft.js` — raft modeli ve ekip yerleşimi
- `src/water.js` — su shader'ı; `src/post.js` — HDR/bloom ve suyun yansıma geçişi
- `src/landmark.js` — Ateş Dağı ufkundaki patlayan yanardağ
- `src/feel.js` — sarsıntı, vuruş donması, titreşim; `src/admin.js` — yönetici paneli (sadece `--admin`)
- `src/terrain.js`, `src/geom.js` — kıyı arazisi, ağaçlar, çimen, fenerler, kıyıdaki tekneler
- `src/assets.js` — gömülü GLB modellerin yüklenmesi
- `assets/` — optimize edilmiş modeller; `tools/` — modelleri yeniden üretme betikleri
- `test/sim.mjs` — ekransız bot simülasyonu: `node test/sim.mjs 40 5000` engel dizilimlerinin geçilebilirliğini ölçer

## Krediler (ikisi de CC0)
- Karakterler: Quaternius — Universal Base Characters (quaternius.com)
- Kayıklar, şamandıralar, iskele, varış takı: Kenney — Watercraft Kit (kenney.nl)

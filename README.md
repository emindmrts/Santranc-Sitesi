# santranc.net

Tarayıcıdan açıp direkt oynayabildiğin bir satranç sitesi. Reklam yok, üyelik yok, indirilecek bir şey yok.

Bir hackathon için yaptım. Satranç tarafında özel bir geçmişim yok, amaç kısa sürede çalışan, sade ve kullanması kolay bir şey çıkarmaktı.

## Ne yapabiliyorsun?

- Bilgisayara karşı oynarsın. Arkada Stockfish 16 NNUE çalışıyor, WebAssembly ile tarayıcının içinde. Hamle için sunucuya hiçbir şey gitmiyor.
- Arkadaşınla aynı ekranda sırayla oynarsın.
- 4 zorluk var: Çırak (~1350), Kulüp (~1900), Usta (~2600), Şampiyon (full güç, ~3500).
- Süre seçebilirsin: Bullet 1 dk, Blitz 3+2, Rapid 15 dk, Classic 30 dk ya da süresiz.
- Hamle geçmişinden istediğin yere dönüp pozisyona bakabilirsin.
- FEN ve PGN olarak dışarı aktarabilirsin.
- Morphy, Anderssen, Legall, Réti gibi isimlerin oyunlarını açıp hamle hamle izleyebilirsin.
- Maç bitince analiz ekranında hatalarına bakabilirsin.
- Takılırsan ipucu butonu en iyi hamleyi tahtada gösteriyor.
- Taş sesleri var. Klavye ve ekran okuyucu desteği de var (ARIA etiketleri eklendi).

## Arka tarafta ne var?

TypeScript + Vite, stil için düz CSS. Runtime'da hiçbir bağımlılık yok. Stockfish bir Web Worker içinde çalıştığı için arayüz donmuyor.

Kural kısmını hazır kütüphaneyle yapmadım, `engine.ts` içinde kendim yazdım: FEN okuma/yazma, yasal hamleler, rok, geçerken alma, terfi, şah, pat, üçlü tekrar, 50 hamle kuralı, yetersiz materyal. Aynı dosyada alfa-beta arama, quiescence search, null-move pruning, konum değerlendirmesi ve PGN üretimi de var.

## Çalıştırmak için

```bash
npm install
npm run dev
```

Build almak için:

```bash
npm run build
```

## Yapay zeka meselesi

Geliştirirken OpenCode üzerinden GLM 5.2 ve DeepSeek Flash modellerini kullandım, özellikle bazı algoritmalarda, arayüzde ve hata ayıklarken. Ama çıkanı olduğu gibi koymadım, kendim denedim, bozuk yerleri düzelttim.

## Lisans

Kendi kodum MIT. Stockfish GPLv3.

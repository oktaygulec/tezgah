# Tezgah Kullanım Kılavuzu

Tezgah, dükkan için küçük bir satış ve etiket programıdır. İnternet gerekmez.

## Programı başlatma

1. `Tezgah.exe` dosyasını bir klasöre koyun. Örnek: `C:\Tezgah`.
2. `Tezgah.exe` dosyasına çift tıklayın.
3. Siyah bir pencere açılır. Bu pencereyi kapatmayın. Pencere kapanırsa program durur.
4. Tarayıcı kendiliğinden açılır. Açılmazsa tarayıcıya `http://localhost:5757` yazın.

Program zaten açıksa, yeniden çift tıklamak sadece tarayıcıyı açar.

Veriler `Tezgah.exe` ile aynı klasördeki `data` klasöründe durur.

## Windows uyarısı (SmartScreen)

İlk açılışta Windows mavi bir uyarı gösterebilir: "Windows bilgisayarınızı korudu".

1. **Ek bilgi** yazısına tıklayın.
2. **Yine de çalıştır** düğmesine tıklayın.

Bu uyarı bir kez çıkar.

## Barkod okutma

Barkod okuyucu, barkodu yazar ve Enter tuşuna basar.

- **Satış** ve **Fiyat Gör** ekranlarında okutma kutusu her zaman hazırdır. Önce tıklamanız gerekmez.
- Ürün formunda barkod kutusuna okutursanız barkod kutuya yazılır.

## Satış

1. **Satış** sekmesini açın.
2. Ürünleri okutun. Aynı ürünü tekrar okutursanız adet 1 artar.
3. Adedi **−** ve **+** düğmeleriyle değiştirin. Satırı silmek için **Kaldır** düğmesine basın.
4. **Siparişi Tamamla** düğmesine basın. Sipariş numarası ekranda görünür.

Siparişi silmek için **Siparişi İptal Et** düğmesine basın ve onaylayın.

Ürün kayıtlı değilse kısa bir uyarı sesi çıkar. Ekranda "Ürün bulunamadı" yazar. **Ürün Ekle** ile ürünü hemen kaydedebilirsiniz.

Sayfa yenilenirse yarım kalan sipariş kaybolmaz.

## Fiyat Gör

Ürünü okutun. Ürün adı ve fiyatı büyük yazıyla görünür. Bu ekran siparişe bir şey eklemez.

## Ürünler

- **Yeni Ürün**: barkod, ad ve fiyat girin. Fiyatı `12,50` veya `12.50` olarak yazabilirsiniz.
- Ürünün barkodu yoksa **Barkod oluştur** düğmesine basın. Program dükkana özel bir barkod verir.
- **Düzenle** ve **Sil** düğmeleri her satırdadır. Siparişte kullanılmış bir ürün silinemez.
- **CSV İçe Aktar**: `barkod;ad;fiyat` biçiminde bir dosya seçin. Hatalı satırlar ekranda listelenir.
- **CSV Dışa Aktar**: tüm ürünleri Excel ile açılabilen bir dosyaya kaydeder.

## Etiket yazdırma

1. **Etiket** sekmesini açın. Ya da **Ürünler** ekranında **Bu ürünü etiketle** düğmesine basın.
2. Etiketlenecek ürünlerin kutusunu işaretleyin.
3. Her ürün için kaç etiket istediğinizi yazın.
4. **Yazdır** düğmesine basın.
5. Yazdırma penceresinde termal yazıcıyı seçin. Ayarları aşağıdaki gibi yapın.
6. **Yazdır** düğmesine basın.

Etiket boyutunu **Ayarlar** ekranında değiştirebilirsiniz. Varsayılan boyut 40 x 30 mm'dir.

## Termal yazıcı ayarı

Kağıt boyutu, yazıcıdaki etiket boyutu ile aynı olmalı. Örnek: 40 x 30 mm.

### Windows yazıcı ayarı (bir kez yapılır)

1. **Başlat** menüsünü açın. **Yazıcılar ve tarayıcılar** yazın ve açın.
2. Termal yazıcıyı seçin. **Yazdırma tercihleri** düğmesine basın.
3. Kağıt (Stock veya Page Size) bölümünde yeni bir boyut ekleyin: genişlik 40 mm, yükseklik 30 mm.
4. Bu boyutu seçin ve **Tamam** düğmesine basın.

Ayar adları yazıcı markasına göre değişebilir.

### Chrome yazdırma penceresi

1. **Hedef**: termal yazıcıyı seçin.
2. **Diğer ayarlar** bölümünü açın.
3. **Kağıt boyutu**: etiket boyutunu seçin (örnek: 40 x 30 mm).
4. **Kenar boşlukları**: **Yok**.
5. **Ölçek**: **Özel**, **100**.
6. **Üstbilgi ve altbilgi** kutusunu boş bırakın.

Chrome bu ayarları bir sonraki yazdırma için hatırlar.

Barkod bulanık veya kesik çıkarsa, ölçeğin 100 olduğunu kontrol edin.

## Siparişler

**Siparişler** ekranı seçilen günün siparişlerini gösterir. En yeni sipariş en üsttedir. Satırları görmek için siparişe tıklayın.

## Yedekleme

Program her açılışta `data\backups` klasörüne bir yedek alır. Son 30 yedek saklanır.

Kendi yedeğinizi almak için:

1. Programı kapatın (siyah pencereyi kapatın).
2. `data` klasörünü kopyalayın. Örnek: bir USB belleğe.

**Ayarlar** ekranındaki **Veritabanı yedeği indir** düğmesi de bir yedek dosyası indirir.

Yedeği geri yüklemek için: programı kapatın. Yedek dosyasını `data\tezgah.db` adıyla kopyalayın. Programı açın.

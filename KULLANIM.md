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
- Barkod başka bir üründe kayıtlıysa form hemen uyarır ve o ürünün adını gösterir. Bu durumda ürün kaydedilmez. **Mevcut ürünü düzenle** düğmesi kayıtlı ürünü açar.
- Hatalı bir alan kırmızı olur. Alanın altında ne yapmanız gerektiği yazar.
- **Düzenle** ve **Sil** düğmeleri her satırdadır. Siparişte kullanılmış bir ürün silinemez.
- **CSV İçe Aktar**: `barkod;ad;fiyat` veya `barkod;ad;fiyat;stok` biçiminde bir dosya seçin. Hatalı satırlar ekranda listelenir.
- **CSV Dışa Aktar**: tüm ürünleri Excel ile açılabilen bir dosyaya kaydeder.

## Stok

Her ürünün stoğu adet olarak tutulur. Stok **Ürünler** listesinde **Stok** sütununda görünür. Stoğu 0 veya daha az olan ürün kırmızı görünür. **Fiyat Gör** ekranı da stoğu gösterir.

- Satış tamamlanınca satılan adetler stoktan düşer.
- Satış stok yetersiz olsa da yapılır. Bu durumda stok eksiye düşer. Sayım ile düzeltin.
- Sipariş iptal edilince satılan adetler stoğa geri eklenir.
- Yeni ürün eklerken **Başlangıç stoğu** yazabilirsiniz.
- Sadece stoğu biten ürünleri görmek için **Ürünler** ekranında **Stoğu bitenler** kutusunu işaretleyin.

### Mal girişi (okutarak)

1. **Stok Girişi** sekmesini açın.
2. Gelen ürünleri okutun. Aynı ürünü tekrar okutmak adedi 1 artırır.
3. Gerekirse **Gelen adet** kutusuna adedi yazın. Örnek: 24.
4. İsterseniz **Not** kutusuna tedarikçi veya fatura numarasını yazın.
5. **Stoğa Ekle** düğmesine basın.

Liste, **Stoğa Ekle** düğmesine basılana kadar stoğu değiştirmez. Sayfa yenilense de liste kaybolmaz.

### Tek ürünün stoğunu değiştirme

1. **Ürünler** ekranında ürünün satırındaki **Stok** düğmesine basın.
2. İşlemi seçin:
   - **Ekle**: gelen malı ekler.
   - **Çıkar**: bozuk veya kayıp malı düşer.
   - **Sayım sonucu**: saydığınız adedi stok olarak yazar.
3. Adedi ve isterseniz bir not yazın. **Yeni stok** değerini kontrol edin.
4. **Kaydet** düğmesine basın.

Aynı pencerede **Stok geçmişi** görünür: her satış, iptal, giriş ve sayım tarih ve notuyla listelenir.

### CSV ile stok

CSV dosyasına 4. sütun olarak `stok` ekleyebilirsiniz: `barkod;ad;fiyat;stok`. Bu sütunda değer olan ürünün stoğu o değere ayarlanır. Değer boşsa stok değişmez. **CSV Dışa Aktar** stok sütununu da yazar.

## Yazıcıyı ayarlama (bir kez yapılır)

Tezgah etiketleri yazıcıya doğrudan gönderir. Yazdırma penceresi açılmaz. Kağıt boyutu ve yön ayarı gerekmez.

1. **Ayarlar** sekmesini açın.
2. **Etiket genişliği** ve **Etiket yüksekliği** kutularına rulodaki etiketin ölçüsünü yazın. Örnek: 60 ve 30.
3. **Etiket yazıcısı** listesinden yazıcıyı seçin. Örnek: **Xprinter XP-470B**.
4. **Kaydet ve deneme etiketi yazdır** düğmesine basın.
5. Çıkan etiketi kontrol edin:
   - Baskı ters ise **Etiketi 180° çevir** kutusunu işaretleyin.
   - Baskı kaymış ise **Sağa kaydır** veya **Aşağı kaydır** değerini değiştirin. Eksi değer sola veya yukarı kaydırır.
   - Baskı soluk ise **Baskı koyuluğu** değerini artırın (en çok 15).
   - Etiketin yarısına basıyorsa veya etiket atlıyorsa **Etiketler arası boşluk** değerini değiştirin (çoğu ruloda 2 veya 3).
6. Etiket düzgün çıkana kadar 4. ve 5. adımları tekrarlayın.

Yazıcı listede yoksa yazıcıyı açın, USB kablosunu kontrol edin ve **Yenile** düğmesine basın.

Bu yöntem TSPL dilini anlayan termal yazıcılar içindir (Xprinter, TSC ve benzerleri). Yazıcı başka bir dil kullanıyorsa listeden **Yazıcı yok** seçeneğini seçin. Bu durumda Tezgah tarayıcının yazdırma penceresini kullanır.

## Etiket yazdırma

1. **Etiket** sekmesini açın. Ya da **Ürünler** ekranında **Bu ürünü etiketle** düğmesine basın.
2. Etiketlenecek ürünlerin kutusunu işaretleyin.
3. Her ürün için kaç etiket istediğinizi yazın.
4. **Yazdır** düğmesine basın.

Etiketler hemen yazıcıdan çıkar. Önizleme, yazıcıdan çıkacak etiketin aynısıdır.

**Tarayıcı ile yazdır** düğmesi tarayıcının yazdırma penceresini açar. Bu düğmeyi yalnızca doğrudan yazdırma çalışmazsa kullanın. Pencerede kağıt boyutunu etiket ölçüsüne ayarlayın. Kenar boşluklarını **Yok**, ölçeği **100** yapın.

## Siparişler

**Siparişler** ekranı seçilen günün siparişlerini gösterir. En yeni sipariş en üsttedir. Satırları görmek için siparişe tıklayın.

### Siparişi iptal etme

1. Siparişe tıklayın.
2. **Siparişi İptal Et** düğmesine basın ve onaylayın.

İptal edilen sipariş listede **İPTAL** olarak kalır. Günün toplamına eklenmez.

### Siparişi silme

Yalnızca iptal edilmiş bir sipariş silinebilir.

1. İptal edilmiş siparişe tıklayın.
2. **Siparişi Sil** düğmesine basın ve onaylayın.

Silinen sipariş geri gelmez. Sipariş numarası başka bir siparişe verilmez.

## Güncelleme

İnternet bağlantısı gerekir.

1. **Ayarlar** sekmesini açın.
2. **Güncelleme** bölümünde **Güncellemeleri denetle** düğmesine basın.
3. Yeni sürüm varsa **Güncelle ve yeniden başlat** düğmesine basın ve onaylayın.
4. Bekleyin. Siyah pencere kapanır ve yenisi açılır. Sayfa kendiliğinden yenilenir.

Ürünler, siparişler ve yarım kalan sipariş korunur.

Güncelleme sırasında siyah pencereyi kapatmayın.

## Yedekleme

Program her açılışta `data\backups` klasörüne bir yedek alır. Son 30 yedek saklanır.

Kendi yedeğinizi almak için:

1. Programı kapatın (siyah pencereyi kapatın).
2. `data` klasörünü kopyalayın. Örnek: bir USB belleğe.

**Ayarlar** ekranındaki **Veritabanı yedeği indir** düğmesi de bir yedek dosyası indirir.

Yedeği geri yüklemek için: programı kapatın. Yedek dosyasını `data\tezgah.db` adıyla kopyalayın. Programı açın.

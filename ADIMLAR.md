# barutherstr. 18 - TAM KURULUM

Şifreli, özel site. Feed, About, Residents bölümleriyle.

---

## NETLIFY'A YÜKLEME (SEN BURDASIN)

### 1. GitHub Private Repo Oluştur

**GitHub.com'a git:**
- Sağ üst **+** → **New repository**
- İsim: `baruther-blog`
- **PRIVATE** seç ⚠️
- **Create repository**

**Dosyaları yükle:**
- "uploading an existing file" linkine tıkla
- Bu 4 dosyayı sürükle:
  - index.html
  - style.css
  - script.js
  - robots.txt
- **Commit changes**

---

### 2. Netlify'a Bağla

**app.netlify.com'a git:**
- Zaten giriş yaptın

**Site ekle:**
- **Add new site** (ya da **Import from Git**)
- **GitHub** seç
- İzin ver (Authorize Netlify)
- **baruther-blog** repo'sunu seç
- Hiçbir şey değiştirme
- **Deploy site** bas

⏱️ 1-2 dakika bekle...

**Test et:**
- Netlify'da site adını göreceksin: `random-name-12345.netlify.app`
- Linke tıkla
- Şifre: **baruther**

---

### 3. Domain Bağla (Netlify'da)

**Netlify site ayarlarında:**
- **Domain settings** (sol menüde)
- **Add custom domain** tıkla
- `baruther-ev.online` yaz
- **Verify** tıkla

Netlify sana DNS kayıtlarını gösterecek. Kopyala.

---

### 4. Porkbun DNS Ayarla

**porkbun.com → Domain Management:**
- **baruther-ev.online** bulup **DNS** tıkla

**Eski kayıtları sil** (varsa A ve CNAME'ler)

**Netlify'ın verdiği kayıtları ekle:**

Genelde şunlar:
```
Type: CNAME
Host: @
Answer: [netlify-verdiği-adres].netlify.app
```

Ya da:
```
Type: A
Host: @
Answer: [Netlify IP]
```

(Netlify'da gösterilen DNS kayıtlarını AYNEN yapıştır)

⏱️ 10 dakika - 2 saat bekle

**Test:**
- https://baruther-ev.online
- Şifre: **baruther**

---

## FOTOĞRAF YÜKLEME

### 1. Fotoğrafları Hazırla
- Max 2000px genişlik
- JPG formatı
- İsimler basit: `photo-1.jpg`, `photo-2.jpg`
- Türkçe karakter yok (ı→i, ş→s, ç→c)
- Boşluk yok (my photo.jpg → my-photo.jpg)

---

### 2. GitHub'a Yükle

**Repo'na git:**
- github.com/KULLANICI-ADIN/baruther-blog

**Fotoğraf yükle:**
- **Add file** → **Upload files**
- Fotoğrafları sürükle
- **Commit changes**

⚠️ **PRIVATE REPO** = Fotoğraflar sadece senin görürsün

---

### 3. index.html'e Ekle

**index.html'i düzenle:**
- Repo'da **index.html** tıkla
- Sağ üstte **kalem** ikonu (Edit)
- Şu satırı bul:
  ```html
  <!-- ADD YOUR IMAGES HERE -->
  ```

**Her fotoğraf için şunu kopyala-yapıştır:**
```html
<div class="image-container">
    <img src="photo-1.jpg" alt="">
</div>
```

`photo-1.jpg` yerine kendi foto adını yaz.

**Örnek:**
```html
<!-- ADD YOUR IMAGES HERE -->

<div class="image-container">
    <img src="berlin-winter.jpg" alt="">
</div>

<div class="image-container">
    <img src="studio-night.jpg" alt="">
</div>

<div class="image-container">
    <img src="friends-dinner.jpg" alt="">
</div>
```

**Kaydet:**
- Altta **Commit changes** bas

⏱️ 1 dakika sonra Netlify otomatik deploy edecek

---

## ABOUT VE RESIDENTS DÜZENLE

### About yazısını değiştir:

**index.html'de şunu bul:**
```html
<!-- ABOUT SECTION -->
```

Altındaki yazıları düzenle:
```html
<p>
    Buraya kendi yazını yaz...
</p>
```

### Residents ekle:

**index.html'de şunu bul:**
```html
<!-- RESIDENTS SECTION -->
```

Her kişi için kopyala:
```html
<div class="resident-item">
    <h3>İsim Soyisim</h3>
    <p>Açıklama / Rol</p>
</div>
```

---

## NAVİGASYON NASIL ÇALIŞIR

- **Feed:** Fotoğraf galerisi (ana sayfa)
- **About:** Hakkında yazısı
- **Residents:** Kişiler listesi

Menüye tıklayınca bölümler değişir.

---

## ŞİFRE DEĞİŞTİRME

**script.js'i düzenle:**
- Repo'da **script.js** tıkla
- **Edit** (kalem)
- İlk satır:
  ```javascript
  const CORRECT_PASSWORD = 'baruther';
  ```
- `'baruther'` yerine yeni şifreni yaz
- **Commit changes**

---

## SORUN ÇIKARSA

**Fotoğraf görünmüyor:**
- Dosya adı HTML'de yazdığınla TAM AYNI mı?
- Büyük/küçük harf önemli: `Photo.jpg` ≠ `photo.jpg`

**Site açılmıyor:**
- DNS 24 saat kadar sürebilir
- Netlify'da deploy tamamlandı mı kontrol et

**Netlify deploy etmiyor:**
- GitHub'da dosyalar var mı kontrol et
- Netlify → Deploys sekmesinde hata var mı bak

---

Başka soru olursa sor! 🚀

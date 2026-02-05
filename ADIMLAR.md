# TEK TEK ADIMLAR - baruther-ev.online

## 1️⃣ GITHUB'A DOSYALARI YÜKLE

### GitHub'a git:
https://github.com

### Yeni repo oluştur:
- Sağ üstte **+** → **New repository**
- İsim: `baruther-blog` (ya da ne istersen)
- **Public** seç
- **Create repository** tıkla

### Dosyaları yükle:
- "uploading an existing file" linkine tıkla
- Bu 5 dosyayı sürükle:
  ✓ index.html
  ✓ style.css
  ✓ script.js
  ✓ robots.txt
  ✓ README.md
- **Commit changes** tıkla

---

## 2️⃣ GITHUB PAGES AKTİF ET

### Settings'e git:
- Repo sayfasında üstte **Settings** sekmesi

### Pages'i aç:
- Sol menüden **Pages** bul, tıkla

### Aktif et:
- **Source:** "Deploy from a branch" seç
- **Branch:** "main" seç
- Yanındaki klasör: **/ (root)** kalsın
- **Save** tıkla

### Domain ekle:
- Aynı sayfada **Custom domain** kutusuna yaz:
  ```
  baruther-ev.online
  ```
- **Save** tıkla
- **Enforce HTTPS** kutucuğunu işaretle (sonra aktif olacak)

---

## 3️⃣ PORKBUN'DA DNS AYARLA

### Porkbun'a giriş yap:
https://porkbun.com → **Account** → **Domain Management**

### baruther-ev.online'ı bul:
- Listede domain'ini bul
- **DNS** butonuna tıkla

### Eski kayıtları sil (varsa):
- A record'ları sil
- CNAME'leri sil (sadece DNS kısmında, domain yönlendirmesi değil)

### YENİ A RECORD EKLE - 1:
- **Type:** A
- **Host:** @ (veya boş bırak)
- **Answer:** `185.199.108.153`
- **Add** tıkla

### YENİ A RECORD EKLE - 2:
- **Type:** A
- **Host:** @
- **Answer:** `185.199.109.153`
- **Add** tıkla

### YENİ A RECORD EKLE - 3:
- **Type:** A
- **Host:** @
- **Answer:** `185.199.110.153`
- **Add** tıkla

### YENİ A RECORD EKLE - 4:
- **Type:** A
- **Host:** @
- **Answer:** `185.199.111.153`
- **Add** tıkla

### YENİ CNAME EKLE (www için):
- **Type:** CNAME
- **Host:** www
- **Answer:** `KULLANICI-ADIN.github.io` (kendi GitHub kullanıcı adınla değiştir)
- **Add** tıkla

---

## 4️⃣ BEKLE

⏱️ **10 dakika - 2 saat** bekle (DNS yayılması için)

Test et:
- https://baruther-ev.online
- Şifre ekranı çıkmalı
- Şifre: **baruther**

---

## 5️⃣ FOTOĞRAF EKLE

### Fotoğrafları hazırla:
- Max 2000px genişlik
- JPG formatı
- Basit isimler: `photo-1.jpg`, `photo-2.jpg`

### GitHub'a yükle:
- Repo'ya git
- **Add file** → **Upload files**
- Fotoğrafları sürükle
- **Commit changes**

### index.html düzenle:
- Repo'da **index.html** tıkla
- Sağ üstte **kalem** ikonu (Edit)
- `<!-- ADD YOUR IMAGES HERE -->` kısmını bul
- Her foto için kopyala-yapıştır:

```html
<div class="image-container">
    <img src="photo-1.jpg" alt="">
</div>
```

- `src="photo-1.jpg"` yerine kendi fotoğraf adını yaz
- Altta **Commit changes** tıkla

---

## ÖNEMLİ NOTLAR

✓ **Google'da çıkmayacak** - robots.txt ve meta tag ekli
✓ **Şifre:** baruther (değiştirmek için script.js'i düzenle)
✓ **Fontlar:** Arial + Georgia (basit, hızlı)
✓ **HTTPS:** Birkaç dakika sonra aktif olacak (GitHub otomatik halleder)

---

## SORUN ÇIKARSA

**Sayfa açılmıyor:**
- 2 saat bekle (DNS)
- GitHub Pages aktif mi kontrol et

**HTTPS hatası:**
- GitHub'da "Enforce HTTPS" işaretli mi?
- 10 dakika bekle, yenile

**Fotoğraf görünmüyor:**
- Dosya adı index.html'de yazdığınla aynı mı?
- Büyük/küçük harf duyarlı

---

Başka soru olursa sor! 🚀

# Do'kon CRM

Do'konlar uchun AI yordamchisi bilan ishlaydigan savdo, ombor va qarz tizimi.
Mobil ilova (React Native / Expo) + o'z serveringiz (Node + Postgres) + Groq AI.

## Nima qila oladi

**AI buyruq paneli** — oddiy gap yozasiz, tizim tushunadi:

| Yozasiz | Tizim nima qiladi |
|---|---|
| `2 kg piyoz sotildi` | Bazadan piyoz narxini oladi, 10 000 so'm hisoblaydi, ombordan 2 kg ayiradi, kunlik kirimga qo'shadi |
| `Alisherga 50 ming qarz berdim, 10 kundan keyin to'laydi` | Alisherni topadi (yoki ochadi), qarzni muddati bilan yozadi |
| `Dilnoza qarzidan 100 ming to'ladi` | Qarz balansidan ayiradi |
| `Transportga 30 ming chiqim` | Kunlik chiqimga yozadi |
| `Omadan 50 kg shakar keldi, 11 mingdan` | Omborga kirim qiladi, tan narxni yangilaydi |

**Muhim:** AI hech qachon so'ramasdan bazaga yozmaydi. U faqat *tayyorlaydi* —
ekranda "nima yoziladi" ko'rsatiladi, siz **Tasdiqlash** tugmasini bosgandan
keyingina yoziladi.

Boshqa imkoniyatlar:
- **Rasmdan mahsulot tanish** — mahsulotni suratga olasiz, AI nomi, kategoriyasi
  va o'lchov birligini to'ldiradi (narxni o'zingiz kiritasiz — AI bozor narxini bilmaydi)
- **O'lchov birliklari** — dona, kg, gram, litr, metr, quti, pachka
- **Qarz daftari** — kim, qancha, qachongacha; muddati o'tganlar ajratib ko'rsatiladi
- **Ombor nazorati** — har bir qoldiq o'zgarishi jurnalga yoziladi, tugayotganlar haqida ogohlantiradi
- **Kunlik tushum/chiqim/foyda** — bosh sahifada va hisobotlarda
- **AI tahlili** — raqamlaringizga qarab nimaga e'tibor berish kerakligini aytadi

## Ishga tushirish

### 1. Baza

```bash
cd dokon-crm
docker compose up -d
```

Postgres **5433**-portda ko'tariladi (5432 da mahsulot bazangiz turgani uchun).

> Bu mashinada `docker-proxy` ishlamagani sababli `network_mode: host` ishlatilgan.
> Shu bois baza portingiz tarmoqqa ochiq bo'ladi. Umumiy Wi-Fi'da ishlatsangiz,
> `docker-compose.yml` dagi parolni albatta almashtiring.

Sxemani qo'llash va sinov ma'lumotlarini to'ldirish:

```bash
cd server
npm install
npm run db:schema
npm run db:seed
```

### 2. Server

```bash
cd server
cp .env.example .env     # GROQ_API_KEY ni kiriting
npm run dev
```

Server `http://0.0.0.0:3000` da ishlaydi.

**AI kalitisiz ham ishlaydi** — savdo, ombor, qarz, hisobot hammasi ishlayveradi,
faqat AI marshrutlari 503 qaytaradi. Kalitni [console.groq.com/keys](https://console.groq.com/keys)
dan olib `.env` ga qo'ying:

```
GROQ_API_KEY=gsk_...
```

### Bir nechta kalit va limitlar

`.env` da bir nechta kalitni vergul bilan yozish mumkin — biri limitga urilsa
tizim avtomatik keyingisiga o'tadi:

```
GROQ_API_KEY=gsk_birinchi,gsk_ikkinchi,gsk_uchinchi
```

> **Muhim:** Groq limitni **kalitga emas, AKKAUNTGA** qo'yadi. Bitta akkauntning
> bir nechta kaliti bir xil kunlik byudjetni bo'lishadi — ular orasida almashish
> kvotani oshirmaydi. Buni tekshirish oson: bitta kalit bilan katta so'rov
> yuborilganda boshqasining `x-ratelimit-remaining-tokens` qiymati ham tushadi.
>
> Almashinuv **har xil akkauntlardan** olingan kalitlarda foyda beradi.

Bepul tarif limitlari (`openai/gpt-oss-120b`):

| Limit | Qiymat |
|---|---|
| Daqiqasiga token (TPM) | 8 000 |
| Kuniga token (TPD) | 200 000 |
| Kuniga so'rov | 1 000 |

**Bitta buyruq = bitta chaqiruv, ~1 500 token.** Kuniga ~130 buyruq (TPD 200 000),
daqiqalik limitga (8 000) esa bemalol sig'adi.

**Nega shunday bo'ldi.** Avval AI ning ixtiyorida `mahsulot_qidir` degan vosita
bor edi va u har bir mahsulotni ALOHIDA qidirardi. To'rt qatorli ro'yxat
("kartoshka / non / piyoz / tuxum") to'rtta Groq chaqiruviga aylanardi, va har
chaqiruvda 1 301 tokenlik vosita sxemasi + butun suhbat tarixi qaytadan
yuborilardi:

| | Vositali agent | Hozirgi (`extract` + SQL) |
|---|---|---|
| Groq chaqiruvi | 4 ta | **1 ta** |
| Token (o'lchangan) | 11 523 | **~1 550** |
| Javob vaqti | 40 s | **~3 s** |
| Daqiqalik limitga (8 000) | **sig'maydi** | sig'adi |

Qidiruv AI dan butunlay olib tashlandi — u bazaning ishi (`dokon_search_products`).
AI faqat matnni JSON ga o'giradi. Qo'shimcha foyda: natija deterministik,
va model biror qatorni jimgina tushirib qoldirmaydi.

Qolgan tejamkorlik choralari:

| O'zgarish | Ta'siri |
|---|---|
| `max_tokens` 4096 → 900 | Groq bu qiymatni limitdan **oldindan band qiladi** |
| Vosita sxemalari olib tashlandi | Har chaqiruvda −1 301 token |
| Xulosani AI emas, kod yozadi | Yakuniy chaqiruv umuman kerak emas |

### Qaysi modellar va nega

Groq'dagi modellar amalda sinab tanlangan:

| Vazifa | Model | Nega |
|---|---|---|
| Buyruq tushunish, tahlil | `openai/gpt-oss-120b` | Strict JSON schema ishonchli, 131k kontekst, `reasoning_effort: low` bilan ~1s |
| Rasmdan mahsulot tanish | `qwen/qwen3.8-27b` | Groq'da rasm qabul qiladigan **yagona** oila |

Muhim cheklovlar:

- **`gpt-oss` modellari rasmni umuman qabul qilmaydi** — `messages[0].content must be
  a string` xatosini qaytaradi. Shuning uchun vision alohida modelda.
- **Groq strict json_schema HAR BIR obyektda `additionalProperties: false` talab
  qiladi** — faqat yuqori qavatga qo'yilsa, ichma-ich sxema 400 bilan rad etiladi
  (`jsonSchema()` uni rekursiv qo'yadi).
- **qwen javobni `<think>…</think>` bilan boshlaydi** — `stripThinking()` uni kesadi.
- **Bepul tarifda limit tez tugaydi.** Limitga urilganda do'konchi tushunadigan
  xabar chiqadi ("Bir-ikki daqiqadan keyin qayta urinib ko'ring"), ilova qulamaydi.

Modelni almashtirmoqchi bo'lsangiz `.env` orqali:

```
GROQ_TEXT_MODEL=openai/gpt-oss-120b     # json_schema (strict) SHART
GROQ_VISION_MODEL=qwen/qwen3.8-27b      # rasm qabul qilishi SHART
```

### 3. Mobil ilova

```bash
cd mobile
npm install
npx expo start
```

Telefonda **Expo Go** ilovasini o'rnatib, QR kodni skanerlang.
Telefon va kompyuter bir Wi-Fi'da bo'lishi shart.

Ilova server manzilini Metro'dan avtomatik oladi. Qo'lda berish kerak bo'lsa:

```bash
EXPO_PUBLIC_API_URL=http://172.20.10.4:3000 npx expo start
```

Server HTTPS da bo'lsa, to'liq manzil bering yoki faqat sxemani almashtiring:

```bash
EXPO_PUBLIC_API_SCHEME=https npx expo start
```

### HTTPS

Server TLS ni qo'llab-quvvatlaydi. `.env` da ikkala yo'l ko'rsatilsa HTTPS da,
bo'sh qoldirilsa oddiy HTTP da ko'tariladi:

```
TLS_KEY=certs/server.key
TLS_CERT=certs/server.crt
```

Mahalliy sertifikat yaratish:

```bash
cd server
npm run cert          # certs/ca.crt va certs/server.crt yaratadi
```

Skript oddiy "self-signed" emas, **mahalliy CA** yaratadi va server sertifikatini
o'sha CA bilan imzolaydi. Sertifikatga `localhost`, `127.0.0.1` va kompyuterning
LAN IP si yoziladi, shuning uchun telefon ham, brauzer ham bir xil ishlaydi.

Tekshirish:

```bash
curl --cacert certs/ca.crt https://localhost:3000/health
```

> `certs/` papkasi `.gitignore` da — maxfiy kalitlar hech qachon git ga tushmaydi.
> Har bir dasturchi o'zida `npm run cert` bilan yaratadi.

#### Telefonda HTTPS: qaysi yo'lni tanlash

Bu yerda muhim nozik joy bor — **qurilma sertifikatga ishonishi kerak**:

| Yo'l | iOS | Android | Izoh |
|---|---|---|---|
| Mahalliy CA (`npm run cert`) | ishlaydi | **ishlamaydi** | Android'da ilovalar foydalanuvchi o'rnatgan CA ga ishonmaydi (API 24+) |
| ngrok tunnel | ishlaydi | ishlaydi | Haqiqiy sertifikat, telefonda hech narsa sozlamaysiz |
| Oddiy HTTP + Expo Go | ishlaydi | ishlaydi | Expo Go oddiy HTTP ga ruxsat beradi — sinash uchun eng sodda |
| Domen + Let's Encrypt | ishlaydi | ishlaydi | Ishlab chiqarish uchun to'g'ri yechim |

**Sinash uchun tavsiya:** oddiy HTTP qoldiring (`.env` da `TLS_KEY` va `TLS_CERT`
ni bo'sh qiling). Expo Go ikkala platformada ham unga ruxsat beradi va hech
qanday sertifikat o'rnatish kerak emas.

**Telefonda HTTPS kerak bo'lsa** — ngrok eng oson:

```bash
ngrok http 3000            # https://xxxx.ngrok-free.app beradi
# keyin mobil tarafda:
EXPO_PUBLIC_API_URL=https://xxxx.ngrok-free.app npx expo start
```

**iOS da mahalliy CA ni o'rnatish** (xohlasangiz):
`certs/ca.crt` ni telefonga yuboring (AirDrop yoki pochta) →
Sozlamalar → Umumiy → VPN va qurilma boshqaruvi → profilni o'rnating →
Sozlamalar → Umumiy → Ma'lumot → **Sertifikatga ishonish sozlamalari** →
"Dokon CRM Local CA" ni yoqing.

**Ishlab chiqarish uchun** — serverni domen bilan joylashtiring va Let's Encrypt
sertifikatini oling (Caddy buni avtomatik qiladi). Shunda ikkala platformada ham
hech qanday qo'shimcha sozlash kerak bo'lmaydi.

### iOS va Android

Kod ikkala platformada ham ishlaydi — klaviatura xatti-harakati, soyalar va
shriftlar `Platform.select` bilan ajratilgan.

**Sinash (ikkala platformada bir xil):** telefonga Expo Go o'rnatib, QR ni
skanerlaysiz. iOS uchun Mac kerak emas.

**Haqiqiy ilova (build) qilish:**

| | Android | iOS |
|---|---|---|
| Linux'dan build | `eas build -p android` | `eas build -p ios` (bulutda) |
| Mac kerakmi | yo'q | yo'q — EAS bulutda kompilyatsiya qiladi |
| Hisob kerakmi | yo'q | Apple Developer, yiliga $99 |

```bash
npm install --global eas-cli
eas login
eas build:configure
eas build --platform android      # yoki ios
```

`app.json` da build uchun kerakli narsalar allaqachon sozlangan:

- `ios.bundleIdentifier` va `android.package` = `uz.dokoncrm.app`
- Kamera va galereya ruxsat matnlari o'zbekcha (iOS'da bularsiz galereya ochilmaydi)
- `NSAllowsLocalNetworking` — server oddiy HTTP orqali ishlagani uchun.
  Expo Go'da bu sezilmaydi, lekin haqiqiy iOS build'da ATS oddiy HTTP ni bloklaydi.

> **Android release APK uchun eslatma:** Android 9+ ham oddiy HTTP ni bloklaydi.
> Serverni HTTPS ga o'tkazing yoki `expo-build-properties` plaginini qo'shib
> `android.usesCleartextTraffic: true` qiling. Eng to'g'ri yechim — serverni
> domen va HTTPS bilan joylashtirish; shunda ikkala platformada ham bu muammo yo'qoladi.

### Sinov hisobi

```
Telefon: +998901234567
Parol:   1234
```

Seed 15 ta mahsulot, 4 ta mijoz va 14 kunlik savdo tarixini yaratadi.

> **`npm run db:seed` seansni bekor qiladi.** Seed do'konni o'chirib qaytadan
> yaratadi — eski `shop_id` yo'qoladi. Ilovada ochiq turgan seans avtomatik
> tugaydi (server 401 qaytaradi) va kirish ekrani chiqadi. Qaytadan kiring.


## Loyiha tuzilishi

```
dokon-crm/
├── docker-compose.yml
├── server/
│   ├── db/schema.sql           Postgres sxemasi + hisobot ko'rinishlari
│   ├── test-api.py             API uchdan-uchgacha sinovi
│   └── src/
│       ├── lib/actions.ts      ⭐ Bazani o'zgartiradigan BARCHA amallar
│       ├── lib/resolve.ts      ⭐ Nomni bazadagi mahsulotga bog'lash (sof SQL)
│       ├── ai/
│       │   ├── client.ts       Groq klienti, model tanlovi, xato tarjimasi
│       │   ├── extract.ts      Matn → JSON (AI ning YAGONA vazifasi)
│       │   ├── agent.ts        extract + resolve ni birlashtiradi
│       │   ├── vision.ts       Rasmdan mahsulot tanish
│       │   └── insights.ts     Savdo tahlili
│       └── routes/             auth, products, sales, debts, reports, ai
└── mobile/
    ├── app/                    Ekranlar (expo-router)
    └── src/
        ├── api/                Server bilan aloqa
        ├── components/         AiCommandBar, Icon, Confirm,
        │                       FilterSheet, CustomerPicker, UI
        ├── lib/                 Aqlli qidiruv (server bilan bir xil qoidalar)
        └── theme/              Rang, oraliq, shrift
```

## Tasdiqlash — pul bilan bog'liq har bir amal

Bazani o'zgartiradigan hech bir amal so'ramasdan bajarilmaydi. Tasdiqlash
oynasida **summa alohida, katta qilib** ko'rsatiladi va nima bo'lishi yoziladi:

```
┌──────────────────────────────────┐
│ 🧾  Savdoni saqlash              │
│                                  │
│  Jami savdo                      │
│  47 500 so'm                     │
│                                  │
│  2 kg Piyoz × 5 000 = 10 000     │
│  1 dona Sut 1L × 12 000 = 12 000 │
│  To'lov: naqd                    │
│  Ombordan ayiriladi, kirimga     │
│  qo'shiladi                      │
│                                  │
│  ⚠ "Piyoz" omborda 1.5 kg qolgan │
│                                  │
│  [ Bekor ]    [ Saqlash ]        │
└──────────────────────────────────┘
```

Qamrab olingan amallar: savdo saqlash, savdoni bekor qilish, qarz berish,
qarz to'lovi, qoldiq to'g'rilash, yangi mahsulot. AI buyruqlari ham xuddi
shu tartibda — avval ko'rsatadi, keyin yozadi.

Summa `amount` maydonida alohida uzatiladi (`src/components/Confirm.tsx`) —
matn ichida yozilsa, uzun ro'yxatda ko'zdan qochib ketishi mumkin edi.

## Mijozli savdo

Bitta mijoz bitta narsa ham, bir nechta har xil mahsulot ham sotib olishi mumkin
— savdo savati cheksiz qator qabul qiladi.

**Mijoz endi har qanday to'lov turida biriktiriladi** (avval faqat qarzda edi):

- Naqd sotganda mijozni belgilash **ixtiyoriy**, lekin foydali
- Qarzga sotganda **shart**
- Yangi ism yozilsa, savdo saqlanganda mijoz avtomatik ochiladi
- Mijoz qidiruvi xato yozilgan ismni ham topadi: `Alsiher` → `Alisher Karimov`

Natijada mijoz sahifasida uning **xaridlar tarixi** paydo bo'ladi: nechta xarid,
jami qancha, qaysi kuni nima olgan — naqd olganlari ham. Qarz tarixi alohida
bo'limda qoladi.

Server: `GET /debts/customer/:id` → `{ balance, history, purchases, jami }`.

## Kunlik savdolar

- **Savdo bo'limi** kunlar bo'yicha guruhlangan: har bir kun sarlavhasida
  o'sha kunning jami savdosi, savdolar soni va foydasi turadi.
- Kun sarlavhasini bosish → **o'sha kunning to'liq manzarasi**: barcha
  savdolar (soati bilan), chiqimlar, qarz harakatlari va kun yakuni.
- Hisobot bo'limidagi kunlar ro'yxati ham shu ekranga olib boradi.

Server tomonida: `GET /reports/day/YYYY-MM-DD`. Kun chegarasi `Asia/Tashkent`
bo'yicha hisoblanadi — aks holda kechqurungi savdo ertangi kunga tushib qolardi.

## Mahsulot filtrlari

Ombor bo'limida **Filtr** tugmasi:

| Filtr | Variantlar |
|---|---|
| Qoldiq holati | hammasi, bor, tugayapti, tugagan |
| O'lchov birligi | dona, kg, gram, litr, metr, quti, pachka |
| Kategoriya | do'kondagi mavjud kategoriyalar |
| Saralash | nom, arzon, qimmat, kam qoldiq, ko'p qoldiq, yangi qo'shilgan |

Har bir variant yonida nechta mahsulot borligi ko'rsatiladi — bo'sh filtrni
bosib, bo'sh ro'yxatga tushib qolmaslik uchun. Yoqilgan filtrlar sarlavha
ostida teg bo'lib turadi, bosib o'chiriladi.

Filtrlash **serverda** bajariladi (`GET /products?status=&unit=&category=&sort=`),
telefonda qayta filtrlanmaydi — ikki joyda ikki xil qoida bo'lmasligi uchun.
Mavjud variantlar: `GET /products/meta/filters`.

## Aqlli qidiruv

Do'konchi nomni to'liq va to'g'ri yozmaydi. Qidiruv shularni qoplaydi:

| Yozadi | Topadi | Nima ishladi |
|---|---|---|
| `piez` | Piyoz | harf tushib qolgan |
| `kartoska` | Kartoshka | `sh` → `s` |
| `kola` | Coca-Cola 1.5L | so'z ichida, `c`/`k` farqi |
| `coca cola` | Coca-Cola 1.5L | defis o'rniga bo'sh joy |
| `osimlik` | O'simlik yog'i 1L | apostrofsiz yozilgan |
| `lazer` | Guruch Lazer 1kg | faqat ikkinchi so'z |
| `kir kukuni` | Kir yuvish kukuni | o'rtadagi so'z tashlangan |
| `пиёз` | Piyoz | kirill alifboda |

### Ikki bosqichli — bu muhim

Qidiruv **har safar taxmin qilmaydi**:

1. **Aniq qidiruv** — aynan moslik, boshlanishi, ichida borligi, so'zma-so'z moslik.
   Bu bosqichda hech qanday taxmin yo'q.
2. **O'xshashlarini qidirish** — faqat birinchi bosqich **hech narsa topmasa**
   ishga tushadi. Xato yozilgan nomlar Levenshtein masofasi bilan topiladi.

Nega shunday? `sut` yozganda `Suv 5L` ni ko'rsatish — shovqin. Aniq moslik bor
ekan, taxminlar aralashtirilmaydi. Taxminiy natijalar qaytganda ilova buni
ochiq aytadi: *"aynan topilmadi — shunga o'xshashlari"*.

```
sut       → Sut 1L                    (aniq)
suv       → Suv 5L                    (aniq)
piez      → Piyoz          ~taxminiy
televizor → hech narsa
```

### Bir mantiq, uch joyda

Qoidalar `server/db/002-search.sql` va `003-search-staged.sql` da yozilgan.
Ulardan foydalanadi:

- **Ombor ekrani** va **qarzdorlar** — REST orqali
- **Buyruq paneli** — ikki joyda: yozayotganda taklif uchun `/products?search=`,
  yuborilgandan keyin `server/src/lib/resolve.ts` orqali (ikkalasi ham AI emas, SQL)
- **Savdo ekrani** — `mobile/src/lib/search.ts` da aynan shu qoidalar takrorlangan
  (mahsulotlar allaqachon yuklangan, shuning uchun qidiruv telefonda — darhol
  ishlaydi; katalog 300 tadan oshsa qolgani serverdan qo'shiladi)

### Savat qatori

Savdo ekranidagi savat qatori kassir uchun ixcham qilingan — avval har qator
~200px joy egallardi (ikkita katta maydon + sarlavhalar) va to'rtta mahsulot
ekranni to'ldirib qo'yardi. Endi ~105px:

```
Piyoz                                    25 000  ✕
[−]  5  [+]  kg  ×  [ 5 000 ] so'm
```

Miqdor ko'pincha bittalab o'zgaradi, shuning uchun `[−]` `[+]` tugmalari bor —
klaviatura ochish shart emas. Aniq son (5.5 kg) kerak bo'lsa raqam ustiga bosib
yoziladi. `[−]` miqdor 1 ga tushganda o'chadi: undan pastga tushirish o'rniga
qatorni `✕` bilan o'chirish kerak.

Qoldiq yetmasa yonida qizil "omborda 71" chiqadi — qator balandligi
o'zgarmaydi, ro'yxat sakramaydi.

### Yozayotganda taklif

Kassir gap yozayotganda mahsulot nomi darhol taklif qilinadi — yuborishdan
oldin. Bu "qaysi kolbasa?" savolini umuman chiqmasligiga olib keladi: nom
allaqachon aniq bo'ladi.

Gapdan mahsulot nomini ajratish qoidasi (`AiCommandBar.tsx` → `mahsulotBolagi`):
oxirgi qatordagi eng oxirgi son yoki o'lchov birligidan **keyingi** so'zlar.
Do'konchilar teskari tartibda ham yozadi, shuning uchun keyin hech narsa
qolmasa **birinchi sondan oldingi** so'zlarga qaytiladi:

```
"2 kg piyoz sotildi"        → piyoz
"3 dona non va 1 litr sut"  → sut          (birinchi mahsulot emas — oxirgisi)
"kartoshka 10 kg"           → kartoshka    (teskari tartib)
"2 ta kolb"                 → kolb         (tugallanmagan)
"Alisherga 50 ming qarz"    → qarz         (mahsulot yo'q — taklif chiqmaydi)
```

Taklif bosilganda nom gapga aniq ko'chiriladi ("2 ta su" → "2 ta Sut 1L").

Uch joyda bir xil natija bo'lishi shart: buyruq paneli topgan mahsulot bilan
do'konchi ekranda ko'rgani bir xil bo'lsin.

> **Qidiruvda AI umuman qatnashmaydi.** Ombor, savdo ekrani va buyruq paneli —
> uchalasi ham `dokon_search_products` ni chaqiradi. AI mahsulot nomini
> ko'rmaydi ham, tanlamaydi ham; u faqat "kolbasa, 2 ta" deb yozib beradi.

## Arxitektura: nega shunday qurilgan

### Barcha yozuvlar bitta joydan o'tadi

`server/src/lib/actions.ts` — bazani o'zgartiradigan yagona modul. AI ham,
qo'lda kiritish ham, seed ham shu yerdan o'tadi. Natijada:

- Har bir savdo tranzaksiyada bajariladi — yarim yozilgan holat bo'lmaydi
- Ombor qoldig'i `SELECT ... FOR UPDATE` bilan qulflanadi — ikki sotuvchi
  bir vaqtda sotsa ham qoldiq buzilmaydi
- Har bir qoldiq o'zgarishi `stock_moves` ga yoziladi — "qoldiq nega bunday?"
  degan savolga har doim javob bor

### Buyruq uch bosqichda ishlaydi

```
Siz yozasiz  →  POST /ai/command
                  │
                  ├─ 1. extract.ts   BITTA Groq chaqiruvi: matn → JSON
                  │                  AI bazani KO'RMAYDI: id, narx, qoldiq bilmaydi
                  │
                  └─ 2. resolve.ts   sof SQL: nomni bazadagi mahsulotga bog'laydi
                                     bitta moslik  → o'zi tanlanadi
                                     bir nechta    → ro'yxat qaytadi ("qaysi kolbasa?")
                ↓
           Ekranda: "nima yoziladi" + tanlovlar + ogohlantirishlar
                ↓
    Tasdiqlaysiz →  POST /ai/execute  →  3. tranzaksiyada yoziladi
```

Tasdiqlash paytida AI **qayta chaqirilmaydi** — amallar allaqachon tayyor.
Variant tanlanganda ham chaqirilmaydi: kerakli hamma narsa (id, narx, birlik)
nomzod ichida allaqachon kelgan. Shuning uchun tasdiqlash bir zumda bo'ladi,
arzon va deterministik: ko'rsatilgan narsa bilan yozilgan narsa har doim bir xil.

### Noaniq nom — AI emas, do'konchi hal qiladi

Do'konda "Sirliy kolbasa", "Doktorskiy kolbasa" va "Kolbasa Dietik 500g" bo'lsa,
`2 ta kolbasa sotildi` degan buyruqqa uchalasi ham ro'yxat bo'lib chiqadi —
rasmi bo'lgani rasm bilan. AI ulardan bittasini o'zi tanlamaydi.

Bitta variant qolganda (masalan `kartoska` → `Kartoshka`) so'ralmaydi: bitta
qatorli ro'yxat do'konchini bekorga to'xtatadi. Buning o'rniga nima deb
tushunilgani ogohlantirishda aytiladi.

### AI nimani o'ylab topmaydi

- **Narxni** — narxni AI ko'rmaydi ham; uni `resolve.ts` bazadan qo'yadi
- **Qaysi mahsulot ekanini** — nom bir nechtasiga to'g'ri kelsa, do'konchi tanlaydi
- **Rasmdagi mahsulot narxini** — bozor narxini bilmaydi, do'konchi kiritadi
- **Yetishmayotgan ma'lumotni** — "piyoz sotildi" desangiz, necha kilo ekanini so'raydi

## Sinovdan o'tgani

Quyidagilar haqiqiy server va haqiqiy Groq chaqiruvlarida tekshirilgan:

| Buyruq | Natija | Vaqt |
|---|---|---|
| `2 kilo piyoz sotildi` | Piyoz bazadan topildi, narx 5 000 olindi, 10 000 so'm hisoblandi, tasdiqdan keyin ombordan 2 kg ayirildi va kunlik kirimga qo'shildi | 2.8s |
| `Bobur To'raevga 75 ming qarz berdim, 5 kundan keyin to'laydi` | Mijoz topildi, "5 kundan keyin" → `2026-09-05` ga aylandi, balans 75 000 ga oshdi | ~3s |
| `3 dona non va 1 dona sut sotildi` | Ikkala mahsulot topildi, jami 24 000 so'm | ~3s |
| `500 kg piyoz sotildi` | Ogohlantirdi: "omborda 54 kg, sotilmoqchi 500 kg — yetmaydi" | ~3s |
| `qarz berdim` | Amal tayyorlamadi — kim, qancha ekanini so'radi | ~2s |
| Sut paketi rasmi | Nomi "Sut 1L", birlik `litr`, shtrix-kod `4780012345678` o'qildi, bazadagi dublikat topildi | 3.2s |

Bundan tashqari 22 ta API sinovi (`npm run test:api`) — savdo ombordan ayiradi,
bekor qilish qaytaradi, qarzga savdo qarz daftariga tushadi, kirim tan narxni
yangilaydi va h.k.

## Render.com ga qo'yish

Repozitoriya ildizida `render.yaml` bor. Render'da: **New → Blueprint** → shu
repozitoriyni tanlang. Baza va server avtomatik yaratiladi.

Qo'lda faqat bitta narsa kiritiladi — **`GROQ_API_KEY`** (Render panelida
`dokon-api` → Environment). Qolgani blueprint'da:

| O'zgaruvchi | Qayerdan |
|---|---|
| `DATABASE_URL` | blueprint'dagi bazadan avtomatik |
| `JWT_SECRET` | Render tasodifiy generatsiya qiladi |
| `PORT` | Render beradi, server o'qiydi |
| `GROQ_TEXT_MODEL` / `GROQ_VISION_MODEL` | blueprint'da yozilgan |
| `TLS_KEY` / `TLS_CERT` | **kerak emas** — HTTPS ni Render o'zi ta'minlaydi |

**Migratsiya.** Render'da `docker` ham, `psql` ham yo'q — shuning uchun
`npm run db:migrate` (`src/migrate.ts`) SQL fayllarni `DATABASE_URL` orqali
o'zi qo'yadi. U har deploy'da `startCommand` ichida ishlaydi. Barcha SQL
idempotent, ya'ni qayta ishlatish mavjud ma'lumotga tegmaydi.

Mahalliyda ham ishlatsa bo'ladi: `npm run db:migrate:dev`.

**Bepul planning ikkita cheklovi** — bilib turing:

- **Baza 30 kundan keyin o'chiriladi.** Render bepul Postgres'ni shuncha vaqt
  saqlaydi. Do'kon uchun ishlatmoqchi bo'lsangiz pullik planga o'ting yoki
  muntazam `pg_dump` bilan zaxira oling.
- **Disk yo'q → mahsulot rasmlari yo'qoladi.** `uploads/` papkasi har deploy'da
  va server uyquda uyg'onganda tozalanadi. Doimiy saqlash uchun `render.yaml`
  dagi `disk:` blokini yoqing (pullik plan) yoki S3/Cloudflare R2 ga o'ting.

### Serverni uxlatmaslik

Bepul web-servis **15 daqiqa harakatsizlikdan keyin uxlaydi**, keyingi so'rov
~50 soniya kutadi. Kassada bu sezilarli: kunning birinchi mahsuloti yoki
tushlikdan keyingi birinchi savdo har doim uzoq ochiladi.

Yechim — tashqi "ping". Render'ning o'z cron'i pullik, shuning uchun bepul
tashqi xizmat ishlatiladi ([cron-job.org](https://cron-job.org) yoki
UptimeRobot). Sozlash:

1. cron-job.org da ro'yxatdan o'ting → **Create cronjob**.
2. URL: `https://dokon-api.onrender.com/health`
   (`/health` autentifikatsiya so'ramaydi va bazaga tegmaydi — ping uchun arzon).
3. Davri: **har 10 daqiqada** (15 daqiqalik chegaradan kichik bo'lishi shart).
4. Vaqt oralig'i: **do'kon ish vaqti**, masalan 07:00–22:00.

Nega faqat ish vaqtida: bepul planda oyiga 750 soat berilgan, bir oy esa
~730 soat. Ya'ni bitta servisni sutkasiga 24 soat uyg'oq tutsangiz limit
deyarli to'la ishlatiladi va ikkinchi servisga joy qolmaydi. 07:00–22:00
oralig'ida esa oyiga ~450 soat ketadi — zaxira qoladi.

Bu uyquni yo'qotadi, lekin bazaning 30 kunlik cheklovini yo'qotmaydi.

**Mobil ilovani ulash.** Deploy tugagach Metro'ni server manzili bilan
ishga tushiring:

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://dokon-api.onrender.com npx expo start
```

## Foydali buyruqlar

```bash
# Server
cd server
npm run dev          # ishga tushirish (o'zgarishlarni kuzatadi)
npm run typecheck    # tiplarni tekshirish
npm run test:api     # API sinovi (server ishlab turishi kerak)
npm run db:seed      # sinov ma'lumotlarini qayta yaratish

# Mobil
cd mobile
npx expo start       # dev server
npm run typecheck
npx expo export --platform android   # to'plam yig'ilishini tekshirish
```

## Keyingi qadamlar

Hozircha qilinmagan, lekin poydevor tayyor:

- **Oflayn rejim** — internet uzilganda savdo yozish (`expo-sqlite` + navbat)
- **Chek chop etish** — Bluetooth termal printer
- **Shtrix-kod skaneri** — `CameraView` da `onBarcodeScanned` allaqachon mavjud
- **Bir nechta filial** — sxemada `shop_id` bor, faqat UI kerak
- **APK** — `eas build -p android`

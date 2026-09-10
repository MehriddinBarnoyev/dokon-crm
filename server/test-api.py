"""Do'kon CRM — API uchdan-uchgacha sinovi (AI'siz qismlar)."""
import json, urllib.parse, urllib.request, ssl, sys, time

# Har yurishda noyob mijoz ismi — sinov qayta-qayta ishlashi uchun
MIJOZ = f"Sinov Mijoz {int(time.time())}"

import os
# HTTPS yoqilgan bo'lsa o'z CA imiz bilan tekshiramiz (-k ishlatmaymiz:
# sertifikat haqiqatan to'g'ri ekanini sinov ham tasdiqlashi kerak).
CA = os.environ.get("API_CA", "certs/ca.crt")


def _detect_url() -> str:
    """Server HTTPS da ham, HTTP da ham ishlashi mumkin — o'zimiz aniqlaymiz."""
    import subprocess
    if os.environ.get("API_URL"):
        return os.environ["API_URL"]
    for url in ("https://localhost:3000", "http://localhost:3000"):
        args = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                "--max-time", "4", f"{url}/health"]
        if url.startswith("https") and os.path.exists(CA):
            args += ["--cacert", CA]
        if subprocess.run(args, capture_output=True, text=True).stdout.strip() == "200":
            return url
    return "http://localhost:3000"


B = _detect_url()
CURL_TLS = ["--cacert", CA] if B.startswith("https") and os.path.exists(CA) else []
TOKEN = None
fails = []

# HTTPS bo'lsa o'z CA imizni yuklaymiz — tekshiruvni o'chirib qo'ymaymiz,
# aks holda sertifikat noto'g'ri bo'lsa ham sinov o'tib ketardi.
SSL_CTX = None
if B.startswith("https"):
    SSL_CTX = ssl.create_default_context()
    if os.path.exists(CA):
        SSL_CTX.load_verify_locations(CA)


def call(path, method="GET", body=None):
    req = urllib.request.Request(f"{B}{path}", method=method)
    # Mobil klient kabi: Content-Type faqat tana bo'lganda yuboriladi
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, context=SSL_CTX) as r:
            return json.loads(r.read() or "null"), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or "null"), e.code

def check(name, cond, detail=""):
    mark = "OK " if cond else "XATO"
    print(f"  [{mark}] {name}" + (f"  — {detail}" if detail else ""))
    if not cond:
        fails.append(name)

# --- Kirish ---
print("\n1. Autentifikatsiya")
res, st = call("/auth/login", "POST", {"phone": "+998901234567", "password": "1234"})
check("login", st == 200 and "token" in res)
TOKEN = res["token"]

res, st = call("/auth/login", "POST", {"phone": "+998901234567", "password": "notogri"})
check("noto'g'ri parol rad etiladi", st == 401)

me, _ = call("/auth/me")
check("/auth/me do'konni qaytaradi", me.get("shop", {}).get("name") == "Baraka Do'koni")

# Raqam qaysi shaklda yozilsa ham bitta hisobga tushadi: ilova endi
# `+998...` yuboradi, lekin eski hisoblar bazada boshqacha yotibdi.
for shakl in ("901234567", "998901234567", "998 90 123 45 67", "+998 90 123 45 67"):
    r, st2 = call("/auth/login", "POST", {"phone": shakl, "password": "1234"})
    check(f"telefon shakli: {shakl}", st2 == 200 and "token" in r)

r, st2 = call("/auth/register", "POST", {
    "shop_name": "Sinov", "name": "Sinov", "phone": "12345", "password": "1234"})
check("chala raqam bilan ro'yxatdan o'tib bo'lmaydi", st2 == 400)
r, st2 = call("/auth/login", "POST", {"phone": "123456", "password": "1234"})
check("chala raqamli kirish 401 beradi (400 emas)", st2 == 401)

# --- Savdo ombordan ayiradi ---
print("\n2. Savdo → ombor kamayadi, kirim ortadi")
prods, _ = call("/products?search=Kartoshka")
p = prods[0]
stock0 = float(p["stock"])
dash0, _ = call("/reports/dashboard")
cash0 = float(dash0["today"]["cash_in"])

res, st = call("/sales", "POST", {
    "items": [{"product_id": p["id"], "name": p["name"], "unit": p["unit"],
               "qty": 3, "unit_price": p["sale_price"]}],
    "payment_method": "naqd"})
check("savdo yozildi", st == 200, res.get("summary", ""))
sale_id = res.get("id")

p2, _ = call(f"/products/{p['id']}")
stock1 = float(p2["stock"])
check("qoldiq 3 ga kamaydi", abs((stock0 - stock1) - 3) < 1e-9, f"{stock0} → {stock1}")
check("ombor harakati yozildi",
      p2["moves"][0]["ref_type"] == "sale" and float(p2["moves"][0]["qty"]) == 3)

dash1, _ = call("/reports/dashboard")
cash1 = float(dash1["today"]["cash_in"])
expected = 3 * float(p["sale_price"])
check("kunlik kirim o'sdi", abs((cash1 - cash0) - expected) < 1e-6,
      f"+{cash1 - cash0:.0f} so'm")

# --- Summasi yozilgan savdo (tarozidagi yaxlitlash) ---
print("\n2b. \"32 minglik bering\" — summa aniq saqlanadi")
# Do'konchi jamiga 32 000 yozadi, miqdor 32000/35000 = 0.914285… bo'lib
# uch xonaga qisqaradi. Ko'paytma 31 990 — kassada 10 so'm kamomat edi.
NARX, YOZILGAN = 35000, 32000
MIQDOR = round(YOZILGAN / NARX, 3)          # ilovadagi toFixed(3) bilan bir xil
check("miqdor yaxlitlanadi", MIQDOR == 0.914, f"{MIQDOR}")
check("ko'paytma kam chiqadi", abs(MIQDOR * NARX - 31990) < 1e-6,
      f"{MIQDOR * NARX:,.0f}")


def savdo_jamisi(sale_id):
    """Yangi yozilgan savdoning `total` i. Ro'yxatdan id bo'yicha topamiz —
    oxirgi qatorga tayanish bir soniyada ikki savdo bo'lsa adashtiradi."""
    royxat, _ = call("/sales?limit=10")
    for r in royxat if isinstance(royxat, list) else []:
        if r.get("id") == sale_id:
            return float(r["total"])
    return None


res, st = call("/sales", "POST", {
    "items": [{"product_id": p["id"], "name": p["name"], "unit": p["unit"],
               "qty": MIQDOR, "unit_price": NARX, "subtotal": YOZILGAN}],
    "payment_method": "naqd"})
check("savdo yozildi", st == 200, res.get("summary", ""))
aniq_id = res.get("id")
jami = savdo_jamisi(aniq_id)
check("jami aynan yozilgan summa", jami is not None and abs(jami - YOZILGAN) < 1e-6,
      f"{jami:,.0f} so'm" if jami is not None else "topilmadi")

# Chegirmani jimgina o'tkazib bo'lmaydi — u narx orqali yozilishi kerak.
res2, st2 = call("/sales", "POST", {
    "items": [{"product_id": p["id"], "name": p["name"], "unit": p["unit"],
               "qty": MIQDOR, "unit_price": NARX, "subtotal": 20000}],
    "payment_method": "naqd"})
check("savdo yozildi (chegirma sinovi)", st2 == 200)
jami2 = savdo_jamisi(res2.get("id"))
check("chegaradan tashqari summa rad etiladi",
      jami2 is not None and abs(jami2 - MIQDOR * NARX) < 1e-6,
      f"{jami2:,.0f} so'm (ko'paytma)" if jami2 is not None else "topilmadi")

# Sinov savdolari qoldiqni buzmasin.
for sid in (aniq_id, res2.get("id")):
    if sid:
        call(f"/sales/{sid}", "DELETE")

# --- Savdoni bekor qilish qoldiqni qaytaradi ---
print("\n3. Savdoni bekor qilish")
res, st = call(f"/sales/{sale_id}", "DELETE")
check("bekor qilindi", st == 200)
p3, _ = call(f"/products/{p['id']}")
check("qoldiq qaytdi", abs(float(p3["stock"]) - stock0) < 1e-9,
      f"{stock1} → {p3['stock']}")

# --- Qarzga savdo ---
print("\n4. Qarzga savdo → qarz daftariga tushadi")
res, st = call("/sales", "POST", {
    "items": [{"product_id": p["id"], "name": p["name"], "unit": p["unit"],
               "qty": 2, "unit_price": 10000}],
    "customer_name": MIJOZ, "payment_method": "qarz", "paid": 0})
check("qarzga savdo yozildi", st == 200, res.get("summary", ""))

debtors, _ = call("/debts?only_owing=1")
sinov = [d for d in debtors if d["name"] == MIJOZ]
check("yangi mijoz qarzdorlar ro'yxatida", len(sinov) == 1)
check("qarz summasi to'g'ri", float(sinov[0]["balance"]) == 20000,
      f"{sinov[0]['balance']} so'm")

# --- Qarz to'lovi ---
print("\n5. Qarz to'lovi")
res, st = call("/debts/payment", "POST", {
    "customer_id": sinov[0]["customer_id"], "customer_name": MIJOZ,
    "amount": 15000})
check("to'lov yozildi", st == 200, res.get("summary", ""))
det, _ = call(f"/debts/customer/{sinov[0]['customer_id']}")
check("balans kamaydi", float(det["balance"]) == 5000, f"{det['balance']} so'm")

# --- Omborga kirim ---
print("\n6. Omborga kirim")
before = float(call(f"/products/{p['id']}")[0]["stock"])
res, st = call("/sales/purchase", "POST", {
    "supplier": "Sinov Optom",
    "items": [{"product_id": p["id"], "name": p["name"], "unit": p["unit"],
               "qty": 25, "cost_price": 4200}]})
check("kirim yozildi", st == 200, res.get("summary", ""))
after = float(call(f"/products/{p['id']}")[0]["stock"])
check("qoldiq 25 ga oshdi", abs((after - before) - 25) < 1e-9, f"{before} → {after}")
check("tan narx yangilandi", float(call(f"/products/{p['id']}")[0]["cost_price"]) == 4200)

# --- Chiqim ---
print("\n7. Chiqim")
e0 = float(call("/reports/dashboard")[0]["today"]["expense_total"])
res, st = call("/sales/expense", "POST", {"category": "transport", "amount": 45000})
check("chiqim yozildi", st == 200, res.get("summary", ""))
e1 = float(call("/reports/dashboard")[0]["today"]["expense_total"])
check("kunlik chiqim o'sdi", abs((e1 - e0) - 45000) < 1e-6, f"+{e1 - e0:.0f} so'm")

# --- Qoldiq tuzatish ---
print("\n8. Qoldiq tuzatish (inventarizatsiya)")
res, st = call(f"/products/{p['id']}/adjust", "POST", {"new_stock": 77, "note": "sinov"})
check("tuzatildi", st == 200, res.get("summary", ""))
check("qoldiq aynan 77", float(call(f"/products/{p['id']}")[0]["stock"]) == 77)

# --- Hisobotlar ---
print("\n9. Hisobotlar")
daily, st = call("/reports/daily?days=7")
check("kunlik hisobot", st == 200 and len(daily) > 0, f"{len(daily)} kun")
top, st = call("/reports/top-products?days=30")
check("top mahsulotlar", st == 200 and len(top) > 0, f"{len(top)} ta")
inv, st = call("/reports/inventory-value")
check("ombor qiymati", st == 200 and float(inv["cost_value"]) > 0,
      f"{float(inv['cost_value']):,.0f} so'm")

# --- Mijozli savdo (naqd bo'lsa ham) ---
print("\n9b. Mijozga bog'langan savdo")
MIJOZ2 = MIJOZ + " naqd"
prods2, _ = call("/products?limit=5")
p2 = prods2[0]
res, st = call("/sales", "POST", {
    "items": [{"product_id": p2["id"], "name": p2["name"], "unit": p2["unit"],
               "qty": 1, "unit_price": 7000}],
    "customer_name": MIJOZ2, "payment_method": "naqd"})
check("naqd savdo mijoz bilan yozildi", st == 200, res.get("summary", ""))

# Bir nechta har xil mahsulot — bitta savdoda
res, st = call("/sales", "POST", {
    "items": [
        {"product_id": prods2[0]["id"], "name": prods2[0]["name"],
         "unit": prods2[0]["unit"], "qty": 2, "unit_price": 5000},
        {"product_id": prods2[1]["id"], "name": prods2[1]["name"],
         "unit": prods2[1]["unit"], "qty": 1, "unit_price": 12000},
        {"product_id": prods2[2]["id"], "name": prods2[2]["name"],
         "unit": prods2[2]["unit"], "qty": 3, "unit_price": 4000},
    ],
    "customer_name": MIJOZ2, "payment_method": "naqd"})
check("ko'p turdagi mahsulot bitta savdoda", st == 200, res.get("summary", "")[:80])

mijozlar, _ = call("/debts?only_owing=0&search=" + urllib.parse.quote(MIJOZ2))
topilgan = [c for c in mijozlar if c["name"] == MIJOZ2]
check("mijoz ro'yxatda ko'rinadi", len(topilgan) == 1)

if topilgan:
    det, _ = call(f"/debts/customer/{topilgan[0]['customer_id']}")
    check("xaridlar tarixi yozildi", det["jami"]["xaridlar_soni"] == 2,
          f"{det['jami']['xaridlar_soni']} ta xarid")
    check("xarid summasi to'g'ri",
          abs(float(det["jami"]["jami_xarid"]) - (7000 + 10000 + 12000 + 12000)) < 1,
          f"{float(det['jami']['jami_xarid']):,.0f} so'm")
    check("naqd xaridda qarz yo'q", float(det["balance"]) == 0,
          f"balans {det['balance']}")

    # Mijoz sahifasi bo'laklab tortiladi: birinchi javobda xaridlar YO'Q,
    # faqat yig'indisi. Mahsulotlar alohida so'rov bilan keladi.
    check("birinchi javobda xaridlar ro'yxati yo'q", "purchases" not in det)
    check("tarix sahifa ko'rinishida keladi",
          isinstance(det.get("history"), dict) and "items" in det["history"])

    cid = topilgan[0]["customer_id"]
    xar, st = call(f"/debts/customer/{cid}/purchases")
    check("xaridlar alohida tortiladi", st == 200 and len(xar["items"]) == 2,
          f"{len(xar.get('items', []))} ta")
    qatorlar = [q for x in xar["items"] for q in (x["items"] or [])]
    check("har qatorda miqdor va narx bor",
          bool(qatorlar) and all(
              q.get("qty") and q.get("unit") and q.get("unit_price") and q.get("subtotal")
              for q in qatorlar),
          f"{len(qatorlar)} ta qator")
    check("qator summasi miqdor × narxga teng",
          all(abs(float(q["subtotal"]) - float(q["qty"]) * float(q["unit_price"])) < 1
              for q in qatorlar))

    buzuq, st = call(f"/debts/customer/{cid}/history?before=buzuq")
    check("buzuq kursor xato bermaydi", st == 200)

# Sahifalash — qarz tarixi bor mijozda (yuqorida qarz ham, to'lov ham yozilgan).
qcid = sinov[0]["customer_id"]
qdet, _ = call(f"/debts/customer/{qcid}")
qtarix = qdet["history"]["items"]
check("qarz tarixi keldi", len(qtarix) >= 2, f"{len(qtarix)} ta yozuv")
if len(qtarix) >= 2:
    kur = urllib.parse.quote(f"{qtarix[0]['created_at']}|{qtarix[0]['id']}")
    keyin, _ = call(f"/debts/customer/{qcid}/history?before={kur}")
    korilgan = [x["id"] for x in keyin["items"]]
    check("kursor faqat keyingilarini qaytaradi",
          korilgan == [x["id"] for x in qtarix[1:]],
          f"{len(korilgan)} ta")

# --- Aqlli qidiruv ---
print("\n9c. Foyda tahlili")
# Tushum bo'yicha birinchi turgan mahsulot eng ko'p FOYDA keltirgani emas.
# Do'konchining asl savoli shu — shuning uchun ikki xil tartib kerak.
tushum, _ = call("/reports/top-products?days=365&sort=tushum&limit=10")
foyda,  _ = call("/reports/top-products?days=365&sort=foyda&limit=10")

check("tushum bo'yicha kamayib boradi",
      all(float(tushum[i]["revenue"]) >= float(tushum[i + 1]["revenue"])
          for i in range(len(tushum) - 1)), f"{len(tushum)} ta qator")
check("foyda bo'yicha kamayib boradi",
      all(float(foyda[i]["profit"]) >= float(foyda[i + 1]["profit"])
          for i in range(len(foyda) - 1)), f"{len(foyda)} ta qator")
check("ustama hisoblanadi",
      all(r["margin"] is not None or float(r["revenue"]) == 0 for r in tushum))

if tushum:
    r = tushum[0]
    kutilgan = round(float(r["profit"]) * 100 / float(r["revenue"]), 1)
    check("ustama = foyda / tushum",
          abs(float(r["margin"]) - kutilgan) < 0.05,
          f"{r['margin']}% ≈ {kutilgan}%")

zarar, _ = call("/reports/loss-sales?days=365")
check("zarar ro'yxatidagi hammasi minusda",
      all(float(r["profit"]) < 0 for r in zarar), f"{len(zarar)} ta savdo")
# Tan narxi kiritilmagan savdo zarar EMAS — u boshqa muammo va
# ro'yxatga tushsa, haqiqiy zararni ko'mib yuborardi.
check("tan narxsiz savdolar zarar deb sanalmaydi",
      all(float(r["cost_total"]) > 0 for r in zarar))
check("eng katta zarar birinchi",
      all(float(zarar[i]["profit"]) <= float(zarar[i + 1]["profit"])
          for i in range(len(zarar) - 1)))


print("\n10. Aqlli qidiruv (xato yozilgan / ko'p so'zli nomlar)")
QIDIRUV = [
    ("piez",       "Piyoz",             "harf tushib qolgan"),
    ("kartoska",   "Kartoshka",         "sh → s"),
    ("sakar",      "Shakar",            "sh → s"),
    ("makron",     "Makaron 500g",      "harf tushib qolgan"),
    ("tuxm",       "Tuxum",             "harf tushib qolgan"),
    ("kola",       "Coca-Cola 1.5L",    "so'z ichida + c/k"),
    ("coca cola",  "Coca-Cola 1.5L",    "defis o'rniga bo'sh joy"),
    ("osimlik",    "O'simlik yog'i 1L", "apostrofsiz"),
    ("lazer",      "Guruch Lazer 1kg",  "faqat ikkinchi so'z"),
    ("ahmad",      "Choy Ahmad 100g",   "faqat ikkinchi so'z"),
    ("kir kukuni", "Kir yuvish kukuni", "o'rtadagi so'z tashlangan"),
    ("пиёз",       "Piyoz",             "kirill alifbo"),
]
for q, kutilgan, sabab in QIDIRUV:
    rows, st = call(f"/products?search={urllib.parse.quote(q)}")
    topildi = rows[0]["name"] if st == 200 and rows else "—"
    check(f'"{q}" → {kutilgan}', topildi == kutilgan, f"{sabab}; topildi: {topildi}")

# Mos kelmaydigan so'rov bo'sh natija berishi kerak
rows, _ = call("/products?search=" + urllib.parse.quote("televizor"))
check("mos kelmaydigan so'rov bo'sh qaytaradi", len(rows) == 0, f"{len(rows)} ta")

# --- Himoya ---
print("\n10b. Bir mahsulotga bir nechta shtrix-kod")
# Ayni mahsulot har xil partiyada har xil kod bilan keladi. Skaner
# ularning HAMMASI bo'yicha topishi kerak — aks holda kassada
# do'konchi nomi bilan qidirishga majbur bo'ladi.
topilgan, _ = call("/products?search=Coca")
mahsulot = topilgan[0] if topilgan else None
check("sinov uchun mahsulot topildi", mahsulot is not None)

if mahsulot:
    pid = mahsulot["id"]
    A, Q = "7770000000001", "7770000000002"

    # Toza boshlash: oldingi yurishdan qolgan kodlar bo'lsa olib tashlaymiz
    for kod in (A, Q):
        call(f"/products/{pid}/barcodes/{kod}", "DELETE")

    r, st = call(f"/products/{pid}/barcodes", "POST", {"code": A})
    check("birinchi kod qo'shildi", st == 200 and A in r.get("barcodes", []))

    r, st = call(f"/products/{pid}/barcodes", "POST", {"code": Q})
    check("ikkinchi kod ham qo'shildi", st == 200 and Q in r.get("barcodes", []),
          f"{len(r.get('barcodes', []))} ta kod")

    # Ikkalasi ham mahsulotni topishi shart
    for kod in (A, Q):
        found, _ = call(f"/products/meta/barcode/{kod}")
        pr = found.get("product")
        check(f"{kod} bo'yicha topiladi", pr is not None and pr["id"] == pid)

        rows, _ = call(f"/products?search={kod}")
        check(f"{kod} qidiruvda aniq moslik",
              len(rows) > 0 and rows[0]["id"] == pid and float(rows[0]["score"]) == 1.0)

    # Kod telefon keshiga tushishi kerak — busiz oflaynda skaner ishlamaydi
    sync, _ = call("/sync/products")
    bizniki = [x for x in sync["products"] if x["id"] == pid]
    check("sync mahsulot kodlarini beradi",
          len(bizniki) == 1 and A in bizniki[0].get("barcodes", [])
          and Q in bizniki[0].get("barcodes", []))

    # Bitta kod ikki mahsulotni bildirsa, kassada qaysi biri to'g'ri
    # ekanini bilib bo'lmaydi — server buni rad etishi shart.
    boshqa, _ = call("/products?search=Kartoshka")
    if boshqa:
        _, st = call(f"/products/{boshqa[0]['id']}/barcodes", "POST", {"code": A})
        check("band kod boshqa mahsulotga biriktirilmaydi", st == 409, f"HTTP {st}")

    _, st = call(f"/products/{pid}/barcodes", "POST", {"code": "12"})
    check("juda qisqa kod rad etiladi", st == 400, f"HTTP {st}")

    r, st = call(f"/products/{pid}/barcodes/{A}", "DELETE")
    check("kod olib tashlanadi", st == 200 and A not in r.get("barcodes", []))
    check("qolgan kod joyida", Q in r.get("barcodes", []))

    call(f"/products/{pid}/barcodes/{Q}", "DELETE")


print("\n11. Xavfsizlik")
saved = TOKEN; TOKEN = None
_, st = call("/products")
check("tokensiz kirish rad etiladi", st == 401)
TOKEN = saved

_, st = call("/sales", "POST", {"items": [], "payment_method": "naqd"})
check("bo'sh savat rad etiladi", st == 400)

# AI marshruti: kalit bo'lsa 200/502, bo'lmasa 503 — ikkalasi ham to'g'ri javob
health, _ = call("/health")
_, st = call("/ai/command", "POST", {"text": "salom"})
if health.get("ai"):
    check("AI yoqilgan, marshrut javob beradi", st in (200, 502), f"HTTP {st}")
else:
    check("AI kalitsiz 503 qaytaradi", st == 503)

print("\n" + "=" * 46)
if fails:
    print(f"XATOLAR ({len(fails)}): " + ", ".join(fails))
    sys.exit(1)
print("HAMMA SINOV O'TDI")

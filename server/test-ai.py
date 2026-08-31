"""AI to'liq oqimi: buyruq → tayyorlash → tasdiqlash → bazaga ta'siri."""
import json, subprocess, time

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

def call(path, method="GET", body=None, timeout=200):
    args = ["curl", "-s", "-w", "\n%{http_code}", "-X", method, f"{B}{path}",
            "--max-time", str(timeout)] + CURL_TLS
    if TOKEN: args += ["-H", f"Authorization: Bearer {TOKEN}"]
    if body is not None:
        args += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    out = subprocess.run(args, capture_output=True, text=True).stdout
    payload, _, code = out.rpartition("\n")
    try: return json.loads(payload or "null"), int(code.strip() or 0)
    except Exception: return {"raw": payload[:300]}, int(code.strip() or 0)

def check(name, cond, detail=""):
    print(f"  [{'OK ' if cond else 'XATO'}] {name}" + (f"  — {detail}" if detail else ""))
    if not cond: fails.append(name)

res, _ = call("/auth/login", "POST", {"phone": "+998901234567", "password": "1234"})
TOKEN = res["token"]

def piyoz():
    rows, _ = call("/products?search=Piyoz")
    return float(rows[0]["stock"])

def bugun():
    d, _ = call("/reports/dashboard")
    return float(d["today"]["cash_in"]), float(d["today"]["expense_total"])

# ---------------------------------------------------------------
print("\n1. \"2 kilo piyoz sotildi\" — asosiy stsenariy")
stock0 = piyoz()
cash0, _ = bugun()
print(f"     boshlang'ich: piyoz {stock0} kg, bugungi kirim {cash0:,.0f}")

t0 = time.time()
res, code = call("/ai/command", "POST", {"text": "2 kilo piyoz sotildi"})
dt = time.time() - t0
check("buyruq qabul qilindi", code == 200, f"{dt:.1f}s")
if code == 200:
    print(f"     AI: {res['summary'][:160]}")
    acts = res["actions"]
    check("savdo amali tayyorlandi", len(acts) == 1 and acts[0]["type"] == "sale")
    if acts and acts[0]["type"] == "sale":
        it = acts[0]["items"][0]
        check("mahsulot bazadan topildi", it["product_id"] is not None, it["name"])
        check("miqdor 2 kg", float(it["qty"]) == 2, f"{it['qty']} {it['unit']}")
        check("narx bazadan olindi", float(it["unit_price"]) == 5000,
              f"{it['unit_price']} so'm")

    # --- Bazaga hali TEGMAGAN bo'lishi kerak ---
    check("tasdiqlashdan oldin ombor O'ZGARMAGAN", piyoz() == stock0,
          f"{stock0} kg")

    # --- Tasdiqlaymiz ---
    ex, code2 = call("/ai/execute", "POST",
                     {"actions": acts, "log_id": res["log_id"]})
    check("tasdiqlash bajarildi", code2 == 200, ex.get("summary", "")[:100])

    stock1 = piyoz()
    cash1, _ = bugun()
    check("ombordan 2 kg ayirildi", abs((stock0 - stock1) - 2) < 1e-9,
          f"{stock0} → {stock1}")
    check("kunlik kirimga 10 000 qo'shildi", abs((cash1 - cash0) - 10000) < 1e-6,
          f"+{cash1 - cash0:,.0f} so'm")

# ---------------------------------------------------------------
time.sleep(35)   # Groq: daqiqasiga 8000 token limiti
print("\n2. Qarz — mijozni topib yozadi")
res, code = call("/ai/command", "POST",
                 {"text": "Bobur To'raevga 75 ming qarz berdim, 5 kundan keyin to'laydi"})
check("buyruq qabul qilindi", code == 200)
if code == 200 and res["actions"]:
    a = res["actions"][0]
    print(f"     AI: {res['summary'][:160]}")
    check("qarz amali", a["type"] == "debt")
    check("mijoz bazadan topildi", a["customer_id"] is not None, a["customer_name"])
    check("summa 75 000", float(a["amount"]) == 75000)
    check("muddat sanaga aylandi", bool(a["due_date"]), str(a["due_date"]))

    before, _ = call(f"/debts/customer/{a['customer_id']}")
    b0 = float(before["balance"])
    call("/ai/execute", "POST", {"actions": res["actions"], "log_id": res["log_id"]})
    after, _ = call(f"/debts/customer/{a['customer_id']}")
    check("qarz balansi 75 000 ga oshdi",
          abs((float(after["balance"]) - b0) - 75000) < 1e-6,
          f"{b0:,.0f} → {float(after['balance']):,.0f}")

# ---------------------------------------------------------------
time.sleep(35)   # Groq: daqiqasiga 8000 token limiti
print("\n3. Yetmaydigan tovar — ogohlantiradi")
res, code = call("/ai/command", "POST", {"text": "500 kg piyoz sotildi"})
check("buyruq qabul qilindi", code == 200)
if code == 200:
    print(f"     AI: {res['summary'][:200]}")
    check("ogohlantirish berildi", len(res["warnings"]) > 0,
          res["warnings"][0][:90] if res["warnings"] else "yo'q")

# ---------------------------------------------------------------
time.sleep(35)   # Groq: daqiqasiga 8000 token limiti
print("\n4. Yetishmagan ma'lumot — so'raydi, taxmin qilmaydi")
res, code = call("/ai/command", "POST", {"text": "qarz berdim"})
check("buyruq qabul qilindi", code == 200)
if code == 200:
    print(f"     AI: {res['summary'][:200]}")
    check("amal tayyorlanmadi (so'radi)", len(res["actions"]) == 0,
          f"{len(res['actions'])} ta amal")

# ---------------------------------------------------------------
time.sleep(35)   # Groq: daqiqasiga 8000 token limiti
print("\n5. AI + xato yozilgan nom")
res, code = call("/ai/command", "POST", {"text": "3 kilo kartoska sotildi"})
check("buyruq qabul qilindi", code == 200)
if code == 200 and res["actions"]:
    a = res["actions"][0]
    print(f"     AI: {res['summary'][:160]}")
    it = a["items"][0] if a["type"] == "sale" else {}
    check("xato yozilgan nom to'g'rilandi", it.get("name") == "Kartoshka",
          f"topildi: {it.get('name')}")
    check("miqdor 3 kg", float(it.get("qty", 0)) == 3)

time.sleep(35)   # Groq: daqiqasiga 8000 token limiti
print("\n6. AI + faqat ikkinchi so'z")
res, code = call("/ai/command", "POST", {"text": "2 dona lazer sotildi"})
check("buyruq qabul qilindi", code == 200)
if code == 200 and res["actions"]:
    a = res["actions"][0]
    print(f"     AI: {res['summary'][:160]}")
    it = a["items"][0] if a["type"] == "sale" else {}
    check("to'liq nom topildi", it.get("name") == "Guruch Lazer 1kg",
          f"topildi: {it.get('name')}")

print("\n" + "=" * 50)
print("XATOLAR: " + ", ".join(fails) if fails else "HAMMA AI SINOVI O'TDI")

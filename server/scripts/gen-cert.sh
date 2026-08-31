#!/usr/bin/env bash
# Mahalliy HTTPS uchun sertifikat yaratadi.
#
# Ikkita fayl chiqadi:
#   certs/ca.crt      — mahalliy sertifikat markazi (telefonga o'rnatiladi)
#   certs/server.crt  — server sertifikati (shu CA imzolagan)
#
# Nega CA kerak? Oddiy "self-signed" sertifikatni brauzer ham, telefon ham
# rad etadi. CA yaratib, uni qurilmaga ishonchli deb qo'shsak — zanjir to'liq
# bo'ladi va ogohlantirish chiqmaydi.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs
cd certs

# Server qaysi manzillarda ochiladi — sertifikatga shularni yozamiz.
LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' | head -1 || echo '127.0.0.1')"
EXTRA="${1:-}"          # qo'shimcha domen/IP kerak bo'lsa: ./gen-cert.sh dokon.local

echo "Sertifikat yaratilmoqda…"
echo "  LAN IP: $LAN_IP"

# ---------- 1. Mahalliy CA ----------
if [ ! -f ca.key ]; then
  openssl genrsa -out ca.key 2048 2>/dev/null
  openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 -out ca.crt \
    -subj "/CN=Dokon CRM Local CA/O=Dokon CRM" 2>/dev/null
  echo "  ca.crt yaratildi (10 yil)"
else
  echo "  ca.crt allaqachon bor — qayta ishlatiladi"
fi

# ---------- 2. Server sertifikati ----------
cat > server.cnf <<CNF
[req]
distinguished_name = dn
req_extensions     = ext
prompt             = no
[dn]
CN = dokon-crm
O  = Dokon CRM
[ext]
subjectAltName   = @alt
keyUsage         = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
[alt]
DNS.1 = localhost
IP.1  = 127.0.0.1
IP.2  = $LAN_IP
CNF

if [ -n "$EXTRA" ]; then
  if [[ "$EXTRA" =~ ^[0-9.]+$ ]]; then
    echo "IP.3  = $EXTRA" >> server.cnf
  else
    echo "DNS.2 = $EXTRA" >> server.cnf
  fi
  echo "  qo'shimcha manzil: $EXTRA"
fi

openssl genrsa -out server.key 2048 2>/dev/null
openssl req -new -key server.key -out server.csr -config server.cnf 2>/dev/null
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 825 -sha256 \
  -extfile server.cnf -extensions ext 2>/dev/null
rm -f server.csr server.cnf ca.srl

chmod 600 server.key ca.key

echo "  server.crt yaratildi (825 kun)"
echo
echo "Tayyor. .env ga qo'shing:"
echo "  TLS_KEY=certs/server.key"
echo "  TLS_CERT=certs/server.crt"
echo
echo "Telefonda ishonch hosil qilish uchun certs/ca.crt ni qurilmaga o'rnating."

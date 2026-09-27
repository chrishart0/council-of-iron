#!/bin/sh
# Self-signed HTTPS for phones on the LAN (the microphone needs a secure context).
# Creates a tiny local CA and a server certificate for this machine's LAN IP in data/tls/ (never committed).
# Usage: scripts/dev-cert.sh [LAN_IP]   then   TLS_CERT=data/tls/cert.pem TLS_KEY=data/tls/key.pem npm start
set -eu
IP="${1:-$(hostname -I | awk '{print $1}')}"
DIR="$(dirname "$0")/../data/tls"
mkdir -p "$DIR" && chmod 700 "$DIR" && cd "$DIR"
[ -f ca.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=Council of Iron dev CA" \
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign -keyout ca-key.pem -out ca.pem
openssl req -newkey rsa:2048 -nodes -subj "/CN=$IP" -keyout key.pem -out cert.csr
printf 'subjectAltName=IP:%s,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$IP" > ext.cnf
openssl x509 -req -in cert.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 397 -extfile ext.cnf -out cert.pem
openssl x509 -in ca.pem -outform der -out ca.crt
rm -f cert.csr ext.cnf
echo "Server cert for $IP: $DIR/cert.pem (key: key.pem). Install $DIR/ca.crt on the phone to trust it,"
echo "or tap through the browser warning once."

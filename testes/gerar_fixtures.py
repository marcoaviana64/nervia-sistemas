"""Gera certificados de teste (padrão ICP-Brasil) para os testes — nada real."""
import os, sys
from datetime import datetime, timedelta, timezone
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12, PrivateFormat
from cryptography.hazmat.primitives.serialization.pkcs12 import PBES

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(D, exist_ok=True)
CNPJ = "12345678000199"
agora = datetime.now(timezone.utc)

def cert(cn, chave, emissor=None, chave_emissor=None, san=None, ca=False):
    nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    b = (x509.CertificateBuilder().subject_name(nome).issuer_name(emissor or nome).public_key(chave.public_key())
         .serial_number(x509.random_serial_number()).not_valid_before(agora - timedelta(days=1))
         .not_valid_after(agora + timedelta(days=300)))
    if san: b = b.add_extension(x509.SubjectAlternativeName(san), False)
    if ca: b = b.add_extension(x509.BasicConstraints(ca=True, path_length=None), True)
    return b.sign(chave_emissor or chave, hashes.SHA256())

# AC de teste + certificado e-CNPJ emitido por ela
k_ac = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ac = cert("AC TESTE", k_ac, ca=True)
k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
outro = x509.OtherName(x509.ObjectIdentifier("2.16.76.1.3.3"), b"\x04\x0e" + CNPJ.encode())
c = cert(f"EMPRESA TESTE LTDA:{CNPJ}", k, ac.subject, k_ac, san=[outro])

moderno = pkcs12.serialize_key_and_certificates(b"teste", k, c, [ac], serialization.BestAvailableEncryption(b"1234"))
legado = pkcs12.serialize_key_and_certificates(b"teste", k, c, [ac],
    PrivateFormat.PKCS12.encryption_builder().kdf_rounds(2048)
    .key_cert_algorithm(PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(b"1234"))
open(f"{D}/a1_moderno.pfx", "wb").write(moderno)
open(f"{D}/a1_legado.pfx", "wb").write(legado)
open(f"{D}/a1_cert.pem", "wb").write(c.public_bytes(serialization.Encoding.PEM))
open(f"{D}/ac.pem", "wb").write(ac.public_bytes(serialization.Encoding.PEM))

# servidor HTTPS de teste (simula a SEFAZ) assinado pela mesma AC, para localhost
k_srv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
srv = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")]))
       .issuer_name(ac.subject).public_key(k_srv.public_key()).serial_number(x509.random_serial_number())
       .not_valid_before(agora - timedelta(days=1)).not_valid_after(agora + timedelta(days=300))
       .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), False).sign(k_ac, hashes.SHA256()))
open(f"{D}/srv_cert.pem", "wb").write(srv.public_bytes(serialization.Encoding.PEM))
open(f"{D}/srv_key.pem", "wb").write(k_srv.private_bytes(serialization.Encoding.PEM, PrivateFormat.PKCS8, serialization.NoEncryption()))
print("fixtures geradas em", D)

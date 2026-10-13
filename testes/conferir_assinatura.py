"""Confere a assinatura do evento de Ciência gerada pela Edge Function, de forma independente.

Usa o C14N da biblioteca padrão do Python (xml.etree.ElementTree.canonicalize), e não o lxml:
o lxml/libxml2 2.14 tem um bug no C14N de sub-árvores com namespace padrão (gera xmlns="" indevido).
Uso: python3 conferir_assinatura.py saida_envEvento.xml fixtures/a1_cert.pem
"""
import base64, hashlib, re, sys
import xml.etree.ElementTree as ET
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

NFE, DS = "http://www.portalfiscal.inf.br/nfe", "http://www.w3.org/2000/09/xmldsig#"
texto = open(sys.argv[1], encoding="utf-8").read()
cert_ref = x509.load_pem_x509_certificate(open(sys.argv[2], "rb").read())

# Canonicaliza o documento inteiro; o C14N de uma sub-árvore é o mesmo trecho com o xmlns herdado no topo
canon = ET.canonicalize(texto)
infs = re.findall(r"<infEvento (Id=\"[^\"]+\">.*?</infEvento>)", canon)
sis = re.findall(r"<SignedInfo>(.*?)</SignedInfo>", canon)
digs = re.findall(r"<DigestValue>([^<]+)</DigestValue>", canon)
sigs = re.findall(r"<SignatureValue>([^<]+)</SignatureValue>", canon)
certs = re.findall(r"<X509Certificate>([^<]+)</X509Certificate>", canon)
assert len(infs) == len(sis) == len(digs) == len(sigs) == 2, "esperava 2 eventos"
for inf, si, dig, sig, c in zip(infs, sis, digs, sigs, certs):
    c14n_inf = f'<infEvento xmlns="{NFE}" {inf}'.encode()
    assert base64.b64encode(hashlib.sha1(c14n_inf).digest()).decode() == dig, "digest diverge"
    c14n_si = f'<SignedInfo xmlns="{DS}">{si}</SignedInfo>'.encode()
    cert = x509.load_der_x509_certificate(base64.b64decode(c))
    assert cert == cert_ref, "certificado embutido diferente"
    cert.public_key().verify(base64.b64decode(sig), c14n_si, padding.PKCS1v15(), hashes.SHA1())
    idv = re.match(r'Id="([^"]+)"', inf).group(1)
    assert len(idv) == 54 and f'URI="#{idv}"' in si
print("Assinatura OK nos 2 eventos (C14N da biblioteca padrão + RSA-SHA1 + certificado correto)")

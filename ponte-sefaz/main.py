"""Ponte SEFAZ — faz o POST com certificado de cliente (mTLS) usando OpenSSL.

Por que existe: o servidor de NF-e da SEFAZ (IIS) pede o certificado por renegociação TLS,
que o runtime das Edge Functions do Supabase (rustls) não suporta. O OpenSSL suporta.

O que faz: recebe {url, headers, body, cert_pem, key_pem} das funções do Supabase, repassa
para a SEFAZ e devolve {status, body}. Não guarda nada: o certificado vive só durante a chamada.
Proteções: segredo no cabeçalho, lista fechada de servidores, limites de tamanho e tempo.
"""
import hmac, http.client, json, os, ssl, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

SEGREDO = os.environ.get("PONTE_SEGREDO", "")
HOSTS_PERMITIDOS = {
    "www1.nfe.fazenda.gov.br",   # Distribuição DF-e (Ambiente Nacional)
    "www.nfe.fazenda.gov.br",    # Recepção de eventos (Ciência da Operação)
    "hom1.nfe.fazenda.gov.br",   # homologação
    "hom.nfe.fazenda.gov.br",
} | {h for h in os.environ.get("PONTE_HOSTS_EXTRA", "").split(",") if h}  # só para teste local
MAX_ENTRADA = 512 * 1024
TEMPO = 90


def chamar_sefaz(url: str, headers: dict, body: str, cert_pem: str, key_pem: str):
    partes = urlsplit(url)
    if partes.scheme != "https" or partes.hostname not in HOSTS_PERMITIDOS:
        raise PermissionError(f"Servidor não permitido: {partes.hostname}")
    ctx = ssl.create_default_context()
    # Python 3.13+ liga a checagem "estrita" (X.509 RFC 5280), que recusa cadeias antigas ainda em uso
    # em servidores do governo. Mantém a verificação normal (cadeia confiável + nome do servidor).
    ctx.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
    extra = os.environ.get("CADEIA_EXTRA_PEM")
    if extra:
        ctx.load_verify_locations(cadata=extra)
    # chave e certificado só existem em arquivo pelo tempo de carregar no contexto TLS
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as fc, \
         tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as fk:
        fc.write(cert_pem); fk.write(key_pem)
    try:
        ctx.load_cert_chain(fc.name, fk.name)
    finally:
        os.remove(fc.name); os.remove(fk.name)
    ctx.set_alpn_protocols(["http/1.1"])
    con = http.client.HTTPSConnection(partes.hostname, partes.port or 443, context=ctx, timeout=TEMPO)
    try:
        caminho = partes.path + (f"?{partes.query}" if partes.query else "")
        dados = body.encode("utf-8")
        cab = {k: v for k, v in (headers or {}).items() if k.lower() in ("content-type", "soapaction", "accept")}
        cab["Content-Length"] = str(len(dados))
        con.request("POST", caminho, body=dados, headers=cab)
        r = con.getresponse()
        return r.status, r.read().decode("utf-8", "replace")
    finally:
        con.close()


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, obj):
        b = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):  # verificação de saúde
        self._json(200, {"ok": True, "servico": "ponte-sefaz"})

    def do_POST(self):
        if not SEGREDO or not hmac.compare_digest(self.headers.get("x-ponte-segredo", ""), SEGREDO):
            return self._json(401, {"erro": "não autorizado"})
        tam = int(self.headers.get("Content-Length") or 0)
        if tam <= 0 or tam > MAX_ENTRADA:
            return self._json(413, {"erro": "tamanho inválido"})
        try:
            p = json.loads(self.rfile.read(tam))
            status, corpo = chamar_sefaz(p["url"], p.get("headers") or {}, p["body"], p["cert_pem"], p["key_pem"])
            self._json(200, {"status": status, "body": corpo})
        except PermissionError as e:
            self._json(403, {"erro": str(e)})
        except (ssl.SSLError, OSError) as e:  # TLS/rede com a SEFAZ (SSLCertVerificationError também é ValueError)
            self._json(502, {"erro": f"{type(e).__name__}: {e}"})
        except (KeyError, ValueError) as e:
            self._json(400, {"erro": f"pedido inválido: {e}"})
        except Exception as e:  # erro de rede/TLS com a SEFAZ: devolve a mensagem, sem dados sensíveis
            self._json(502, {"erro": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):  # registra só método/caminho/status, nunca o corpo
        print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}", flush=True)


if __name__ == "__main__":
    porta = int(os.environ.get("PORT", "8080"))
    print(f"ponte-sefaz ouvindo na porta {porta}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", porta), Handler).serve_forever()

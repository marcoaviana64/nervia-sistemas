"""Servidor HTTPS que EXIGE certificado de cliente (como a SEFAZ). Só para teste local.
Uso: python3 servidor_mtls.py <porta>
"""
import os, ssl, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


class H(BaseHTTPRequestHandler):
    def _cn(self):
        c = self.connection.getpeercert() or {}
        for rdn in c.get("subject", ()):
            for k, v in rdn:
                if k == "commonName":
                    return v
        return ""

    def do_POST(self):
        tam = int(self.headers.get("Content-Length", 0))
        corpo = self.rfile.read(tam).decode()
        resp = ('<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>'
                '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><cStat>137</cStat>'
                f'<xMotivo>Nenhum documento localizado (cliente: {self._cn()}; recebeu CNPJ {"<CNPJ>12345678000199</CNPJ>" in corpo})</xMotivo>'
                '<ultNSU>000000000000000</ultNSU><maxNSU>000000000000000</maxNSU></retDistDFeInt></soap:Body></soap:Envelope>')
        b = resp.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/soap+xml")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(f"{D}/srv_cert.pem", f"{D}/srv_key.pem")
ctx.load_verify_locations(f"{D}/ac.pem")
ctx.verify_mode = ssl.CERT_REQUIRED
srv = HTTPServer(("127.0.0.1", int(sys.argv[1])), H)
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
print("pronto", flush=True)
srv.serve_forever()

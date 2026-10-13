"""Servidor que imita a SEFAZ de NF-e (IIS): o handshake TLS 1.2 começa SEM pedir certificado e,
depois de receber o pedido HTTP, RENEGOCIA a conexão exigindo o certificado do cliente.
É exatamente isso que o rustls (Edge Functions do Supabase) não suporta, e o OpenSSL (ponte) suporta.
Só para teste local.  Uso: python3 servidor_renegociacao.py <porta>   (precisa de: pip install pyopenssl)
"""
import os, socket, sys, threading, time
from OpenSSL import SSL, crypto

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

ctx = SSL.Context(SSL.TLS_SERVER_METHOD)
ctx.set_max_proto_version(SSL.TLS1_2_VERSION)  # renegociação só existe até o TLS 1.2 (a SEFAZ usa 1.2)
ctx.use_certificate_file(f"{D}/srv_cert.pem")
ctx.use_privatekey_file(f"{D}/srv_key.pem")
ctx.load_verify_locations(f"{D}/ac.pem")
ctx.set_session_id(b"nervia-teste")
ctx.set_options(SSL.OP_NO_TICKET)
ctx.set_session_cache_mode(SSL.SESS_CACHE_OFF)  # sem retomar sessão: a renegociação tem que pedir o certificado
ctx.set_verify(SSL.VERIFY_NONE, lambda *a: True)  # 1º handshake: não pede certificado


def ler_ate(con, fim: bytes) -> bytes:
    buf = b""
    while fim not in buf:
        buf += con.recv(65536)
    return buf


def atender(sock):
    con = SSL.Connection(ctx, sock)
    con.set_accept_state()
    try:
        con.do_handshake()
        dados = ler_ate(con, b"\r\n\r\n")
        # agora (como o IIS) exige o certificado do cliente, renegociando
        con.set_verify(SSL.VERIFY_PEER | SSL.VERIFY_FAIL_IF_NO_PEER_CERT, lambda c, x, e, d, ok: ok)
        con.renegotiate()
        con.do_handshake()  # envia o HelloRequest
        cab, _, corpo = dados.partition(b"\r\n\r\n")
        tam = next((int(l.split(b":")[1]) for l in cab.split(b"\r\n") if l.lower().startswith(b"content-length")), 0)
        sock.settimeout(0.05)  # lê de pouco em pouco até o cliente refazer o handshake com o certificado
        fim = time.time() + 10
        while (len(corpo) < tam or con.get_peer_certificate() is None) and time.time() < fim:
            try:
                corpo += con.recv(65536)
            except (SSL.WantReadError, socket.timeout):
                pass
        sock.settimeout(None)
        cert = con.get_peer_certificate()
        if cert is None:
            raise RuntimeError("cliente não apresentou certificado na renegociação")
        cn = cert.to_cryptography().subject.rfc4514_string().split("CN=")[-1].split(",")[0]
        resp = ('<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>'
                '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><cStat>137</cStat>'
                f'<xMotivo>Nenhum documento localizado (renegociou; cliente: {cn})</xMotivo>'
                '<ultNSU>000000000000000</ultNSU><maxNSU>000000000000000</maxNSU></retDistDFeInt></soap:Body></soap:Envelope>').encode()
        con.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/soap+xml\r\nConnection: close\r\n"
                    + f"Content-Length: {len(resp)}\r\n\r\n".encode() + resp)
        con.shutdown()
    except Exception as e:  # sem certificado → derruba a conexão, como a SEFAZ
        print('servidor:', type(e).__name__, e, file=sys.stderr, flush=True)
    finally:
        sock.close()


s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1])))
s.listen(5)
print("pronto", flush=True)
while True:
    c, _ = s.accept()
    threading.Thread(target=atender, args=(c,), daemon=True).start()

// Certificado A1: leitura do .pfx (só no cadastro) e uso em HTTPS com certificado de cliente.
// @deno-types="npm:@types/node-forge@1.3.11"
import forge from "npm:node-forge@1.3.1";

export interface CertGuardado {
  cert_pem: string;   // certificado + cadeia, em PEM
  key_pem: string;    // chave privada PKCS#8, em PEM (fica criptografada no Vault)
}

export interface InfoCert {
  titular: string;
  cnpj: string | null;
  validade: string; // ISO
  guardado: CertGuardado;
}

const OID_CNPJ_DER = "\x06\x05\x60\x4c\x01\x03\x03"; // 2.16.76.1.3.3 (ICP-Brasil: CNPJ do titular)

function cnpjDoCertificado(cert: forge.pki.Certificate, titular: string): string | null {
  const ext = cert.getExtension("subjectAltName") as { value?: string } | null;
  const bruto = ext?.value ?? "";
  const pos = bruto.indexOf(OID_CNPJ_DER);
  if (pos >= 0) {
    const m = bruto.slice(pos + OID_CNPJ_DER.length, pos + 60).match(/[0-9A-Z]{12}\d{2}/);
    if (m) return m[0];
  }
  const m = titular.match(/:([0-9A-Za-z]{12}\d{2})\b/);
  return m ? m[1].toUpperCase() : null;
}

export function lerPfx(pfxBase64: string, senha: string): InfoCert {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.decode64(pfxBase64);
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, senha);
  } catch {
    throw new Error("Senha incorreta ou arquivo .pfx inválido");
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  const chave = chaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave || !certs.length) throw new Error("O .pfx não contém chave privada e certificado");
  const doTitular = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(chave.n));
  if (!doTitular) throw new Error("O certificado do .pfx não corresponde à chave privada");

  const cn = doTitular.subject.getField("CN")?.value as string | undefined;
  const titular = cn ?? doTitular.subject.attributes.map((a) => a.value).join(", ");
  const cadeia = [doTitular, ...certs.filter((c) => c !== doTitular)];
  const keyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave)));
  return {
    titular,
    cnpj: cnpjDoCertificado(doTitular, titular),
    validade: doTitular.validity.notAfter.toISOString(),
    guardado: { cert_pem: cadeia.map((c) => forge.pki.certificateToPem(c)).join(""), key_pem: keyPem },
  };
}

// ------------------------------------------------------------------ uso
export function certificadoDerB64(g: CertGuardado): string {
  // primeiro bloco PEM = certificado do titular
  const m = g.cert_pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
  if (!m) throw new Error("Certificado guardado inválido");
  return m[1].replace(/\s+/g, "");
}

export function clienteHttp(g: CertGuardado): Deno.HttpClient {
  const extra = Deno.env.get("CADEIA_EXTRA_PEM"); // ACs ICP-Brasil, se algum servidor precisar
  return Deno.createHttpClient({
    cert: g.cert_pem,
    key: g.key_pem,
    // Os servidores da SEFAZ (IIS) recusam HTTP/2 com certificado de cliente:
    // "endpoint requires HTTP/1.1". Forçamos HTTP/1.1 em todas as chamadas.
    http1: true,
    http2: false,
    ...(extra ? { caCerts: [extra] } : {}),
  });
}

export async function chaveDeAssinatura(g: CertGuardado): Promise<CryptoKey> {
  const b64 = g.key_pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" }, false, ["sign"]);
}

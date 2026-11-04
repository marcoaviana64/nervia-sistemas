// Testes do Mídia Indoor (Edge Functions) sem Supabase e sem internet: conferência do MP4 com vídeos reais gerados
// pelo ffmpeg, leitura da pasta do Google Drive imitada (fetch falso) e regras da sincronização.
// Rodar (na pasta do projeto):  deno test -A testes/midia/midia_test.ts     (precisa do ffmpeg com libx264 e libx265)
import nodeAssert from "node:assert/strict";
import { analisarMp4 } from "../../supabase/functions/_shared/mp4.ts";
import { listarPasta, PASTA } from "../../supabase/functions/_shared/drive.ts";
import { type BancoMidia, type Conferidos, type Pasta, ordenar, sincronizarConta, versaoConteudo } from "../../supabase/functions/_shared/midia.ts";

const assert = (c: unknown, m?: string) => nodeAssert.ok(c, m);
const eq = (a: unknown, b: unknown, m?: string) => nodeAssert.deepStrictEqual(a, b, m);
const DIR = await Deno.makeTempDir({ prefix: "midia-" });

async function video(nome: string, args: string[]): Promise<Uint8Array> {
  const caminho = `${DIR}/${nome}`;
  const r = await new Deno.Command("ffmpeg", { args: ["-hide_banner", "-loglevel", "error", "-y", ...args, caminho], stdout: "null", stderr: "piped" }).output();
  if (!r.success) throw new Error(new TextDecoder().decode(r.stderr));
  return Deno.readFileSync(caminho);
}
const fonte = (tam: string, seg = 2) => ["-f", "lavfi", "-i", `testsrc=size=${tam}:rate=25:duration=${seg}`];
const leitor = (b: Uint8Array, contar?: { n: number }) => (i: number, f: number) => { if (contar) contar.n++; return Promise.resolve(b.slice(i, f + 1)); };

const V = {
  h264: await video("h264_1080.mp4", [...fonte("1920x1080"), "-c:v", "libx264", "-preset", "ultrafast", "-movflags", "+faststart"]),
  h264Fim: await video("h264_fim.mp4", [...fonte("1280x720", 4), "-c:v", "libx264", "-preset", "ultrafast"]),   // moov no fim
  emPe: await video("h264_empe.mp4", [...fonte("1080x1920"), "-c:v", "libx264", "-preset", "ultrafast"]),
  hevc: await video("hevc.mp4", [...fonte("1280x720"), "-c:v", "libx265", "-preset", "ultrafast", "-tag:v", "hvc1", "-x265-params", "log-level=none"]),
  k4: await video("h264_4k.mp4", [...fonte("3840x2160", 1), "-c:v", "libx264", "-preset", "ultrafast"]),
  semVideo: await video("so_audio.mp4", ["-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac"]),
};

Deno.test("MP4 H.264 1080p com índice no começo: aceito, com resolução e duração", async () => {
  const r = await analisarMp4(leitor(V.h264), V.h264.length);
  eq([r.ok, r.codec, r.largura, r.altura], [true, "H.264", 1920, 1080]);
  assert(Math.abs((r.duracao_s ?? 0) - 2) < 0.2, `duração ${r.duracao_s}`);
});
Deno.test("MP4 com índice (moov) no FIM: acha lendo só cabeçalhos", async () => {
  const n = { n: 0 };
  const r = await analisarMp4(leitor(V.h264Fim, n), V.h264Fim.length);
  eq([r.ok, r.codec, r.largura, r.altura], [true, "H.264", 1280, 720]);
  assert(n.n <= 4, `leituras: ${n.n}`);
});
Deno.test("vídeo em pé 1080×1920 é aceito", async () => {
  const r = await analisarMp4(leitor(V.emPe), V.emPe.length);
  eq([r.ok, r.largura, r.altura], [true, 1080, 1920]);
});
Deno.test("H.265 (HEVC) é recusado com explicação", async () => {
  const r = await analisarMp4(leitor(V.hevc), V.hevc.length);
  eq([r.ok, r.codec], [false, "H.265 (HEVC)"]);
  assert(r.motivo.includes("H.264"));
});
Deno.test("4K é recusado", async () => {
  const r = await analisarMp4(leitor(V.k4), V.k4.length);
  eq([r.ok, r.largura], [false, 3840]);
  assert(r.motivo.includes("1080p"));
});
Deno.test("MP4 só com áudio, arquivo falso e MP4 cortado são recusados", async () => {
  eq((await analisarMp4(leitor(V.semVideo), V.semVideo.length)).motivo, "o arquivo não tem faixa de vídeo");
  const falso = new TextEncoder().encode("isto não é um vídeo, só tem extensão .mp4 ...");
  assert((await analisarMp4(leitor(falso), falso.length)).motivo.includes("não é um arquivo MP4"));
  const cortado = V.h264Fim.slice(0, Math.floor(V.h264Fim.length / 2));
  assert(!(await analisarMp4(leitor(cortado), cortado.length)).ok);
});

// ------------------------------------------------------------------ Drive imitado
type Item = { id: string; name: string; mimeType: string; parent: string; dados?: Uint8Array; md5?: string; resourceKey?: string };
function drive(itens: Item[], opts: { pastaPrivada?: string } = {}) {
  const pedidos: { url: URL; headers: Record<string, string> }[] = [];
  const f = (async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada)); const headers = (init?.headers ?? {}) as Record<string, string>;
    pedidos.push({ url, headers });
    if (url.searchParams.get("key") !== "CHAVE") return new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 });
    if (url.pathname === "/drive/v3/files") {
      const pai = url.searchParams.get("q")!.match(/'([^']+)' in parents/)![1];
      if (pai === opts.pastaPrivada) return new Response(JSON.stringify({ error: { message: "File not found" } }), { status: 404 });
      const files = itens.filter((i) => i.parent === pai).map((i) => ({ id: i.id, name: i.name, mimeType: i.mimeType, resourceKey: i.resourceKey,
        size: i.dados ? String(i.dados.length) : undefined, md5Checksum: i.md5 ?? (i.dados ? "md5-" + i.id : undefined), modifiedTime: "2026-11-04T10:00:00Z" }));
      return Response.json({ files });
    }
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    const it = itens.find((i) => i.id === id);
    if (!it?.dados) return new Response("{}", { status: 404 });
    const m = (headers.Range ?? "").match(/bytes=(\d+)-(\d+)/);
    return m ? new Response(it.dados.slice(+m[1], +m[2] + 1), { status: 206 }) : new Response(it.dados.slice());
  }) as typeof fetch;
  return { f, pedidos };
}
function bancoFalso(conta = { id: "c1", pasta_id: "RAIZ", pasta_chave: "", limite_mb: 5000 }) {
  const b = { gravado: null as Pasta[] | null, erro: null as string | null, reservas: 0, conferidos: new Map() as Conferidos, livre: true };
  const banco: BancoMidia = {
    reservar: () => { b.reservas++; return Promise.resolve(b.livre); },
    conta: () => Promise.resolve(conta),
    conferidos: () => Promise.resolve(b.conferidos),
    gravar: (_c, p, e) => { b.gravado = p; b.erro = e; return Promise.resolve(); },
  };
  return { b, banco };
}

Deno.test("ordem pelo nome comparando números como números", () => {
  eq(ordenar([{ name: "10_c.jpg" }, { name: "2_b.jpg" }, { name: "01_a.mp4" }]).map((x) => x.name), ["01_a.mp4", "2_b.jpg", "10_c.jpg"]);
});

Deno.test("sincronização: subpastas viram playlists, arquivos conferidos e na ordem do nome", async () => {
  const jpg = new Uint8Array(100);
  const { f, pedidos } = drive([
    { id: "SUB_HALL", name: "Hall", mimeType: PASTA, parent: "RAIZ", resourceKey: "rk1" },
    { id: "SUB_PRACA", name: "Praça", mimeType: PASTA, parent: "RAIZ" },
    { id: "v1", name: "02_promo.mp4", mimeType: "video/mp4", parent: "SUB_HALL", dados: V.h264 },
    { id: "i1", name: "01_cardapio.jpg", mimeType: "image/jpeg", parent: "SUB_HALL", dados: jpg },
    { id: "v2", name: "03_iphone.mp4", mimeType: "video/mp4", parent: "SUB_HALL", dados: V.hevc },
    { id: "g1", name: "anim.gif", mimeType: "image/gif", parent: "SUB_PRACA", dados: jpg },
    { id: "d1", name: "Slides", mimeType: "application/vnd.google-apps.presentation", parent: "SUB_PRACA" },
    { id: "m1", name: "video.mov", mimeType: "video/quicktime", parent: "SUB_PRACA", dados: jpg },
    { id: "SUB_SUB", name: "dentro", mimeType: PASTA, parent: "SUB_PRACA" },
  ]);
  const { b, banco } = bancoFalso();
  const r = await sincronizarConta(banco, "c1", "CHAVE", true, f);
  eq([r.feito, r.playlists, r.arquivos, r.recusados], [true, 2, 6, 4]);
  eq(b.gravado!.map((p) => p.nome), ["Hall", "Praça"], "sem 'Pasta principal' quando ela só tem subpastas");
  const hall = b.gravado![0].arquivos;
  eq(hall.map((a) => [a.nome, a.situacao]), [["01_cardapio.jpg", "ok"], ["02_promo.mp4", "ok"], ["03_iphone.mp4", "recusado"]]);
  eq(hall[1].codec, "H.264");
  const praca = Object.fromEntries(b.gravado![1].arquivos.map((a) => [a.nome, a.motivo]));
  assert(praca["anim.gif"].includes("JPG ou PNG") && praca["Slides"].includes("arquivo do Google") && praca["video.mov"].includes("converta para MP4"));
  assert(pedidos.some((p) => p.headers["X-Goog-Drive-Resource-Keys"] === "SUB_HALL/rk1"), "resource key da subpasta enviada");
});

Deno.test("sincronização: vídeo já conferido com o mesmo md5 não é baixado de novo", async () => {
  const { f, pedidos } = drive([{ id: "v1", name: "a.mp4", mimeType: "video/mp4", parent: "RAIZ", dados: V.h264, md5: "X" }]);
  const { b, banco } = bancoFalso();
  b.conferidos.set("v1", { md5: "X", situacao: "ok", motivo: "", largura: 1920, altura: 1080, duracao_s: 2, codec: "H.264" });
  await sincronizarConta(banco, "c1", "CHAVE", true, f);
  eq(b.gravado![0].nome, "Pasta principal");
  eq(b.gravado![0].arquivos[0].situacao, "ok");
  eq(pedidos.filter((p) => p.url.searchParams.get("alt") === "media").length, 0);
});

Deno.test("sincronização: limite de espaço da conta e vídeo acima de 300 MB", async () => {
  const grande = new Uint8Array(2 * 1048576);
  const { f } = drive([
    { id: "a", name: "1.jpg", mimeType: "image/jpeg", parent: "RAIZ", dados: grande },
    { id: "b", name: "2.jpg", mimeType: "image/jpeg", parent: "RAIZ", dados: grande },
  ]);
  const { b, banco } = bancoFalso({ id: "c1", pasta_id: "RAIZ", pasta_chave: "", limite_mb: 3 });
  await sincronizarConta(banco, "c1", "CHAVE", true, f);
  eq(b.gravado![0].arquivos.map((a) => a.situacao), ["ok", "recusado"]);
  assert(b.gravado![0].arquivos[1].motivo.includes("limite de espaço"));
  const enorme = (async () => Response.json({ files: [{ id: "z", name: "z.mp4", mimeType: "video/mp4", size: String(301 * 1048576), md5Checksum: "q" }] })) as unknown as typeof fetch;
  const x = bancoFalso();
  await sincronizarConta(x.banco, "c1", "CHAVE", true, enorme);
  assert(x.b.gravado![0].arquivos[0].motivo.includes("300 MB"));
});

Deno.test("sincronização: pasta não compartilhada ou sem chave grava o erro para o painel", async () => {
  const { f } = drive([], { pastaPrivada: "RAIZ" });
  const { b, banco } = bancoFalso();
  const r = await sincronizarConta(banco, "c1", "CHAVE", true, f);
  assert(r.erro?.includes("qualquer pessoa com o link") && b.erro === r.erro && b.gravado === null);
  const s = bancoFalso();
  assert((await sincronizarConta(s.banco, "c1", "", true, f)).erro?.includes("GOOGLE_DRIVE_CHAVE"));
});

Deno.test("sincronização: outra leitura em andamento (ou recente) não lê de novo", async () => {
  const { b, banco } = bancoFalso(); b.livre = false;
  const r = await sincronizarConta(banco, "c1", "CHAVE", false, (() => { throw new Error("não devia chamar o Drive"); }) as unknown as typeof fetch);
  eq(r.feito, false);
});

Deno.test("listarPasta segue as páginas", async () => {
  let n = 0;
  const f = (async (u: string | URL) => {
    n++; const t = new URL(String(u)).searchParams.get("pageToken");
    return Response.json(t ? { files: [{ id: "2", name: "b", mimeType: "image/png" }] } : { files: [{ id: "1", name: "a", mimeType: "image/png" }], nextPageToken: "p2" });
  }) as typeof fetch;
  eq((await listarPasta("RAIZ", "", "CHAVE", f)).map((x) => x.id), ["1", "2"]);
  eq(n, 2);
});

Deno.test("versão do conteúdo muda quando muda arquivo, ordem ou tempo", async () => {
  const a = await versaoConteudo([{ id: "1", md5: "x", tempo_s: 10 }, { id: "2", md5: "y" }]);
  assert(a !== await versaoConteudo([{ id: "1", md5: "x", tempo_s: 12 }, { id: "2", md5: "y" }]));
  assert(a !== await versaoConteudo([{ id: "2", md5: "y" }, { id: "1", md5: "x", tempo_s: 10 }]));
  eq(a, await versaoConteudo([{ id: "1", md5: "x", tempo_s: 10 }, { id: "2", md5: "y" }]));
});

"""Teste de tela das propostas e da vitrine pública (Playwright, Supabase imitado: testes/supabase_falso.js +
testes/propostas/propostas_falso.js). As regras do banco estão em testes/teste_sql.sql.
Fluxo: equipe Nervia cria a proposta na Administração → link + código → prospect abre com código errado e certo →
pede ajuste → equipe faz a versão 2 → prospect aprova → equipe marca como cliente (vai para Logins já preenchido).
Uso: python3 testes/propostas/tela_propostas_test.py [pasta_para_prints]
"""
import os, sys, re, threading, http.server, functools
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAIDA = sys.argv[1] if len(sys.argv) > 1 else None
FALSO = open(os.path.join(RAIZ, "testes", "supabase_falso.js"), encoding="utf-8").read() + "\n" + \
        open(os.path.join(RAIZ, "testes", "propostas", "propostas_falso.js"), encoding="utf-8").read()
PORTA = 8841
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(RAIZ, "site")))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORTA}"
ok = 0
def confere(cond, txt):
    global ok
    assert cond, txt
    ok += 1; print("ok ", txt)

def pagina(ctx, largura=1400):
    pg = ctx.new_page(); pg.set_viewport_size({"width": largura, "height": 900})
    erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.on("dialog", lambda d: d.accept())
    pg.route("**/supabase-js@*/**", lambda r: r.fulfill(body=FALSO, content_type="text/javascript"))
    pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    pg.route("https://wa.me/**", lambda r: r.fulfill(body="whatsapp", content_type="text/plain"))
    return pg, erros

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context()
    # ------------------------------------------------ equipe Nervia cria a proposta
    pg, erros = pagina(ctx)
    pg.goto(f"{URL}/cliente/?papel=admin"); pg.wait_for_selector(".app")
    pg.evaluate("location.hash = '#admin'"); pg.wait_for_selector("#abaPrp")
    pg.click("#abaPrp"); pg.wait_for_selector("text=Nenhuma proposta ainda.")
    confere(True, "Administração → Propostas abre vazia")
    pg.click("text=+ Nova proposta"); pg.wait_for_selector("#prProspect")
    pg.fill("#prProspect", "Harmonia do Corpo"); pg.fill("#prContato", "Dra. Deborah Gleichman"); pg.fill("#prZap", "(21) 98235-3913")
    pg.fill("#prTitulo", "Site com agendamento online"); pg.fill("#prResumo", "Site profissional para o studio.")
    pg.fill("#prModelo", "/modelos/harmonia-do-corpo-r7k2m9/")
    pg.fill("#prIncluido", "Site completo, pronto para celular | Início, serviços, sobre, planos e contato\nAgendamento online")
    pg.fill("#prPrecisamos", "Número do CREFITO\nFotos do studio")
    pg.fill("#prInv", "Criação do site | pagamento único | R$ 0,00\nMensalidade | site no ar e suporte | R$ 0,00 /mês")
    pg.click("text=Criar proposta"); pg.wait_for_selector("#msgAdm.ok")
    confere("criada" in pg.inner_text("#msgAdm"), "proposta criada pela tela")
    pg.wait_for_selector("#propMsg")
    mensagem = pg.input_value("#propMsg")
    link = re.search(r"/proposta/#([a-f0-9]{12})", mensagem).group(1)
    codigo = re.search(r"Código de acesso: (\d{6})", mensagem).group(1)
    confere(mensagem.startswith("Olá, Dra. Deborah Gleichman!"), "mensagem pronta com link e código: " + mensagem.splitlines()[0])
    confere("Rascunho" in pg.inner_text("#propDetalhe"), "começa como rascunho")
    confere("NÃO abre para o cliente" in pg.inner_text("#propDetalhe"), "rascunho avisa que o link ainda não abre para o cliente")
    previa = pg.get_attribute("a:has-text('Ver como o cliente')", "href")
    confere(previa.endswith("/proposta/?previa#" + link), "Ver como o cliente aponta para a prévia")
    pr, erros_pr = pagina(ctx)
    pr.goto(previa); pr.wait_for_selector("#pagina:not(.oculto)")
    confere("Prévia da equipe Nervia" in pr.inner_text("#situacao") and "RASCUNHO" in pr.inner_text("#situacao")
            and pr.locator("#resposta").is_hidden() and "Harmonia do Corpo" in pr.inner_text("#prospect"), "prévia abre o rascunho sem código e sem resposta")
    confere(not pr.evaluate("JSON.parse(localStorage.getItem('prop_teste')).prop_eventos.some(e => e.tipo === 'visualizada')"), "prévia não conta visita")
    pr.close()
    # prospect antes de enviar: não abre
    pp, erros_p = pagina(ctx, 390)
    pp.goto(f"{URL}/proposta/#{link}"); pp.wait_for_selector("#codigo")
    pp.fill("#codigo", codigo); pp.click("#bEntrar"); pp.wait_for_selector("#erroEntrada:not(.oculto)")
    confere("não está disponível" in pp.inner_text("#erroEntrada"), "rascunho não abre para o prospect")
    pg.click("button:has-text('Enviar no WhatsApp')"); pg.wait_for_selector("#msgAdm.ok")
    confere("Enviada" in pg.inner_text("#propDetalhe"), "Enviar no WhatsApp marca como enviada")
    # ------------------------------------------------ prospect (celular)
    pp.reload(); pp.wait_for_selector("#codigo")
    pp.fill("#codigo", "000000"); pp.click("#bEntrar"); pp.wait_for_selector("#erroEntrada:not(.oculto)")
    confere("Código incorreto" in pp.inner_text("#erroEntrada"), "código errado não abre")
    pp.fill("#codigo", codigo); pp.click("#bEntrar"); pp.wait_for_selector("#pagina:not(.oculto)")
    texto = pp.inner_text("#pagina")
    confere("Harmonia do Corpo" in pp.inner_text("#prospect") and "Site completo, pronto para celular" in texto and "Número do CREFITO" in texto
            and "Mensalidade" in texto, "proposta aberta com o conteúdo")
    confere(pp.get_attribute("#modeloQuadro", "src") == "/modelos/harmonia-do-corpo-r7k2m9/", "modelo do site aberto dentro da proposta")
    confere(pp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "celular sem rolagem lateral")
    if SAIDA: pp.screenshot(path=f"{SAIDA}/proposta_celular.png", full_page=True)
    pp.click("#bAjuste"); pp.wait_for_selector("#cxTexto:not(.oculto)")
    pp.click("#bAjuste"); pp.wait_for_selector("#erroResp:not(.oculto)")
    confere("Informe o seu nome" in pp.inner_text("#erroResp"), "resposta exige o nome")
    pp.fill("#nome", "Deborah"); pp.fill("#texto", "Trocar a foto do topo"); pp.click("#bAjuste")
    pp.wait_for_selector("#respFeita:not(.oculto)")
    confere("pedido de ajuste" in pp.inner_text("#respFeita"), "prospect pede ajuste")
    # ------------------------------------------------ equipe vê o ajuste e faz a versão 2
    pg.click("#abaPrp"); pg.wait_for_selector("text=Ajuste pedido")
    pg.click("button.lnk:has-text('abrir')"); pg.wait_for_selector("text=Trocar a foto do topo")
    confere("Aberta pelo prospect" in pg.inner_text("#propDetalhe"), "histórico mostra a visita e o ajuste")
    pg.click("#propDetalhe button:has-text('Editar')"); pg.wait_for_selector("#prResumo")
    pg.fill("#prResumo", "Site profissional para o studio, com a foto nova."); pg.click("#propEditor button:has-text('Salvar')")
    pg.wait_for_selector("#msgAdm.ok")
    confere("versão 2" in pg.inner_text("#msgAdm"), "editar depois do ajuste = versão 2 no mesmo link")
    # ------------------------------------------------ prospect aprova (código guardado na aba)
    pp.reload(); pp.wait_for_selector("#pagina:not(.oculto)")
    confere("versão 2" in pp.inner_text("#numero") and "foto nova" in pp.inner_text("#resumo"), "prospect vê a versão 2 sem digitar o código de novo")
    pp.fill("#nome", "Deborah Gleichman"); pp.click("#bAprovar"); pp.wait_for_selector("#respFeita:not(.oculto)")
    confere("Proposta aprovada" in pp.inner_text("#respFeita") and pp.locator("#bResponder").is_hidden(), "prospect aprova e os botões somem")
    # ------------------------------------------------ equipe: tornar cliente → Logins preenchido
    pg.click("#abaPrp"); pg.wait_for_selector("text=Aprovada")
    pg.click("button.lnk:has-text('abrir')"); pg.click("text=Tornar cliente (criar login)")
    pg.wait_for_selector("#nNome"); pg.wait_for_timeout(300)
    confere(pg.input_value("#nEmpresa") == "Harmonia do Corpo" and "Deborah" in pg.input_value("#nNome"), "virou cliente e o cadastro do login vem preenchido")
    # ------------------------------------------------ modelo e vitrine pública
    pm, erros_m = pagina(ctx)
    pm.goto(f"{URL}/modelos/harmonia-do-corpo-r7k2m9/"); pm.wait_for_selector("text=Agendar aula")
    confere(pm.locator("svg").count() > 0 and "Pedra de Guaratiba" in pm.inner_text("body"), "modelo do site abre (com a marca d'água de modelo)")
    pv, erros_v = pagina(ctx, 390)
    pv.goto(f"{URL}/produtos/"); pv.wait_for_selector(".card")
    grade = pv.inner_text("#grade")
    confere(pv.locator(".card").count() == 3 and "Disponível" in grade and "Em desenvolvimento" in grade and "Ver demonstração" in grade,
            "vitrine pública lista os produtos com a situação")
    confere(pv.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "vitrine no celular sem rolagem lateral")
    todos = erros + erros_pr + erros_p + erros_m + erros_v
    confere(not todos, "nenhum erro de JavaScript: " + "; ".join(todos))
    b.close()
print(f"TODOS OS TESTES DE TELA DAS PROPOSTAS OK ({ok})")

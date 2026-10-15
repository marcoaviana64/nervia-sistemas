"""Gera exportações FICTÍCIAS no formato do portal Claro Empresas (Relatório de Dados, de Chamadas e de Assinante),
usadas pela demonstração (/demo/telefonia/) e pelos testes de tela do app Auditoria de Telefonia Móvel.
Empresa, pessoas, números e consumo são inventados. Uso: python3 testes/telefonia/gerar_exemplo.py
Gera duas exportações (10/07 e 15/10/2026) que se sobrepõem num dia, como acontece de verdade."""
import os, random, datetime as dt
AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "exemplo")
os.makedirs(SAIDA, exist_ok=True)
rnd = random.Random(2026)
INI, FIM = dt.date(2026, 4, 6), dt.date(2026, 10, 15)
CORTE = dt.date(2026, 7, 10)  # primeira exportação vai até aqui (dia parcial)
AM, MU = "PJ Passaporte Americas Voz/SMS ilimitado + 5 GB", "PJ Passaporte Mundo Voz/SMS ilimitado + 10 GB"
# número, plano (GB), adicionais, web médio GB/dia, social, whats
LINHAS = [
    ("5521990000101", 100, [AM, MU], 1.30, 0.25, 0.04),   # Ana: uso intenso
    ("5521990000102", 100, [MU],     0.40, 0.08, 0.02),   # Bruno: superdimensionada
    ("5521990000103", 100, [AM, MU], 0.30, 0.20, 0.03),   # Carla: superdimensionada, viajando no fim
    ("5521990000104", 50,  [],       0.55, 0.15, 0.03),   # Diego
    ("5521990000105", 25,  [],       0.0,  0.0,  0.0),    # Elisa: linha parada
    ("5521990000106", 100, [AM],     0.70, 0.12, 0.03),   # Fábio
]
ROAM = {"5521990000101": [(dt.date(2026, 6, 14), dt.date(2026, 6, 19), AM, 0.55)],
        "5521990000103": [(dt.date(2026, 10, 3), dt.date(2026, 10, 15), MU, 0.68)]}
def dias(a, b):
    d = a
    while d <= b: yield d; d += dt.timedelta(days=1)
def mb(v): return f"{v * 1024:.2f};MB" if v < 1 else f"{v:.2f};GB"
def em_roaming(n, d):
    return next((r for r in ROAM.get(n, []) if r[0] <= d <= r[1]), None)

dados = []
for n, fr, add, w, s, z in LINHAS:
    for d in dias(INI, FIM):
        r = em_roaming(n, d)
        if r:
            dados.append((d, f"+{n};{n};{d};{mb(max(0.05, rnd.gauss(r[3], 0.25)))};Roaming;{r[2]};")); continue
        if w == 0: continue
        fator = 3.2 if (n.endswith("106") and d.month == 5 and d.day in (12, 13, 20, 27)) else 1
        web = max(0.003, rnd.expovariate(1 / w) * fator)
        dados.append((d, f"+{n};{n};{d};{mb(web)};Web;Claro Pós {fr}GB;"))
        dados.append((d, f"+{n};{n};{d};{mb(max(0.001, rnd.expovariate(1 / s)))};Facebook, Instagram e Twitter;Pacote Redes Sociais PME 40GB;"))
        dados.append((d, f"+{n};{n};{d};{mb(max(0.0005, rnd.expovariate(1 / z)))};WhatsApp;Pacote Mensageria;"))
        if n.endswith("104") and rnd.random() < .3:
            dados.append((d, f"+{n};{n};{d};{mb(rnd.uniform(.002, .03))};Waze;Pacote Waze;"))
TIPOS = ["Móvel para Fixo Outras Operadoras Local", "Móvel Intagrupo Local", "Móvel para Móvel Outras Operadoras Local", "Chamada Especial 0800"]
cham = []
for n, *_ in LINHAS:
    for d in dias(INI, FIM):
        if n.endswith("105"):
            if rnd.random() < .25: cham.append((d, f"+{n};{n};;{d:%d/%m/%Y};{rnd.randint(8, 19):02d}:{rnd.randint(0, 59):02d}:{rnd.randint(0, 59):02d};+5510407000000;00:00:30;Claro Recados"))
            continue
        for _ in range(rnd.choice([0, 0, 1, 1, 2])):
            seg = int(rnd.expovariate(1 / 150)) + 15
            cham.append((d, f"+{n};{n};;{d:%d/%m/%Y};{rnd.randint(8, 19):02d}:{rnd.randint(0, 59):02d}:{rnd.randint(0, 59):02d};+5521{rnd.randint(20000000, 39999999)};{seg // 3600:02d}:{seg % 3600 // 60:02d}:{seg % 60:02d};{rnd.choice(TIPOS)}"))
        if rnd.random() < .05:
            cham.append((d, f"+{n};{n};;{d:%d/%m/%Y};12:00:00;+{n};00:00:30;Móvel Intagrupo Local"))
def escrever(nome, titulo, cab, linhas):
    with open(os.path.join(SAIDA, nome), "w", encoding="utf-8", newline="\n") as f:
        f.write(titulo + "\n" + cab + "\n" + "\n".join(linhas) + "\n")
CAB_D = "CP+CA+Numero;Nome;Data;Valor Consumo;Unidade Consumo;Grupo de classificacao;Oferta e pacote usado"
CAB_C = "CP+CA+Numero;Nome;Sobrenome;Data;Hora;CP + CA + Numero;Duracao;Tipo de chamadas"
# exportação 1: até o CORTE, com o último dia pela metade
d1 = [l for d, l in dados if d < CORTE] + [l for d, l in dados if d == CORTE][::2]
escrever("Relatorio-Dados-20260710_120000000.csv", "Relatorio-Dados", CAB_D, d1)
escrever("Relatorio-Chamadas-20260710_120100000.csv", "Relatorio-Chamadas", CAB_C, [l for d, l in cham if d <= CORTE])
# exportação 2: do CORTE (dia completo) até o fim
escrever("Relatorio-Dados-20261015_090000000.csv", "Relatorio-Dados", CAB_D, [l for d, l in dados if d >= CORTE])
escrever("Relatorio-Chamadas-20261015_090100000.csv", "Relatorio-Chamadas", CAB_C, [l for d, l in cham if d >= CORTE])
ass = [f"{n};{n};700000001;Linhas sem Departamento;8955000000000000{i:04d};Claro Pós {fr}GB|Claro Pós {fr}GB  " + "".join("|" + a for a in add) + ";TudoLiberado;Ativo"
       for i, (n, fr, add, *_r) in enumerate(LINHAS, 1)]
escrever("Relatorio-assinante-20261015_090200000.csv", "Relatorio-Assinante", "Nome;Numero da linha;Numero da conta;Departamento;Iccid;Oferta;Perfil da linha;Status", ass)
print("ok", SAIDA, len(dados), "registros de dados,", len(cham), "chamadas")

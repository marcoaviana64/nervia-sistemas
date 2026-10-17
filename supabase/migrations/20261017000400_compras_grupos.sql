-- Orçamentos de Compras: lista de grupos de compra sugerida pelo Marco (17/10/2026), com descrição do que entra
-- em cada um. Os grupos antigos que têm equivalente são RENOMEADOS (as requisições acompanham pelo
-- "on update cascade"; nos fornecedores, que guardam a lista de grupos, a troca é feita aqui). "Automação"
-- e "Outros" continuam. Subgrupos (ex.: "Manutenção predial > Elétrica") ficam para depois, se precisar.

alter table public.cmp_grupos add column if not exists descricao text not null default '';

create temp table cmp_grupos_de_para (antigo text, novo text);
insert into cmp_grupos_de_para values
  ('Tecnologia', 'Informática e tecnologia'),
  ('Refrigeração', 'Ar-condicionado e ventilação'),
  ('Limpeza', 'Material de limpeza e higiene'),
  ('Segurança', 'Segurança e prevenção de incêndio'),
  ('Jardinagem', 'Paisagismo e áreas externas'),
  ('Obras civis', 'Obras e reformas'),
  ('Mão de obra', 'Serviços contratados'),
  ('Energia', 'Água e energia');

-- fornecedores: troca o nome antigo pelo novo na lista de grupos (sem repetir)
update public.cmp_fornecedores f
   set grupos = array(select distinct on (coalesce(m.novo, g.nome)) coalesce(m.novo, g.nome)
                        from unnest(f.grupos) with ordinality as g(nome, i) left join cmp_grupos_de_para m on m.antigo = g.nome
                       order by coalesce(m.novo, g.nome), g.i)
 where f.grupos && (select array_agg(antigo) from cmp_grupos_de_para);

-- grupos: renomeia (requisições acompanham); se o nome novo já existir, só aponta as requisições e apaga o antigo
update public.cmp_requisicoes r set grupo = m.novo
  from cmp_grupos_de_para m
 where r.grupo = m.antigo and exists (select 1 from public.cmp_grupos where nome = m.novo);
delete from public.cmp_grupos g using cmp_grupos_de_para m
 where g.nome = m.antigo and exists (select 1 from public.cmp_grupos where nome = m.novo);
update public.cmp_grupos g set nome = m.novo from cmp_grupos_de_para m where g.nome = m.antigo;

insert into public.cmp_grupos (nome, ordem, descricao) values
  ('Informática e tecnologia', 10, 'Computadores, periféricos, redes, softwares e acessórios.'),
  ('Papelaria e material de escritório', 20, 'Papel, canetas, pastas, etiquetas e itens de arquivo.'),
  ('Material de limpeza e higiene', 30, 'Produtos de limpeza, sacos de lixo, papel toalha, sabonete e dispensers.'),
  ('Manutenção predial', 40, 'Materiais elétricos, hidráulicos, pintura, alvenaria e ferramentas.'),
  ('Ar-condicionado e ventilação', 50, 'Filtros, peças, dutos e materiais de refrigeração.'),
  ('Segurança e prevenção de incêndio', 60, 'EPIs, sinalização, extintores, alarmes e itens de controle de acesso.'),
  ('Materiais de operação', 70, 'Itens da rotina das equipes de estacionamento, docas, áreas comuns e apoio operacional.'),
  ('Mobiliário e equipamentos', 80, 'Mesas, cadeiras, armários, estantes e equipamentos de uso administrativo ou operacional.'),
  ('Comunicação visual e sinalização', 90, 'Placas, banners, adesivos, impressos e materiais de orientação.'),
  ('Marketing e eventos', 100, 'Brindes, decoração, materiais promocionais, estruturas e serviços para campanhas.'),
  ('Uniformes e identificação', 110, 'Uniformes, crachás, distintivos e acessórios das equipes.'),
  ('Copa e alimentação', 120, 'Café, água, alimentos, utensílios e descartáveis para uso interno.'),
  ('Veículos e transporte', 130, 'Combustível, peças, pneus, manutenção e serviços de transporte.'),
  ('Serviços contratados', 140, 'Manutenção especializada, limpeza, vigilância, consultoria e mão de obra terceirizada.'),
  ('Telefonia e conectividade', 150, 'Celulares, linhas, chips, internet e equipamentos de comunicação.'),
  ('Despesas administrativas e taxas', 160, 'Cartórios, licenças, tarifas, taxas e assinaturas.'),
  ('Paisagismo e áreas externas', 170, 'Plantas, terra, adubo, irrigação e materiais de jardinagem.'),
  ('Gestão de resíduos e sustentabilidade', 180, 'Coletores, materiais de reciclagem e serviços de destinação.'),
  ('Obras e reformas', 190, 'Materiais e serviços para reformas, adequações e melhorias.'),
  ('Água e energia', 200, 'Materiais, medidores, componentes e serviços ligados ao consumo e à eficiência.'),
  ('Automação', 210, 'Automação predial, controladores, sensores e peças de elevadores e escadas rolantes.'),
  ('Outros', 999, 'O que não se encaixa nos grupos acima.')
on conflict (nome) do update set ordem = excluded.ordem, descricao = excluded.descricao;

drop table cmp_grupos_de_para;

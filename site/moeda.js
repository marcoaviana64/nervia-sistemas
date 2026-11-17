/* Valores em reais digitados no formato brasileiro (pedido do Marco em 17/11/2026: o fornecedor digitou
   "24.087,08" num campo type="number", o navegador entendeu 24,08708 e a proposta foi gravada como R$ 24,09).
   Campos de dinheiro usam <input data-moeda inputmode="decimal"> (texto, não number).
   window.NERVIA_MOEDA.ler(texto) → número, null (vazio) ou NaN (formato que não dá para entender com certeza).
   Aceita "24.087,08", "24087,08", "R$ 24.087,08", "24087.08" (ponto com até 2 casas = decimal), "24.087" (= 24087).
   Recusa "24.0870", "1,234" (3 casas), "24,087.08" e letras. Ao digitar, mostra embaixo como foi entendido e
   marca o campo como inválido (setCustomValidity), então o formulário não envia valor ambíguo. */
(function () {
  const MILHAR = /^\d{1,3}(\.\d{3})+$/;
  function ler(t) {
    t = String(t == null ? "" : t).replace(/R\$|\s/g, "");
    if (t === "") return null;
    if (!/^\d[\d.,]*$/.test(t) || /[.,]$/.test(t)) return NaN;
    let i, d = "";
    if (t.includes(",")) {
      const p = t.split(",");
      if (p.length > 2 || p[1].length > 2) return NaN;
      i = p[0]; d = p[1];
      if (i.includes(".")) { if (!MILHAR.test(i)) return NaN; i = i.replace(/\./g, ""); }
    } else if (t.includes(".")) {
      const p = t.split(".");
      if (p.length === 2 && p[1].length <= 2) { i = p[0]; d = p[1]; }
      else if (MILHAR.test(t)) i = t.replace(/\./g, "");
      else return NaN;
    } else i = t;
    return Number(i + "." + (d || "0"));
  }
  const brl = v => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  // valor para preencher o campo: 24087.08 → "24.087,08"
  const fmt = v => v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function conferir(el) {
    const v = ler(el.value);
    let dica = el.nextElementSibling;
    if (!dica || !dica.classList.contains("moeda-dica")) {
      dica = document.createElement("div"); dica.className = "moeda-dica";
      dica.style.cssText = "font-size:12px;margin-top:3px;color:#4f5f73";
      el.insertAdjacentElement("afterend", dica);
    }
    if (Number.isNaN(v)) {
      el.setCustomValidity("Valor não entendido. Use o formato 24.087,08 (ponto no milhar, vírgula nos centavos).");
      dica.textContent = "Não entendi o valor. Exemplo: 24.087,08"; dica.style.color = "#b42318";
    } else {
      el.setCustomValidity("");
      dica.textContent = v == null ? "" : "= " + brl(v); dica.style.color = "#4f5f73";
    }
  }
  document.addEventListener("input", ev => { if (ev.target.matches && ev.target.matches("input[data-moeda]")) conferir(ev.target); });
  // lê o campo e avisa se não deu para entender (para usar antes de gravar)
  function valor(texto, nome) {
    const v = ler(texto);
    if (Number.isNaN(v)) throw new Error(`${nome || "Valor"}: não entendi "${texto}". Use o formato 24.087,08.`);
    return v;
  }
  window.NERVIA_MOEDA = { ler, valor, fmt, conferir };
})();

// app.js — seletor de HORÁRIOS (Professores + Turmas) com PDF.js
// Requisitos: index.html com #typeSelect, #itemSelect, #status e #pdfCanvas
// PDFs no mesmo diretório:
//   - horarios-professores.pdf
//   - horarios-turmas.pdf

const PDFS = {
  prof: "./horarios-professores.pdf",
  turma: "./horarios-turmas.pdf",
};

const typeSelect = document.getElementById("typeSelect");
const itemSelect = document.getElementById("itemSelect");
const canvas = document.getElementById("pdfCanvas");
const statusEl = document.getElementById("status");
const ctx = canvas.getContext("2d");

// Worker do PDF.js (CDN)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";

let pdfDoc = null;
let pageMap = []; // [{ label, pageNumber }]
let currentType = typeSelect?.value || "prof";

// ---------- Utilidades ----------
function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function normalizeSpaces(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

async function getPageText(page) {
  const content = await page.getTextContent();
  return content.items.map((it) => it.str).join(" ");
}

// ---------- Extratores de rótulo (dropdown) ----------
// Professores: tenta achar "Professor Fulano de Tal"
function extractProfessorName(text) {
  const t = normalizeSpaces(text);

  // Ajuste se seu PDF de professores tiver outro padrão de cabeçalho
  // Ex.: "Professor Adelino Jacó Seibt"
  const m = t.match(/\bProfessor[a]?\s+[A-ZÀ-Ú][A-Za-zÀ-ú'´`^~\-\s]+/);
  if (!m) return null;

  return normalizeSpaces(m[0]);
}

// Turmas: ajustado ao seu PDF real (padrão do topo)
// Exemplos no arquivo: "INF 11 - ...", "ADM 11 - ...", "ENS T12 - ...", "ENF T3 - ..." :contentReference[oaicite:1]{index=1}
function extractTurmaName(text) {
  const t = normalizeSpaces(text);

  // Captura algo como:
  // INF 11 - 1º ANO Técnico em Informática Integrado
  // ADM 21 - 2º ano Técnico em Administração Integrado
  // ENS T12 - 1º sem Téc. Enfermagem [Registro no Sigaa]
  // ENF T3 - 1º sem Bacharelado em Enfermagem
  const m = t.match(/\b[A-Z]{2,4}\s?T?\d{1,2}\s?-\s.+?(?=(\bHorário criado\b|\bHORÁRIOS\b|$))/i);
  if (!m) return null;

  let label = m[0];

  // Limpeza: remove "Integrado..." e colchetes "[Registro ...]"
  label = label.replace(/\sIntegrado.*/i, "");
  label = label.replace(/\s\[[^\]]+\]/g, "");
  label = normalizeSpaces(label);

  // Mantém rótulo num tamanho razoável
  if (label.length > 80) label = label.slice(0, 80).trim() + "…";

  return label;
}

function extractLabel(text, type) {
  if (type === "prof") return extractProfessorName(text);
  return extractTurmaName(text);
}

// ---------- Carregar PDF e montar dropdown ----------
async function loadPdf(type) {
  currentType = type;
  const url = PDFS[type];

  itemSelect.disabled = true;
  itemSelect.innerHTML = `<option>Carregando…</option>`;
  setStatus("Carregando PDF…");

  pdfDoc = await pdfjsLib.getDocument(url).promise;

  setStatus("Lendo páginas e montando lista…");

  pageMap = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const text = await getPageText(page);
    const label = extractLabel(text, type) || `Página ${p}`;
    pageMap.push({ label, pageNumber: p });
  }

  // Ordena alfabeticamente (se preferir manter a ordem do PDF, comente esta linha)
  pageMap.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  itemSelect.innerHTML = "";
  for (const item of pageMap) {
    const opt = document.createElement("option");
    opt.value = String(item.pageNumber);
    opt.textContent = item.label;
    itemSelect.appendChild(opt);
  }

  itemSelect.disabled = false;
  setStatus(`Pronto: ${pdfDoc.numPages} páginas`);
}

// ---------- Renderizar página selecionada ----------
async function renderPage(pageNumber) {
  if (!pdfDoc) return;

  setStatus(`Renderizando página ${pageNumber}…`);

  const page = await pdfDoc.getPage(pageNumber);

  // Escala base
  const baseScale = 1.6;

  // Ajuste leve conforme largura disponível (para ficar bom no embed do Google Sites)
  const containerWidth = Math.min(document.body.clientWidth || 900, 1100);
  const viewport1 = page.getViewport({ scale: 1 });
  const fitScale = (containerWidth / viewport1.width) * baseScale;

  const viewport = page.getViewport({ scale: fitScale });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  setStatus("");
}

// ---------- (Opcional) parâmetros de URL ----------
function applyUrlParams() {
  // Permite abrir direto: ?tipo=turma&page=10
  const params = new URLSearchParams(window.location.search);

  const tipo = params.get("tipo");
  const page = parseInt(params.get("page"), 10);

  if (tipo === "prof" || tipo === "turma") {
    currentType = tipo;
    typeSelect.value = tipo;
  }

  return Number.isFinite(page) ? page : null;
}

function updateUrl(pageNumber) {
  const params = new URLSearchParams(window.location.search);
  params.set("tipo", currentType);
  params.set("page", String(pageNumber));
  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", newUrl);
}

// ---------- Inicialização ----------
async function init() {
  try {
    const initialPageFromUrl = applyUrlParams();

    await loadPdf(currentType);

    // Seleciona a página inicial
    let startPage = initialPageFromUrl || parseInt(itemSelect.value, 10) || 1;

    // Se veio página pela URL, tenta selecionar (se existir)
    if (initialPageFromUrl) itemSelect.value = String(startPage);

    await renderPage(startPage);
    updateUrl(startPage);

    // Eventos
    typeSelect.addEventListener("change", async () => {
      await loadPdf(typeSelect.value);
      const p = parseInt(itemSelect.value, 10) || 1;
      await renderPage(p);
      updateUrl(p);
    });

    itemSelect.addEventListener("change", async () => {
      const p = parseInt(itemSelect.value, 10) || 1;
      await renderPage(p);
      updateUrl(p);
    });
  } catch (e) {
    console.error(e);
    setStatus(
      "Erro ao carregar. Verifique se os PDFs estão no mesmo diretório e com os nomes: horarios-professores.pdf e horarios-turmas.pdf"
    );
  }
}

init();
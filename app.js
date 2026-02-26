// app.js — seletor de HORÁRIOS (Professores + Turmas) com PDF.js
// PDFs na raiz do GitHub Pages:
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

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";

let pdfDoc = null;
let pageMap = []; // [{ label, pageNumber }]
let currentType = typeSelect?.value || "prof";

// ---------------- Utils ----------------
function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function normalizeSpaces(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Para casos em que o PDF “junta” tokens e some com espaços:
function loosen(s) {
  // remove espaços para um 2º modo de busca (fallback)
  return (s || "").replace(/\s+/g, "");
}

async function getPageText(page) {
  const content = await page.getTextContent();
  // juntar tokens com espaço ajuda, mas alguns PDFs ainda “colam” tudo
  return content.items.map((it) => it.str).join(" ");
}

// ---------------- Label extractors ----------------

// PROFESSORES (robusto)
// 1) tenta "Professor Fulano..." ou "Prof. Fulano..."
// 2) se não achar, tenta pegar um nome próprio "Fulano de Tal" e filtra cabeçalhos comuns
function extractProfessorName(text) {
  const t = normalizeSpaces(text);
  const t2 = loosen(t);

  // 1) Com "Professor/Prof"
  let m =
    t.match(/\b(Professor[a]?|Prof\.?)\s+([A-ZÀ-Ú][A-Za-zÀ-ú'´`^~\-]+(?:\s+[A-ZÀ-Ú][A-Za-zÀ-ú'´`^~\-]+){1,5})\b/) ||
    t2.match(/\b(Professor[a]?|Prof\.?)\s*([A-ZÀ-Ú][A-Za-zÀ-ú'´`^~\-]+(?:[A-ZÀ-Ú][A-Za-zÀ-ú'´`^~\-]+){1,5})\b/);

  if (m) {
    // m[2] pode vir colado no modo loosen; não dá para “re-separar” perfeito,
    // então priorizamos o match com espaços; se cair no loosen, mostramos como está.
    const name = m[2] ? normalizeSpaces(m[2]) : null;
    if (name) return `Professor ${name}`;
  }

  // 2) Fallback por “nome próprio” (evita pegar "Instituto Federal Farroupilha")
  const head = t.slice(0, 260);
  const candidates = head.match(
    /\b[A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de|da|do|dos|das|e))?(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,5}\b/g
  );

  if (!candidates) return null;

  const blacklist = [
    "Instituto Federal",
    "Farroupilha",
    "Campus",
    "Santo",
    "Ângelo",
    "Horário criado",
    "aSc TimeTables",
    "HORÁRIOS",
  ];

  for (const c of candidates) {
    const ok = !blacklist.some((b) => c.toLowerCase().includes(b.toLowerCase()));
    if (ok) return c;
  }

  return null;
}

// TURMAS (ajustado ao seu PDF + robusto a espaços sumidos)
// Padrões esperados (exemplos reais): INF 11 - ..., ADM 11 - ..., ENS T12 - ..., ENF T3 - ... :contentReference[oaicite:1]{index=1}
function extractTurmaName(text) {
  const t = normalizeSpaces(text);
  const t2 = loosen(t);

  // 1) Modo normal (com espaços) — aceita hífen "-" ou "–"
  let m = t.match(/\b([A-Z]{2,4})\s*(T)?\s*(\d{1,2})\s*[-–]\s*([^]+?)\b/i);

  // 2) Fallback sem espaços (quando vira "INF11-1ºANO...")
  if (!m) {
    m = t2.match(/\b([A-Z]{2,4})(T)?(\d{1,2})[-–]([^]+?)\b/i);
  }

  if (!m) return null;

  const sigla = m[1].toUpperCase();
  const hasT = m[2] ? " T" : "";
  const numero = m[3];
  let resto = m[4] || "";

  // corta o resto para não virar “a página inteira”
  resto = normalizeSpaces(resto).slice(0, 90);

  // limpeza: remove "Integrado..." e colchetes "[Registro...]"
  resto = resto.replace(/\sIntegrado.*/i, "");
  resto = resto.replace(/\s\[[^\]]+\]/g, "");
  resto = normalizeSpaces(resto);

  // monta label
  let label = `${sigla}${hasT} ${numero} - ${resto}`.trim();

  // se ainda estiver grande, reduz
  if (label.length > 90) label = label.slice(0, 90).trim() + "…";

  return label;
}

function extractLabel(text, type) {
  return type === "prof" ? extractProfessorName(text) : extractTurmaName(text);
}

// ---------------- Load / render ----------------
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

  // Ordena alfabeticamente (se quiser manter ordem do PDF, comente)
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

async function renderPage(pageNumber) {
  if (!pdfDoc) return;

  setStatus(`Renderizando página ${pageNumber}…`);
  const page = await pdfDoc.getPage(pageNumber);

  // Ajuste de escala para embed (Google Sites)
  const baseScale = 1.5;
  const containerWidth = Math.min(document.body.clientWidth || 900, 1100);
  const viewport1 = page.getViewport({ scale: 1 });
  const fitScale = (containerWidth / viewport1.width) * baseScale;

  const viewport = page.getViewport({ scale: fitScale });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  setStatus("");
}

// URL opcional: ?tipo=turma&page=10
function applyUrlParams() {
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
  history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

async function init() {
  try {
    const initialPageFromUrl = applyUrlParams();

    await loadPdf(currentType);

    let startPage = initialPageFromUrl || parseInt(itemSelect.value, 10) || 1;
    if (initialPageFromUrl) itemSelect.value = String(startPage);

    await renderPage(startPage);
    updateUrl(startPage);

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
      "Erro ao carregar. Confira se os PDFs estão na raiz e com os nomes: horarios-professores.pdf e horarios-turmas.pdf"
    );
  }
}

init();
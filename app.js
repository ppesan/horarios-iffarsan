// ===== CONFIGURAÇÃO DOS PDFs =====
const PDFS = {
  prof: "./horarios-professores.pdf",
  turma: "./horarios-turmas.pdf",
};

// ===== ELEMENTOS =====
const typeSelect = document.getElementById("typeSelect");
const itemSelect = document.getElementById("itemSelect");
const searchInput = document.getElementById("searchInput");
const openPdfBtn = document.getElementById("openPdfBtn");
const canvas = document.getElementById("pdfCanvas");
const statusEl = document.getElementById("status");
const loadingDot = document.getElementById("loadingDot");
const ctx = canvas.getContext("2d");

// ===== WORKER LOCAL =====
pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.js";

// ===== ESTADO =====
let pdfDoc = null;
let currentType = "prof";
let allOptions = []; // [{page, label}] para filtrar sem reler PDF

// ===== UX =====
function setStatus(msg){
  statusEl.textContent = msg || "";
  if (loadingDot) loadingDot.classList.toggle("on", !!msg);
}

function normalize(text){
  return (text || "").replace(/\s+/g," ").trim();
}

function toSearchKey(s){
  return normalize(s).toLowerCase();
}

async function getPageText(page){
  const content = await page.getTextContent();
  return content.items.map(i => i.str).join(" ");
}

// ===== EXTRAÇÃO DE TURMAS =====
// Padrão típico do seu PDF: "INF 11 - ...", "ENS T12 - ...", etc.
function extractTurma(text){
  const t = normalize(text);
  const match = t.match(/\b[A-Z]{2,4}\s?T?\d{1,2}\s?[-–]\s?.{1,120}/);
  if(!match) return null;

  let label = match[0];
  label = label.replace(/\sIntegrado.*/i,"");
  label = label.replace(/\[[^\]]+\]/g,"");
  return normalize(label);
}

// ===== EXTRAÇÃO DE PROFESSORES =====
function extractProfessor(text){
  const t = normalize(text);
  const match = t.match(/\bProfessor[a]?\s+[A-ZÀ-Ú][A-Za-zÀ-ú\s'´`^~\-]{2,120}/);
  if(!match) return null;
  return normalize(match[0]);
}

function extractLabel(text,type){
  return type==="prof" ? extractProfessor(text) : extractTurma(text);
}

// ===== RENDERIZAÇÃO =====
async function renderPage(num){
  if (!pdfDoc) return;

  setStatus(`Renderizando página ${num}...`);

  const page = await pdfDoc.getPage(num);

  // Escala boa para embed
  const viewport = page.getViewport({ scale: 1.5 });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({
    canvasContext: ctx,
    viewport
  }).promise;

  setStatus("");
}

// ===== DROPDOWN =====
function fillDropdown(options){
  itemSelect.innerHTML = "";

  for (const opt of options){
    const o = document.createElement("option");
    o.value = String(opt.page);
    o.textContent = opt.label;
    itemSelect.appendChild(o);
  }

  itemSelect.disabled = options.length === 0;

  if (options.length === 0){
    const o = document.createElement("option");
    o.textContent = "Nenhum resultado";
    itemSelect.appendChild(o);
  }
}

function applyFilter(){
  const q = toSearchKey(searchInput.value);
  if (!q){
    fillDropdown(allOptions);
    return;
  }

  const filtered = allOptions.filter(o => toSearchKey(o.label).includes(q));
  fillDropdown(filtered);
}

// ===== BOTÃO ABRIR PDF =====
function updateOpenPdfBtn(){
  openPdfBtn.href = currentType === "turma" ? PDFS.turma : PDFS.prof;
}

// ===== CARREGAMENTO DO PDF =====
async function loadPdf(type){
  currentType = type;
  updateOpenPdfBtn();

  searchInput.value = "";
  itemSelect.disabled = true;
  itemSelect.innerHTML = `<option>Carregando...</option>`;

  setStatus("Carregando PDF...");

  pdfDoc = await pdfjsLib.getDocument(PDFS[type]).promise;

  setStatus("Lendo páginas e montando lista...");
  allOptions = [];

  for(let p=1; p<=pdfDoc.numPages; p++){
    const page = await pdfDoc.getPage(p);
    const text = await getPageText(page);
    const label = extractLabel(text,type) || `Página ${p}`;
    allOptions.push({ page: p, label });
  }

  // Ordena alfabeticamente (mais fácil de achar)
  allOptions.sort((a,b) => a.label.localeCompare(b.label, "pt-BR"));

  fillDropdown(allOptions);
  itemSelect.disabled = false;

  setStatus("");
  // Renderiza o primeiro item disponível
  if (allOptions.length > 0){
    await renderPage(allOptions[0].page);
  }
}

// ===== EVENTOS =====
typeSelect.addEventListener("change", () => {
  loadPdf(typeSelect.value);
});

itemSelect.addEventListener("change", () => {
  const p = parseInt(itemSelect.value, 10);
  if (Number.isFinite(p)) renderPage(p);
});

// Filtra enquanto digita
searchInput.addEventListener("input", () => {
  applyFilter();
  // Se houver resultado, renderiza o primeiro
  const first = itemSelect.querySelector("option");
  if (first && first.value){
    const p = parseInt(first.value, 10);
    if (Number.isFinite(p)) renderPage(p);
  }
});

// ===== INICIAR =====
updateOpenPdfBtn();
loadPdf("prof").catch(err => {
  console.error(err);
  setStatus("Erro ao carregar. Verifique arquivos e tente Ctrl+F5.");
});

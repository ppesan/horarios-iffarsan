// ===== CONFIGURAÇÃO DOS PDFs =====
const PDFS = {
  prof: "./horarios-professores.pdf",
  turma: "./horarios-turmas.pdf",
};

// ===== ELEMENTOS =====
const typeSelect = document.getElementById("typeSelect");
const itemSelect = document.getElementById("itemSelect");
const canvas = document.getElementById("pdfCanvas");
const statusEl = document.getElementById("status");
const ctx = canvas.getContext("2d");

// ===== WORKER LOCAL =====
pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.js";

let pdfDoc = null;

// ===== FUNÇÕES AUXILIARES =====
function setStatus(msg){
  statusEl.textContent = msg || "";
}

function normalize(text){
  return (text || "").replace(/\s+/g," ").trim();
}

async function getPageText(page){
  const content = await page.getTextContent();
  return content.items.map(i => i.str).join(" ");
}

// ===== EXTRAÇÃO DE TURMAS =====
function extractTurma(text){
  const t = normalize(text);
  const match = t.match(/\b[A-Z]{2,4}\s?T?\d{1,2}\s?[-–]\s?.{1,100}/);
  if(!match) return null;

  let label = match[0];
  label = label.replace(/\sIntegrado.*/i,"");
  label = label.replace(/\[[^\]]+\]/g,"");
  return normalize(label);
}

// ===== EXTRAÇÃO DE PROFESSORES =====
function extractProfessor(text){
  const t = normalize(text);
  const match = t.match(/\bProfessor[a]?\s+[A-ZÀ-Ú][A-Za-zÀ-ú\s'´`^~\-]{2,90}/);
  if(!match) return null;
  return normalize(match[0]);
}

function extractLabel(text,type){
  return type==="prof" ? extractProfessor(text) : extractTurma(text);
}

// ===== RENDERIZAÇÃO =====
async function renderPage(num){
  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale:1.5 });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;
}

// ===== CARREGAMENTO DO PDF =====
async function loadPdf(type){
  const url = PDFS[type];

  setStatus("Carregando PDF...");
  itemSelect.disabled = true;
  itemSelect.innerHTML = `<option>Carregando...</option>`;

  pdfDoc = await pdfjsLib.getDocument(url).promise;

  setStatus("Lendo páginas...");
  itemSelect.innerHTML = "";

  for(let p=1; p<=pdfDoc.numPages; p++){
    const page = await pdfDoc.getPage(p);
    const text = await getPageText(page);
    const label = extractLabel(text,type) || `Página ${p}`;

    const opt = document.createElement("option");
    opt.value = String(p);
    opt.textContent = label;
    itemSelect.appendChild(opt);
  }

  itemSelect.disabled = false;
  setStatus("");

  await renderPage(1);
}

// ===== EVENTOS =====
typeSelect.addEventListener("change",()=>{
  loadPdf(typeSelect.value);
});

itemSelect.addEventListener("change",()=>{
  renderPage(parseInt(itemSelect.value));
});

// ===== INICIAR =====
loadPdf("prof");
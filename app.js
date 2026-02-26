const PDFS = {
  prof: "./horarios-professores.pdf",
  turma: "./horarios-turmas.pdf",
};

const typeSelect = document.getElementById("typeSelect");
const itemSelect = document.getElementById("itemSelect");
const canvas = document.getElementById("pdfCanvas");
const statusEl = document.getElementById("status");
const ctx = canvas.getContext("2d");

// Worker usando jsDelivr
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.js";

let pdfDoc = null;
let currentType = "prof";

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

function extractTurma(text){
  const t = normalize(text);

  const match = t.match(/\b[A-Z]{2,4}\s?T?\d{1,2}\s?[-–]\s?.{1,80}/);

  if(!match) return null;

  let label = match[0];

  label = label.replace(/\sIntegrado.*/i,"");
  label = label.replace(/\[[^\]]+\]/g,"");

  return normalize(label);
}

function extractProfessor(text){
  const t = normalize(text);

  const match = t.match(/\bProfessor[a]?\s+[A-ZÀ-Ú][A-Za-zÀ-ú\s]+/);

  if(!match) return null;

  return normalize(match[0]);
}

function extractLabel(text,type){
  if(type==="prof"){
    return extractProfessor(text);
  }
  return extractTurma(text);
}

async function loadPdf(type){

  currentType = type;
  const url = PDFS[type];

  setStatus("Carregando PDF...");
  itemSelect.disabled = true;

  pdfDoc = await pdfjsLib.getDocument(url).promise;

  setStatus("Lendo páginas...");

  itemSelect.innerHTML = "";

  for(let p=1; p<=pdfDoc.numPages; p++){

    const page = await pdfDoc.getPage(p);
    const text = await getPageText(page);
    const label = extractLabel(text,type) || `Página ${p}`;

    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = label;

    itemSelect.appendChild(opt);
  }

  itemSelect.disabled = false;

  renderPage(1);
  setStatus("");
}

async function renderPage(num){

  const page = await pdfDoc.getPage(num);

  const viewport = page.getViewport({scale:1.5});

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;
}

typeSelect.addEventListener("change",()=>{
  loadPdf(typeSelect.value);
});

itemSelect.addEventListener("change",()=>{
  renderPage(parseInt(itemSelect.value));
});

loadPdf("prof");
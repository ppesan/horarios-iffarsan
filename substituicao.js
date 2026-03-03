// substituicao.js
// Lê o arquivo horarios_ocupacao_professores.csv na raiz do repositório
// Colunas esperadas: dia, periodo, inicio, fim, professor, turmas, disciplina

const CSV_URL = "./horarios_ocupacao_professores.csv";

const diaSelect = document.getElementById("diaSelect");
const horaSelect = document.getElementById("horaSelect");
const ausenteInput = document.getElementById("ausenteInput");
const profList = document.getElementById("profList");
const buscarBtn = document.getElementById("buscarBtn");

const statusEl = document.getElementById("status");
const loadingDot = document.getElementById("loadingDot");

const disponiveisList = document.getElementById("disponiveisList");
const ocupadosList = document.getElementById("ocupadosList");
const disponiveisHint = document.getElementById("disponiveisHint");
const ocupadosHint = document.getElementById("ocupadosHint");

let rows = [];          // todas as linhas do CSV
let professores = [];   // lista única de professores
let dias = [];          // lista única de dias
let horas = [];         // lista única de horários início

function setStatus(msg) {
  statusEl.textContent = msg || "";
  if (loadingDot) loadingDot.classList.toggle("on", !!msg);
}

function clearList(ul) {
  ul.innerHTML = "";
}

function addItem(ul, name, meta) {
  const li = document.createElement("li");
  li.className = "item";
  li.innerHTML = `
    <div class="name">${escapeHtml(name)}</div>
    <div class="meta">${escapeHtml(meta || "")}</div>
  `;
  ul.appendChild(li);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(s) {
  return String(s || "").trim();
}

// Parser CSV simples (compatível com UTF-8-sig e aspas)
function parseCSV(text) {
  // remove BOM (UTF-8-sig)
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length < 2) return [];

  const header = splitCSVLine(lines[0]).map(h => normalize(h).toLowerCase());
  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = normalize(cols[c] ?? "");
    out.push(obj);
  }
  return out;
}

function splitCSVLine(line) {
  const res = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' ) {
      if (inQuotes && line[i+1] === '"') { // escape ""
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      res.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  res.push(cur);
  return res;
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function fillSelect(select, values, placeholder) {
  select.innerHTML = "";
  if (placeholder) {
    const op = document.createElement("option");
    op.value = "";
    op.textContent = placeholder;
    select.appendChild(op);
  }
  for (const v of values) {
    const op = document.createElement("option");
    op.value = v;
    op.textContent = v;
    select.appendChild(op);
  }
}

function buildDatalist(datalist, values) {
  datalist.innerHTML = "";
  for (const v of values) {
    const op = document.createElement("option");
    op.value = v;
    datalist.appendChild(op);
  }
}

function currentSelection() {
  const dia = diaSelect.value;
  const inicio = horaSelect.value;
  const ausente = normalize(ausenteInput.value);
  return { dia, inicio, ausente };
}

function buscar() {
  const { dia, inicio, ausente } = currentSelection();

  clearList(disponiveisList);
  clearList(ocupadosList);
  disponiveisHint.textContent = "";
  ocupadosHint.textContent = "";

  if (!dia || !inicio) {
    disponiveisHint.textContent = "Selecione Dia e Horário para buscar.";
    return;
  }

  // Quem está ocupado nesse slot
  const ocupadosSlot = rows.filter(r => r.dia === dia && r.inicio === inicio);

  const ocupadosSet = new Set(ocupadosSlot.map(r => r.professor).filter(Boolean));

  // Se o usuário indicou ausente, remove ele da lista de disponíveis
  const ausenteNorm = ausente;
  const disponiveis = professores
    .filter(p => p && !ocupadosSet.has(p) && p !== ausenteNorm);

  // Render ocupados (com turma/discip)
  ocupadosSlot
    .sort((a,b) => (a.professor||"").localeCompare(b.professor||"", "pt-BR"))
    .forEach(r => {
      const meta = `${r.turmas || ""}${r.disciplina ? " • " + r.disciplina : ""}`.trim();
      addItem(ocupadosList, r.professor || "(sem nome)", meta);
    });

  // Render disponíveis (sem meta por enquanto)
  disponiveis
    .sort((a,b) => a.localeCompare(b, "pt-BR"))
    .forEach(p => addItem(disponiveisList, p, "Livre"));

  disponiveisHint.textContent = `Total disponíveis: ${disponiveis.length}`;
  ocupadosHint.textContent = `Total ocupados: ${ocupadosSlot.length}`;

  // Caso o ausente não esteja exatamente como no cadastro, avisa
  if (ausenteNorm && !professores.includes(ausenteNorm)) {
    disponiveisHint.textContent += " • (Obs.: o nome do ausente não bate exatamente com a lista)";
  }
}

async function init() {
  try {
    setStatus("Carregando base de dados...");

    // cache:'no-store' ajuda a evitar pegar CSV antigo
    const resp = await fetch(CSV_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Falha ao carregar CSV (${resp.status})`);

    const text = await resp.text();
    rows = parseCSV(text);

    // normaliza nomes de colunas que importam
    rows = rows.map(r => ({
      dia: r.dia || r["dia"] || "",
      inicio: r.inicio || r["início"] || "",
      fim: r.fim || "",
      professor: r.professor || "",
      turmas: r.turmas || "",
      disciplina: r.disciplina || "",
      periodo: r.periodo || r["período"] || ""
    }));

    professores = uniqueSorted(rows.map(r => r.professor).filter(Boolean));
    dias = uniqueSorted(rows.map(r => r.dia).filter(Boolean));

    // Horários: usamos o campo "inicio"
    horas = uniqueSorted(rows.map(r => r.inicio).filter(Boolean));

    fillSelect(diaSelect, dias, "Selecione...");
    fillSelect(horaSelect, horas, "Selecione...");
    buildDatalist(profList, professores);

    diaSelect.disabled = false;
    horaSelect.disabled = false;
    ausenteInput.disabled = false;
    buscarBtn.disabled = false;

    setStatus("");

    // auto-busca quando o usuário muda dia/hora
    diaSelect.addEventListener("change", buscar);
    horaSelect.addEventListener("change", buscar);
    buscarBtn.addEventListener("click", buscar);

  } catch (err) {
    console.error(err);
    setStatus("Erro: não consegui carregar o CSV. Verifique se ele está na raiz do repositório.");
  }
}

init();

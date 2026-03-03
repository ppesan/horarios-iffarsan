// substituicao.js — Regra 3 (disponibilidade apenas)
// Sugere professor B livre em S, e encontra um horário T em que B está ocupado e A (ausente) está livre.
// Versão robusta: normaliza horário (HH:MM) e agrupa por (dia + início), sem depender do "fim".

const CSV_URL = "./horarios_ocupacao_professores.csv";

const diaSelect = document.getElementById("diaSelect");
const horaSelect = document.getElementById("horaSelect");
const ausenteInput = document.getElementById("ausenteInput");
const profList = document.getElementById("profList");
const buscarBtn = document.getElementById("buscarBtn");

const statusEl = document.getElementById("status");
const loadingDot = document.getElementById("loadingDot");

const sugestoesList = document.getElementById("sugestoesList");
const ocupadosList = document.getElementById("ocupadosList");
const sugestoesHint = document.getElementById("sugestoesHint");
const ocupadosHint = document.getElementById("ocupadosHint");

// dados
let rows = [];
let professores = [];
let dias = [];
let horas = [];

// índices
let busyByProf = new Map();   // professor -> Set(slotKey)
let rowsBySlot = new Map();   // slotKey -> [rows ocupadas nesse slot]
let slotInfo = new Map();     // slotKey -> {dia,inicio}

// ---------- UX ----------
function setStatus(msg) {
  statusEl.textContent = msg || "";
  if (loadingDot) loadingDot.classList.toggle("on", !!msg);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearList(ul) {
  ul.innerHTML = "";
}

function addItem(ul, title, meta) {
  const li = document.createElement("li");
  li.className = "item";
  li.innerHTML = `
    <div class="name">${escapeHtml(title)}</div>
    <div class="meta">${escapeHtml(meta || "")}</div>
  `;
  ul.appendChild(li);
}

function normalize(s) {
  return String(s || "").trim();
}

function normalizeTime(t) {
  // Converte "15:30:00" -> "15:30" e remove espaços
  const x = normalize(t);
  if (!x) return "";
  // pega HH:MM se existir
  const m = x.match(/\b(\d{1,2}):(\d{2})/);
  if (!m) return x;
  const hh = m[1].padStart(2, "0");
  const mm = m[2];
  return `${hh}:${mm}`;
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function fillSelect(select, values, placeholder) {
  select.innerHTML = "";
  const op0 = document.createElement("option");
  op0.value = "";
  op0.textContent = placeholder || "Selecione...";
  select.appendChild(op0);

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

// ---------- CSV parser ----------
function splitCSVLine(line) {
  const res = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
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

function parseCSV(text) {
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

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

// ---------- Slots / índices ----------
function makeSlotKey(dia, inicio) {
  return `${dia}||${inicio}`;
}

function sortSlotKey(a, b) {
  const dayOrder = { "Segunda":1, "Terça":2, "Quarta":3, "Quinta":4, "Sexta":5 };
  const [da, ia] = a.split("||");
  const [db, ib] = b.split("||");
  const oa = dayOrder[da] || 99;
  const ob = dayOrder[db] || 99;
  if (oa !== ob) return oa - ob;
  return (ia || "").localeCompare(ib || "", "pt-BR");
}

function buildIndexes() {
  busyByProf = new Map();
  rowsBySlot = new Map();
  slotInfo = new Map();

  for (const r of rows) {
    const dia = r.dia;
    const inicio = r.inicio;
    const prof = r.professor;

    if (!dia || !inicio || !prof) continue;

    const key = makeSlotKey(dia, inicio);
    slotInfo.set(key, { dia, inicio });

    if (!rowsBySlot.has(key)) rowsBySlot.set(key, []);
    rowsBySlot.get(key).push(r);

    if (!busyByProf.has(prof)) busyByProf.set(prof, new Set());
    busyByProf.get(prof).add(key);
  }
}

// ---------- Regra de sugestão ----------
function currentSelection() {
  return {
    ausente: normalize(ausenteInput.value),
    dia: diaSelect.value,
    inicio: horaSelect.value
  };
}

function buscarSugestoes() {
  try {
    clearList(sugestoesList);
    clearList(ocupadosList);
    sugestoesHint.textContent = "";
    ocupadosHint.textContent = "";

    const { ausente, dia, inicio } = currentSelection();

    if (!ausente) {
      sugestoesHint.textContent = "Informe o professor ausente (obrigatório).";
      return;
    }
    if (!professores.includes(ausente)) {
      sugestoesHint.textContent = "Nome do ausente não bate exatamente com a lista. Selecione pelo autocomplete.";
      return;
    }
    if (!dia || !inicio) {
      sugestoesHint.textContent = "Selecione Dia e Horário.";
      return;
    }

    const slotS = makeSlotKey(dia, inicio);
    if (!slotInfo.has(slotS)) {
      sugestoesHint.textContent = `Não encontrei esse horário na base: ${dia} ${inicio}.`;
      return;
    }

    const ocupadosS = rowsBySlot.get(slotS) || [];
    const ocupadosSetS = new Set(ocupadosS.map(r => r.professor).filter(Boolean));

    // coluna "Ocupados"
    ocupadosS
      .slice()
      .sort((a,b) => (a.professor||"").localeCompare(b.professor||"", "pt-BR"))
      .forEach(r => {
        const meta = `${r.turmas || ""}${r.disciplina ? " • " + r.disciplina : ""}`.trim();
        addItem(ocupadosList, r.professor || "(sem nome)", meta);
      });
    ocupadosHint.textContent = `Total ocupados neste horário: ${ocupadosS.length}`;

    const busyA = busyByProf.get(ausente) || new Set();

    // candidatos B: livres em S
    const candidatos = professores.filter(p => p && p !== ausente && !ocupadosSetS.has(p));

    const sugestoes = [];

    for (const b of candidatos) {
      const busyB = busyByProf.get(b) || new Set();

      // T: algum slot em que B está ocupado e A está livre
      const possiveisT = Array.from(busyB)
        .filter(t => t !== slotS && !busyA.has(t))
        .sort(sortSlotKey);

      if (possiveisT.length === 0) continue;

      const melhorT = possiveisT[0];
      const infoT = slotInfo.get(melhorT);

      // pegar uma aula de B em T para mostrar turma/discip
      const aulasEmT = (rowsBySlot.get(melhorT) || []).filter(r => r.professor === b);
      const aula = aulasEmT[0];

      sugestoes.push({
        substituto: b,
        trocaDia: infoT?.dia || "",
        trocaInicio: infoT?.inicio || "",
        trocaTurmas: aula?.turmas || "",
        trocaDisciplina: aula?.disciplina || ""
      });
    }

    sugestoes.sort((a,b) => a.substituto.localeCompare(b.substituto, "pt-BR"));

    for (const s of sugestoes) {
      const meta =
        `Troca sugerida:\n${s.trocaDia} ${s.trocaInicio}` +
        `${s.trocaTurmas ? `\n${s.trocaTurmas}` : ""}` +
        `${s.trocaDisciplina ? `\n${s.trocaDisciplina}` : ""}`;

      addItem(sugestoesList, s.substituto, meta);
    }

    sugestoesHint.textContent =
      `Substitutos possíveis (com pelo menos 1 troca viável): ${sugestoes.length} • ` +
      `Candidatos livres no horário: ${candidatos.length}`;

  } catch (e) {
    console.error(e);
    sugestoesHint.textContent = "Ocorreu um erro na busca. Abra o console (F12) e me envie o print do erro.";
  }
}

// ---------- init ----------
async function init() {
  try {
    setStatus("Carregando base de dados...");

    const resp = await fetch(CSV_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Falha ao carregar CSV (${resp.status})`);
    const text = await resp.text();

    const raw = parseCSV(text);

    rows = raw.map(r => ({
      dia: normalize(r.dia),
      inicio: normalizeTime(r.inicio || r["início"]),
      fim: normalizeTime(r.fim),
      professor: normalize(r.professor),
      turmas: normalize(r.turmas),
      disciplina: normalize(r.disciplina),
    })).filter(r => r.dia && r.inicio && r.professor);

    professores = uniqueSorted(rows.map(r => r.professor));
    dias = uniqueSorted(rows.map(r => r.dia));
    horas = uniqueSorted(rows.map(r => r.inicio));

    buildIndexes();

    fillSelect(diaSelect, dias, "Selecione...");
    fillSelect(horaSelect, horas, "Selecione...");
    buildDatalist(profList, professores);

    diaSelect.disabled = false;
    horaSelect.disabled = false;
    ausenteInput.disabled = false;
    buscarBtn.disabled = false;

    setStatus("");

    buscarBtn.addEventListener("click", buscarSugestoes);

  } catch (err) {
    console.error(err);
    setStatus("Erro: não consegui carregar o CSV. Verifique se ele está na raiz do repositório.");
  }
}

init();

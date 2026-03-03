// substituicao.js — Regra 3 (disponibilidade apenas)
// Sugere professor B livre em S, e encontra um horário T em que B está ocupado e A (ausente) está livre.

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
let rows = [];                 // linhas normalizadas
let professores = [];          // lista única
let dias = [];                 // lista única
let horas = [];                // lista única (início)
let slots = [];                // slots possíveis (dia+inicio+fim)

// índices para performance
let busyByProf = new Map();    // professor -> Set(slotKey)
let rowsBySlot = new Map();    // slotKey -> [rows ocupadas nesse slot]
let slotInfo = new Map();      // slotKey -> {dia,inicio,fim}

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

// ---------- CSV parser (simples e robusto) ----------
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
  // remove BOM (UTF-8-sig)
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
function makeSlotKey(dia, inicio, fim) {
  return `${dia}||${inicio}||${fim}`;
}

function sortSlotKey(a, b) {
  // ordena por dia (seg..sex) e hora início
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
    const fim = r.fim;
    const prof = r.professor;

    if (!dia || !inicio || !fim || !prof) continue;

    const key = makeSlotKey(dia, inicio, fim);

    slotInfo.set(key, { dia, inicio, fim });

    if (!rowsBySlot.has(key)) rowsBySlot.set(key, []);
    rowsBySlot.get(key).push(r);

    if (!busyByProf.has(prof)) busyByProf.set(prof, new Set());
    busyByProf.get(prof).add(key);
  }

  slots = Array.from(slotInfo.keys()).sort(sortSlotKey);
}

// ---------- Regra de sugestão ----------
function currentSelection() {
  return {
    ausente: normalize(ausenteInput.value),
    dia: diaSelect.value,
    inicio: horaSelect.value
  };
}

function getSlotKeyByDiaHora(dia, inicio) {
  // encontra o slot que bate (dia+inicio); se houver mais de um fim, pega o primeiro
  for (const k of slots) {
    const info = slotInfo.get(k);
    if (info && info.dia === dia && info.inicio === inicio) return k;
  }
  return null;
}

function buscarSugestoes() {
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
    sugestoesHint.textContent = "Nome do ausente não bate exatamente com a lista. Selecione pelo campo (setinha/autocomplete).";
    return;
  }
  if (!dia || !inicio) {
    sugestoesHint.textContent = "Selecione Dia e Horário.";
    return;
  }

  const slotS = getSlotKeyByDiaHora(dia, inicio);
  if (!slotS) {
    sugestoesHint.textContent = "Não encontrei esse horário na base.";
    return;
  }

  const ocupadosS = rowsBySlot.get(slotS) || [];
  const ocupadosSetS = new Set(ocupadosS.map(r => r.professor).filter(Boolean));

  // ocupa a coluna "Ocupados"
  ocupadosS
    .slice()
    .sort((a,b) => (a.professor||"").localeCompare(b.professor||"", "pt-BR"))
    .forEach(r => {
      const meta = `${r.turmas || ""}${r.disciplina ? " • " + r.disciplina : ""}`.trim();
      addItem(ocupadosList, r.professor || "(sem nome)", meta);
    });
  ocupadosHint.textContent = `Total ocupados neste horário: ${ocupadosS.length}`;

  // sets de ocupação
  const busyA = busyByProf.get(ausente) || new Set();

  // Candidatos B: livres em S (não estão em ocupadosSetS) e não são o ausente
  const candidatos = professores.filter(p => p && p !== ausente && !ocupadosSetS.has(p));

  // Para cada B, procurar um T onde B está ocupado e A está livre
  const sugestoes = [];

  for (const b of candidatos) {
    const busyB = busyByProf.get(b) || new Set();
    // T: slots que B tem aula (ocupado)
    // Condição: A livre em T => T não está em busyA
    // Além disso, evitamos T == S (mesmo horário)
    let melhorT = null;

    for (const t of busyB) {
      if (t === slotS) continue;
      if (!busyA.has(t)) {
        melhorT = t;
        break; // já está ordenado? Não. Então escolhemos depois.
      }
    }

    if (melhorT) {
      // Para escolher o "melhor" T, vamos pegar o primeiro pela ordem de slots (seg..sex, hora)
      // então recalculamos pegando o mínimo segundo sortSlotKey
      const possiveis = Array.from(busyB).filter(t => t !== slotS && !busyA.has(t)).sort(sortSlotKey);
      melhorT = possiveis[0];

      // Pegamos o que B está dando em T para mostrar meta
      const aulasEmT = (rowsBySlot.get(melhorT) || []).filter(r => r.professor === b);
      const aula = aulasEmT[0]; // geralmente 1
      const infoT = slotInfo.get(melhorT);

      sugestoes.push({
        substituto: b,
        trocaDia: infoT?.dia || "",
        trocaInicio: infoT?.inicio || "",
        trocaFim: infoT?.fim || "",
        trocaTurmas: aula?.turmas || "",
        trocaDisciplina: aula?.disciplina || ""
      });
    }
  }

  // ordena sugestões por nome
  sugestoes.sort((a,b) => a.substituto.localeCompare(b.substituto, "pt-BR"));

  // render
  for (const s of sugestoes) {
    const meta =
      `Troca sugerida:\n${s.trocaDia} ${s.trocaInicio}–${s.trocaFim}` +
      `${s.trocaTurmas ? `\n${s.trocaTurmas}` : ""}` +
      `${s.trocaDisciplina ? `\n${s.trocaDisciplina}` : ""}`;

    addItem(sugestoesList, s.substituto, meta);
  }

  sugestoesHint.textContent =
    `Substitutos possíveis (com pelo menos 1 troca viável): ${sugestoes.length} • ` +
    `Candidatos livres no horário: ${candidatos.length}`;
}

// ---------- init ----------
async function init() {
  try {
    setStatus("Carregando base de dados...");

    const resp = await fetch(CSV_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Falha ao carregar CSV (${resp.status})`);
    const text = await resp.text();

    const raw = parseCSV(text);

    // normalização de colunas
    rows = raw.map(r => ({
      dia: r.dia || "",
      inicio: r.inicio || r["início"] || "",
      fim: r.fim || "",
      professor: r.professor || "",
      turmas: r.turmas || "",
      disciplina: r.disciplina || "",
      periodo: r.periodo || r["período"] || ""
    }));

    professores = uniqueSorted(rows.map(r => r.professor).filter(Boolean));
    dias = uniqueSorted(rows.map(r => r.dia).filter(Boolean));
    horas = uniqueSorted(rows.map(r => r.inicio).filter(Boolean));

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
    diaSelect.addEventListener("change", () => { /* opcional */ });
    horaSelect.addEventListener("change", () => { /* opcional */ });

  } catch (err) {
    console.error(err);
    setStatus("Erro: não consegui carregar o CSV. Verifique se ele está na raiz do repositório.");
  }
}

init();

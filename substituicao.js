// substituicao.js
// Regras:
// 1) Não sugerir trocas nas tardes de Terça, Quarta e Sexta
// 2) Permitir busca por 1, 2, 3 ou mais períodos consecutivos
// 3) O substituto deve estar livre em TODO o bloco solicitado
// 4) O substituto deve ter um bloco de troca com no mínimo a mesma quantidade de períodos
// 5) Manter a lógica de troca na mesma turma

const CSV_URL = "./horarios_ocupacao_professores.csv";

// Ajuste aqui se quiser mudar o início da "tarde"
const AFTERNOON_START = "12:00";

const diaSelect = document.getElementById("diaSelect");
const horaSelect = document.getElementById("horaSelect");
const quantidadeSelect = document.getElementById("quantidadeSelect");
const ausenteInput = document.getElementById("ausenteInput");
const profList = document.getElementById("profList");
const buscarBtn = document.getElementById("buscarBtn");

const statusEl = document.getElementById("status");
const loadingDot = document.getElementById("loadingDot");

const sugestoesList = document.getElementById("sugestoesList");
const ocupadosList = document.getElementById("ocupadosList");
const sugestoesHint = document.getElementById("sugestoesHint");
const ocupadosHint = document.getElementById("ocupadosHint");

let rows = [];
let professores = [];
let dias = [];
let horas = [];

let busyByProf = new Map();   // professor -> Set(slotKey)
let rowsBySlot = new Map();   // slotKey -> [rows]
let slotInfo = new Map();     // slotKey -> { dia, inicio }
let horasPorDia = new Map();  // dia -> [hora1, hora2, ...]

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
  const x = normalize(t);
  if (!x) return "";
  const m = x.match(/\b(\d{1,2}):(\d{2})/);
  if (!m) return x;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
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
  if (text && text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length < 2) return [];

  const header = splitCSVLine(lines[0]).map(h => normalize(h).toLowerCase());
  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = normalize(cols[c] ?? "");
    }
    out.push(obj);
  }

  return out;
}

function makeSlotKey(dia, inicio) {
  return `${dia}||${inicio}`;
}

function parseTimeToMinutes(t) {
  const x = normalizeTime(t);
  const m = x.match(/^(\d{2}):(\d{2})$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * 60 + Number(m[2]);
}

function sortTimes(a, b) {
  return parseTimeToMinutes(a) - parseTimeToMinutes(b);
}

function sortSlotKey(a, b) {
  const dayOrder = {
    "Segunda": 1,
    "Terça": 2,
    "Quarta": 3,
    "Quinta": 4,
    "Sexta": 5
  };

  const [da, ia] = a.split("||");
  const [db, ib] = b.split("||");

  const oa = dayOrder[da] || 99;
  const ob = dayOrder[db] || 99;

  if (oa !== ob) return oa - ob;
  return sortTimes(ia || "", ib || "");
}

function buildIndexes() {
  busyByProf = new Map();
  rowsBySlot = new Map();
  slotInfo = new Map();
  horasPorDia = new Map();

  for (const r of rows) {
    if (!r.dia || !r.inicio || !r.professor) continue;

    const key = makeSlotKey(r.dia, r.inicio);
    slotInfo.set(key, { dia: r.dia, inicio: r.inicio });

    if (!rowsBySlot.has(key)) rowsBySlot.set(key, []);
    rowsBySlot.get(key).push(r);

    if (!busyByProf.has(r.professor)) busyByProf.set(r.professor, new Set());
    busyByProf.get(r.professor).add(key);

    if (!horasPorDia.has(r.dia)) horasPorDia.set(r.dia, new Set());
    horasPorDia.get(r.dia).add(r.inicio);
  }

  for (const [dia, setHoras] of horasPorDia.entries()) {
    horasPorDia.set(dia, Array.from(setHoras).sort(sortTimes));
  }
}

function extractTurmaSet(turmasStr) {
  const s = normalize(turmasStr);
  if (!s) return new Set();
  return new Set(
    s.split(";")
      .map(p => normalize(p))
      .filter(Boolean)
  );
}

function currentSelection() {
  return {
    ausente: normalize(ausenteInput.value),
    dia: diaSelect.value,
    inicio: horaSelect.value,
    quantidade: Number(quantidadeSelect.value || "1")
  };
}

function intersectSets(setA, setB) {
  const out = new Set();
  for (const item of setA) {
    if (setB.has(item)) out.add(item);
  }
  return out;
}

function unionSets(sets) {
  const out = new Set();
  for (const s of sets) {
    for (const item of s) out.add(item);
  }
  return out;
}

function intersectionOfArrayOfSets(sets) {
  if (!sets.length) return new Set();
  let current = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    current = intersectSets(current, sets[i]);
  }
  return current;
}

function isBlockedAfternoon(dia, inicio) {
  const diasBloqueados = new Set(["Terça", "Quarta", "Sexta"]);
  if (!diasBloqueados.has(dia)) return false;
  return parseTimeToMinutes(inicio) >= parseTimeToMinutes(AFTERNOON_START);
}

function getConsecutiveSlots(dia, inicio, quantidade) {
  const horasDoDia = horasPorDia.get(dia) || [];
  const idx = horasDoDia.indexOf(inicio);
  if (idx < 0) return null;

  const bloco = horasDoDia.slice(idx, idx + quantidade);
  if (bloco.length !== quantidade) return null;

  return bloco.map(h => makeSlotKey(dia, h));
}

function blockTouchesRestrictedAfternoon(slotKeys) {
  for (const key of slotKeys) {
    const info = slotInfo.get(key);
    if (!info) return true;
    if (isBlockedAfternoon(info.dia, info.inicio)) return true;
  }
  return false;
}

function getProfessorRowsInBlock(professor, slotKeys) {
  const out = [];
  for (const key of slotKeys) {
    const rowsSlot = rowsBySlot.get(key) || [];
    const rowsProf = rowsSlot.filter(r => r.professor === professor);
    out.push(rowsProf);
  }
  return out;
}

function isProfessorBusyInAllSlots(professor, slotKeys) {
  const busy = busyByProf.get(professor) || new Set();
  return slotKeys.every(k => busy.has(k));
}

function isProfessorFreeInAllSlots(professor, slotKeys) {
  const busy = busyByProf.get(professor) || new Set();
  return slotKeys.every(k => !busy.has(k));
}

function getTurmaReferenceForBlock(professor, slotKeys) {
  const rowsPorSlot = getProfessorRowsInBlock(professor, slotKeys);

  const turmaSetsPorSlot = rowsPorSlot.map(rowsSlot => {
    const unionSlot = new Set();
    for (const row of rowsSlot) {
      const tset = extractTurmaSet(row.turmas);
      for (const turma of tset) unionSlot.add(turma);
    }
    return unionSlot;
  });

  const inter = intersectionOfArrayOfSets(turmaSetsPorSlot);
  if (inter.size > 0) {
    return inter;
  }

  return unionSets(turmaSetsPorSlot);
}

function getBusyRowsInBlock(slotKeys) {
  const map = new Map();

  for (const key of slotKeys) {
    const rowsSlot = rowsBySlot.get(key) || [];
    for (const row of rowsSlot) {
      if (!row.professor) continue;
      if (!map.has(row.professor)) map.set(row.professor, []);
      map.get(row.professor).push(row);
    }
  }

  return map;
}

function findCandidateTradeBlock(ausente, substituto, quantidade, turmasReferencia, slotOrigem) {
  const busySub = busyByProf.get(substituto) || new Set();
  const horasCandidato = Array.from(busySub).sort(sortSlotKey);

  for (const slotInicial of horasCandidato) {
    if (slotInicial === slotOrigem[0]) continue;

    const info = slotInfo.get(slotInicial);
    if (!info) continue;

    const blocoT = getConsecutiveSlots(info.dia, info.inicio, quantidade);
    if (!blocoT) continue;

    // Não permitir bloco de troca em tarde bloqueada
    if (blockTouchesRestrictedAfternoon(blocoT)) continue;

    // B precisa estar ocupado em todo o bloco T
    if (!isProfessorBusyInAllSlots(substituto, blocoT)) continue;

    // A precisa estar livre em todo o bloco T
    if (!isProfessorFreeInAllSlots(ausente, blocoT)) continue;

    const turmasBlocoT = getTurmaReferenceForBlock(substituto, blocoT);
    const turmasComuns = intersectSets(turmasReferencia, turmasBlocoT);

    if (turmasComuns.size === 0) continue;

    const turmaEscolhida = Array.from(turmasComuns).sort((a, b) => a.localeCompare(b, "pt-BR"))[0];
    const primeiroInfo = slotInfo.get(blocoT[0]);
    const ultimoInfo = slotInfo.get(blocoT[blocoT.length - 1]);

    const primeiraLinha = (rowsBySlot.get(blocoT[0]) || []).find(r => r.professor === substituto);

    return {
      blocoT,
      turma: turmaEscolhida,
      trocaDia: primeiroInfo?.dia || "",
      trocaInicio: primeiroInfo?.inicio || "",
      trocaFim: ultimoInfo?.inicio || "",
      disciplina: primeiraLinha?.disciplina || ""
    };
  }

  return null;
}

function formatBlockLabel(slotKeys) {
  if (!slotKeys || !slotKeys.length) return "";
  const primeira = slotInfo.get(slotKeys[0]);
  const ultima = slotInfo.get(slotKeys[slotKeys.length - 1]);
  if (!primeira || !ultima) return "";
  return `${primeira.dia} • ${primeira.inicio} até ${ultima.inicio} (${slotKeys.length} período(s))`;
}

function buscarSugestoes() {
  clearList(sugestoesList);
  clearList(ocupadosList);
  sugestoesHint.textContent = "";
  ocupadosHint.textContent = "";

  const { ausente, dia, inicio, quantidade } = currentSelection();

  if (!ausente) {
    sugestoesHint.textContent = "Informe o professor ausente.";
    return;
  }

  if (!professores.includes(ausente)) {
    sugestoesHint.textContent = "Nome do ausente não bate exatamente com a lista. Selecione pelo autocomplete.";
    return;
  }

  if (!dia || !inicio) {
    sugestoesHint.textContent = "Selecione o dia e o horário inicial.";
    return;
  }

  if (!Number.isInteger(quantidade) || quantidade < 1) {
    sugestoesHint.textContent = "Selecione uma quantidade válida de períodos.";
    return;
  }

  const blocoS = getConsecutiveSlots(dia, inicio, quantidade);
  if (!blocoS) {
    sugestoesHint.textContent = "Não encontrei quantidade suficiente de períodos consecutivos a partir deste horário.";
    return;
  }

  if (blockTouchesRestrictedAfternoon(blocoS)) {
    sugestoesHint.textContent =
      "Não é permitido sugerir trocas nas tardes de terça, quarta e sexta. Escolha outro bloco.";
    return;
  }

  // Ausente precisa estar ocupado em todo o bloco de origem
  if (!isProfessorBusyInAllSlots(ausente, blocoS)) {
    sugestoesHint.textContent =
      "O professor ausente não aparece ocupado em todos os períodos consecutivos selecionados. Verifique o horário e a quantidade de períodos.";
    return;
  }

  const turmasReferencia = getTurmaReferenceForBlock(ausente, blocoS);
  if (turmasReferencia.size === 0) {
    sugestoesHint.textContent =
      "Não consegui identificar a turma do bloco selecionado para o professor ausente.";
    return;
  }

  const ocupadosMap = getBusyRowsInBlock(blocoS);
  const professoresOcupadosNoBloco = new Set(ocupadosMap.keys());

  const ocupadosOrdenados = Array.from(ocupadosMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

  for (const [prof, linhas] of ocupadosOrdenados) {
    const turmas = uniqueSorted(
      linhas.flatMap(l => Array.from(extractTurmaSet(l.turmas)))
    );
    const disciplinas = uniqueSorted(
      linhas.map(l => normalize(l.disciplina)).filter(Boolean)
    );

    const meta =
      `${formatBlockLabel(blocoS)}\n` +
      (turmas.length ? `Turma(s): ${turmas.join(" | ")}\n` : "") +
      (disciplinas.length ? `Disciplina(s): ${disciplinas.join(" | ")}` : "");

    addItem(ocupadosList, prof, meta.trim());
  }

  ocupadosHint.textContent =
    `Bloco selecionado: ${formatBlockLabel(blocoS)}\n` +
    `Professores ocupados no bloco: ${ocupadosOrdenados.length}`;

  const candidatos = professores.filter(p =>
    p &&
    p !== ausente &&
    !professoresOcupadosNoBloco.has(p) &&
    isProfessorFreeInAllSlots(p, blocoS)
  );

  const sugestoes = [];

  for (const candidato of candidatos) {
    const troca = findCandidateTradeBlock(ausente, candidato, quantidade, turmasReferencia, blocoS);

    if (!troca) continue;

    sugestoes.push({
      substituto: candidato,
      turma: troca.turma,
      trocaDia: troca.trocaDia,
      trocaInicio: troca.trocaInicio,
      trocaFim: troca.trocaFim,
      disciplina: troca.disciplina
    });
  }

  sugestoes.sort((a, b) => a.substituto.localeCompare(b.substituto, "pt-BR"));

  for (const s of sugestoes) {
    const meta =
      `Livre em: ${formatBlockLabel(blocoS)}\n` +
      `Troca na mesma turma: ${s.turma}\n` +
      `Bloco de troca: ${s.trocaDia} • ${s.trocaInicio} até ${s.trocaFim} (${quantidade} período(s))` +
      (s.disciplina ? `\nDisciplina no bloco de troca: ${s.disciplina}` : "");

    addItem(sugestoesList, s.substituto, meta);
  }

  sugestoesHint.textContent =
    `Bloco solicitado: ${formatBlockLabel(blocoS)}\n` +
    `Turma(s) de referência: ${Array.from(turmasReferencia).join(" | ")}\n` +
    `Candidatos livres no bloco: ${candidatos.length}\n` +
    `Substitutos sugeridos: ${sugestoes.length}`;
}

async function init() {
  try {
    setStatus("Carregando base de dados...");

    const resp = await fetch(CSV_URL, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`Falha ao carregar CSV (${resp.status})`);
    }

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
    horas = uniqueSorted(rows.map(r => r.inicio)).sort(sortTimes);

    buildIndexes();

    fillSelect(diaSelect, dias, "Selecione...");
    fillSelect(horaSelect, horas, "Selecione...");
    buildDatalist(profList, professores);

    diaSelect.disabled = false;
    horaSelect.disabled = false;
    quantidadeSelect.disabled = false;
    ausenteInput.disabled = false;
    buscarBtn.disabled = false;

    buscarBtn.addEventListener("click", buscarSugestoes);

    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("Erro: não consegui carregar o CSV. Verifique se ele está na raiz do repositório.");
  }
}

init();

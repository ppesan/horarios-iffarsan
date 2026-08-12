/// substituicao.js

const CSV_URL = "./horarios_ocupacao_professores.csv";

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

const PERIOD_GRID = {
  manhã: [
    { codigo: "M1", inicio: "07:30", fim: "08:20", periodoLabel: "1º Período (manhã)", ordem: 1, turno: "manhã" },
    { codigo: "M2", inicio: "08:20", fim: "09:10", periodoLabel: "2º Período (manhã)", ordem: 2, turno: "manhã" },
    { codigo: "M3", inicio: "09:10", fim: "10:00", periodoLabel: "3º Período (manhã)", ordem: 3, turno: "manhã" },
    { codigo: "M4", inicio: "10:20", fim: "11:10", periodoLabel: "4º Período (manhã)", ordem: 4, turno: "manhã" },
    { codigo: "M5", inicio: "11:10", fim: "12:00", periodoLabel: "5º Período (manhã)", ordem: 5, turno: "manhã" }
  ],
  tarde: [
    { codigo: "T1", inicio: "13:30", fim: "14:20", periodoLabel: "1º Período (tarde)", ordem: 1, turno: "tarde" },
    { codigo: "T2", inicio: "14:20", fim: "15:10", periodoLabel: "2º Período (tarde)", ordem: 2, turno: "tarde" },
    { codigo: "T3", inicio: "15:30", fim: "16:20", periodoLabel: "3º Período (tarde)", ordem: 3, turno: "tarde" },
    { codigo: "T4", inicio: "16:20", fim: "17:10", periodoLabel: "4º Período (tarde)", ordem: 4, turno: "tarde" }
  ],
  noite: [
    { codigo: "N1", inicio: "19:00", fim: "19:50", periodoLabel: "1º Período (noite)", ordem: 1, turno: "noite" },
    { codigo: "N2", inicio: "19:50", fim: "20:40", periodoLabel: "2º Período (noite)", ordem: 2, turno: "noite" },
    { codigo: "N3", inicio: "20:50", fim: "21:40", periodoLabel: "3º Período (noite)", ordem: 3, turno: "noite" },
    { codigo: "N4", inicio: "21:40", fim: "22:30", periodoLabel: "4º Período (noite)", ordem: 4, turno: "noite" }
  ]
};

const PERIOD_BY_START = new Map();
const PERIODS_ALL = [];

for (const turno of Object.keys(PERIOD_GRID)) {
  for (const p of PERIOD_GRID[turno]) {
    PERIOD_BY_START.set(p.inicio, p);
    PERIODS_ALL.push(p);
  }
}

let rows = [];
let professores = [];
let dias = [];
let horas = [];

let busyByProf = new Map();
let planejamentoByProf = new Map();
let rowsBySlot = new Map();
let slotInfo = new Map();
let validStartsByDay = new Map();

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
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
  if (ul) ul.innerHTML = "";
}

function addItem(ul, title, meta, options = {}) {
  if (!ul) return;

  const li = document.createElement("li");
  li.className = options.planejamento ? "item planejamento" : "item";

  li.innerHTML = `
    <div class="name">${escapeHtml(title)}</div>
    <div class="meta">${escapeHtml(meta || "")}</div>
    ${options.planejamento ? `<span class="tag-planejamento">📋 Dia de Planejamento — consultar o professor</span>` : ""}
  `;

  ul.appendChild(li);
}

function normalize(s) {
  return String(s || "").trim();
}

function normalizeLower(s) {
  return normalize(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isPlanejamentoRow(row) {
  const texto = normalizeLower(`
    ${row.dia || ""}
    ${row.inicio || ""}
    ${row.fim || ""}
    ${row.professor || ""}
    ${row.turmas || ""}
    ${row.disciplina || ""}
    ${row.textoOriginal || ""}
  `);

  return texto.includes("planejamento");
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

function parseTimeToMinutes(t) {
  const x = normalizeTime(t);
  const m = x.match(/^(\d{2}):(\d{2})$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * 60 + Number(m[2]);
}

function sortTimes(a, b) {
  return parseTimeToMinutes(a) - parseTimeToMinutes(b);
}

function sortDiasSemana(a, b) {
  const ordem = {
    "Segunda": 1,
    "Terça": 2,
    "Quarta": 3,
    "Quinta": 4,
    "Sexta": 5
  };
  return (ordem[a] || 99) - (ordem[b] || 99);
}

function getFriendlyHourLabel(hora) {
  const p = getPeriodByStart(hora);
  if (!p) return hora;
  return `${hora} — ${p.periodoLabel}`;
}

function fillSelect(select, values, placeholder, labelFn) {
  if (!select) return;

  const currentValue = select.value;
  select.innerHTML = "";

  const op0 = document.createElement("option");
  op0.value = "";
  op0.textContent = placeholder || "Selecione...";
  select.appendChild(op0);

  for (const v of values) {
    const op = document.createElement("option");
    op.value = v;
    op.textContent = typeof labelFn === "function" ? labelFn(v) : v;
    select.appendChild(op);
  }

  select.value = values.includes(currentValue) ? currentValue : "";
}

function buildDatalist(datalist, values) {
  if (!datalist) return;
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
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

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

function parseSlotKey(key) {
  if (!key || !String(key).includes("||")) return null;
  const [dia, inicio] = String(key).split("||");
  return { dia, inicio };
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
  planejamentoByProf = new Map();
  rowsBySlot = new Map();
  slotInfo = new Map();
  validStartsByDay = new Map();

  for (const r of rows) {
    if (!r.dia || !r.inicio || !r.professor) continue;

    const key = makeSlotKey(r.dia, r.inicio);
    const planejamento = isPlanejamentoRow(r);

    slotInfo.set(key, { dia: r.dia, inicio: r.inicio });

    if (!rowsBySlot.has(key)) rowsBySlot.set(key, []);
    rowsBySlot.get(key).push(r);

    if (planejamento) {
      if (!planejamentoByProf.has(r.professor)) planejamentoByProf.set(r.professor, new Set());
      planejamentoByProf.get(r.professor).add(key);
    } else {
      if (!busyByProf.has(r.professor)) busyByProf.set(r.professor, new Set());
      busyByProf.get(r.professor).add(key);
    }

    if (PERIOD_BY_START.has(r.inicio)) {
      if (!validStartsByDay.has(r.dia)) validStartsByDay.set(r.dia, new Set());
      validStartsByDay.get(r.dia).add(r.inicio);
    }
  }

  for (const [dia, startSet] of validStartsByDay.entries()) {
    validStartsByDay.set(dia, Array.from(startSet).sort(sortTimes));
  }
}

function extractTurmaSet(turmasStr) {
  const s = normalize(turmasStr);
  if (!s) return new Set();

  return new Set(
    s.split(";")
      .map(p => normalize(p))
      .filter(Boolean)
      .filter(p => !normalizeLower(p).includes("planejamento"))
  );
}

function currentSelection() {
  return {
    ausente: normalize(ausenteInput ? ausenteInput.value : ""),
    dia: diaSelect ? diaSelect.value : "",
    inicio: horaSelect ? horaSelect.value : "",
    quantidade: Number(quantidadeSelect ? quantidadeSelect.value : "1")
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

function getPeriodByStart(start) {
  return PERIOD_BY_START.get(normalizeTime(start)) || null;
}

function isBlockedAfternoon(dia, inicio) {
  const period = getPeriodByStart(inicio);
  if (!period) return false;

  const diasBloqueados = new Set(["Terça", "Quarta", "Sexta"]);
  return diasBloqueados.has(dia) && period.turno === "tarde";
}

function getConsecutivePedagogicalSlots(dia, inicio, quantidade) {
  const period = getPeriodByStart(inicio);
  if (!period) return null;

  const sequence = PERIOD_GRID[period.turno] || [];
  const idx = sequence.findIndex(p => p.inicio === period.inicio);
  if (idx < 0) return null;

  const bloco = sequence.slice(idx, idx + quantidade);
  if (bloco.length !== quantidade) return null;

  return bloco.map(p => makeSlotKey(dia, p.inicio));
}

function blockTouchesRestrictedAfternoon(slotKeys) {
  for (const key of slotKeys) {
    const info = slotInfo.get(key) || parseSlotKey(key);
    if (!info) return true;
    if (isBlockedAfternoon(info.dia, info.inicio)) return true;
  }
  return false;
}

function getProfessorRowsInBlock(professor, slotKeys, options = {}) {
  const includePlanejamento = options.includePlanejamento === true;
  const out = [];

  for (const key of slotKeys) {
    const rowsSlot = rowsBySlot.get(key) || [];
    const rowsProf = rowsSlot.filter(r => {
      if (r.professor !== professor) return false;
      if (!includePlanejamento && isPlanejamentoRow(r)) return false;
      return true;
    });
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

function isWeekday(dia) {
  return ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"].includes(dia);
}

function professorHasAnyClassOnDay(professor, dia) {
  if (!isWeekday(dia)) return false;

  const busy = busyByProf.get(professor) || new Set();

  for (const key of busy) {
    const info = slotInfo.get(key) || parseSlotKey(key);
    if (info && info.dia === dia) return true;
  }

  return false;
}

function isProfessorPlanningDay(professor, dia) {
  return isWeekday(dia) && !professorHasAnyClassOnDay(professor, dia);
}

function isProfessorInPlanejamentoInAnySlot(professor, slotKeys) {
  const plan = planejamentoByProf.get(professor) || new Set();
  return slotKeys.some(k => plan.has(k));
}

function getPlanejamentoLabels(professor, slotKeys) {
  const plan = planejamentoByProf.get(professor) || new Set();

  return slotKeys
    .filter(k => plan.has(k))
    .map(k => {
      const info = slotInfo.get(k) || parseSlotKey(k);
      if (!info) return "";
      const p = getPeriodByStart(info.inicio);
      return p ? `${info.inicio} — ${p.periodoLabel}` : info.inicio;
    })
    .filter(Boolean);
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
  if (inter.size > 0) return inter;

  return unionSets(turmaSetsPorSlot);
}

function getBusyRowsInBlock(slotKeys) {
  const map = new Map();

  for (const key of slotKeys) {
    const rowsSlot = rowsBySlot.get(key) || [];

    for (const row of rowsSlot) {
      if (!row.professor) continue;
      if (isPlanejamentoRow(row)) continue;

      if (!map.has(row.professor)) map.set(row.professor, []);
      map.get(row.professor).push(row);
    }
  }

  return map;
}

function getBlockPeriodLabels(slotKeys) {
  return slotKeys
    .map(key => {
      const info = slotInfo.get(key) || parseSlotKey(key);
      if (!info) return "";
      const p = getPeriodByStart(info.inicio);
      return p ? p.periodoLabel : info.inicio;
    })
    .filter(Boolean);
}

function formatBlockLabel(slotKeys) {
  if (!slotKeys || !slotKeys.length) return "";

  const firstInfo = slotInfo.get(slotKeys[0]) || parseSlotKey(slotKeys[0]);
  const lastInfo = slotInfo.get(slotKeys[slotKeys.length - 1]) || parseSlotKey(slotKeys[slotKeys.length - 1]);

  if (!firstInfo || !lastInfo) return "";

  const firstPeriod = getPeriodByStart(firstInfo.inicio);
  const lastPeriod = getPeriodByStart(lastInfo.inicio);

  const turno = firstPeriod ? firstPeriod.turno : "";
  const inicioTexto = firstInfo.inicio;
  const fimTexto = lastPeriod ? lastPeriod.fim : lastInfo.inicio;

  return `${firstInfo.dia} • ${inicioTexto} até ${fimTexto} • ${slotKeys.length} período(s)${turno ? ` • ${turno}` : ""}`;
}

function getCandidateTradeStartKeys(substituto) {
  const busySub = busyByProf.get(substituto) || new Set();

  return Array.from(busySub)
    .filter(key => {
      const info = slotInfo.get(key);
      if (!info) return false;
      return !!getPeriodByStart(info.inicio);
    })
    .sort(sortSlotKey);
}

function findCandidateTradeBlock(ausente, substituto, quantidade, turmasReferencia, slotOrigem) {
  const startKeys = getCandidateTradeStartKeys(substituto);

  for (const startKey of startKeys) {
    const info = slotInfo.get(startKey);
    if (!info) continue;

    const blocoT = getConsecutivePedagogicalSlots(info.dia, info.inicio, quantidade);
    if (!blocoT) continue;

    if (slotOrigem[0] === blocoT[0]) continue;
    if (blockTouchesRestrictedAfternoon(blocoT)) continue;
    if (!isProfessorBusyInAllSlots(substituto, blocoT)) continue;
    if (!isProfessorFreeInAllSlots(ausente, blocoT)) continue;

    const turmasBlocoT = getTurmaReferenceForBlock(substituto, blocoT);
    const turmasComuns = intersectSets(turmasReferencia, turmasBlocoT);

    if (turmasComuns.size === 0) continue;

    const turmaEscolhida = Array.from(turmasComuns).sort((a, b) => a.localeCompare(b, "pt-BR"))[0];
    const primeiroInfo = slotInfo.get(blocoT[0]) || parseSlotKey(blocoT[0]);
    const ultimoInfo = slotInfo.get(blocoT[blocoT.length - 1]) || parseSlotKey(blocoT[blocoT.length - 1]);
    const ultimoPeriod = ultimoInfo ? getPeriodByStart(ultimoInfo.inicio) : null;

    const primeiraLinha = (rowsBySlot.get(blocoT[0]) || [])
      .find(r => r.professor === substituto && !isPlanejamentoRow(r));

    return {
      blocoT,
      turma: turmaEscolhida,
      trocaDia: primeiroInfo ? primeiroInfo.dia : "",
      trocaInicio: primeiroInfo ? primeiroInfo.inicio : "",
      trocaFim: ultimoPeriod ? ultimoPeriod.fim : (ultimoInfo ? ultimoInfo.inicio : ""),
      disciplina: primeiraLinha ? primeiraLinha.disciplina : ""
    };
  }

  return null;
}

function getValidHourOptionsFromRows(rowsData) {
  const horariosBase = Array.from(new Set(
    rowsData
      .map(r => normalizeTime(r.inicio || r["início"]))
      .filter(Boolean)
  )).sort(sortTimes);

  return horariosBase.filter(h => PERIOD_BY_START.has(h));
}

function getAllowedStartOptionsForDayAndQuantity(dia, quantidade) {
  if (!dia || !Number.isInteger(quantidade) || quantidade < 1) return [];

  const horariosDia = validStartsByDay.get(dia) || [];
  const validos = [];

  for (const inicio of horariosDia) {
    const bloco = getConsecutivePedagogicalSlots(dia, inicio, quantidade);
    if (!bloco) continue;
    if (blockTouchesRestrictedAfternoon(bloco)) continue;
    validos.push(inicio);
  }

  return validos.sort(sortTimes);
}

function refreshHourOptions() {
  if (!horaSelect) return;

  const dia = diaSelect ? diaSelect.value : "";
  const quantidade = Number(quantidadeSelect ? quantidadeSelect.value : "1");

  let novasOpcoes = [];

  if (dia) {
    novasOpcoes = getAllowedStartOptionsForDayAndQuantity(dia, quantidade);
  }

  fillSelect(
    horaSelect,
    novasOpcoes,
    novasOpcoes.length ? "Selecione..." : "Sem horários válidos",
    getFriendlyHourLabel
  );

  horaSelect.disabled = !dia || novasOpcoes.length === 0;
}

function buscarSugestoes() {
  clearList(sugestoesList);
  clearList(ocupadosList);

  if (sugestoesHint) sugestoesHint.textContent = "";
  if (ocupadosHint) ocupadosHint.textContent = "";

  const { ausente, dia, inicio, quantidade } = currentSelection();

  if (!ausente) {
    if (sugestoesHint) sugestoesHint.textContent = "Informe o professor ausente.";
    return;
  }

  if (!professores.includes(ausente)) {
    if (sugestoesHint) sugestoesHint.textContent = "Nome do ausente não bate exatamente com a lista. Selecione pelo autocomplete.";
    return;
  }

  if (!dia || !inicio) {
    if (sugestoesHint) sugestoesHint.textContent = "Selecione o dia e o horário inicial.";
    return;
  }

  if (!Number.isInteger(quantidade) || quantidade < 1) {
    if (sugestoesHint) sugestoesHint.textContent = "Selecione uma quantidade válida de períodos.";
    return;
  }

  const periodoInicial = getPeriodByStart(inicio);

  if (!periodoInicial) {
    if (sugestoesHint) {
      sugestoesHint.textContent = "Este horário inicial não pertence a um período letivo válido da grade.";
    }
    return;
  }

  const blocoS = getConsecutivePedagogicalSlots(dia, inicio, quantidade);

  if (!blocoS) {
    if (sugestoesHint) {
      sugestoesHint.textContent = "Não existe essa quantidade de períodos consecutivos dentro do mesmo turno a partir do horário selecionado.";
    }
    return;
  }

  if (blockTouchesRestrictedAfternoon(blocoS)) {
    if (sugestoesHint) {
      sugestoesHint.textContent = "Não é permitido sugerir trocas nas tardes de terça, quarta e sexta.";
    }
    return;
  }

  if (!isProfessorBusyInAllSlots(ausente, blocoS)) {
    if (sugestoesHint) {
      sugestoesHint.textContent = "O professor ausente não aparece ocupado em todos os períodos do bloco selecionado.";
    }
    return;
  }

  const turmasReferencia = getTurmaReferenceForBlock(ausente, blocoS);

  if (turmasReferencia.size === 0) {
    if (sugestoesHint) {
      sugestoesHint.textContent = "Não consegui identificar a turma do bloco selecionado para o professor ausente.";
    }
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
      `Períodos: ${getBlockPeriodLabels(blocoS).join(" | ")}\n` +
      (turmas.length ? `Turma(s): ${turmas.join(" | ")}\n` : "") +
      (disciplinas.length ? `Disciplina(s): ${disciplinas.join(" | ")}` : "");

    addItem(ocupadosList, prof, meta.trim());
  }

  if (ocupadosHint) {
    ocupadosHint.textContent =
      `Bloco selecionado: ${formatBlockLabel(blocoS)}\n` +
      `Períodos: ${getBlockPeriodLabels(blocoS).join(" | ")}\n` +
      `Professores ocupados em aula no bloco: ${ocupadosOrdenados.length}`;
  }

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

    const emPlanejamento = isProfessorPlanningDay(candidato, dia);
    const planejamentoLabels = emPlanejamento
      ? [`${dia}: professor sem aulas em nenhum turno (manhã, tarde ou noite)`]
      : [];

    sugestoes.push({
      substituto: candidato,
      turma: troca.turma,
      trocaDia: troca.trocaDia,
      trocaInicio: troca.trocaInicio,
      trocaFim: troca.trocaFim,
      disciplina: troca.disciplina,
      blocoT: troca.blocoT,
      planejamento: emPlanejamento,
      planejamentoLabels
    });
  }

  sugestoes.sort((a, b) => {
    if (a.planejamento !== b.planejamento) return a.planejamento ? 1 : -1;
    return a.substituto.localeCompare(b.substituto, "pt-BR");
  });

  for (const s of sugestoes) {
    const meta =
      `Livre em: ${formatBlockLabel(blocoS)}\n` +
      `Períodos livres: ${getBlockPeriodLabels(blocoS).join(" | ")}\n` +
      (s.planejamento ? `📋 Dia de Planejamento: o professor não possui aulas neste dia. Consulte-o antes de registrar uma eventual troca.\n` : "") +
      `Troca na mesma turma: ${s.turma}\n` +
      `Bloco de troca: ${s.trocaDia} • ${s.trocaInicio} até ${s.trocaFim} (${quantidade} período(s))\n` +
      `Períodos do bloco de troca: ${getBlockPeriodLabels(s.blocoT).join(" | ")}` +
      (s.disciplina ? `\nDisciplina no bloco de troca: ${s.disciplina}` : "");

    addItem(sugestoesList, s.substituto, meta, { planejamento: s.planejamento });
  }

  const totalPlanejamento = sugestoes.filter(s => s.planejamento).length;

  if (sugestoesHint) {
    sugestoesHint.textContent =
      `Bloco solicitado: ${formatBlockLabel(blocoS)}\n` +
      `Períodos: ${getBlockPeriodLabels(blocoS).join(" | ")}\n` +
      `Turma(s) de referência: ${Array.from(turmasReferencia).join(" | ")}\n` +
      `Candidatos livres no bloco: ${candidatos.length}\n` +
      `Substitutos sugeridos: ${sugestoes.length}\n` +
      `Sugestões em Dia de Planejamento: ${totalPlanejamento}`;
  }
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
      textoOriginal: Object.values(r).map(v => normalize(v)).join(" ")
    })).filter(r => r.dia && r.inicio && r.professor);

    professores = uniqueSorted(rows.map(r => r.professor));
    dias = Array.from(new Set(rows.map(r => r.dia))).sort(sortDiasSemana);
    horas = getValidHourOptionsFromRows(rows);

    buildIndexes();

    fillSelect(diaSelect, dias, "Selecione...");
    fillSelect(horaSelect, [], "Selecione o dia primeiro...", getFriendlyHourLabel);
    buildDatalist(profList, professores);

    if (diaSelect) diaSelect.disabled = false;
    if (quantidadeSelect) quantidadeSelect.disabled = false;
    if (ausenteInput) ausenteInput.disabled = false;
    if (buscarBtn) buscarBtn.disabled = false;

    refreshHourOptions();

    if (buscarBtn) {
      buscarBtn.addEventListener("click", buscarSugestoes);
    }

    if (diaSelect) {
      diaSelect.addEventListener("change", refreshHourOptions);
    }

    if (quantidadeSelect) {
      quantidadeSelect.addEventListener("change", refreshHourOptions);
    }

    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("Erro: não consegui carregar o CSV. Verifique se ele está na raiz do repositório.");
  }
}

init();

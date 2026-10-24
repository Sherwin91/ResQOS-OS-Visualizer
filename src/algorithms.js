const finiteNumber = (value, label, { min = 0, integer = false } = {}) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new Error(`${label} must be ${integer ? 'an integer ' : ''}at least ${min}`);
  }
  return n;
};

export function schedule(input, algorithm, quantum = 2) {
  if (!Array.isArray(input)) throw new Error('Processes must be an array');
  if (!['FCFS', 'SJF', 'Priority', 'Round Robin'].includes(algorithm)) throw new Error('Unknown scheduling algorithm');
  if (algorithm === 'Round Robin') quantum = finiteNumber(quantum, 'Time quantum', { min: 1 });
  const ids = new Set();
  const processes = input.map((raw, index) => {
    if (!raw.id || ids.has(String(raw.id))) throw new Error(`Process ${index + 1} needs a unique ID`);
    ids.add(String(raw.id));
    return {
      ...raw,
      id: String(raw.id),
      arrival: finiteNumber(raw.arrival, `${raw.id} arrival`),
      burst: finiteNumber(raw.burst, `${raw.id} burst`, { min: Number.EPSILON }),
      priority: finiteNumber(raw.priority ?? 0, `${raw.id} priority`),
      remaining: Number(raw.burst), first: null, done: false,
    };
  });
  if (!processes.length) return { timeline: [], rows: [], averages: { waiting: 0, turnaround: 0, response: 0 } };

  let time = 0, completed = 0;
  const timeline = [], ready = [];
  const add = (id, start, end) => {
    if (end <= start) return;
    const prev = timeline.at(-1);
    if (prev?.id === id && prev.end === start) prev.end = end;
    else timeline.push({ id, start, end });
  };
  const idleUntil = next => { if (next > time) { add('IDLE', time, next); time = next; } };
  const enqueueArrivals = (through, after = -Infinity) => processes
    .filter(p => !p.done && p !== running && p.arrival > after && p.arrival <= through && !ready.includes(p))
    .sort((a, b) => a.arrival - b.arrival || input.indexOf(a) - input.indexOf(b))
    .forEach(p => ready.push(p));
  let running = null;

  if (algorithm === 'Round Robin') {
    while (completed < processes.length) {
      enqueueArrivals(time);
      if (!ready.length) {
        idleUntil(Math.min(...processes.filter(p => !p.done).map(p => p.arrival)));
        enqueueArrivals(time);
      }
      running = ready.shift();
      if (running.first === null) running.first = time;
      const start = time, slice = Math.min(quantum, running.remaining);
      time += slice; running.remaining -= slice; add(running.id, start, time);
      enqueueArrivals(time, start);
      if (running.remaining > 0) ready.push(running);
      else { running.done = true; running.completion = time; completed++; }
      running = null;
    }
  } else {
    while (completed < processes.length) {
      const available = processes.filter(p => !p.done && p.arrival <= time);
      if (!available.length) {
        idleUntil(Math.min(...processes.filter(p => !p.done).map(p => p.arrival)));
        continue;
      }
      available.sort((a, b) => {
        if (algorithm === 'SJF') return a.burst - b.burst || a.arrival - b.arrival || input.indexOf(a) - input.indexOf(b);
        if (algorithm === 'Priority') return a.priority - b.priority || a.arrival - b.arrival || input.indexOf(a) - input.indexOf(b);
        return a.arrival - b.arrival || input.indexOf(a) - input.indexOf(b);
      });
      const p = available[0]; p.first = time;
      const start = time; time += p.burst; p.completion = time; p.done = true; completed++; add(p.id, start, time);
    }
  }

  const rows = processes.map(p => {
    const turnaround = p.completion - p.arrival;
    return { ...p, turnaround, waiting: turnaround - p.burst, response: p.first - p.arrival };
  });
  const average = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  return { timeline, rows, averages: { waiting: average('waiting'), turnaround: average('turnaround'), response: average('response') } };
}

function validateBankState(state) {
  if (!state || !Array.isArray(state.available) || !Array.isArray(state.processes)) throw new Error('Banker state is malformed');
  const resources = state.available.length;
  const available = state.available.map((v, j) => finiteNumber(v, `Available[${j}]`, { integer: true }));
  const totals = state.resources?.map((v, j) => finiteNumber(v, `Resources[${j}]`, { integer: true }));
  const ids = new Set();
  const processes = state.processes.map(p => {
    if (!p.id || ids.has(String(p.id))) throw new Error('Banker process IDs must be unique');
    ids.add(String(p.id));
    if (!Array.isArray(p.allocation) || !Array.isArray(p.max) || p.allocation.length !== resources || p.max.length !== resources) throw new Error(`${p.id} matrix dimensions do not match resources`);
    const allocation = p.allocation.map((v, j) => finiteNumber(v, `${p.id} Allocation[${j}]`, { integer: true }));
    const max = p.max.map((v, j) => finiteNumber(v, `${p.id} Max[${j}]`, { integer: true }));
    const need = max.map((v, j) => {
      if (v < allocation[j]) throw new Error(`${p.id} allocation cannot exceed maximum demand`);
      if (totals && v > totals[j]) throw new Error(`${p.id} maximum demand cannot exceed system instances`);
      return v - allocation[j];
    });
    return { ...p, allocation, max, need };
  });
  if (totals && totals.some((total, j) => total < available[j] + processes.reduce((sum, p) => sum + p.allocation[j], 0))) {
    throw new Error('Resource instances cannot be below allocated plus available resources');
  }
  return { ...state, available, processes };
}

export function banker(input) {
  const state = validateBankState(input);
  let work = [...state.available];
  const finish = state.processes.map(() => false), steps = [], sequence = [];
  while (true) {
    const i = state.processes.findIndex((p, index) => !finish[index] && p.need.every((need, j) => need <= work[j]));
    if (i < 0) break;
    const p = state.processes[i], before = [...work];
    work = work.map((value, j) => value + p.allocation[j]);
    finish[i] = true; sequence.push(p.id);
    steps.push({ id: p.id, before, released: [...p.allocation], after: [...work], finish: [...finish] });
  }
  return { safe: finish.every(Boolean), sequence, steps, work, finish };
}

export function requestResources(input, processId, request) {
  const state = validateBankState(input);
  const index = state.processes.findIndex(p => String(p.id) === String(processId));
  if (index < 0) throw new Error('Unknown process');
  if (!Array.isArray(request) || request.length !== state.available.length) throw new Error('Request vector has the wrong number of resources');
  const vector = request.map((v, j) => finiteNumber(v, `Request[${j}]`, { integer: true }));
  const p = state.processes[index];
  if (vector.some((v, j) => v > p.need[j])) return { granted: false, reason: 'exceeds-need', state, safety: null };
  if (vector.some((v, j) => v > state.available[j])) return { granted: false, reason: 'unavailable', state, safety: null };
  const tentative = {
    ...state,
    available: state.available.map((v, j) => v - vector[j]),
    processes: state.processes.map((item, i) => i === index
      ? { ...item, allocation: item.allocation.map((v, j) => v + vector[j]) }
      : item),
  };
  const safety = banker(tentative);
  if (!safety.safe) return { granted: false, reason: 'unsafe', state, safety };
  return { granted: true, reason: null, state: tentative, safety };
}

export function allocate(blocks, size, fit) {
  size = finiteNumber(size, 'Allocation size', { min: 1, integer: true });
  if (!['First Fit', 'Best Fit', 'Worst Fit'].includes(fit)) throw new Error('Unknown memory fit algorithm');
  blocks.forEach((block, index) => finiteNumber(block.size, `Block ${index + 1} size`, { min: 1, integer: true }));
  const candidates = blocks.map((block, index) => ({ block, index })).filter(x => !x.block.pid && x.block.size >= size);
  if (!candidates.length) return -1;
  candidates.sort((a, b) => fit === 'Best Fit' ? a.block.size - b.block.size || a.index - b.index
    : fit === 'Worst Fit' ? b.block.size - a.block.size || a.index - b.index : a.index - b.index);
  return candidates[0].index;
}

export function allocateMemory(blocks, pid, size, fit) {
  if (!pid) throw new Error('A process ID is required');
  if (blocks.some(block => block.pid === pid)) throw new Error(`${pid} already has allocated memory`);
  const index = allocate(blocks, size, fit);
  if (index < 0) return null;
  const result = blocks.map(block => ({ ...block }));
  const remainder = result[index].size - Number(size);
  result[index] = { size: Number(size), pid };
  if (remainder > 0) result.splice(index + 1, 0, { size: remainder, pid: null });
  return result;
}

export function releaseMemory(blocks, pid) {
  let released = false;
  const result = blocks.map(block => {
    if (block.pid !== pid) return { ...block };
    released = true;
    return { size: block.size, pid: null };
  });
  if (!released) throw new Error(`No memory allocation found for ${pid}`);
  for (let i = result.length - 1; i > 0; i--) {
    if (!result[i].pid && !result[i - 1].pid) {
      result[i - 1].size += result[i].size;
      result.splice(i, 1);
    }
  }
  return result;
}

export function memoryStats(blocks) {
  const total = blocks.reduce((sum, block) => sum + block.size, 0);
  const used = blocks.reduce((sum, block) => sum + (block.pid ? block.size : 0), 0);
  const freeBlocks = blocks.filter(block => !block.pid).map(block => block.size);
  const free = total - used;
  return { total, used, free, utilization: total ? used / total * 100 : 0, externalFragmentation: free ? 1 - Math.max(0, ...freeBlocks) / free : 0 };
}

export function produce(buffer, capacity, alert) {
  capacity = finiteNumber(capacity, 'Buffer capacity', { min: 1, integer: true });
  if (!Array.isArray(buffer) || buffer.length > capacity) throw new Error('Buffer state violates its capacity');
  if (!alert) throw new Error('An alert is required');
  if (buffer.length === capacity) return { accepted: false, reason: 'full', buffer: [...buffer], empty: 0, full: capacity };
  const next = [...buffer, alert];
  return { accepted: true, reason: null, buffer: next, empty: capacity - next.length, full: next.length };
}

export function consume(buffer, capacity) {
  capacity = finiteNumber(capacity, 'Buffer capacity', { min: 1, integer: true });
  if (!Array.isArray(buffer) || buffer.length > capacity) throw new Error('Buffer state violates its capacity');
  if (!buffer.length) return { consumed: false, reason: 'empty', alert: null, buffer: [], empty: capacity, full: 0 };
  const [alert, ...next] = buffer;
  return { consumed: true, reason: null, alert, buffer: next, empty: capacity - next.length, full: next.length };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, allocateMemory, banker, consume, memoryStats, produce, releaseMemory, requestResources, schedule } from './algorithms.js';

const procs = [
  { id: 'P1', arrival: 0, burst: 5, priority: 2 },
  { id: 'P2', arrival: 1, burst: 3, priority: 1 },
  { id: 'P3', arrival: 2, burst: 1, priority: 3 },
];

test('FCFS handles idle time and computes process metrics', () => {
  const result = schedule([{ id: 'P1', arrival: 2, burst: 3, priority: 1 }, { id: 'P2', arrival: 7, burst: 2, priority: 1 }], 'FCFS');
  assert.deepEqual(result.timeline, [
    { id: 'IDLE', start: 0, end: 2 }, { id: 'P1', start: 2, end: 5 },
    { id: 'IDLE', start: 5, end: 7 }, { id: 'P2', start: 7, end: 9 },
  ]);
  assert.deepEqual(result.rows.map(({ completion, turnaround, waiting, response }) => [completion, turnaround, waiting, response]), [[5, 3, 0, 0], [9, 2, 0, 0]]);
  assert.equal(result.averages.waiting, 0);
  assert.equal(result.averages.turnaround, 2.5);
});

test('non-preemptive SJF and Priority select the correct ready task', () => {
  assert.deepEqual(schedule(procs, 'SJF').timeline.map(x => x.id), ['P1', 'P3', 'P2']);
  assert.deepEqual(schedule(procs, 'Priority').timeline.map(x => x.id), ['P1', 'P2', 'P3']);
});

test('Round Robin respects the quantum, arrival queue order, and metrics', () => {
  const result = schedule(procs, 'Round Robin', 2);
  assert.deepEqual(result.timeline.map(x => [x.id, x.start, x.end]), [
    ['P1', 0, 2], ['P2', 2, 4], ['P3', 4, 5], ['P1', 5, 7], ['P2', 7, 8], ['P1', 8, 9],
  ]);
  assert.deepEqual(result.rows.map(x => [x.id, x.completion, x.turnaround, x.waiting, x.response]), [
    ['P1', 9, 9, 4, 0], ['P2', 8, 7, 4, 1], ['P3', 5, 3, 2, 2],
  ]);
});

test('Round Robin records idle CPU intervals and processes arrivals at slice boundaries', () => {
  const result = schedule([{ id: 'P1', arrival: 3, burst: 2, priority: 1 }, { id: 'P2', arrival: 4, burst: 1, priority: 1 }], 'Round Robin', 1);
  assert.deepEqual(result.timeline, [
    { id: 'IDLE', start: 0, end: 3 }, { id: 'P1', start: 3, end: 4 },
    { id: 'P2', start: 4, end: 5 }, { id: 'P1', start: 5, end: 6 },
  ]);
});

test('scheduler rejects invalid values and duplicate IDs', () => {
  assert.throws(() => schedule([{ id: 'P1', arrival: 0, burst: 0 }], 'FCFS'));
  assert.throws(() => schedule(procs, 'Round Robin', 0));
  assert.throws(() => schedule([procs[0], { ...procs[1], id: 'P1' }], 'FCFS'));
});

test('bounded buffer produces and consumes FIFO items with correct semaphores', () => {
  const a = { id: 'P1' }, b = { id: 'P2' };
  const first = produce([], 2, a);
  const full = produce(first.buffer, 2, b);
  assert.deepEqual([first.empty, first.full], [1, 1]);
  assert.deepEqual([full.empty, full.full], [0, 2]);
  assert.equal(first.empty + first.full, 2);
  assert.equal(full.empty + full.full, 2);
  assert.equal(produce(full.buffer, 2, { id: 'P3' }).reason, 'full');
  const takeA = consume(full.buffer, 2);
  assert.equal(takeA.alert.id, 'P1');
  assert.deepEqual([takeA.empty, takeA.full], [1, 1]);
  const takeB = consume(takeA.buffer, 2);
  assert.equal(takeB.alert.id, 'P2');
  assert.deepEqual([takeB.empty, takeB.full], [2, 0]);
  assert.equal(consume(takeB.buffer, 2).reason, 'empty');
  assert.throws(() => produce([], 0, a));
});

const safeState = { available: [3, 3, 2], processes: [
  { id: 'P1', allocation: [1, 0, 0], max: [2, 1, 1], need: [999, 999, 999] },
  { id: 'P2', allocation: [1, 1, 0], max: [2, 2, 1] },
  { id: 'P3', allocation: [1, 1, 1], max: [3, 1, 2] },
] };

test('Banker safety returns a valid sequence and computes Need from matrices', () => {
  const result = banker(safeState);
  assert.equal(result.safe, true);
  assert.deepEqual(result.sequence, ['P1', 'P2', 'P3']);
  assert.deepEqual(result.steps[0].after, [4, 3, 2]);
});

test('Banker rejects an unsafe state and invalid matrix values', () => {
  assert.equal(banker({ available: [0], processes: [{ id: 'P1', allocation: [1], max: [2] }] }).safe, false);
  assert.throws(() => banker({ available: [1], processes: [{ id: 'P1', allocation: [2], max: [1] }] }));
});

test('resource request commits safe grants, rolls unsafe grants back, and checks bounds', () => {
  const granted = requestResources(safeState, 'P1', [1, 0, 0]);
  assert.equal(granted.granted, true);
  assert.deepEqual(granted.state.available, [2, 3, 2]);
  const rejected = requestResources({ available: [1], processes: [{ id: 'P1', allocation: [1], max: [3] }, { id: 'P2', allocation: [0], max: [2] }] }, 'P1', [1]);
  assert.equal(rejected.granted, false);
  assert.equal(rejected.reason, 'unsafe');
  assert.deepEqual(rejected.state.available, [1]);
  assert.equal(requestResources(safeState, 'P1', [2, 0, 0]).reason, 'exceeds-need');
  assert.equal(requestResources(safeState, 'P1', [3, 0, 0]).reason, 'exceeds-need');
  assert.equal(requestResources({ available: [0], processes: [{ id: 'P1', allocation: [0], max: [1] }] }, 'P1', [1]).reason, 'unavailable');
});

test('First, Best, and Worst Fit select the intended free block', () => {
  const blocks = [{ size: 100 }, { size: 250 }, { size: 150 }];
  assert.equal(allocate(blocks, 120, 'First Fit'), 1);
  assert.equal(allocate(blocks, 120, 'Best Fit'), 2);
  assert.equal(allocate(blocks, 120, 'Worst Fit'), 1);
  assert.equal(allocate(blocks, 300, 'First Fit'), -1);
  assert.throws(() => allocate(blocks, 0, 'First Fit'));
});

test('memory allocation splits, fragmentation can prevent placement, and reclamation coalesces', () => {
  let blocks = [{ size: 100 }, { size: 250 }, { size: 150 }];
  blocks = allocateMemory(blocks, 'P1', 100, 'First Fit');
  blocks = allocateMemory(blocks, 'P2', 100, 'First Fit');
  blocks = allocateMemory(blocks, 'P3', 100, 'First Fit');
  assert.equal(memoryStats(blocks).total, 500);
  assert.equal(memoryStats(blocks).used, 300);
  assert.equal(memoryStats(blocks).free, 200);
  assert.equal(memoryStats(blocks).externalFragmentation, 0.25);
  assert.equal(allocateMemory(blocks, 'P4', 180, 'First Fit'), null);
  blocks = releaseMemory(blocks, 'P2');
  assert.equal(memoryStats(blocks).total, 500);
  assert.equal(memoryStats(blocks).free, 300);
  assert.ok(Math.abs(memoryStats(blocks).externalFragmentation - 1 / 3) < 1e-12);
  assert.throws(() => allocateMemory(blocks, 'P1', 10, 'First Fit'));
});

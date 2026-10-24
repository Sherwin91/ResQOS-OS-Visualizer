# ResQOS

ResQOS is a local educational simulation for an Operating Systems practical. It demonstrates CPU scheduling, bounded-buffer producer–consumer synchronization, variable-sized memory allocation, and Banker’s deadlock avoidance. All incidents and resources are simulated; there are no external service connections.

## Run locally

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. To create a production build, run `npm run build`.

## Modules

- **CPU Scheduling:** FCFS, non-preemptive SJF, non-preemptive priority, and Round Robin; timeline and per-process completion, turnaround, waiting, and response measures.
- **Producer–Consumer:** FIFO bounded alert buffer with producer/consumer actions, empty/full counts, simulated mutex, and operation log.
- **Memory Management:** First Fit, Best Fit, and Worst Fit on variable-sized blocks, with allocation, fragmentation, termination, and reclamation.
- **Banker’s Algorithm:** Allocation/Max/Need matrices, safety trace, safe/unsafe scenarios, and transactional resource requests.

The process directory is shared across modules. Scheduling, buffer, memory, and Banker resource states are independent simulations. Process directory edits persist in local storage.
# ResQOS-OS-Visualizer

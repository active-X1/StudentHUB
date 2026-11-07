import test from 'node:test';
import { createMemoryStore } from './helpers/memory-store.js';
import { runStoreContract } from './helpers/store-contract.js';
import { runAssignmentsContract } from './helpers/assignments-contract.js';

runStoreContract(test, 'memory store', async () => ({ store: createMemoryStore() }));
runAssignmentsContract(test, 'memory store', async () => ({ store: createMemoryStore() }));

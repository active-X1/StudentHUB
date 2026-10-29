import test from 'node:test';
import { createMemoryStore } from './helpers/memory-store.js';
import { runStoreContract } from './helpers/store-contract.js';

runStoreContract(test, 'memory store', async () => ({ store: createMemoryStore() }));

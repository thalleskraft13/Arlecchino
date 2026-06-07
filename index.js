'use strict';

require('dotenv').config();

const { isMainThread } = require('worker_threads');
const ClusterManager   = require('./src/Core/ClusterManager.js');

if (isMainThread) {
    const manager = new ClusterManager({
        totalShards:   4,
        shardsPerCluster: 2,
        clientOptions: { intents: 53608447 },
    });

    // Expõe globalmente para o IPC funcionar via require
    global.__clusterManager = manager;

    manager.launch().catch(console.error);
}
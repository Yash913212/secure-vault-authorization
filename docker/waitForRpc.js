const { setTimeout: delay } = require("timers/promises");

async function rpcHealthy(rpcUrl) {
    try {
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });

        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
        });

        if (!res.ok) return false;
        const json = await res.json();
        return Boolean(json && json.result);
    } catch {
        return false;
    }
}

async function main() {
    const rpcUrl = process.env.RPC_URL || "http://blockchain:8545";

    const maxAttempts = Number(process.env.RPC_WAIT_ATTEMPTS || 60);
    const sleepMs = Number(process.env.RPC_WAIT_SLEEP_MS || 500);

    for (let i = 1; i <= maxAttempts; i++) {
        const ok = await rpcHealthy(rpcUrl);
        if (ok) {
            console.log("RPC is ready:", rpcUrl);
            return;
        }
        process.stdout.write(`RPC not ready yet (${i}/${maxAttempts})...\n`);
        await delay(sleepMs);
    }

    throw new Error(`RPC did not become healthy in time: ${rpcUrl}`);
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
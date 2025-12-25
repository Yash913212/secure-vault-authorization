/* eslint-disable no-console */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function requireEnv(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

async function main() {
    const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
    const privateKey = requireEnv("PRIVATE_KEY");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    // Avoid occasional nonce races in fast local nodes / containerized environments.
    const signer = new ethers.NonceManager(wallet);

    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    const artifactsRoot = path.join(__dirname, "..", "artifacts", "contracts");

    function loadArtifact(contractFile, contractName) {
        const artifactPath = path.join(artifactsRoot, contractFile, `${contractName}.json`);
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        return artifact;
    }

    const authArtifact = loadArtifact("AuthorizationManager.sol", "AuthorizationManager");
    const vaultArtifact = loadArtifact("SecureVault.sol", "SecureVault");

    const signerAddress = process.env.AUTH_SIGNER_ADDRESS || wallet.address;

    console.log("Deploying with:");
    console.log("  RPC_URL:", rpcUrl);
    console.log("  Deployer:", await signer.getAddress());
    console.log("  ChainId:", chainId);
    console.log("  Authorized signer:", signerAddress);

    const AuthorizationManagerFactory = new ethers.ContractFactory(
        authArtifact.abi,
        authArtifact.bytecode,
        signer
    );

    const authorizationManager = await AuthorizationManagerFactory.deploy(signerAddress);
    await authorizationManager.waitForDeployment();

    const SecureVaultFactory = new ethers.ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, signer);
    const vault = await SecureVaultFactory.deploy(await authorizationManager.getAddress());
    await vault.waitForDeployment();

    // One-time wiring: allow the vault to consume authorizations.
    const tx = await authorizationManager.setVault(await vault.getAddress());
    await tx.wait();

    const deployment = {
        chainId,
        rpcUrl,
        deployer: await signer.getAddress(),
        authorizedSigner: signerAddress,
        authorizationManager: await authorizationManager.getAddress(),
        secureVault: await vault.getAddress(),
        timestamp: new Date().toISOString()
    };

    console.log("\nDeployed:");
    console.log(JSON.stringify(deployment, null, 2));

    const outDir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, `deployment-${chainId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
    console.log("\nWrote deployment artifact:", outPath);
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
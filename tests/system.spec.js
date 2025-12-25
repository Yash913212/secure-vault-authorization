const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SecureVault + AuthorizationManager (system)", function() {
    async function expectTxToRevert(sendTxPromise) {
        let reverted = false;
        try {
            const tx = await sendTxPromise;
            if (tx && typeof tx.wait === "function") {
                const receipt = await tx.wait();
                // Some toolchains may represent status as 0 (number) or 0n (bigint).
                // Use loose equality to avoid BigInt literal formatting regressions.
                if (receipt && receipt.status == 0) {
                    reverted = true;
                }
            }
        } catch (e) {
            reverted = true;
        }
        expect(reverted).to.equal(true);
    }

    async function deploy() {
        const [deployer, recipient, randomCaller] = await ethers.getSigners();

        const AuthorizationManager = await ethers.getContractFactory("AuthorizationManager");
        const authorizationManager = await AuthorizationManager.deploy(deployer.address);
        await authorizationManager.waitForDeployment();

        const SecureVault = await ethers.getContractFactory("SecureVault");
        const vault = await SecureVault.deploy(await authorizationManager.getAddress());
        await vault.waitForDeployment();

        await authorizationManager.setVault(await vault.getAddress());

        expect(await vault.authorizationManager()).to.equal(await authorizationManager.getAddress());

        return { deployer, recipient, randomCaller, authorizationManager, vault };
    }

    async function signWithdrawal({ signer, authorizationManager, vault, recipient, amount, nonce }) {
        const network = await ethers.provider.getNetwork();

        const domain = {
            name: "SecureVaultAuthorization",
            version: "1",
            chainId: Number(network.chainId),
            verifyingContract: await authorizationManager.getAddress()
        };

        const types = {
            WithdrawalAuthorization: [
                { name: "vault", type: "address" },
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
                { name: "nonce", type: "bytes32" }
            ]
        };

        const value = {
            vault: await vault.getAddress(),
            recipient: recipient.address,
            amount,
            nonce
        };

        return signer.signTypedData(domain, types, value);
    }

    it("accepts deposits from anyone and emits Deposit", async function() {
        const { vault, recipient } = await deploy();

        await expect(recipient.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("1") }))
            .to.emit(vault, "Deposit")
            .withArgs(recipient.address, ethers.parseEther("1"), ethers.parseEther("1"));

        expect(await vault.accountedBalance()).to.equal(ethers.parseEther("1"));
    });

    it("withdraws only with a valid, single-use authorization", async function() {
        const { deployer, recipient, vault, authorizationManager, randomCaller } = await deploy();

        await deployer.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("2") });

        const amount = ethers.parseEther("0.4");
        const nonce = ethers.keccak256(ethers.toUtf8Bytes("nonce-withdraw-1"));
        const signature = await signWithdrawal({
            signer: deployer,
            authorizationManager,
            vault,
            recipient,
            amount,
            nonce
        });

        const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

        await expect(vault.connect(randomCaller).withdraw(recipient.address, amount, nonce, signature))
            .to.emit(authorizationManager, "AuthorizationConsumed")
            .and.to.emit(vault, "Withdrawal");

        const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);
        expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(amount);

        // Replay must fail deterministically.
        await expect(vault.connect(randomCaller).withdraw(recipient.address, amount, nonce, signature))
            .to.be.revertedWithCustomError(authorizationManager, "AuthorizationAlreadyUsed");
    });

    it("does not allow EOAs to consume authorizations directly in the manager", async function() {
        const { deployer, recipient, vault, authorizationManager } = await deploy();

        const nonce = ethers.keccak256(ethers.toUtf8Bytes("nonce-direct-call-1"));
        const amount = ethers.parseEther("0.1");
        const signature = await signWithdrawal({
            signer: deployer,
            authorizationManager,
            vault,
            recipient,
            amount,
            nonce
        });

        await expect(
            authorizationManager.verifyAuthorization(await vault.getAddress(), recipient.address, amount, nonce, signature)
        ).to.be.revertedWithCustomError(authorizationManager, "NotVault");
    });

    it("reverts deterministically on insufficient balance (no side effects)", async function() {
        const { deployer, recipient, vault, authorizationManager } = await deploy();

        // no deposit
        const nonce = ethers.keccak256(ethers.toUtf8Bytes("nonce-insufficient-1"));
        const amount = ethers.parseEther("1");
        const signature = await signWithdrawal({
            signer: deployer,
            authorizationManager,
            vault,
            recipient,
            amount,
            nonce
        });

        await expect(vault.withdraw(recipient.address, amount, nonce, signature))
            .to.be.revertedWithCustomError(vault, "InsufficientBalance");

        // Authorization must remain unconsumed since the call reverted before manager consumption.
        const authId = await authorizationManager.getAuthorizationId(await vault.getAddress(), recipient.address, amount, nonce);
        expect(await authorizationManager.consumed(authId)).to.equal(false);
    });
});
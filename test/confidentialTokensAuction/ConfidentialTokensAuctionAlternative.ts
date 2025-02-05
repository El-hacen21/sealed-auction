// test/ConfidentialTokensAuctionAlternative.test.js

// Import necessary libraries and helpers
import { expect } from 'chai';
import { ethers, network } from 'hardhat';

import {
    displayAllBidOutputs,
    jumpToAuctionEnd,
    placeBid,
    finalizeAuction, // (seulement pour certains cas d'edge)
    decryptAndDisplay,
    getDecryptedBalance,
    transferTokens,
    approveTokens,
    displayAllBids
} from './Helpers';
import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";
import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
import { createInstance } from "../instance";
import { getSigners, initSigners } from '../signers';
// Use your  fixture (which deploys ConfidentialTokensAuctionAlternative)
import { deployConfidentialTokensAuctionAlternativeFixture } from './ConfidentialTokensAuctionAlternative.fixture';
import { getFHEGasFromTxReceipt } from "../coprocessorUtils";

describe('Test ConfidentialTokensAuctionAlternative', function () {
    // Shared variables across tests
    before(async function () {
        // Initialize Gateway and Signers
        await initGateway();
        await initSigners();
        this.signers = await getSigners();
    });

    beforeEach(async function () {
        // Create fhevm instance
        this.fhevm = await createInstance();

        // Deploy ConfidentialERC20 contract with Alice’s account
        const contractErc20 = await deployConfidentialERC20Fixture();
        this.erc20 = contractErc20;
        this.contractERC20Address = await contractErc20.getAddress();

        // Mint tokens for Alice (e.g. 10,000,000 tokens)
        const mintTx = await this.erc20.mint(10000000);
        await mintTx.wait();

        // Deploy the  Auction contract
        // (Parameters: deployer, ERC20 address, total tokens available, auction duration, minBidPrice)
        // Ici, minBidPrice est fourni en clair (ex. 5) et sera converti en valeur chiffrée en interne.
        const auctionContract = await deployConfidentialTokensAuctionAlternativeFixture(
            this.signers.alice,
            this.contractERC20Address,
            10,         // Total tokens available in the auction
            1000000,    // Auction duration (in seconds)
            7        // Minimum bid price (pmin)
        );

        // Log deployment gas usage if desired
        // const deploymentTxHash = auctionContract.deploymentTransaction()?.hash;
        // if (!deploymentTxHash) throw new Error("Deployment transaction hash not found.");
        // const receipt = await ethers.provider.getTransactionReceipt(deploymentTxHash);
        // console.log(`Gas used for  contract deployment: ${receipt.gasUsed.toString()}`);

        this.contractAddress = await auctionContract.getAddress();
        this.auction = auctionContract;
    });

    describe('Deployment', function () {
        it('should deploy the  Auction contract correctly', async function () {
            expect(this.contractAddress).to.properAddress;
            // console.log(`Alternative Auction Contract Address: ${this.contractAddress}`);
        });
    });

    describe('Bidding Process', function () {
        it('should allow Bob to place a bid and verify token transfer', async function () {
            const { bob, alice } = this.signers;
            // Transfer tokens from Alice to Bob
            await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 500);
            const bobInitialBalance = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);

            // Approve the auction contract to spend tokens from Bob
            await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);

            // Place a bid: e.g. 10 units @ price 10 (total = 100)
            await placeBid(this.fhevm, this.auction, this.contractAddress, bob, 10, 10);

            // Verify Bob's balance after bidding (should decrease by 100 tokens)
            const bobBalanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
            expect(bobBalanceAfter).to.equal(BigInt(bobInitialBalance - BigInt(100)));

            // Check that bidCounter has incremented
            const currentBidCounter = await this.auction.bidCounter();
            expect(currentBidCounter).to.equal(1);
        });
    });

    describe('Finalization Process', function () {
        it('should finalize successfully after auction ends using  batch allocation', async function () {
            const { alice, bob, carol, dave, eve } = this.signers;
            // Transfer tokens to participants
            await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 1000);
            await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, carol, 1000);
            await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, dave, 2000);
            await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, eve, 2000);

            // Approve auction for all participants
            await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 1000);
            await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, carol, this.contractAddress, 1000);
            await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, dave, this.contractAddress, 1000);
            await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, eve, this.contractAddress, 1000);

            // Place bids from different participants:
            // Only bids with price >= minBidPrice (here 5) are considered.
            // Carol places a bid with price 1 (below min), so it will be filtered out.
            await placeBid(this.fhevm, this.auction, this.contractAddress, dave, 10, 3);   // Carol: 3 units @ price 10
            await placeBid(this.fhevm, this.auction, this.contractAddress, dave, 6, 1);    // Dave: 1 unit @ price 6
            await placeBid(this.fhevm, this.auction, this.contractAddress, eve, 15, 1);    // Eve: 3 units @ price 15
            

            // Advance time to after the auction end
            await jumpToAuctionEnd(this.auction);

            const tEremain = await this.auction.connect(alice).assignERemain();
            const receipt = await tEremain.wait();

            if (network.name === "hardhat") {
                // Gas log (kept)
                const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
                console.log("\t\t - FHE Gas Consumed:", FHEGasConsumed);
            }
            // Gas log (kept)
            console.log("\t\t - Native Gas Used:", receipt.gasUsed);

            // --- Phase 1: Global finalization ---
            // Call finalizeAuctionAlternative to compute global data (e.g. globalOfferExceedsDemand)
            await this.auction.connect(alice).finalize();
            // Wait for asynchronous decryption callback(s) to complete
            await awaitAllDecryptionResults();

            // --- Phase 2: Allocation in batches ---
            // Process allocations in batches until allocationIndex equals bidCounter
            let bidCount = Number(await this.auction.bidCounter());
            let allocationIndex = Number(await this.auction.allocationIndex());
            const batchSize = 5; // You may adjust the batch size depending on gas constraints


            const tx = await this.auction.connect(alice).allocateBatch(batchSize);
            await tx.wait();
            // await awaitAllDecryptionResults();

            const bidderInfo = [
                // { address: carol.address, surname: "Carol" },
                { address: dave.address, surname: "Dave" },
                { address: eve.address, surname: "Eve" },
            ];


            await displayAllBids(this.signers.alice, this.fhevm, this.auction, this.contractAddress, bidderInfo, true);

            // // Vérifier que l'allocation a bien été effectuée sur l'ensemble des bids
            // let totalAllocated = BigInt(0);
            // for (let i = 0; i < bidCount; i++) {
            //     const allocEnc = await this.auction.allocatedQuantity(i);
            //     const allocDec = await decryptAndDisplay(alice, this.fhevm, allocEnc, this.contractAddress, true);
            //     totalAllocated += BigInt(allocDec);
            // }
            // console.log("Total Allocated Tokens (decrypted):", totalAllocated.toString());
            // expect(totalAllocated).to.equal(BigInt(10));

            // Déchiffrer et afficher le prix de règlement
            const settlementPriceEnc = await this.auction.settlementPrice();
            const settlementPriceDec = await decryptAndDisplay(alice, this.fhevm, settlementPriceEnc, this.contractAddress, true);
            console.log("Settlement Price (decrypted):", settlementPriceDec);
            // Vous pouvez ici vérifier par exemple que le prix de règlement correspond à celui attendu selon votre logique.

            // await displayAllBidOutputs(this.signers.alice, this.fhevm, this.blindAuction, this.contractAddress, sortedBidderInfo, true);
        });
    });

    describe('Claim and Withdraw', function () {
        beforeEach(async function () {
            const { alice, bob } = this.signers;
            // Transfer tokens to Bob and approve spending
            await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 100);
            await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);

            // Place a bid by Bob (e.g. 5 units @ price 10)
            await placeBid(this.fhevm, this.auction, this.contractAddress, bob, 10, 5);
            await jumpToAuctionEnd(this.auction);
            await this.auction.connect(alice).finalize();
            await awaitAllDecryptionResults();
            // Traitement batch (si nécessaire)
            let bidCount = Number(await this.auction.bidCounter());
            let allocationIndex = Number(await this.auction.allocationIndex());
            while (allocationIndex < bidCount) {
                await this.auction.connect(alice).allocateBatch(5);
                await awaitAllDecryptionResults();
                allocationIndex = Number(await this.auction.allocationIndex());
            }
        });

        it("should verify balances before and after claim", async function () {
            const { bob } = this.signers;
            const bobBalanceBefore = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
            await expect(this.auction.connect(bob).claim()).to.not.be.reverted;
            const bobBalanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
            expect(bobBalanceAfter).to.be.greaterThan(bobBalanceBefore);
        });

        it("should prevent double claiming", async function () {
            const { bob } = this.signers;
            await expect(this.auction.connect(bob).claim()).to.not.be.reverted;
            await expect(this.auction.connect(bob).claim())
                .to.be.revertedWith("Bid already claimed or cannot claim");
        });

        it("should revert withdraw if bid is not claimed", async function () {
            const { bob } = this.signers;
            await expect(this.auction.connect(bob).withdraw())
                .to.be.revertedWith("Bid must be claimed before withdrawal");
        });
    });

    describe('Additional Edge Cases and Reverts', function () {
        it("should revert if finalization is called before auction end", async function () {
            const { alice } = this.signers;
            await expect(this.auction.connect(alice).finalize())
                .to.be.reverted;
        });

        it("should revert if non-owner tries to finalize the auction", async function () {
            const { bob } = this.signers;
            await jumpToAuctionEnd(this.auction);
            await expect(finalizeAuction(this.auction.connect(bob), 10))
                .to.be.revertedWithCustomError(this.auction, "OwnableUnauthorizedAccount");
        });

        it('should finalize correctly with no bids placed', async function () {
            const { alice } = this.signers;
            await jumpToAuctionEnd(this.auction);
            await this.auction.connect(alice).finalize();
            await awaitAllDecryptionResults();
            // Process batch allocation even s'il n'y a aucun bid
            let bidCount = Number(await this.auction.bidCounter());
            let allocationIndex = Number(await this.auction.allocationIndex());
            while (allocationIndex < bidCount) {
                await this.auction.connect(alice).allocateBatch(5);
                await awaitAllDecryptionResults();
                allocationIndex = Number(await this.auction.allocationIndex());
            }
            const settlementPriceEnc = await this.auction.settlementPrice();
            const decryptedSettlementPrice = await decryptAndDisplay(alice, this.fhevm, settlementPriceEnc, this.auction, true);
            expect(decryptedSettlementPrice).to.equal(0);
        });
    });
});

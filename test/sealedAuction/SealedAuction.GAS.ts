import { network, ethers } from "hardhat";
import { getFHEGasFromTxReceipt } from "../coprocessorUtils";
import { createInstance } from "../instance";
import { getSigners, initSigners } from "../signers";
import { createAuctionViaFactory } from "../sealedAuctionFactory/CreateAuctionViaFactory";
import { awaitAllDecryptionResults } from "../asyncDecrypt";
import {
    jumpToAuctionEnd,
    transferTokens,
    approveTokens,
    placeBid,
} from "./Helpers";

describe("SealedAuctionGas - Combined Finalization Steps", function () {
    // One‑time initialization: deploy the auction factory and load signers.
    before(async function () {
        await initSigners();
        this.signers = await getSigners();

        // Deploy the auction factory using your fixture.
        const { SealedAuctionFactoryFixture } = await import(
            "../sealedAuctionFactory/SealedAuctionFactory.fixture"
        );
        this.factory = await SealedAuctionFactoryFixture();
        this.factoryAddress = await this.factory.getAddress();
        // console.log("Auction Factory deployed at:", this.factoryAddress);
    });

    // Before each test, create a fresh FHEVM instance and mint tokens.
    beforeEach(async function () {
        this.fhevm = await createInstance();

        // Get the default payment ERC20 token from the factory.
        this.erc20Address = await this.factory.defaultPaymentERC20();
        this.erc20 = await ethers.getContractAt("MyConfidentialERC20", this.erc20Address);

        // Mint tokens for the auction owner (Alice).
        const mintTx = await this.erc20.mint(10000);
        await mintTx.wait();
    });


    /**
     * A helper that combines the auction finalization steps:
     * 1. Advances time (using jumpToAuctionEnd).
     * 2. Calls finalize() on the auction.
     * 3. Calls allocateBids() on the auction.
     * 4. Logs the gas consumption for both steps.
     */
    async function finalizeAuction(auction: any) {
        console.log("\n-- Finalizing Auction --");
        await jumpToAuctionEnd(auction);

        // Finalize the auction.
        const finalizeTx = await auction.finalize();
        const finalizeReceipt = await finalizeTx.wait();
        const nativeGasFinalize = finalizeReceipt.gasUsed.toString();
        if (network.name === "hardhat") {
            const fheGasFinalize = getFHEGasFromTxReceipt(finalizeReceipt);
            console.log(`Finalize() Gas => FHE: ${fheGasFinalize} | Native: ${nativeGasFinalize}`);
        } else {
            console.log(`Finalize() Gas => Native: ${nativeGasFinalize}`);
        }

        // Allocate bids (using a single call if possible).
        const allocateTx = await auction.allocateBids(10);
        const allocateReceipt = await allocateTx.wait();
        const nativeGasAllocate = allocateReceipt.gasUsed.toString();
        if (network.name === "hardhat") {
            const fheGasAllocate = getFHEGasFromTxReceipt(allocateReceipt);
            console.log(`AllocateBids() Gas => FHE: ${fheGasAllocate} | Native: ${nativeGasAllocate}`);
        } else {
            console.log(`AllocateBids() Gas => Native: ${nativeGasAllocate}`);
        }
        await awaitAllDecryptionResults();
    }

    it("should log gas for auction creation", async function () {
        console.log("\n=== Auction Creation ===");
        const auction = await createAuctionViaFactory(
            this.signers.alice,
            10,      // Asset supply
            3600,    // Bidding duration (seconds)
            2,       // Minimum bid price
            2,       // Minimum bid quantity
            0,       // Payment type: ERC20
            this.factory
        );
        const auctionAddress = await auction.getAddress();
        console.log("Auction successfully created at:", auctionAddress);
        // (If creation returns a transaction receipt, you can also log its gas consumption here.)
    });

    it("should log gas for bidding operations", async function () {
        console.log("\n=== Bidding Operations ===");
        const auction = await createAuctionViaFactory(
            this.signers.alice,
            10,
            3600,
            1,    // Minimum bid price
            2,    // Minimum bid quantity
            0,
            this.factory
        );
        const auctionAddress = await auction.getAddress();
        const { alice, bob, carol } = this.signers;

        // Fund Bob and Carol with tokens.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 200);

        // Approve the auction contract to spend tokens.
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, auctionAddress, 200);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, auctionAddress, 200);

        // Bob places his bid.
        console.log("Bob places a bid: price=5, quantity=3");
        const bidTxBob = await placeBid(this.fhevm, auction, auctionAddress, bob, 5, 3);
        const bidReceiptBob = await bidTxBob.wait();
        if (network.name === "hardhat") {
            console.log(
                `Bob's Bid Gas => FHE: ${getFHEGasFromTxReceipt(bidReceiptBob)} | Native: ${bidReceiptBob.gasUsed.toString()}`
            );
        } else {
            console.log(`Bob's Bid Gas => Native: ${bidReceiptBob.gasUsed.toString()}`);
        }

        // Carol places her bid.
        console.log("Carol places a bid: price=2, quantity=7");
        const bidTxCarol = await placeBid(this.fhevm, auction, auctionAddress, carol, 2, 7);
        const bidReceiptCarol = await bidTxCarol.wait();
        if (network.name === "hardhat") {
            console.log(
                `Carol's Bid Gas => FHE: ${getFHEGasFromTxReceipt(bidReceiptCarol)} | Native: ${bidReceiptCarol.gasUsed.toString()}`
            );
        } else {
            console.log(`Carol's Bid Gas => Native: ${bidReceiptCarol.gasUsed.toString()}`);
        }
    });

    it("should log gas for combined finalization & allocation", async function () {
        console.log("\n=== Finalization & Allocation ===");
        const auction = await createAuctionViaFactory(
            this.signers.alice,
            10,
            3600,
            1,
            2,
            0,
            this.factory
        );
        const auctionAddress = await auction.getAddress();
        const { alice, bob, carol } = this.signers;

        // Setup bidding: Bob and Carol place bids.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 200);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, auctionAddress, 200);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, auctionAddress, 200);
        await placeBid(this.fhevm, auction, auctionAddress, bob, 5, 3);
        await placeBid(this.fhevm, auction, auctionAddress, carol, 2, 7);

        // Finalize the auction (which also allocates bids).
        await finalizeAuction(auction);
    });

    it("should log gas for bidder claim and owner withdrawal", async function () {
        console.log("\n=== Claim & Owner Withdrawal ===");
        const auction = await createAuctionViaFactory(
            this.signers.alice,
            10,
            3600,
            1,
            2,
            0,
            this.factory
        );
        const auctionAddress = await auction.getAddress();
        const { alice, bob, carol } = this.signers;

        // Fund bidders and set approvals.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 200);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, auctionAddress, 200);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, auctionAddress, 200);
        await placeBid(this.fhevm, auction, auctionAddress, bob, 5, 3);
        await placeBid(this.fhevm, auction, auctionAddress, carol, 2, 7);

        // Finalize the auction (finalize + allocate).
        await finalizeAuction(auction);

        // Bob claims his allocation.
        console.log("Bob is claiming his allocation...");
        const claimTx = await auction.connect(bob).claim();
        const claimReceipt = await claimTx.wait();
        if (network.name === "hardhat") {
            console.log(
                `Claim() Gas => FHE: ${getFHEGasFromTxReceipt(claimReceipt)} | Native: ${claimReceipt.gasUsed.toString()}`
            );
        } else {
            console.log(`Claim() Gas => Native: ${claimReceipt.gasUsed.toString()}`);
        }

        // Owner (Alice) withdraws the sale proceeds.
        console.log("Owner (Alice) withdraws the sale proceeds...");
        const withdrawTx = await auction.connect(alice).ownerWithdraw();
        const withdrawReceipt = await withdrawTx.wait();
        if (network.name === "hardhat") {
            console.log(
                `OwnerWithdraw() Gas => FHE: ${getFHEGasFromTxReceipt(withdrawReceipt)} | Native: ${withdrawReceipt.gasUsed.toString()}`
            );
        } else {
            console.log(`OwnerWithdraw() Gas => Native: ${withdrawReceipt.gasUsed.toString()}`);
        }
    });

    it("should log gas for processing 4 bids in batches", async function () {
        console.log("\n=== Batch Processing of 4 Bids ===");
        const auction = await createAuctionViaFactory(
            this.signers.alice,
            10,
            3600,
            1,
            2,
            0,
            this.factory
        );
        const auctionAddress = await auction.getAddress();
        const { alice, bob, carol } = this.signers;

        // Fund and approve bidders.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, auctionAddress, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, auctionAddress, 100);

        console.log("Placing 4 bids: two from Bob and two from Carol");
        // Bob places two bids.
        await placeBid(this.fhevm, auction, auctionAddress, bob, 5, 3);
        await placeBid(this.fhevm, auction, auctionAddress, bob, 6, 4);
        // Carol places two bids (note: the second bid may be invalid if below the minimum quantity).
        await placeBid(this.fhevm, auction, auctionAddress, carol, 4, 3);
        await placeBid(this.fhevm, auction, auctionAddress, carol, 7, 1);

        // Finalize the auction.
        await jumpToAuctionEnd(auction);
        const finalizeTx = await auction.finalize();
        const finalizeReceipt = await finalizeTx.wait();
        if (network.name === "hardhat") {
            console.log(
                `Finalize() Gas => FHE: ${getFHEGasFromTxReceipt(finalizeReceipt)} | Native: ${finalizeReceipt.gasUsed.toString()}`
            );
        } else {
            console.log(`Finalize() Gas => Native: ${finalizeReceipt.gasUsed.toString()}`);
        }
        await awaitAllDecryptionResults();

        // Process bids in two batches (batch size = 2).
        console.log("Processing bids in two batches (batch size: 2)");
        const computeTx1 = await auction.computeBidsBefore(2);
        const computeReceipt1 = await computeTx1.wait();
        if (network.name === "hardhat") {
            console.log(
                `Batch 1 - Compute Gas => FHE: ${getFHEGasFromTxReceipt(computeReceipt1)} | Native: ${computeReceipt1.gasUsed.toString()}`
            );
        } else {
            console.log(`Batch 1 - Compute Gas => Native: ${computeReceipt1.gasUsed.toString()}`);
        }
        const computeTx2 = await auction.computeBidsBefore(2);
        const computeReceipt2 = await computeTx2.wait();
        if (network.name === "hardhat") {
            console.log(
                `Batch 2 - Compute Gas => FHE: ${getFHEGasFromTxReceipt(computeReceipt2)} | Native: ${computeReceipt2.gasUsed.toString()}`
            );
        } else {
            console.log(`Batch 2 - Compute Gas => Native: ${computeReceipt2.gasUsed.toString()}`);
        }

        const allocateTx1 = await auction.allocateBids(2);
        const allocateReceipt1 = await allocateTx1.wait();
        if (network.name === "hardhat") {
            console.log(
                `Batch 1 - Allocate Gas => FHE: ${getFHEGasFromTxReceipt(allocateReceipt1)} | Native: ${allocateReceipt1.gasUsed.toString()}`
            );
        } else {
            console.log(`Batch 1 - Allocate Gas => Native: ${allocateReceipt1.gasUsed.toString()}`);
        }
        const allocateTx2 = await auction.allocateBids(2);
        const allocateReceipt2 = await allocateTx2.wait();
        if (network.name === "hardhat") {
            console.log(
                `Batch 2 - Allocate Gas => FHE: ${getFHEGasFromTxReceipt(allocateReceipt2)} | Native: ${allocateReceipt2.gasUsed.toString()}`
            );
        } else {
            console.log(`Batch 2 - Allocate Gas => Native: ${allocateReceipt2.gasUsed.toString()}`);
        }
        await awaitAllDecryptionResults();

        const settlementPrice = await auction.decryptedPrice();
        console.log("Final Settlement Price:", settlementPrice.toString());
    });
});

// import { expect } from "chai";
// import { network, ethers } from "hardhat";
// import { getFHEGasFromTxReceipt } from "../coprocessorUtils";
// import { createInstance } from "../instance";
// import { getSigners, initSigners } from "../signers";
// import { SealedAuctionFixture } from "./SealedAuction.fixture";
// import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
// import {
//     placeBid,
//     approveTokens,
//     transferTokens,
//     jumpToAuctionEnd,
// } from "./Helpers";

// import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";

// describe("SealedAuction:FHEGas", function () {
//     before(async function () {
//         await initGateway();
//         await initSigners();
//         this.signers = await getSigners();
//     });

//     beforeEach(async function () {
//         // Create an instance of fhevm and deploy the ConfidentialERC20 token fixture.
//         this.fhevm = await createInstance();
//         this.erc20 = await deployConfidentialERC20Fixture();
//         this.erc20Address = await this.erc20.getAddress();

//         // Deploy the SealedAuction contract.
//         // Parameters: supply, biddingTime, minPrice, minQty, maxBidsPerAddress.
//         this.auction = await SealedAuctionFixture(
//             this.signers.alice,
//             this.erc20Address,
//             10,     // supply: 10 tokens available
//             3600,   // bidding time (in seconds)
//             2,      // minPrice: 2
//             2,      // minQty: 2
//             2       // maxBidsPerAddress: 2
//         );
//         this.auctionAddress = await this.auction.getAddress();
//     });

//     it("Gas consumed during deployment", async function () {
//         // Deploy the auction via the factory to capture deployment gas.
//         const AuctionFactory = await ethers.getContractFactory("SealedAuction");
//         const deployTx = await AuctionFactory.connect(this.signers.alice).deploy(
//             this.erc20Address,
//             10,     // supply
//             3600,   // bidding time
//             2,      // minPrice
//             2,      // minQty
//             2       // maxBidsPerAddress
//         );
//         const txReceipt = await deployTx.deploymentTransaction()?.wait();
//         console.log("Native Gas Consumed during deployment:", txReceipt?.gasUsed.toString());
//         if (network.name === "hardhat") {
//             const FHEGasDeployment = getFHEGasFromTxReceipt(txReceipt);
//             console.log("FHEGas Consumed during deployment:", FHEGasDeployment);
//         }
//         // Wait for decryption results if needed (usually deployment may not trigger decryption).
//         await awaitAllDecryptionResults();
//     });

//     it("Gas consumed during placeBid", async function () {
//         const { alice, bob } = this.signers;
//         // Ensure Bob has enough tokens.
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);

//         // Place a bid (e.g., price: 5, quantity: 10) before auction end.
//         const tx = await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);
//         const receipt = await tx.wait();
//         expect(receipt.status).to.eq(1);
//         if (network.name === "hardhat") {
//             const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
//             console.log("FHEGas Consumed during placeBid:", FHEGasConsumed);
//         }
//         console.log("Native Gas Consumed during placeBid:", receipt.gasUsed.toString());
//     });

//     it("Gas consumed during finalize", async function () {
//         const { alice, bob } = this.signers;
//         // Place a bid so the auction has activity.
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);
//         const bidTx = await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);
//         await bidTx.wait();

//         // Advance time to pass the bidding period.
//         await jumpToAuctionEnd(this.auction);

//         // Finalize the auction.
//         const tx = await this.auction.finalize();
//         const receipt = await tx.wait();
//         expect(receipt.status).to.eq(1);
//         if (network.name === "hardhat") {
//             const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
//             console.log("FHEGas Consumed during finalize:", FHEGasConsumed);
//         }
//         console.log("Native Gas Consumed during finalize:", receipt.gasUsed.toString());

//         // Wait for all decryption results (this happens automatically in the contract).
//         await awaitAllDecryptionResults();
//     });

//     it("Gas consumed during computeBidsBefore (over-demand)", async function () {
//         const { alice, bob, carol } = this.signers;
//         // Create an over-demand scenario: supply is 10, but total bid quantity is greater than 10.
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 200);

//         // Bob and Carol each bid 7 tokens (total 14 > supply 10).
//         await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 7);
//         await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 5, 7);

//         await jumpToAuctionEnd(this.auction);
//         await this.auction.finalize();
//         // Wait until decryption results are available.
//         await awaitAllDecryptionResults();

//         // Call computeBidsBefore.
//         const tx = await this.auction.computeBidsBefore(10);
//         const receipt = await tx.wait();
//         expect(receipt.status).to.eq(1);
//         if (network.name === "hardhat") {
//             const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
//             console.log("FHEGas Consumed during computeBidsBefore:", FHEGasConsumed);
//         }
//         console.log("Native Gas Consumed during computeBidsBefore:", receipt.gasUsed.toString());
//     });

//     it("Gas consumed during allocateBids", async function () {
//         const { alice, bob, carol } = this.signers;

//         // --- Under-demand scenario ---
//         // Under-demand: total bid quantity is below supply.
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 200);

//         // Bob bids 3 tokens and Carol bids 4 tokens (total 7 < supply 10).
//         await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 3);
//         await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 2, 4);

//         await jumpToAuctionEnd(this.auction);
//         await this.auction.finalize();
//         await awaitAllDecryptionResults();

//         const tx1 = await this.auction.allocateBids(10);
//         const receipt1 = await tx1.wait();
//         expect(receipt1.status).to.eq(1);
//         if (network.name === "hardhat") {
//             const FHEGasConsumed1 = getFHEGasFromTxReceipt(receipt1);
//             console.log("FHEGas Consumed during allocateBids (under-demand):", FHEGasConsumed1);
//         }
//         console.log("Native Gas Consumed during allocateBids (under-demand):", receipt1.gasUsed.toString());

//         // --- Over-demand scenario ---
//         // Deploy a fresh auction instance.
//         this.auction = await SealedAuctionFixture(
//             this.signers.alice,
//             this.erc20Address,
//             10,    // supply: 10 tokens available
//             36000,
//             2,
//             2,
//             2
//         );
//         this.auctionAddress = await this.auction.getAddress();
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 200);

//         // Over-demand: Bob and Carol each bid 7 tokens (total 14 > supply 10).
//         await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 7);
//         await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 5, 7);

//         await jumpToAuctionEnd(this.auction);
//         await this.auction.finalize();
//         await awaitAllDecryptionResults();
//         await this.auction.computeBidsBefore(10);
//         const tx2 = await this.auction.allocateBids(10);
//         const receipt2 = await tx2.wait();
//         expect(receipt2.status).to.eq(1);
//         if (network.name === "hardhat") {
//             const FHEGasConsumed2 = getFHEGasFromTxReceipt(receipt2);
//             console.log("FHEGas Consumed during allocateBids (over-demand):", FHEGasConsumed2);
//         }
//         console.log("Native Gas Consumed during allocateBids (over-demand):", receipt2.gasUsed.toString());
//     });

//     it("Gas consumed during claim and withdraw", async function () {
//         const { alice, bob } = this.signers;
//         // Set up an auction with one bid.
//         await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
//         await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);
//         await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);

//         await jumpToAuctionEnd(this.auction);
//         await this.auction.finalize();
//         await awaitAllDecryptionResults();

//         // Allocate bids.
//         await this.auction.allocateBids(10);

//         // Claim.
//         const claimTx = await this.auction.claim();
//         const claimReceipt = await claimTx.wait();
//         expect(claimReceipt.status).to.eq(1);
//         if (network.name === "hardhat") {
//             const FHEGasConsumedClaim = getFHEGasFromTxReceipt(claimReceipt);
//             console.log("FHEGas Consumed during claim:", FHEGasConsumedClaim);
//         }
//         console.log("Native Gas Consumed during claim:", claimReceipt.gasUsed.toString());

//         // Withdraw.
//         const withdrawTx = await this.auction.withdraw();
//         const withdrawReceipt = await withdrawTx.wait();
//         expect(withdrawReceipt.status).to.eq(1);
//         if (network.name === "hardhat") {
//             const FHEGasConsumedWithdraw = getFHEGasFromTxReceipt(withdrawReceipt);
//             console.log("FHEGas Consumed during withdraw:", FHEGasConsumedWithdraw);
//         }
//         console.log("Native Gas Consumed during withdraw:", withdrawReceipt.gasUsed.toString());
//     });
// });

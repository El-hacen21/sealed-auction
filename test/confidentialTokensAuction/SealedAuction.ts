// // // test/ConfidentialTokensAuctionAlternative.test.js

// // // Import necessary libraries and helpers
// // import { expect } from 'chai';
// // import { ethers, network } from 'hardhat';

// // import {
// //     displayAllBidOutputs,
// //     jumpToAuctionEnd,
// //     placeBid,
// //     finalizeAuction, // (seulement pour certains cas d'edge)
// //     decryptAndDisplay,
// //     getDecryptedBalance,
// //     transferTokens,
// //     approveTokens,
// //     displayAllBids
// // } from './Helpers';
// // import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";
// // import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
// // import { createInstance } from "../instance";
// // import { getSigners, initSigners } from '../signers';
// // // Use your  fixture (which deploys ConfidentialTokensAuctionAlternative)
// // import { deployConfidentialTokensAuctionAlternativeFixture } from './ConfidentialTokensAuctionAlternative.fixture';
// // import { getFHEGasFromTxReceipt } from "../coprocessorUtils";

// // describe('Test ConfidentialTokensAuctionAlternative', function () {
// //     // Shared variables across tests
// //     before(async function () {
// //         // Initialize Gateway and Signers
// //         await initGateway();
// //         await initSigners();
// //         this.signers = await getSigners();
// //     });

// //     beforeEach(async function () {
// //         // Create fhevm instance
// //         this.fhevm = await createInstance();

// //         // Deploy ConfidentialERC20 contract with Alice’s account
// //         const contractErc20 = await deployConfidentialERC20Fixture();
// //         this.erc20 = contractErc20;
// //         this.contractERC20Address = await contractErc20.getAddress();

// //         // Mint tokens for Alice (e.g. 10,000,000 tokens)
// //         const mintTx = await this.erc20.mint(10000000);
// //         await mintTx.wait();

// //         // Deploy the  Auction contract
// //         // (Parameters: deployer, ERC20 address, total tokens available, auction duration, minBidPrice)
// //         // Ici, minBidPrice est fourni en clair (ex. 5) et sera converti en valeur chiffrée en interne.
// //         const auctionContract = await deployConfidentialTokensAuctionAlternativeFixture(
// //             this.signers.alice,
// //             this.contractERC20Address,
// //             10,         // Total tokens available in the auction
// //             1000000,    // Auction duration (in seconds)
// //             7        // Minimum bid price (pmin)
// //         );

// //         // Log deployment gas usage if desired
// //         // const deploymentTxHash = auctionContract.deploymentTransaction()?.hash;
// //         // if (!deploymentTxHash) throw new Error("Deployment transaction hash not found.");
// //         // const receipt = await ethers.provider.getTransactionReceipt(deploymentTxHash);
// //         // console.log(`Gas used for  contract deployment: ${receipt.gasUsed.toString()}`);

// //         this.contractAddress = await auctionContract.getAddress();
// //         this.auction = auctionContract;
// //     });

// //     describe('Deployment', function () {
// //         it('should deploy the  Auction contract correctly', async function () {
// //             expect(this.contractAddress).to.properAddress;
// //             // console.log(`Alternative Auction Contract Address: ${this.contractAddress}`);
// //         });
// //     });

// //     describe('Bidding Process', function () {
// //         it('should allow Bob to place a bid and verify token transfer', async function () {
// //             const { bob, alice } = this.signers;
// //             // Transfer tokens from Alice to Bob
// //             await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 500);
// //             const bobInitialBalance = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);

// //             // Approve the auction contract to spend tokens from Bob
// //             await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);

// //             // Place a bid: e.g. 10 units @ price 10 (total = 100)
// //             await placeBid(this.fhevm, this.auction, this.contractAddress, bob, 10, 10);

// //             // Verify Bob's balance after bidding (should decrease by 100 tokens)
// //             const bobBalanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
// //             expect(bobBalanceAfter).to.equal(BigInt(bobInitialBalance - BigInt(100)));

// //             // Check that bidCounter has incremented
// //             const currentBidCounter = await this.auction.bidCounter();
// //             expect(currentBidCounter).to.equal(1);
// //         });
// //     });

// //     describe('Finalization Process', function () {
// //         it('should finalize successfully after auction ends using  batch allocation', async function () {
// //             const { alice, bob, carol, dave, eve } = this.signers;
// //             // Transfer tokens to participants
// //             await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 1000);
// //             await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, carol, 1000);
// //             await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, dave, 2000);
// //             await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, eve, 2000);

// //             // Approve auction for all participants
// //             await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 1000);
// //             await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, carol, this.contractAddress, 1000);
// //             await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, dave, this.contractAddress, 1000);
// //             await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, eve, this.contractAddress, 1000);

// //             // Place bids from different participants:
// //             // Only bids with price >= minBidPrice (here 5) are considered.
// //             // Carol places a bid with price 1 (below min), so it will be filtered out.
// //             await placeBid(this.fhevm, this.auction, this.contractAddress, dave, 10, 3);   // Carol: 3 units @ price 10
// //             await placeBid(this.fhevm, this.auction, this.contractAddress, dave, 6, 1);    // Dave: 1 unit @ price 6
// //             await placeBid(this.fhevm, this.auction, this.contractAddress, eve, 15, 1);    // Eve: 3 units @ price 15


// //             // Advance time to after the auction end
// //             await jumpToAuctionEnd(this.auction);

// //             const tEremain = await this.auction.connect(alice).assignERemain();
// //             const receipt = await tEremain.wait();

// //             if (network.name === "hardhat") {
// //                 // Gas log (kept)
// //                 const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
// //                 console.log("\t\t - FHE Gas Consumed:", FHEGasConsumed);
// //             }
// //             // Gas log (kept)
// //             console.log("\t\t - Native Gas Used:", receipt.gasUsed);

// //             // --- Phase 1: Global finalization ---
// //             // Call finalizeAuctionAlternative to compute global data (e.g. globalOfferExceedsDemand)
// //             await this.auction.connect(alice).finalize();
// //             // Wait for asynchronous decryption callback(s) to complete
// //             await awaitAllDecryptionResults();

// //             // --- Phase 2: Allocation in batches ---
// //             // Process allocations in batches until allocationIndex equals bidCounter
// //             let bidCount = Number(await this.auction.bidCounter());
// //             let allocationIndex = Number(await this.auction.allocationIndex());
// //             const batchSize = 5; // You may adjust the batch size depending on gas constraints


// //             const tx = await this.auction.connect(alice).allocateBatch(batchSize);
// //             await tx.wait();
// //             await awaitAllDecryptionResults();

// //             const bidderInfo = [
// //                 // { address: carol.address, surname: "Carol" },
// //                 { address: dave.address, surname: "Dave" },
// //                 { address: eve.address, surname: "Eve" },
// //             ];


// //             await displayAllBids(this.signers.alice, this.fhevm, this.auction, this.contractAddress, bidderInfo, true);

// //             // // Vérifier que l'allocation a bien été effectuée sur l'ensemble des bids
// //             // let totalAllocated = BigInt(0);
// //             // for (let i = 0; i < bidCount; i++) {
// //             //     const allocEnc = await this.auction.allocatedQuantity(i);
// //             //     const allocDec = await decryptAndDisplay(alice, this.fhevm, allocEnc, this.contractAddress, true);
// //             //     totalAllocated += BigInt(allocDec);
// //             // }
// //             // console.log("Total Allocated Tokens (decrypted):", totalAllocated.toString());
// //             // expect(totalAllocated).to.equal(BigInt(10));

// //             // Déchiffrer et afficher le prix de règlement
// //             const settlementPriceEnc = await this.auction.settlementPrice();
// //             const settlementPriceDec = await decryptAndDisplay(alice, this.fhevm, settlementPriceEnc, this.contractAddress, true);
// //             console.log("Settlement Price (decrypted):", settlementPriceDec);
// //             // Vous pouvez ici vérifier par exemple que le prix de règlement correspond à celui attendu selon votre logique.

// //             // await displayAllBidOutputs(this.signers.alice, this.fhevm, this.blindAuction, this.contractAddress, sortedBidderInfo, true);
// //         });
// //     });

// //     describe('Claim and Withdraw', function () {
// //         beforeEach(async function () {
// //             const { alice, bob } = this.signers;
// //             // Transfer tokens to Bob and approve spending
// //             await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 100);
// //             await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);

// //             // Place a bid by Bob (e.g. 5 units @ price 10)
// //             await placeBid(this.fhevm, this.auction, this.contractAddress, bob, 10, 5);
// //             await jumpToAuctionEnd(this.auction);
// //             await this.auction.connect(alice).finalize();
// //             await awaitAllDecryptionResults();
// //             // Traitement batch (si nécessaire)
// //             let bidCount = Number(await this.auction.bidCounter());
// //             let allocationIndex = Number(await this.auction.allocationIndex());
// //             while (allocationIndex < bidCount) {
// //                 await this.auction.connect(alice).allocateBatch(5);
// //                 await awaitAllDecryptionResults();
// //                 allocationIndex = Number(await this.auction.allocationIndex());
// //             }
// //         });

// //         it("should verify balances before and after claim", async function () {
// //             const { bob } = this.signers;
// //             const bobBalanceBefore = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
// //             await expect(this.auction.connect(bob).claim()).to.not.be.reverted;
// //             const bobBalanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
// //             expect(bobBalanceAfter).to.be.greaterThan(bobBalanceBefore);
// //         });

// //         it("should prevent double claiming", async function () {
// //             const { bob } = this.signers;
// //             await expect(this.auction.connect(bob).claim()).to.not.be.reverted;
// //             await expect(this.auction.connect(bob).claim())
// //                 .to.be.revertedWith("Bid already claimed or cannot claim");
// //         });

// //         it("should revert withdraw if bid is not claimed", async function () {
// //             const { bob } = this.signers;
// //             await expect(this.auction.connect(bob).withdraw())
// //                 .to.be.revertedWith("Bid must be claimed before withdrawal");
// //         });
// //     });

// //     describe('Additional Edge Cases and Reverts', function () {
// //         it("should revert if finalization is called before auction end", async function () {
// //             const { alice } = this.signers;
// //             await expect(this.auction.connect(alice).finalize())
// //                 .to.be.reverted;
// //         });

// //         it("should revert if non-owner tries to finalize the auction", async function () {
// //             const { bob } = this.signers;
// //             await jumpToAuctionEnd(this.auction);
// //             await expect(finalizeAuction(this.auction.connect(bob), 10))
// //                 .to.be.revertedWithCustomError(this.auction, "OwnableUnauthorizedAccount");
// //         });

// //         it('should finalize correctly with no bids placed', async function () {
// //             const { alice } = this.signers;
// //             await jumpToAuctionEnd(this.auction);
// //             await this.auction.connect(alice).finalize();
// //             await awaitAllDecryptionResults();
// //             // Process batch allocation even s'il n'y a aucun bid
// //             let bidCount = Number(await this.auction.bidCounter());
// //             let allocationIndex = Number(await this.auction.allocationIndex());
// //             while (allocationIndex < bidCount) {
// //                 await this.auction.connect(alice).allocateBatch(5);
// //                 await awaitAllDecryptionResults();
// //                 allocationIndex = Number(await this.auction.allocationIndex());
// //             }
// //             const settlementPriceEnc = await this.auction.settlementPrice();
// //             const decryptedSettlementPrice = await decryptAndDisplay(alice, this.fhevm, settlementPriceEnc, this.auction, true);
// //             expect(decryptedSettlementPrice).to.equal(0);
// //         });
// //     });
// // });


// // test/ConfidentialTokensAuctionAlternative.test.js

// import { expect } from "chai";
// import { ethers, network } from "hardhat";

// import {
//     displayAllBidOutputs,
//     jumpToAuctionEnd,
//     placeBid,
//     decryptAndDisplay,
//     getDecryptedBalance,
//     transferTokens,
//     approveTokens,
//     displayAllBids
// } from "./Helpers";
// import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";
// import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
// import { createInstance } from "../instance";
// import { getSigners, initSigners } from "../signers";
// import { deployConfidentialTokensAuctionAlternativeFixture } from "./ConfidentialTokensAuctionAlternative.fixture";
// import { getFHEGasFromTxReceipt } from "../coprocessorUtils";

// describe("ConfidentialTokensAuctionAlternative", function () {
//     before(async function () {
//         await initGateway();
//         await initSigners();
//         this.signers = await getSigners();
//     });

//     beforeEach(async function () {
//         // Create FHEVM instance and deploy ERC20 token
//         this.fhevm = await createInstance();
//         const erc20 = await deployConfidentialERC20Fixture();
//         this.erc20 = erc20;
//         this.erc20Address = await erc20.getAddress();

//         // Mint tokens (e.g. 10,000,000 tokens)
//         const mintTx = await erc20.mint(10000000);
//         await mintTx.wait();

//         // Deploy the Auction contract:
//         // Parameters: deployer, ERC20 address, total tokens available, auction duration, minBidPrice
//         const auction = await deployConfidentialTokensAuctionAlternativeFixture(
//             this.signers.alice,
//             this.erc20Address,
//             20,       // Total tokens available
//             1000000,  // Auction duration (seconds)
//             0         // Minimum bid price
//         );
//         this.contractAddress = await auction.getAddress();
//         this.auction = auction;
//     });

//     describe("Deployment", function () {
//         it("deploys correctly", async function () {
//             expect(this.contractAddress).to.properAddress;
//         });
//     });

//     describe("Bidding", function () {
//         it("allows a bid and transfers tokens", async function () {
//             const { bob, alice } = this.signers;
//             await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 500);
//             const bobInitialBalance = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
//             await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.contractAddress, 100);
//             await placeBid(this.fhevm, this.auction, this.contractAddress, bob, 10, 10);
//             const bobBalanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
//             expect(bobBalanceAfter).to.equal(BigInt(bobInitialBalance) - BigInt(100));
//             const currentBidCounter = await this.auction.bidCounter();
//             expect(currentBidCounter).to.equal(1);
//         });
//     });

//     describe("Finalization", function () {
//         it("finalizes auction with batched allocation", async function () {
//             const { alice, bob, dave, eve } = this.signers;
//             // Transfer tokens and approve spending for participants
//             await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 1000);
//             await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, dave, 2000);
//             await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, eve, 2000);
//             await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.contractAddress, 1000);
//             await approveTokens(this.fhevm, this.erc20, this.erc20Address, dave, this.contractAddress, 1000);
//             await approveTokens(this.fhevm, this.erc20, this.erc20Address, eve, this.contractAddress, 1000);

//             // Place bids (only bids with price >= minBidPrice are valid)
//             await placeBid(this.fhevm, this.auction, this.contractAddress, dave, 10, 3);
//             await placeBid(this.fhevm, this.auction, this.contractAddress, dave, 6, 1);
//             await placeBid(this.fhevm, this.auction, this.contractAddress, eve, 15, 1);

//             // Advance time past auction end
//             await jumpToAuctionEnd(this.auction);

//             // Compute encrypted remain values in a batch
//             const computeTx = await this.auction.connect(alice).computeERemains(5);
//             const receipt = await computeTx.wait();
//             if (network.name === "hardhat") {
//                 const fheGas = getFHEGasFromTxReceipt(receipt);
//                 console.log("FHE Gas Consumed:", fheGas);
//             }
//             console.log("Native Gas Used:", receipt.gasUsed);

//             // Finalize the auction (requests decryption for global offer)
//             await this.auction.connect(alice).finalize();
//             await awaitAllDecryptionResults();

//             const bidCount = Number(await this.auction.bidCounter());
//             let allocIndex = Number((await this.auction.auctionState()).allocationIndex);
//             const batchSize = 5;
//             const globalFlag = (await this.auction.auctionState()).globalOfferExceedsDemand;
//             // Process allocations until all bids are handled
//             while (allocIndex < bidCount) {
//                 const tx = await this.auction.connect(alice).allocateBids(batchSize);
//                 await tx.wait();
//                 allocIndex = Number((await this.auction.auctionState()).allocationIndex);
//             }
//             await awaitAllDecryptionResults();

//             const settlementEnc = (await this.auction.auctionState()).settlementPrice;
//             const settlementDec = await decryptAndDisplay(alice, this.fhevm, settlementEnc, this.contractAddress, true);
//             console.log("Settlement Price (decrypted):", settlementDec);
//         });
//     });

//     describe("Claim & Withdraw", function () {
//         beforeEach(async function () {
//             const { alice, bob } = this.signers;
//             await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
//             await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.contractAddress, 100);
//             await placeBid(this.fhevm, this.auction, this.contractAddress, bob, 10, 5);
//             await jumpToAuctionEnd(this.auction);
//             await this.auction.connect(alice).finalize();
//             await awaitAllDecryptionResults();
//             const bidCount = Number(await this.auction.bidCounter());
//             let allocIndex = Number((await this.auction.auctionState()).allocationIndex);
//             const globalFlag = (await this.auction.auctionState()).globalOfferExceedsDemand;
//             while (allocIndex < bidCount) {
//                 await this.auction.connect(alice).allocateBids(5);
//                 await awaitAllDecryptionResults();
//                 allocIndex = Number((await this.auction.auctionState()).allocationIndex);
//             }
//         });

//         it("claims tokens correctly", async function () {
//             const { bob } = this.signers;
//             const balanceBefore = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
//             await expect(this.auction.connect(bob).claim()).to.not.be.reverted;
//             const balanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
//             expect(balanceAfter).to.be.greaterThan(balanceBefore);
//         });

//         it("prevents double claiming", async function () {
//             const { bob } = this.signers;
//             await expect(this.auction.connect(bob).claim()).to.not.be.reverted;
//             await expect(this.auction.connect(bob).claim()).to.be.revertedWith("Bid already claimed or cannot claim");
//         });

//         it("reverts withdraw if not claimed", async function () {
//             const { bob } = this.signers;
//             await expect(this.auction.connect(bob).withdraw()).to.be.revertedWith(
//                 "Bid must be claimed before withdrawal"
//             );
//         });
//     });

//     describe("Edge Cases", function () {
//         it("reverts finalization before auction end", async function () {
//             const { alice } = this.signers;
//             await expect(this.auction.connect(alice).finalize()).to.be.reverted;
//         });

//         it("reverts non-owner finalization", async function () {
//             const { bob } = this.signers;
//             await jumpToAuctionEnd(this.auction);
//             await expect(this.auction.connect(bob).finalize()).to.be.revertedWithCustomError(
//                 this.auction,
//                 "OwnableUnauthorizedAccount"
//             );
//         });

//         it("finalizes correctly with no bids", async function () {
//             const { alice } = this.signers;
//             await jumpToAuctionEnd(this.auction);
//             await this.auction.connect(alice).finalize();
//             await awaitAllDecryptionResults();
//             const bidCount = Number(await this.auction.bidCounter());
//             let allocIndex = Number((await this.auction.auctionState()).allocationIndex);
//             const globalFlag = (await this.auction.auctionState()).globalOfferExceedsDemand;
//             while (allocIndex < bidCount) {
//                 await this.auction.connect(alice).allocateBids(5, globalFlag);
//                 await awaitAllDecryptionResults();
//                 allocIndex = Number((await this.auction.auctionState()).allocationIndex);
//             }
//             const settlementEnc = (await this.auction.auctionState()).settlementPrice;
//             const settlementDec = await decryptAndDisplay(alice, this.fhevm, settlementEnc, this.contractAddress, true);
//             expect(settlementDec).to.equal(0);
//         });
//     });
// });



// test/ConfidentialTokensAuctionAlternative.test.js
import { expect } from "chai";
import { ethers, network } from "hardhat";

import {
  displayAllBidOutputs,
  jumpToAuctionEnd,
  placeBid,
  decryptAndDisplay,
  getDecryptedBalance,
  transferTokens,
  approveTokens,
  displayAllBids,
} from "./Helpers";
import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";
import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
import { createInstance } from "../instance";
import { getSigners, initSigners } from "../signers";
import { getFHEGasFromTxReceipt } from "../coprocessorUtils";

// Use your fixture that deploys the "SealedAuction" or "ConfidentialTokensAuctionAlternative"
// Make sure to adapt the fixture code to deploy your updated contract.
import { SealedAucitonFixture } from "./SealedAuction.fixture";

describe("SealedAuction Tests", function () {
  before(async function () {
    await initGateway();
    await initSigners();
    this.signers = await getSigners();
  });

  beforeEach(async function () {
    // Create FHEVM instance
    this.fhevm = await createInstance();

    // Deploy ConfidentialERC20
    this.erc20 = await deployConfidentialERC20Fixture();
    this.erc20Address = await this.erc20.getAddress();

    // Mint tokens, e.g., 1,000,000
    const mintTx = await this.erc20.mint(1_000_000);
    await mintTx.wait();

    // Deploy the Auction contract
    // constructor(ConfidentialERC20 token, uint64 supply, uint256 biddingTime, uint256 minBidPrice)
    this.auction = await SealedAucitonFixture(
      this.signers.alice,
      this.erc20Address,
      10,       // supply
      3600,     // biddingTime
      2,         // minBidPrice
      1,
      1
    );
    this.auctionAddress = await this.auction.getAddress();
  });

  describe("Deployment", function () {
    it("deploys correctly", async function () {
      expect(this.auctionAddress).to.properAddress;
    });
  });

  describe("Bidding", function () {
    it("places bids and transfers tokens", async function () {
      const { alice, bob } = this.signers;
      await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
      const bobStartBal = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);

      // Approve the auction contract
      await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);

      // Place bid (price 5, qty 10 => deposit 50)
      await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);

      const bobEndBal = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
      expect(bobEndBal).to.equal(BigInt(bobStartBal) - BigInt(50));

      const bidCount = await this.auction.bidCount();
      expect(bidCount).to.equal(1);
    });

    it("reverts if price is not > 0", async function () {
      const { alice, bob } = this.signers;
      await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
      await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 50);

      // Attempt placing a bid with price = 0
      await expect(
        placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 0, 5)
      ).to.be.reverted; // Should revert due to price <= 0 check
    });
  });

  describe("Total Buy Scenario", function () {
    it("allocates entire supply if total bids match supply exactly", async function () {
      const { alice, bob, carol } = this.signers;

      // Supply is 10 (from fixture)
      // Bob + Carol place bids summing exactly 10
      // Price must be >= 2 (minBidPrice)
      await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 500);
      await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 500);

      await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 300);
      await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 300);

      // Bob bids 3 tokens @ price 5 => deposit 15
      await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 3);
      // Carol bids 7 tokens @ price 2 => deposit 14
      await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 2, 7);

      // End auction
      await jumpToAuctionEnd(this.auction);

      // Compute eBidsBefore if partial approach
      // (We call it for coverage, though in total-buy scenario it might not matter.)
      const txCompute = await this.auction.connect(alice).computeBidsBefore(5);
      await txCompute.wait();

      // Finalize
      await this.auction.connect(alice).finalize();
      await awaitAllDecryptionResults();

      // Allocation
      const bCount = await this.auction.bidCount();
      let idx = (await this.auction.allocIndex()).toNumber();
      while (idx < bCount) {
        await (await this.auction.connect(alice).allocateBids(3)).wait();
        await awaitAllDecryptionResults();
        idx = (await this.auction.allocIndex()).toNumber();
      }

      // Settlement Price Decrypted
      const st = await this.auction.ePrice();
      await decryptAndDisplay(alice, this.fhevm, st, this.auctionAddress, false);

      // Bob claims
      const bobBalBefore = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
      await this.auction.connect(bob).claim();
      const bobBalAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
      expect(bobBalAfter).to.be.greaterThan(bobBalBefore);

      // Bob withdraws leftover
      await this.auction.connect(bob).withdraw();

      // Carol claims
      const carolBalBefore = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
      await this.auction.connect(carol).claim();
      const carolBalAfter = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
      expect(carolBalAfter).to.be.greaterThan(carolBalBefore);

      // Carol withdraws leftover
      await this.auction.connect(carol).withdraw();
    });
  });

  describe("Partial Buy Scenario", function () {
    it("allocates partially if total bids exceed supply", async function () {
      const { alice, bob, carol } = this.signers;

      // Auction supply is 10
      // Bids sum to more than 10
      await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 1000);
      await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 1000);

      await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 500);
      await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 500);

      // Bob bids 8 tokens @ price 5 => deposit 40
      await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 8);
      // Carol bids 10 tokens @ price 4 => deposit 40
      await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 4, 10);

      // End
      await jumpToAuctionEnd(this.auction);

      // Compute partial remains
      await (await this.auction.connect(alice).computeBidsBefore(5)).wait();

      // Finalize
      await this.auction.connect(alice).finalize();
      await awaitAllDecryptionResults();

      // Allocate
      let bCount = (await this.auction.bidCount()).toNumber();
      let idx = (await this.auction.allocIndex()).toNumber();
      while (idx < bCount) {
        await (await this.auction.connect(alice).allocateBids(5)).wait();
        await awaitAllDecryptionResults();
        idx = (await this.auction.allocIndex()).toNumber();
      }

      // Settlement Price
      const st = await this.auction.ePrice();
      await decryptAndDisplay(alice, this.fhevm, st, this.auctionAddress, true);

      // Bob claims and withdraws
      const bobBalBefore = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
      await this.auction.connect(bob).claim();
      await this.auction.connect(bob).withdraw();
      const bobBalAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
      expect(bobBalAfter).to.be.greaterThan(bobBalBefore);

      // Carol claims and withdraws
      const carolBalBefore = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
      await this.auction.connect(carol).claim();
      await this.auction.connect(carol).withdraw();
      const carolBalAfter = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
      expect(carolBalAfter).to.be.greaterThan(carolBalBefore);
    });
  });

  describe("Edge Cases", function () {
    it("reverts finalize if called before auction end", async function () {
      const { alice } = this.signers;
      await expect(this.auction.connect(alice).finalize()).to.be.reverted;
    });

    it("reverts if non-owner tries to finalize", async function () {
      const { bob } = this.signers;
      await jumpToAuctionEnd(this.auction);
      await expect(this.auction.connect(bob).finalize()).to.be.revertedWithCustomError(
        this.auction,
        "OwnableUnauthorizedAccount"
      );
    });

    it("handles zero bids gracefully", async function () {
      const { alice } = this.signers;
      await jumpToAuctionEnd(this.auction);
      await this.auction.connect(alice).finalize();
      await awaitAllDecryptionResults();

      // Allocate
      const bCount = Number(await this.auction.bidCount());
      let idx = Number(await this.auction.allocIndex());
      while (idx < bCount) {
        await (await this.auction.connect(alice).allocateBids(5)).wait();
        await awaitAllDecryptionResults();
        idx = Number(await this.auction.allocIndex());
      }

      const ePrice = (await this.auction.ePrice());
      const decP   = await decryptAndDisplay(alice, this.fhevm, ePrice, this.auctionAddress, true);
      expect(decP).to.equal(0);
    });
  });
});

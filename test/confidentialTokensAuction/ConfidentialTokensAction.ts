// Import necessary libraries and helpers
import { expect } from 'chai';
import { ethers, network } from 'hardhat';

import {
  displayAllBidOutputs,
  jumpToAuctionEnd,
  placeBid,
  finalizeAuction,
  expectFinalizeAuctionRevert,
  decryptAndDisplay,
  getDecryptedBalance,
  displayAllBids,
  expectDecryptedBalance,
  transferTokens,
  approveTokens
} from './Helpers';
import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";

import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
import { createInstance } from "../instance";
import { getSigners, initSigners } from '../signers';
import { deployConfidentialTokensAuctionFixture } from './ConfidentialTokensAuction.fixture';

import { getFHEGasFromTxReceipt } from "../coprocessorUtils";

describe('Test ConfidentialTokensAuction', function () {
  // Shared variables across tests
  before(async function () {
    // Initialize Zama Gateway and Signers
    await initGateway();
    await initSigners();
    this.signers = await getSigners();

    // Deploy SortingNetworkLibrary contract
    const SortingNetworkLibrary = await ethers.getContractFactory("SortingNetworkLibrary");
    this.sortingLibrary = await SortingNetworkLibrary.connect(this.signers.alice).deploy();
    await this.sortingLibrary.waitForDeployment();

    const tx = this.sortingLibrary.deploymentTransaction().hash;
    const receipt = await ethers.provider.getTransactionReceipt(tx);

    // Gas log (kept)
    console.log(`Gas used for the sorting:       ${receipt.gasUsed.toString()}`);
    // console.log(`Gas price (wei): ${receipt.effectiveGasPrice.toString()}`);
  });

  beforeEach(async function () {
    // Create fhevm instance
    this.fhevm = await createInstance();

    // Deploy ERC20 contract with Alice account
    const contractErc20 = await deployConfidentialERC20Fixture();
    this.erc20 = contractErc20;
    this.contractERC20Address = await contractErc20.getAddress();

    // Mint tokens for Alice (10,000,000 tokens)
    const mintTx = await this.erc20.mint(10000000);
    await mintTx.wait();

    // Deploy Auction contract
    const auctionContract = await deployConfidentialTokensAuctionFixture(
      this.signers.alice,
      this.contractERC20Address,
      await this.sortingLibrary.getAddress(),
      10,          // Quantity (total tokens available in auction)
      1000000      // Auction duration
    );

    // Retrieve the deployment transaction hash and receipt
    const deploymentTxHash = auctionContract.deploymentTransaction()?.hash;
    if (!deploymentTxHash) {
      throw new Error("Deployment transaction hash not found.");
    }
    const receipt = await ethers.provider.getTransactionReceipt(deploymentTxHash);

    // Gas log (kept)
    console.log(`\t - Gas used for contract deployment: ${receipt.gasUsed.toString()}`);

    // Continue using the contract as usual
    this.contractAddress = await auctionContract.getAddress();
    this.blindAuction = auctionContract;
  });

  describe('Deployment', function () {
    it('should deploy Auction contracts correctly', async function () {
      expect(this.contractAddress).to.properAddress;
      // console.log(`Auction Contract Address: ${this.contractAddress}`);
    });
  });

  describe('Bidding Process', function () {
    it('should allow Bob to place a bid and verify the token transfer', async function () {
      const { bob, alice } = this.signers;
      // console.log("=== Test: Bob Places a Bid ===");

      // Transfer 500 tokens from Alice to Bob
      await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 500);
      await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address).then(balance => {
        // console.log(`\t - Bob's Initial Balance: ${balance.toString()}`);
      });

      // Approve the auction to spend 100 tokens from Bob
      await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);
      // console.log("\t - Bob approved 100 tokens for the auction.");

      // Place a bid: 10 units @ price 10 (total = 100)
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 10, 10);

      // Verify Bob's balance after bidding (should be 400)
      await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address).then(balance => {
        // console.log(`\t - Bob's Balance After Bidding: ${balance.toString()}`);
        expect(balance).to.equal(BigInt(400));
      });

      // Check that the bidCounter has incremented
      const currentBidCounter = await this.blindAuction.bidCounter();
      expect(currentBidCounter).to.equal(1);
      // console.log(`\t - Bid Counter: ${currentBidCounter.toString()}`);
    });
  });

  describe('Finalization Process', function () {
    it('should finalize successfully after auction ends', async function () {
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

      // Place bids
      // (Multiple commented-out bids below are kept for reference)
      // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 1, 3);   // Carol: 3 units @ price 3
      // ...
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 1, 3);   // Carol: 3 units @ price 3

      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, dave, 2, 1);    // Dave: 1 unit @ price 2
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, dave, 30, 1);   // Dave: 1 unit @ price 30
      const tx = await placeBid(this.fhevm, this.blindAuction, this.contractAddress, eve, 15, 3);    // Eve: 3 units @ price 15

      const receipt = await tx.wait();

      if (network.name === "hardhat") {
        // Gas log (kept)
        const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
        console.log("\t\t - Bidding FHE Gas Consumed:", FHEGasConsumed);
      }
      // Gas log (kept)
      console.log("\t\t - Bidding Native Gas Used:", receipt.gasUsed);

      // console.log("\t - Placed bids for Carol, Dave, and Eve.");

      const bidderInfo = [
        { address: carol.address, surname: "Carol" },
        { address: dave.address, surname: "Dave" },
        { address: eve.address, surname: "Eve" },
      ];

      // Advance time to after the auction ends
      await jumpToAuctionEnd(this.blindAuction);
      // console.log("\t - Auction time has ended.");

      // console.log("\t - Sorting bids...");

      // Finalize the auction in batches
      const batchSize = 10;
      let totalNativeGasUsed = BigInt(0);
      let totalFHEGasConsumed = 0;
      const swapIterations = 3; // Adjust based on the number of swap calls required

      for (let i = 0; i < swapIterations; i++) {
        const tx = await this.blindAuction.connect(alice).swap(); // Trigger the swap
        const receipt = await tx.wait(); // Wait for the transaction to complete

        if (network.name === "hardhat") {
          // Gas log (kept)
          const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
          totalFHEGasConsumed += FHEGasConsumed;
        }

        // Gas log (kept)
        const nativeGasUsed = BigInt(receipt.gasUsed);
        // console.log(`Native Gas Used during swap ${i + 1}:`, nativeGasUsed.toString());
        totalNativeGasUsed += nativeGasUsed;

        await awaitAllDecryptionResults();
        // console.log("Decryption results awaited.");
        // console.log("---------------");
      }

      if (network.name === "hardhat") {
        // Gas log (kept)
        console.log("\t\t - Sorting FHE Gas Consumed:", totalFHEGasConsumed);
      }
      // Gas log (kept)
      console.log("\t\t - Sorting Native Gas Used:", totalNativeGasUsed.toString());

      // console.log("\t - Auction to be finalized...");
      // Finalize the auction
      const gasData = await finalizeAuction(this.blindAuction.connect(this.signers.alice), 10);

      if (network.name === "hardhat") {
        // Gas log (kept)
        console.log("\t - Finalization Total FHE Gas Consumed:", gasData.totalFHEGasConsumed);
      }
      // Gas log (kept)
      console.log("\t - Finalization Total Gas Used:", gasData.totalGasUsed);

      // Display all bids and bid outputs
      // await displayAllBidOutputs(this.signers.alice, this.fhevm, this.blindAuction, this.contractAddress, sortedBidderInfo, true);
    });

    /* 
      Scenario: Partial Fill with Expected Settlement and Allocation
      
      - Total tokens available: 10
      - Bob places a bid for 7 tokens @ price 20.
      - Carol places a bid for 7 tokens @ price 15.
      - Total requested: 14 tokens (exceeds available 10 tokens).
      
      Expected outcome:
      - Bob's bid is fully awarded: 7 tokens.
      - Carol is partially filled: 3 tokens awarded.
      - Settlement price should be Carol's bid price (15) as she is the last fill.
      - The sum of allocated tokens equals the total (7 + 3 = 10).
      - We also compute the expected amounts for each bidder.
    */
    it("should finalize auction with partial fill and compute expected settlement and allocations", async function () {
      const { alice, bob, carol } = this.signers;

      // Transfer tokens and approve spending
      await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 1000);
      await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, carol, 1000);
      await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 1000);
      await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, carol, this.contractAddress, 1000);

      // Place bids
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 20, 7);   // Bob: 7 tokens @ price 20
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 15, 7); // Carol: 7 tokens @ price 15

      // End the auction and finalize
      await jumpToAuctionEnd(this.blindAuction);
      // console.log("\t - Auction time has ended (partial fill test).");

      const tx = await this.blindAuction.connect(alice).swap();
      await tx.wait();
      await awaitAllDecryptionResults();

      await finalizeAuction(this.blindAuction.connect(alice), 10);
      await awaitAllDecryptionResults();

      // Retrieve bid outputs and decrypt awarded quantities
      const bobOutput = await this.blindAuction.connect(bob).getBidOutput();
      const carolOutput = await this.blindAuction.connect(carol).getBidOutput();
      const bobAwarded = await decryptAndDisplay(bob, this.fhevm, bobOutput.eQuantity, this.contractAddress, false);
      const carolAwarded = await decryptAndDisplay(carol, this.fhevm, carolOutput.eQuantity, this.contractAddress, false);

      // console.log(`\t - Bob Awarded: ${bobAwarded} tokens`);
      // console.log(`\t - Carol Awarded: ${carolAwarded} tokens`);

      expect(bobAwarded).to.equal(7);
      expect(carolAwarded).to.equal(3);
      expect(BigInt(bobAwarded + carolAwarded)).to.equal(10);

      // Check that the settlement price is Carol's bid price (15)
      const decryptSettlementPrice = await this.blindAuction.decryptedSettlementPrice();

      // console.log(`\t - Settlement Price: ${decryptSettlementPrice}`);
      expect(decryptSettlementPrice).to.equal(15);

      // Optionally, compute expected final claim amounts (if additional logic exists)
      // e.g., Bob's final claim amount = 7 * settlementPrice and Carol's likewise.

      // Claim tokens for both winners; since bids are fully awarded.
      await this.blindAuction.connect(bob).claim();
      await this.blindAuction.connect(carol).claim();
    });

    /*
      Scenario: 32 Bids from a Single Bidder with 14 Sorting Layers
      
      - Total tokens available: 10
      - Bob places 32 bids with different prices (descending) and each bid requests 1 token.
      - For example, bid prices from 100 down to 69.
      - Total requested = 32 tokens; only the top 10 bids (highest prices) are awarded.
      
      Expected outcome:
      - The sorting network should require 14 layers (SortingNetworkLibrary.getNumberOfLayers(32) should be 14).
      - The awarded tokens come from the 10 highest-priced bids.
      - The settlement price is the price of the lowest awarded bid (i.e. the 10th highest bid).
      - In this case, if the bids are 100, 99, ..., 69, then the 10th highest is 91.
    */
    // it("should finalize auction with 32 bids from a single bidder and require 14 sorting layers", async function () {
    //   const { alice, bob } = this.signers;
    //   const totalBids = 32;
    //   const totalTokensAvailable = 10;
    //
    //   // Redeploy the auction with totalTokens = 10 (if needed)
    //   // (Assuming the fixture deploys with totalTokens = 10 already)
    //
    //   // Approve tokens for Bob
    //   await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 5000);
    //   await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 5000);
    //
    //   // Bob places 32 bids, each for 1 token, with descending prices from 100 down to 69
    //   for (let i = 0; i < totalBids; i++) {
    //     const price = 100 - i; // Prices: 100, 99, 98, ..., 69
    //     await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, price, 1);
    //   }
    //
    //   // Check that bidCounter is 32
    //   const bidCounter = await this.blindAuction.bidCounter();
    //   expect(bidCounter).to.equal(totalBids);
    //   console.log(`\t - Total bids placed: ${bidCounter.toString()}`);
    //
    //   // Verify that the expected number of sorting layers is 14 for 32 bids.
    //   // (Assuming the SortingNetworkLibrary has a function getNumberOfLayers)
    //   const expectedLayers = await this.sortingLibrary.getNumberOfLayers(totalBids);
    //   console.log(`\t - Expected sorting layers: ${expectedLayers.toString()}`);
    //   expect(expectedLayers).to.equal(14);
    //
    //   // Advance time to after the auction ends
    //   await jumpToAuctionEnd(this.blindAuction);
    //   console.log("\t - Auction time has ended (32 bids test).");
    //
    //   console.log("\t - Sorting bids...");
    //   // Finalize auction by performing the required number of swap iterations (14 layers)
    //   const swapIterations = expectedLayers; // should be 14
    //   for (let i = 0; i < swapIterations; i++) {
    //     const tx = await this.blindAuction.connect(alice).swap();
    //     await tx.wait();
    //     await awaitAllDecryptionResults();
    //   }
    //
    //   // Finalize the auction
    //   const gasData = await finalizeAuction(this.blindAuction.connect(alice), 10);
    //   console.log(`\t - Finalization Total Gas Used: ${gasData.totalGasUsed}`);
    //
    //   // In the sorted bids, Bob's highest 10 bids will be awarded.
    //   // The awarded bids are those with prices: 100 down to 91.
    //   // Hence, the settlement price should be the 10th highest bid: 91.
    //   const settlementPriceEnc = await this.blindAuction.settlementPrice();
    //   const settlementPriceDec = await decryptAndDisplay(alice, this.fhevm, settlementPriceEnc, this.blindAuction, false);
    //   console.log(`\t - Settlement Price (expected 91): ${settlementPriceDec}`);
    //   expect(settlementPriceDec).to.equal(91);
    //
    //   // Since Bob is the only bidder, his total awarded tokens should equal totalTokensAvailable (10)
    //   const bobOutput = await this.blindAuction.connect(bob).getBidOutput();
    //   const bobAwarded = await decryptAndDisplay(bob, this.fhevm, bobOutput.eQuantity, this.blindAuction, false);
    //   console.log(`\t - Bob Awarded Tokens: ${bobAwarded}`);
    //   expect(bobAwarded).to.equal(totalTokensAvailable);
    //
    //   console.log("32 bids from single bidder scenario executed successfully.");
    // });
  });

  describe('Claim and Withdraw', function () {
    beforeEach(async function () {
      const { alice, bob } = this.signers;

      // Transfer tokens to Bob
      await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 100);
      // await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, carol, 45);

      // Approve auction to spend tokens from Bob
      await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);
      // await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, carol, this.contractAddress, 45);

      // Place bids
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 10, 5);    // Bob: 5 units @ price 10
      // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 15, 3);  // Carol: 3 units @ price 15

      // console.log("\t - Bob Places a bid (Price: 10, Quantity=5)");

      // End the auction
      await jumpToAuctionEnd(this.blindAuction);
      // console.log("\t - Auction time has ended.");

      // Trigger swap and finalize
      // await this.blindAuction.connect(this.signers.alice).swap();
      // console.log("\t - Sorting...");

      await finalizeAuction(this.blindAuction.connect(this.signers.alice), 10);

      // console.log("\t - Auction finalized.");
    });

    it("should verify balances before and after claim", async function () {
      const { bob } = this.signers;

      // Log Bob's balance before claim (log commented)
      const bobBalanceBefore = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
      // console.log(`\t - Bob's Balance Before Claim: ${bobBalanceBefore.toString()}`);

      // Claim for Bob
      // console.log("\t - Bob is claiming his bid...");
      await expect(this.blindAuction.connect(bob).claim()).to.not.be.reverted;

      // Log Bob's balance after claim (log commented)
      const bobBalanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
      // console.log(`\t - Bob's Balance After Claim: ${bobBalanceAfter.toString()}`);
      expect(bobBalanceAfter).to.be.greaterThan(bobBalanceBefore);
    });

    it("should prevent double claiming", async function () {
      const { bob } = this.signers;

      // console.log("\t - Bob is claiming his bid for the first time...");
      await expect(this.blindAuction.connect(bob).claim()).to.not.be.reverted;

      // console.log("\t - Bob attempts to claim his bid a second time...");
      await expect(this.blindAuction.connect(bob).claim())
        .to.be.revertedWith("Bid already claimed or cannot claim");
    });

    // it("should allow non-winners to claim then withdraw", async function () {
    //   const { carol } = this.signers;
    //   // Log Carol's balance before withdraw
    //   const carolBalanceBeforeWithdraw = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.contractERC20Address);
    //   console.log(`Carol's Balance Before Withdraw: ${carolBalanceBeforeWithdraw.toString()}`);
    //   // Withdraw for Carol
    //   console.log("Carol is withdrawing her bid...");
    //   await expect(this.blindAuction.connect(carol).withdraw()).to.not.be.reverted;
    //   // Log Carol's balance after withdraw
    //   const carolBalanceAfterWithdraw = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.contractERC20Address);
    //   console.log(`Carol's Balance After Withdraw: ${carolBalanceAfterWithdraw.toString()}`);
    //   expect(carolBalanceAfterWithdraw).to.be.greaterThan(carolBalanceBeforeWithdraw);
    // });

    it("should revert withdraw if bid is not claimed", async function () {
      const { bob } = this.signers;

      // console.log("\t - Bob attempts to withdraw before claiming...");
      await expect(this.blindAuction.connect(bob).withdraw())
        .to.be.revertedWith("Bid must be claimed before withdrawal");
    });
  });

  describe('Additional Edge Cases and Reverts', function () {
    it("should revert if finalization is called before the auction ends", async function () {
      const { alice } = this.signers;

      // Attempt to finalize before auction end
      await expect(
        this.blindAuction.connect(alice).finalizeAuction(1)
      ).to.be.reverted;
    });

    it("should revert if non-owner tries to finalize the auction", async function () {
      const { bob } = this.signers;

      // Advance time to after the auction ends
      await jumpToAuctionEnd(this.blindAuction);
      // console.log("\t - Auction time has ended.");

      await expect(
        finalizeAuction(this.blindAuction.connect(bob), 10)
      ).to.be.revertedWithCustomError(this.blindAuction, "OwnableUnauthorizedAccount");
    });

    it('should finalize correctly with no bids placed', async function () {
      const { alice } = this.signers;

      // End the auction
      await jumpToAuctionEnd(this.blindAuction);

      // Finalize the auction
      await finalizeAuction(this.blindAuction.connect(alice), 10);

      // Verify the settlement price and remaining tokens
      const settlementPrice = await this.blindAuction.settlementPrice();
      const decryptedSettlementPrice = await decryptAndDisplay(alice, this.fhevm, settlementPrice, this.blindAuction, true);
      expect(decryptedSettlementPrice).to.equal(0);
    });
  });

});


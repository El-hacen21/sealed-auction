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

    // Deploy DecryptionHelper contract
    const DecryptionHelper = await ethers.getContractFactory("DecryptionHelper");
    this.decryptionHelperContract = await DecryptionHelper.connect(this.signers.alice).deploy();
    await this.decryptionHelperContract.waitForDeployment();

    // Deploy SortingNetworkLibrary contract
    const SortingNetworkLibrary = await ethers.getContractFactory("SortingNetworkLibrary");
    this.sortingLibrary = await SortingNetworkLibrary.connect(this.signers.alice).deploy();
    await this.sortingLibrary.waitForDeployment();
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
      10,          // Quantity
      1000000,     // Auction duration
      true         // Confidential mode
    );

    // // Retrieve the deployment transaction hash and receipt
    // const deploymentTxHash = auctionContract.deploymentTransaction()?.hash;
    // if (!deploymentTxHash) {
    //   throw new Error("Deployment transaction hash not found.");
    // }
    // const receipt = await ethers.provider.getTransactionReceipt(deploymentTxHash);

    // // Log the gas used for deployment
    // console.log(`\t - Gas used for contract deployment: ${receipt.gasUsed.toString()}`);

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
        console.log(`\t - Bob's Initial Balance: ${balance.toString()}`);
      });

      // Approve the auction to spend 100 tokens from Bob
      await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);
      console.log("\t - Bob approved 100 tokens for the auction.");

      // Place a bid: 10 units @ price 10 (total = 100)
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 10, 10);

      // .to.emit(this.blindAuction, 'BidSubmitted').withArgs(bob.address, 10, 10);

      // Verify Bob's balance after bidding (should be 400)
      await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address).then(balance => {
        console.log(`\t - Bob's Balance After Bidding: ${balance.toString()}`);
        expect(balance).to.equal(BigInt(400));
      });

      // Check that the bidCounter has incremented
      const currentBidCounter = await this.blindAuction.bidCounter();
      expect(currentBidCounter).to.equal(1);
      console.log(`\t - Bid Counter: ${currentBidCounter.toString()}`);
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
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 3, 3);   // Carol: 3 units @ price 3
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, dave, 2, 1);    // Dave: 1 unit @ price 2
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, dave, 30, 1);   // Dave: 1 unit @ price 30
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, eve, 15, 3);    // Eve: 3 units @ price 15
      console.log("\t - Placed bids for Carol, Dave, and Eve.");

      const bidderInfo = [
        { address: carol.address, surname: "Carol" },
        { address: dave.address, surname: "Dave" },
        { address: eve.address, surname: "Eve" },
      ];

      await displayAllBids(this.signers.alice, this.fhevm, this.blindAuction, this.contractAddress, bidderInfo, true);

      const sortedBidderInfo = [
        { address: dave.address, surname: "Dave" },
        { address: eve.address, surname: "Eve" },
        { address: carol.address, surname: "Carol" },
      ];

      // Advance time to after the auction ends
      await jumpToAuctionEnd(this.blindAuction);
      console.log("\t - Auction time has ended.");

      console.log("\t - Sorting bids...");

      // Finalize the auction in batches
      const batchSize = 10;
      let totalNativeGasUsed = BigInt(0);
      let totalFHEGasConsumed = 0;
      const swapIterations = 3; // Adjust based on the number of swap calls required

      for (let i = 0; i < swapIterations; i++) {
        const tx = await this.blindAuction.connect(alice).swap(); // Trigger the swap
        const receipt = await tx.wait(); // Wait for the transaction to complete

        if (network.name === "hardhat") {
          // Calculate FHE gas consumed if on mocked FHEVM
          const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
          totalFHEGasConsumed += FHEGasConsumed;
        }

        // Log the native gas used for the transaction
        const nativeGasUsed = BigInt(receipt.gasUsed);
        // console.log(`Native Gas Used during swap ${i + 1}:`, nativeGasUsed.toString());
        totalNativeGasUsed += nativeGasUsed;

        // Await any additional decryption results if required
        await awaitAllDecryptionResults();
        // console.log("Decryption results awaited.");
        // console.log("---------------");
      }

      if (network.name === "hardhat") {
        console.log("\t\t - Sorting FHE Gas Consumed:", totalFHEGasConsumed);
      }
      console.log("\t\t - Sorting Native Gas Used:", totalNativeGasUsed.toString());

      // Fetch and log all bid indices
      // const totalBids = await this.blindAuction.bidCounter();
      // console.log(`Total Bids: ${totalBids.toString()}`);
      // for (let i = 0; i < totalBids; i++) {
      //   const bidIndex = await this.blindAuction.bidsIndexs(i);
      //   console.log(`Bid Index ${i}:`, bidIndex.toString());
      // }

      console.log("\t - Auction to be finalized...");
      // Finalize the auction
      const gasData = await finalizeAuction(this.blindAuction.connect(this.signers.alice), 10);


      if (network.name === "hardhat") {
        console.log("\t - Finalization Total FHE Gas Consumed:", gasData.totalFHEGasConsumed);
      }
      console.log("\t - Finalization Total Gas Used:", gasData.totalGasUsed);


      // Display all bids and bid outputs

      await displayAllBidOutputs(this.signers.alice, this.fhevm, this.blindAuction, this.contractAddress, sortedBidderInfo, true);
    });
  });



  // it('should partially fill a bid exceeding the remaining tokens', async function () {
  //   const { bob, alice } = this.signers;

  //   // Transfer tokens to Bob and approve the auction
  //   await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 100);
  //   await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);

  //   // Bob places a bid that exceeds total tokens
  //   await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 20, 20); // 20 units @ 20 price
  //   console.log("\t - Bob places a bid exceeding total tokens.");

  //   // End the auction
  //   await jumpToAuctionEnd(this.blindAuction);
  //   console.log("\t - Auction time has ended.");

  //   // Finalize the auction
  //   await finalizeAuction(this.blindAuction.connect(alice), 10);
  //   console.log("\t - Auction finalized with partial fill.");

  //   // Verify Bob's final quantity and the settlement price
  //   const bidOutput = await this.blindAuction.bidsOutput(bob.address);
  //   const settlementPrice = await this.blindAuction.settlementPrice();

  //   console.log(`\t - Settlement Price: ${settlementPrice.toString()}`);
  //   console.log(`\t - Bob's Final Quantity: ${bidOutput.eQuantity.toString()}`);

  //   expect(bidOutput.eQuantity).to.equal(10); // Only 10 tokens are available
  //   expect(settlementPrice).to.equal(20);
  // });



  describe('Claim and Withdraw', function () {
    beforeEach(async function () {
      const { alice, bob, carol } = this.signers;

      // Transfer tokens to Bob and Carol
      await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 100);
      // await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, carol, 45);


      // Approve auction to spend tokens from Bob and Carol
      await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);
      // await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, carol, this.contractAddress, 45);

      // Place bids
      await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 10, 5);    // Bob: 5 units @ price 10
      // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 15, 3);  // Carol: 3 units @ price 15

      console.log("\t - Bob Places a bid (Price: 10, Quantity=5)");

      // const bidderInfo = [
      //   { address: bob.address, surname: "Bob" },
      //   { address: carol.address, surname: "Carol" },
      // ];

      // await displayAllBids(this.signers.alice, this.fhevm, this.blindAuction, this.contractAddress, bidderInfo, true);

      // End the auction
      await jumpToAuctionEnd(this.blindAuction);
      // console.log("\t - Auction time has ended.");

      // Trigger swap and finalize
      await this.blindAuction.connect(this.signers.alice).swap();
      // console.log("\t - Sorting...");

      await finalizeAuction(this.blindAuction.connect(this.signers.alice), 10);
      console.log("\t - Auction finalized.");

    });

    it("should verify balances before and after claim", async function () {
      const { bob } = this.signers;

      // Log Bob's balance before claim
      const bobBalanceBefore = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
      console.log(`\t - Bob's Balance Before Claim: ${bobBalanceBefore.toString()}`);

      // Claim for Bob
      console.log("\t - Bob is claiming his bid...");
      await expect(this.blindAuction.connect(bob).claim()).to.not.be.reverted;

      // Log Bob's balance after claim
      const bobBalanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address);
      console.log(`\t - Bob's Balance After Claim: ${bobBalanceAfter.toString()}`);
      expect(bobBalanceAfter).to.be.greaterThan(bobBalanceBefore);
    });

    it("should prevent double claiming", async function () {
      const { bob } = this.signers;

      // First claim for Bob
      console.log("\t - Bob is claiming his bid for the first time...");
      await expect(this.blindAuction.connect(bob).claim()).to.not.be.reverted;

      // Attempt second claim for Bob (should revert)
      console.log("\t - Bob attempts to claim his bid a second time...");
      await expect(this.blindAuction.connect(bob).claim())
        .to.be.revertedWith("Bid already claimed or user cannot claim");
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

      // Attempt to withdraw for Bob without claiming (should revert)
      console.log("\t - Bob attempts to withdraw before claiming...");
      await expect(this.blindAuction.connect(bob).withdraw())
        .to.be.revertedWith("Bid must be claimed before withdraw");
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
      console.log("\t - Auction time has ended.");

      await expect(
        finalizeAuction(this.blindAuction.connect(bob), 10)
      ).to.be.revertedWithCustomError(this.blindAuction, "OwnableUnauthorizedAccount")

    });

    it('should finalize correctly with no bids placed', async function () {
      const { alice } = this.signers;

      // End the auction
      await jumpToAuctionEnd(this.blindAuction);

      // Finalize the auction
      await finalizeAuction(this.blindAuction.connect(alice), 10);

      // Verify the settlement price and remaining tokens
      const settlementPrice = await this.blindAuction.settlementPrice();

      const decryptedSettlementPrice= await decryptAndDisplay(alice, this.fhevm, settlementPrice, this.blindAuction, true);

      expect(decryptedSettlementPrice).to.equal(0);
    
    });

  });
});

import { expect } from "chai";
import { ethers } from "hardhat";
import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";
import { createInstance } from "../instance";
import { getSigners, initSigners } from "../signers";
import { createAuctionViaFactory } from "../sealedAuctionFactory/CreateAuctionViaFactory";
import { SealedAuctionFactoryFixture } from "../sealedAuctionFactory/SealedAuctionFactory.fixture";
import {
  placeBid,
  approveTokens,
  transferTokens,
  jumpToAuctionEnd,
  getDecryptedBalance,
} from "./Helpers";

describe("SealedAuction Tests (via createAuctionViaFactory)", function () {
  // One-time initialization: initialize gateway, signers and deploy the auction factory.
  before(async function () {
    await initGateway();
    await initSigners();
    this.signers = await getSigners();
    this.factory = await SealedAuctionFactoryFixture();
    this.factoryAddress = await this.factory.getAddress();
    console.log("Deployed factory address:", this.factoryAddress);
  });

  // Global beforeEach: create a new FHEVM instance and initialize tokens for each test.
  beforeEach(async function () {
    this.fhevm = await createInstance();

    // Get the default ERC20 token (payment token) from the factory.
    this.erc20Address = await this.factory.defaultPaymentERC20();
    this.erc20 = await ethers.getContractAt("MyConfidentialERC20", this.erc20Address);

    // Mint tokens for the auction owner (Alice).
    const mintTx = await this.erc20.mint(10000);
    await mintTx.wait();

    // Retrieve and initialize the default WETH.
    this.wethAddress = await this.factory.defaultWETH();
    this.weth = await ethers.getContractAt("ConfidentialWETH", this.wethAddress);
  });

  /*** Auction Constructor ***/
  describe("Constructor", function () {
    it("should deploy an auction with valid parameters", async function () {
      // Create an auction with specified supply, bidding duration, minimum bid price/quantity and ERC20 payment.
      const auction = await createAuctionViaFactory(
        this.signers.alice,
        10,       // Asset supply
        3600,     // Bidding duration (seconds)
        2,        // Minimum bid price
        2,        // Minimum bid quantity
        0,        // Payment type: ERC20
        this.factory
      );
      // Verify that the auction owner is correctly set.
      expect(await auction.owner()).to.equal(this.signers.alice.address);
    });
  });

  /*** Full Auction Flow ***/
  describe("Auction Flow", function () {
    beforeEach(async function () {
      // Create a fresh auction instance for each test.
      this.auction = await createAuctionViaFactory(
        this.signers.alice,
        10,       // Asset supply
        3600,     // Bidding duration
        1,        // Minimum bid price
        2,        // Minimum bid quantity
        0,        // Payment type: ERC20
        this.factory
      );
      this.auctionAddress = await this.auction.getAddress();

      // (Optional) Retrieve the asset token for further inspection.
      // const assetTokenAddress = await this.auction.assetToken();
      // const assetToken = await ethers.getContractAt("MyConfidentialERC20", assetTokenAddress);
    });

    /*** Bidding Phase ***/
    describe("Bidding Phase", function () {
      it("should transfer the correct deposit on placeBid", async function () {
        const { alice, bob } = this.signers;
        // Fund Bob with payment tokens so he can bid.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
        const bobStart = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        // Bob approves the auction contract to spend his tokens.
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);
        // Place a bid: price = 5, quantity = 10; deposit = (5 × 10) + 50 (penalty fee) = 100 tokens.
        const tx = await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);
        await tx.wait();
        const bobEnd = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        // Verify that Bob's balance is reduced by the deposit and that the bid count increments.
        expect(bobEnd).to.equal(BigInt(bobStart) - 100n);
        expect(await this.auction.bidCount()).to.equal(1);
      });

      it("should revert if bidding after the auction end", async function () {
        const { bob } = this.signers;
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 50);
        await jumpToAuctionEnd(this.auction);
        // Bids after auction end should revert with a "TooLate" error.
        await expect(
          placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10)
        ).to.be.revertedWithCustomError(this.auction, "TooLate");
      });

      it("should revert when maximum bids per address are exceeded", async function () {
        const { bob } = this.signers;
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 1000);
        // The default maximum bids per address is 2.
        for (let i = 0; i < 2; i++) {
          await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 2);
        }
        // The third bid should revert with a "MaxBidsExceeded" error.
        await expect(
          placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 2)
        ).to.be.revertedWithCustomError(this.auction, "MaxBidsExceeded");
      });
    });

    /*** Finalization Phase ***/
    describe("Finalization Phase", function () {
      it("should revert computeBidsBefore if called by a non-owner", async function () {
        const { bob } = this.signers;
        await jumpToAuctionEnd(this.auction);
        // Only the owner should be able to compute cumulative bids.
        await expect(this.auction.connect(bob).computeBidsBefore(5)).to.be.reverted;
      });

      it("should revert computeBidsBefore if called too early", async function () {
        // Attempting to compute bids before auction end should revert with "TooEarly".
        await expect(this.auction.computeBidsBefore(5))
          .to.be.revertedWithCustomError(this.auction, "TooEarly");
      });

      it("should revert allocateBids if called by a non-owner", async function () {
        const { bob } = this.signers;
        await jumpToAuctionEnd(this.auction);
        // Only the owner should be able to allocate bids.
        await expect(this.auction.connect(bob).allocateBids(5))
          .to.be.revertedWithCustomError(this.auction, "OwnableUnauthorizedAccount");
      });

      it("should revert allocateBids if called too early", async function () {
        // Allocating bids before the auction has ended should revert with "TooEarly".
        await expect(this.auction.allocateBids(5))
          .to.be.revertedWithCustomError(this.auction, "TooEarly");
      });

      it("should revert claim if called before auction end", async function () {
        // Bidders cannot claim their allocation before the auction ends.
        await expect(this.auction.claim())
          .to.be.revertedWithCustomError(this.auction, "TooEarly");
      });

      it("should revert claim if the settlement price is not yet decrypted", async function () {
        await jumpToAuctionEnd(this.auction);
        await awaitAllDecryptionResults();
        // Claiming before the settlement price decryption is complete should revert.
        await expect(this.auction.claim())
          .to.be.revertedWith("Settlement price not yet decrypted");
      });
    });

    /*** Allocation and Settlement ***/
    describe("Allocation and Settlement", function () {
      it("Full allocation scenario (under-demand)", async function () {
        const { alice, bob, carol } = this.signers;

        // Fund Bob and Carol so they can participate.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 500);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 500);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 300);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 300);

        // Record Bob's payment token balance before bidding.
        const bobInitialPaymentBalance = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);

        // Retrieve the asset token contract.
        const assetTokenAddress = await this.auction.assetToken();
        const assetToken = await ethers.getContractAt("MyConfidentialERC20", assetTokenAddress);

        // Place bids:
        // - Bob: price 5 for 3 tokens (deposit = 5×3 + 50 = 65).
        // - Carol: price 2 for 7 tokens.
        // Under-demand: expected settlement price is 2.
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 3);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 2, 7);

        // End the auction and finalize.
        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();

        // If demand is less than supply, compute cumulative bids.
        const overDemand = await this.auction.isDemandOverSupply();
        if (overDemand) {
          await this.auction.computeBidsBefore(10);
        }
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // Verify the decrypted settlement price equals the expected value.
        const settlement = BigInt(await this.auction.decryptedPrice());
        expect(settlement).to.equal(2n);

        // Bob claims his allocation.
        await this.auction.connect(bob).claim();

        // Calculate Bob's net cost: settlement price × bid quantity.
        const expectedNetCost = BigInt(3) * settlement; // 3 * 2 = 6
        const bobFinalPaymentBalance = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        expect(BigInt(bobInitialPaymentBalance) - BigInt(bobFinalPaymentBalance)).to.equal(expectedNetCost);

        // Verify Bob's asset token balance increases by his bid quantity.
        const bobAssetBalanceAfter = await getDecryptedBalance(bob, this.fhevm, assetToken, assetTokenAddress);
        expect(bobAssetBalanceAfter).to.equal(3n);
      });

      it("Partial allocation scenario (over-demand)", async function () {
        const { alice, bob, carol } = this.signers;
        // Fund bidders.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 400);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 400);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 300);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 300);

        // Over-demand scenario: total demand exceeds supply.
        // Bob bids: price 5 for 9 tokens.
        // Carol bids: price 5 for 6 tokens.
        // Expected settlement price becomes 5.
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 9);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 5, 6);

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();

        // Compute cumulative bids and allocate in one step.
        await this.auction.computeBidsBefore(10);
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // Verify that the settlement price is 5.
        const settlement = BigInt(await this.auction.decryptedPrice());
        expect(settlement).to.equal(5n);

        // Retrieve the asset token contract (could be obtained from auction or factory).
        const assetTokenAddress = await this.factory.defaultAssetERC20();
        const assetToken = await ethers.getContractAt("MyConfidentialERC20", assetTokenAddress);

        // Verify Bob's allocation and refund.
        const bobAssetBalanceBefore = await getDecryptedBalance(bob, this.fhevm, assetToken, assetTokenAddress);
        const bobPaymentBalanceBefore = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(bob).claim();
        const bobAssetBalanceAfter = await getDecryptedBalance(bob, this.fhevm, assetToken, assetTokenAddress);
        const bobPaymentBalanceAfter = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        expect(bobAssetBalanceAfter - bobAssetBalanceBefore).to.be.gt(0);
        expect(bobPaymentBalanceAfter).to.be.gt(bobPaymentBalanceBefore);

        // Verify Carol's allocation and refund.
        const carolAssetBalanceBefore = await assetToken.balanceOf(carol.address);
        const carolPaymentBalanceBefore = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(carol).claim();
        const carolAssetBalanceAfter = await assetToken.balanceOf(carol.address);
        const carolPaymentBalanceAfter = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
        expect(carolAssetBalanceAfter - carolAssetBalanceBefore).to.be.gt(0);
        expect(carolPaymentBalanceAfter).to.be.gt(carolPaymentBalanceBefore);
      });
    });

    /*** Owner Withdrawal ***/
    describe("Owner Claim", function () {
      it("should allow the owner to withdraw funds after auction finalization", async function () {
        const { alice, bob, carol } = this.signers;

        // Fund bidders.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 500);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 500);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 300);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 300);

        // Place bids.
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 1);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 3, 6);

        // End auction and finalize.
        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();
        // Allocate bids (owner-only functions).
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // Verify the settlement price (expected to be 3 in this scenario).
        const settlement = BigInt(await this.auction.decryptedPrice());
        expect(settlement).to.equal(3n);

        // Bidders claim their allocations.
        await this.auction.connect(bob).claim();
        await this.auction.connect(carol).claim();

        // Capture owner's payment token balance before and after withdrawal.
        const ownerInitialPaymentBalance = await getDecryptedBalance(alice, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(alice).ownerWithdraw();
        const ownerFinalPaymentBalance = await getDecryptedBalance(alice, this.fhevm, this.erc20, this.erc20Address);

        // Verify that the owner receives the expected sale proceeds.
        const expectedSaleProceeds = 68n; // Adjust as necessary based on the auction outcome.
        expect(BigInt(ownerFinalPaymentBalance) - BigInt(ownerInitialPaymentBalance)).to.equal(expectedSaleProceeds);
      });
    });

    /*** Edge Cases ***/
    describe("Edge Cases", function () {
      it("should revert on double claim", async function () {
        const { alice, bob } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // First claim should succeed.
        await this.auction.connect(bob).claim();
        // A second claim should revert.
        await expect(this.auction.connect(bob).claim()).to.be.revertedWith("Bid already claimed or cannot claim");
      });

      it("should handle scenario with no bids", async function () {
        const { alice, bob } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
        // No bid is placed.

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        // Expect that decryption (or allocation) fails because there are no bids.
        await expect(this.auction.allocateBids(10)).to.be.revertedWith("Allocation completed");

        // Owner withdrawal should yield zero net gain when there are no valid bids.
        const ownerInitial = await getDecryptedBalance(alice, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(alice).ownerWithdraw();
        const ownerFinal = await getDecryptedBalance(alice, this.fhevm, this.erc20, this.erc20Address);
        expect(ownerFinal - ownerInitial).to.equal(0n);
      });

      it("should handle scenario with a zero valid bid", async function () {
        const { alice, bob } = this.signers;

        // Transfer and approve tokens
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);

        // Place an invalid bid (quantity below the minimum requirement, e.g., minQty = 2)
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 1); // valid price but invalid quantity

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();

        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // Check owner funds: only the penalty fee should be collected.
        const ownerInitial = await getDecryptedBalance(alice, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(alice).ownerWithdraw();
        const ownerFinal = await getDecryptedBalance(alice, this.fhevm, this.erc20, this.erc20Address);
        expect(ownerFinal - ownerInitial).to.equal(50n); // Penalty fee only
      });

      it("should handle two bids from the same address", async function () {
        const { alice, bob } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);

        // Retrieve the asset token contract.
        const assetTokenAddress = await this.auction.assetToken();
        const assetToken = await ethers.getContractAt("MyConfidentialERC20", assetTokenAddress);

        // Bob places two bids.
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 5);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 3, 5);

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();


        const bobAssetBalanceBefore = await getDecryptedBalance(bob, this.fhevm, assetToken, assetTokenAddress);

        // Bob claim their allocations.
        await this.auction.connect(bob).claim();


        const bobAssetBalanceAfter = await getDecryptedBalance(bob, this.fhevm, assetToken, assetTokenAddress);

        // Bob got his 10 assetToken sent to him
        expect(bobAssetBalanceAfter - bobAssetBalanceBefore).to.equal(10n);
      });

      it("should process 4 bids in batches of 2", async function () {
        const { alice, bob, carol } = this.signers;

        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);

        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 100);

        // supply = 10, which means all tokens are sold
        const bids = [
          { price: 5, qty: 3 },  // Bid 0: valid
          { price: 6, qty: 4 },  // Bid 1: valid
          { price: 4, qty: 3 },  // Bid 2: valid
          { price: 7, qty: 1 }   // Bid 3: invalid; minQuantity = 2
        ];

        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, bids[0].price, bids[0].qty);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, bids[1].price, bids[1].qty);

        await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, bids[2].price, bids[2].qty);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, bids[3].price, bids[3].qty);

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();

        await this.auction.computeBidsBefore(2);
        await this.auction.computeBidsBefore(2);

        await this.auction.allocateBids(2);
        await this.auction.allocateBids(2);

        await awaitAllDecryptionResults();

        // Verify that the final decrypted settlement price is as expected.
        expect(await this.auction.decryptedPrice()).to.equal(4n);
      });



      it("should calculate settlement price correctly with mixed valid and invalid bids", async function () {
        const { alice, bob, carol, dave } = this.signers;
        // Set up tokens and approvals for multiple bidders.
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 100);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, dave, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, dave, this.auctionAddress, 100);

        // Assume the minimum quantity for a bid to be valid is 3.
        // Place two valid bids:
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 10, 5);   // valid bid at price 10
        await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 8, 4);   // valid bid at price 8
        // Place an invalid bid (quantity below minimum):
        await placeBid(this.fhevm, this.auction, this.auctionAddress, dave, 9, 2);    // invalid bid

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();

        // Allocate bids (assume a single call is sufficient for this test)
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // The settlement price should be determined from the valid bids only.
        // For example, if the settlement price is defined as the lowest valid bid price,
        // then it should be 8.
        expect(await this.auction.decryptedPrice()).to.equal(8n);
      });

      it("should apply penalty fee correctly for invalid bids", async function () {
        const { alice, bob } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 100);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);


        // one invalid bid (e.g., quantity =0).
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 7, 0);

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();

        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // Validate that the owner receives the penalty fee for the invalid bid.
        const ownerInitial = await getDecryptedBalance(alice, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(alice).ownerWithdraw();
        const ownerFinal = await getDecryptedBalance(alice, this.fhevm, this.erc20, this.erc20Address);
        expect(ownerFinal - ownerInitial).to.equal(await this.factory.DEFAULT_PENALTY_FEE());
      });
    });

  });
});

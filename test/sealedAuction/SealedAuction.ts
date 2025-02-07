import { expect } from "chai";
import { ethers } from "hardhat";
import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";
import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
import { createInstance } from "../instance";
import { getSigners, initSigners } from "../signers";
import { SealedAuctionFixture } from "./SealedAuction.fixture";
import {
  placeBid,
  approveTokens,
  transferTokens,
  jumpToAuctionEnd,
  getDecryptedBalance
} from "./Helpers";

describe("SealedAuction Tests", function () {
  before(async function () {
    await initGateway();
    await initSigners();
    this.signers = await getSigners();
  });

  describe("Constructor", function () {
    beforeEach(async function () {
      this.fhevm = await createInstance();
      this.erc20 = await deployConfidentialERC20Fixture();
      this.erc20Address = await this.erc20.getAddress();
    });

    it("Should revert if minPrice is 0", async function () {
      await expect(
        SealedAuctionFixture(
          this.signers.alice,
          this.erc20Address,
          10,
          3600,
          0,
          2,
          2
        )
      ).to.be.reverted;
    });

    it("Should revert if minQty is 0", async function () {
      await expect(
        SealedAuctionFixture(
          this.signers.alice,
          this.erc20Address,
          10,
          3600,
          2,
          0,
          2
        )
      ).to.be.reverted;
    });

    it("Should deploy with valid parameters", async function () {
      const auction = await SealedAuctionFixture(
        this.signers.alice,
        this.erc20Address,
        10,
        3600,
        2,
        2,
        2
      );
      expect(await auction.owner()).to.equal(this.signers.alice.address);
    });
  });

  describe("Auction Flow", function () {
    beforeEach(async function () {
      this.fhevm = await createInstance();
      this.erc20 = await deployConfidentialERC20Fixture();
      this.erc20Address = await this.erc20.getAddress();
      const mintTx = await this.erc20.mint(1000000);
      await mintTx.wait();
      this.auction = await SealedAuctionFixture(
        this.signers.alice,
        this.erc20Address,
        10,
        3600,
        2,
        2,
        2
      );
      this.auctionAddress = await this.auction.getAddress();
    });

    describe("Bidding Phase", function () {
      it("Should transfer deposit on placeBid", async function () {
        const { alice, bob } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
        const bStart = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);
        const tx = await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);
        await tx.wait();
        const bEnd = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        expect(bEnd).to.equal(BigInt(bStart) - 50n);
        expect(await this.auction.bidCount()).to.equal(1);
      });

      it("Should revert if max bids exceeded", async function () {
        const { bob } = this.signers;
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 1000);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 2);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 2);
        await expect(
          placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 2)
        ).to.be.revertedWithCustomError(this.auction, "MaxBidsExceeded");
      });

      it("Should revert if bidding after auction end", async function () {
        const { bob } = this.signers;
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 50);
        await jumpToAuctionEnd(this.auction);
        await expect(
          placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10)
        ).to.be.revertedWithCustomError(this.auction, "TooLate");
      });
    });

    describe("Finalization Phase", function () {
      it("Should revert computeBidsBefore if not owner", async function () {
        const { bob } = this.signers;
        await jumpToAuctionEnd(this.auction);
        await expect(this.auction.connect(bob).computeBidsBefore(5)).to.be.reverted;
      });

      it("Should revert computeBidsBefore if called too early", async function () {
        await expect(this.auction.computeBidsBefore(5)).to.be.revertedWithCustomError(this.auction, "TooEarly");
      });

      it("Should revert allocateBids if not owner", async function () {
        const { bob } = this.signers;
        await jumpToAuctionEnd(this.auction);
        await expect(this.auction.connect(bob).allocateBids(5)).to.be.revertedWithCustomError(this.auction, "OwnableUnauthorizedAccount");
      });

      it("Should revert allocateBids if called too early", async function () {
        await expect(this.auction.allocateBids(5)).to.be.revertedWithCustomError(this.auction, "TooEarly");
      });

      it("Should revert claim if called before auction end", async function () {
        await expect(this.auction.claim()).to.be.revertedWithCustomError(this.auction, "TooEarly");
      });

      it("Should revert claim if settlement price is not decrypted", async function () {
        await jumpToAuctionEnd(this.auction);
        await awaitAllDecryptionResults();
        await expect(this.auction.claim()).to.be.revertedWith("Settlement price not yet decrypted");
      });
    });

    describe("Allocation and Settlement", function () {
      it("Full allocation scenario (under-demand)", async function () {
        const { alice, bob, carol } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 500);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 500);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 300);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 300);

        const bobBid = { price: 5, quantity: 3 };
        const carolBid = { price: 2, quantity: 7 };
        const expectedSettlementPrice = 2;

        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, bobBid.price, bobBid.quantity);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, carolBid.price, carolBid.quantity);

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        // Wait for all decryption results to ensure isOverDemand is set.
        await awaitAllDecryptionResults();

        // Dynamically check whether the auction is over-demand.
        // If it is, we need to call computeBidsBefore before allocation.
        const overDemand = await this.auction.isOverDemand();
        if (overDemand) {
          await this.auction.computeBidsBefore(10);
        }
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // Verify that the settlement price is as expected.
        expect(await this.auction.decryptedPrice()).to.equal(expectedSettlementPrice);

        // Bob claims his allocation.
        const bobInitial = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(bob).claim();
        const bobAfterClaim = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        expect(bobAfterClaim - bobInitial).to.equal(expectedSettlementPrice * bobBid.quantity);
        // Bob withdraws his remaining deposit.
        await this.auction.connect(bob).withdraw();
        const bobFinal = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        // For Bob, the refund should be: (deposit – cost) = (5×3 – 2×3) = 9.
        expect(bobFinal - bobAfterClaim).to.equal(9n);

        // Carol claims and then withdraws.
        const carolInitial = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(carol).claim();
        const carolAfterClaim = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
        expect(carolAfterClaim - carolInitial).to.equal(expectedSettlementPrice * carolBid.quantity);
        await this.auction.connect(carol).withdraw();
        const carolFinal = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
        expect(carolFinal - carolAfterClaim).to.equal(0n);
      });

      it("Partial allocation scenario (over-demand)", async function () {
        const { alice, bob, carol } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 400);
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, carol, 400);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 300);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, carol, this.auctionAddress, 300);

        // Bob bids 5 for 9 tokens (deposit = 45) and Carol bids 5 for 6 tokens (deposit = 30)
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 9);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, carol, 5, 6);

        await jumpToAuctionEnd(this.auction);
        await this.auction.finalize();
        await awaitAllDecryptionResults();

        // In an over-demand scenario, computeBidsBefore must be called.
        await this.auction.computeBidsBefore(10);
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        // Expected settlement price is 5.
        expect(await this.auction.decryptedPrice()).to.equal(5n);

        // Allocation: supply = 10, so Bob gets 9 tokens and Carol gets 1 token.
        // Bob: cost = 9 * 5 = 45, deposit = 45, refund = 0.
        // Carol: cost = 1 * 5 = 5, deposit = 30, refund = 25.
        const bobInitial = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(bob).claim();
        const bobAfterClaim = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        expect(bobAfterClaim - bobInitial).to.equal(45n);
        await this.auction.connect(bob).withdraw();
        const bobAfterWithdraw = await getDecryptedBalance(bob, this.fhevm, this.erc20, this.erc20Address);
        expect(bobAfterWithdraw - bobAfterClaim).to.equal(0n);

        const carolInitial = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
        await this.auction.connect(carol).claim();
        const carolAfterClaim = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
        expect(carolAfterClaim - carolInitial).to.equal(5n);
        await this.auction.connect(carol).withdraw();
        const carolAfterWithdraw = await getDecryptedBalance(carol, this.fhevm, this.erc20, this.erc20Address);
        expect(carolAfterWithdraw - carolAfterClaim).to.equal(25n);
      });
    });

    describe("Edge Cases", function () {
      it("Should revert on double claim", async function () {
        const { alice, bob } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);

        await jumpToAuctionEnd(this.auction);
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        await this.auction.connect(bob).claim();
        await expect(this.auction.connect(bob).claim()).to.be.revertedWith("Bid already claimed or cannot claim");
      });

      it("Should revert withdraw if claim not performed", async function () {
        const { alice, bob } = this.signers;
        await transferTokens(this.fhevm, this.erc20, this.erc20Address, alice, bob, 200);
        await approveTokens(this.fhevm, this.erc20, this.erc20Address, bob, this.auctionAddress, 100);
        await placeBid(this.fhevm, this.auction, this.auctionAddress, bob, 5, 10);

        await jumpToAuctionEnd(this.auction);
        await this.auction.allocateBids(10);
        await awaitAllDecryptionResults();

        await expect(this.auction.connect(bob).withdraw()).to.be.revertedWith("Bid must be claimed before withdrawal");
      });
    });

    describe("Batched Processing", function () {
      it("Should process bids in batches correctly", async function () {
        // Get signers and select three bidders (non-owner accounts)
        const allSigners = await ethers.getSigners();
        const bidders = allSigners.slice(1, 4);

        // Deploy an auction with limited supply to force an over-demand scenario.
        const auction = await SealedAuctionFixture(
          this.signers.alice,
          this.erc20Address,
          5,     // limited supply
          3600,  // auction duration
          1,
          1,
          10     // high MAX_BIDS_PER_ADDRESS for testing
        );
        const auctionAddress = await auction.getAddress();

        // For each bidder, transfer tokens and approve spending.
        for (const bidder of bidders) {
          await transferTokens(this.fhevm, this.erc20, this.erc20Address, this.signers.alice, bidder, 100);
          await approveTokens(this.fhevm, this.erc20, this.erc20Address, bidder, auctionAddress, 100);
        }

        // Each bidder places two bids with different prices:
        // - Bid 1: price = (2 + bidder index), quantity = 10.
        // - Bid 2: price = (1 + bidder index), quantity = 5.
        for (let i = 0; i < bidders.length; i++) {
          const bidder = bidders[i];
          const price1 = 2 + i;
          const qty1 = 10;
          await placeBid(this.fhevm, auction, auctionAddress, bidder, price1, qty1);

          const price2 = 1 + i;
          const qty2 = 5;
          await placeBid(this.fhevm, auction, auctionAddress, bidder, price2, qty2);
        }

        // End the auction, finalize and wait for decryption.
        await jumpToAuctionEnd(auction);
        await auction.finalize();
        await awaitAllDecryptionResults();

        // Process bids in batches for the computation phase.
        const bidCount = Number(await auction.bidCount());
        const batchSize = 3;
        while ((await auction.compIndex()) < bidCount) {
          await auction.computeBidsBefore(batchSize);
        }

        // Process allocation in batches.
        while ((await auction.allocIndex()) < bidCount) {
          await auction.allocateBids(batchSize);
          await awaitAllDecryptionResults();
        }

        // Verify that all bids have been processed.
        expect(await auction.compIndex()).to.equal(bidCount);
        expect(await auction.allocIndex()).to.equal(bidCount);

        // Settlement price should be greater than 0.
        const settlementPrice = await auction.decryptedPrice();
        expect(settlementPrice).to.be.gt(0);

        // For each bidder, verify that claim and withdraw increase their balance.
        for (const bidder of bidders) {
          const initialBalance = await getDecryptedBalance(bidder, this.fhevm, this.erc20, this.erc20Address);
          await auction.connect(bidder).claim();
          await auction.connect(bidder).withdraw();
          const finalBalance = await getDecryptedBalance(bidder, this.fhevm, this.erc20, this.erc20Address);
          expect(finalBalance).to.be.gt(initialBalance);
        }
      });
    });
  });
});

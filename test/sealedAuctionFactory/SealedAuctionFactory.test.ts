import { expect } from "chai";
import { ethers } from "hardhat";
import type { SealedAuctionFactory } from "../../types";
import { getSigners, initSigners } from "../signers";
import { SealedAuctionFactoryFixture } from "./SealedAuctionFactory.fixture";
import { createInstance } from "../instance";
import { approveTokens } from "../sealedAuction/Helpers";
import { Signer } from "ethers";

describe("SealedAuctionFactory", function () {
  let factory: SealedAuctionFactory;
  let auctionOwner: Signer;
  let snapshotId: string;

  before(async function () {
    await initSigners();
    this.signers = await getSigners();
    auctionOwner = this.signers.alice;
    user = this.signers.bob;
    // Deploy the factory only once because the auction contract uses a hard-coded factory address.
    factory = await SealedAuctionFactoryFixture();
    this.fhevm = await createInstance();
  });

  beforeEach(async function () {
    // Use a snapshot to reset state between tests.
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  it("should create an ERC20 auction via the helper", async function () {
    // This test already uses createAuctionViaFactory, which includes minting and approval.
    const { createAuctionViaFactory } = await import("./CreateAuctionViaFactory");
    await createAuctionViaFactory(
      auctionOwner,
      1000,   // totalTokens
      3600,   // biddingDuration (in seconds)
      10,     // minBidPrice
      1,      // minBidQuantity
      0,      // paymentType = ERC20 (0)
      factory // using the deployed factory instance
    );
    const totalAuctions = await factory.getTotalAuctions();
    expect(totalAuctions).to.equal(1);
  });

  it("should paginate auctions", async function () {
    // Get the asset token instance from the factory.
    const defaultAssetAddress = await factory.defaultAssetERC20();
    const assetToken = await ethers.getContractAt("MyConfidentialERC20", defaultAssetAddress);
    const totalTokens = 1000;
    const fhevm = await createInstance();

    // Create 5 auctions, each with proper minting and approval.
    for (let i = 0; i < 5; i++) {
      // Mint tokens to the auction owner.
      const mintTx = await assetToken.connect(auctionOwner).mint(totalTokens);
      await mintTx.wait();

      // Approve the factory to transfer the tokens.
      await approveTokens(fhevm, assetToken, defaultAssetAddress, auctionOwner, await factory.getAddress(), totalTokens);

      // Create the auction.
      const tx = await factory.createAuction(
        await auctionOwner.getAddress(),
        totalTokens,
        3600,
        10,
        1,
        0
      );
      await tx.wait();
    }

    const batch = await factory.getAuctions(2, 2);
    expect(batch.length).to.equal(2);
    const total = await factory.getTotalAuctions();
    expect(total).to.equal(5);
  });

  it("should filter active auctions", async function () {
    // Get the asset token instance from the factory.
    const defaultAssetAddress = await factory.defaultAssetERC20();
    const assetToken = await ethers.getContractAt("MyConfidentialERC20", defaultAssetAddress);
    const totalTokens = 1000;

    // Create first auction (active for 1 hour).
    {
      const mintTx = await assetToken.connect(auctionOwner).mint(totalTokens);
      await mintTx.wait();

      await approveTokens(this.fhevm, assetToken, defaultAssetAddress, auctionOwner, await factory.getAddress(), totalTokens);
      const tx1 = await factory.createAuction(
        await auctionOwner.getAddress(),
        totalTokens,
        3600, // ends in 1 hour
        10,
        1,
        0
      );
      await tx1.wait();
    }

    // Create second auction (expires almost immediately).
    {
      const mintTx = await assetToken.connect(auctionOwner).mint(totalTokens);
      await mintTx.wait();

      await approveTokens(this.fhevm, assetToken, defaultAssetAddress, auctionOwner, await factory.getAddress(), totalTokens);
      const tx2 = await factory.createAuction(
        await auctionOwner.getAddress(),
        totalTokens,
        1,    // expires in 1 second
        10,
        1,
        0
      );
      await tx2.wait();
    }

    // Increase time so that the second auction expires.
    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);

    const activeAuctions = await factory.getActiveAuctions(0, 10);
    expect(activeAuctions.length).to.equal(1);

    const totalActive = await factory.getTotalActiveAuctions();
    expect(totalActive).to.equal(1);
  });

  it("should revert auction creation if auction owner has insufficient balance (no tokens minted)", async function () {
    // Do not mint tokens and do not approve.
    // The auction owner's balance is zero, so transferFrom fails.
    await expect(
      factory.createAuction(
        await auctionOwner.getAddress(),
        1000,  // required tokens
        3600,  // bidding duration
        10,    // min bid price
        1,     // min bid quantity
        0      // paymentType = ERC20
      )
    ).to.be.revertedWith("Sender doesn't own rhs on op");
  });

  it("should revert auction creation if auction owner has no approval", async function () {
    // Get the asset token instance from the factory.
    const defaultAssetAddress = await factory.defaultAssetERC20();
    const assetToken = await ethers.getContractAt("MyConfidentialERC20", defaultAssetAddress);
    const totalTokens = 1000;

    // Mint tokens so that the auction owner's balance is sufficient.
    const mintTx = await assetToken.connect(auctionOwner).mint(totalTokens);
    await mintTx.wait();

    // Deliberately do not approve any tokens (allowance remains 0).
    // Then, when createAuction is called, the transferFrom will fail,
    // and the require will revert with "Asset token transfer failed".
    await expect(
      factory.createAuction(
        await auctionOwner.getAddress(),
        totalTokens,
        3600,
        10,
        1,
        0
      )
    ).to.be.revertedWith("Sender doesn't own rhs on op");
  });

  it("should revert if minPrice is 0", async function () {
    await expect(
      factory.createAuction(
        await auctionOwner.getAddress(),
        1000,    // supply
        3600,    // biddingTime
        0,       // minPrice is 0
        1,       // minQty
        0        // paymentType = ERC20
      )
    ).to.be.revertedWithCustomError(factory, "InvalidMinPrice");
  });

  it("should revert if minQty is 0", async function () {
    await expect(
      factory.createAuction(
        await auctionOwner.getAddress(),
        1000,    // supply
        3600,    // biddingTime
        10,      // minPrice
        0,       // minQty is 0
        0        // paymentType = ERC20
      )
    ).to.be.revertedWithCustomError(factory, "InvalidMinQty");
  });

  it("should revert if supply is 0", async function () {
    await expect(
      factory.createAuction(
        await auctionOwner.getAddress(),
        0,       // supply is 0
        3600,    // biddingTime
        10,      // minPrice
        1,       // minQty
        0        // paymentType = ERC20
      )
    ).to.be.revertedWithCustomError(factory, "InvalidSupply");
  });

});

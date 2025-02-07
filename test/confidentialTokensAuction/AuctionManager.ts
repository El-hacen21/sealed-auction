import { Address } from "hardhat-deploy/types";

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AuctionManager", function () {
    let auctionManager: string;
    let token: any;
    let owner: Address, addr1: Address, addr2: Address;

    beforeEach(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        // Deploy a simple ERC20 mock token.
        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        token = await ERC20Mock.deploy("Mock Token", "MTK", owner.address, 1_000_000);
        await token.deployed();

        // Deploy the AuctionManager contract.
        const AuctionManagerFactory = await ethers.getContractFactory("AuctionManager");
        auctionManager = await AuctionManagerFactory.deploy();
        await auctionManager.deployed();
    });

    it("should create auctions and track them correctly", async function () {
        const biddingTime = 3600; // 1 hour duration
        const totalTokens = 100;
        const minBidPrice = 5;

        // addr1 creates an auction.
        await expect(
            auctionManager.connect(addr1).createAuction(token.address, totalTokens, biddingTime, minBidPrice)
        ).to.emit(auctionManager, "AuctionCreated");

        // Verify auctions list.
        const allAuctions = await auctionManager.getAllAuctions();
        expect(allAuctions.length).to.equal(1);

        // Verify auctions by creator (addr1).
        const addr1Auctions = await auctionManager.getAuctionsByCreator(addr1.address);
        expect(addr1Auctions.length).to.equal(1);

        // addr2 creates an auction.
        await auctionManager.connect(addr2).createAuction(token.address, totalTokens, biddingTime, minBidPrice);
        const allAuctionsAfter = await auctionManager.getAllAuctions();
        expect(allAuctionsAfter.length).to.equal(2);

        // Auctions for addr2.
        const addr2Auctions = await auctionManager.getAuctionsByCreator(addr2.address);
        expect(addr2Auctions.length).to.equal(1);
    });

    it("should filter active auctions correctly", async function () {
        const totalTokens = 100;
        const minBidPrice = 5;

        // Create two auctions: one with a very short duration and one with a longer duration.
        // Auction 1: bidding time 1 second (will become inactive quickly)
        await auctionManager.connect(owner).createAuction(token.address, totalTokens, 1, minBidPrice);
        // Auction 2: bidding time 3600 seconds
        await auctionManager.connect(owner).createAuction(token.address, totalTokens, 3600, minBidPrice);

        // Immediately, both auctions should be active.
        let activeAuctions = await auctionManager.getActiveAuctions();
        expect(activeAuctions.length).to.equal(2);

        // Wait for 2 seconds so that the first auction expires.
        await new Promise((resolve) => setTimeout(resolve, 2100));

        activeAuctions = await auctionManager.getActiveAuctions();
        // Only the long-duration auction remains active.
        expect(activeAuctions.length).to.equal(1);
    });
});

import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  displayAllBidOutputs,
  jumpToAuctionEnd,
  placeBid,
  finalizeAuction,
  expectFinalizeAuctionRevert,
  decryptAndDisplay,
  displayAllBids,
  expectDecryptedBalance,
  transferTokens,
  approveTokens
} from './Helpers';


import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
import { createInstance } from "../instance";
import { getSigners, initSigners } from '../signers';
import { deployConfidentialTokensAuctionFixture } from './ConfidentialTokensAuction.fixture';


describe('ConfidentialTokensAuction', function () {
  before(async function () {
    // Initialize signers
    await initSigners();
    this.signers = await getSigners();
  });

  beforeEach(async function () {
    // Create fhevm instance
    this.fhevm = await createInstance();

    // Deploy ERC20 contract with Alice account
    const contractErc20 = await deployConfidentialERC20Fixture();
    this.erc20 = contractErc20;
    this.contractERC20Address = await contractErc20.getAddress();
    // console.log("Deployed ERC20 Address:", this.contractERC20Address);

    // Mint tokens for Alice (1000 tokens)
    const mintTransaction = await this.erc20.mint(10000);
    await mintTransaction.wait();

    // Deploy auction contract
    const [auctionContract] = await Promise.all([
      deployConfidentialTokensAuctionFixture(
        this.signers.alice,
        this.contractERC20Address,
        5,     // Quantity
        1000000, // Auction duration
        true     // Confidential mode
      ),
      mintTransaction.wait()
    ]);

    this.contractAddress = await auctionContract.getAddress(); // Auction contract address
    this.blindAuction = auctionContract;

    // console.log("Deployed Auction Contract Address:", this.contractAddress);
    // console.log("Setup completed successfully.");
  });

  it('should allow Bob to place a bid and verify the token transfer', async function () {
    const { bob, alice } = this.signers;

    // Give Bob some tokens first (500 tokens)
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 500);

    // Verify Bob's balance (should be 500)
    await expectDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address, 500);

    // Approve the auction to spend 100 tokens from Bob
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);

    // Place a bid (price=10, quantity=10 => total=100)
    await expect(
      placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 10, 10)
    ).to.emit(this.blindAuction, 'BidSubmitted');

    // Check Bob's balance now (should be 400)
    await expectDecryptedBalance(bob, this.fhevm, this.erc20, this.contractERC20Address, 400);

    // Check that the bidCounter has incremented
    const currentBidCounter = await this.blindAuction.bidCounter();
    expect(currentBidCounter).to.equal(1);

  });

  it("should revert if finalization is called before the auction ends", async function () {
    await expect(
      this.blindAuction.connect(this.signers.alice).finalizeAuction()
    ).to.be.revertedWithCustomError(this.blindAuction, "TooEarly")
      .withArgs(await this.blindAuction.endTime());
  });

  it("should revert if someone other than the owner tries to finalize", async function () {
    // Advance time to after the auction ends
    await jumpToAuctionEnd(this.blindAuction);

    // Non-owner attempts finalization
    await expectFinalizeAuctionRevert(this.blindAuction, this.signers.bob);
  });

  it("should finalize successfully after auction ends", async function () {

    const { alice, bob, carol, dave, eve } = this.signers;

    // Give Bob and Carol tokens
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 100);
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, carol, 100);
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, dave, 200);
    // await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, eve, 200);

    // Approve auction for Bob and Carol
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, carol, this.contractAddress, 100);
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, dave, this.contractAddress, 100);
    // await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, eve, this.contractAddress, 100);

    // Place bids
    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 10, 5);
    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 15, 3);
    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, dave, 15, 3);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, eve, 15, 3);


    // Advance time to after the auction ends
    await jumpToAuctionEnd(this.blindAuction);


    // Owner finalizes
    await finalizeAuction(this.blindAuction, alice);

     // Verify balance after claim
     await expectDecryptedBalance(
      alice,
      this.fhevm,
      this.erc20,
      this.contractERC20Address,
      50
    );

    const encryptedRemaining = await this.blindAuction.encryptedRemaining();
    const encryptedTotalBuys = await this.blindAuction.encryptedTotalBuys();
    const countTotalBuys = await this.blindAuction.countTotalBuys();

    const dencryptedTotalBuys = await decryptAndDisplay(alice, this.fhevm, encryptedTotalBuys, this.contractAddress, true);
    const dencryptedRemaining = await decryptAndDisplay(alice, this.fhevm, encryptedRemaining, this.contractAddress, true);
    const dcountTotalBuys = await decryptAndDisplay(alice, this.fhevm, countTotalBuys, this.contractAddress, true);

    console.log(`  dencryptedRemaining: ${dencryptedRemaining}`);
    console.log(`  dencryptedTotalBuys: ${dencryptedTotalBuys}`);
    console.log(`  countTotalBuys: ${dcountTotalBuys}`);

    // logDecryptedBid(decryptedBid, 1);
    await displayAllBids(alice, this.fhevm, this.blindAuction, this.contractAddress, true);

    await displayAllBidOutputs(alice, this.fhevm, this.blindAuction, this.contractAddress, true);

  });

  it("should allow winners to claim and non-winners to withdraw after auction ends", async function () {
    const { alice, bob, carol, dave, eve } = this.signers;

    // Setup initial token transfers and approvals
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 100);
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, carol, 45);
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 100);
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, carol, this.contractAddress, 45);

    // Place bids
    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 10, 5); // Bob: 10 units @ price 5
    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 15, 3); // Carol: 15 units @ price 3

    // End the auction
    await jumpToAuctionEnd(this.blindAuction);
    await finalizeAuction(this.blindAuction, alice);

    // Verify balance after claim
    await expectDecryptedBalance(
      bob,
      this.fhevm,
      this.erc20,
      this.contractERC20Address,
      50
    );

    console.log("Testing withdraw() for Bob...");
    await expect(this.blindAuction.connect(bob).withdraw()).to.be.revertedWith("Bid must be claimed before withdraw");

    // Test claim() for Bob
    console.log("Testing claim() for Bob...");
    await expect(this.blindAuction.connect(bob).claim());

    // Verify balance after claim
    await expectDecryptedBalance(
      bob,
      this.fhevm,
      this.erc20,
      this.contractERC20Address,
      50
    );

    // Attempting double claim should fail
    await expect(this.blindAuction.connect(bob).claim())
      .to.be.revertedWith("Bid already claimed or user cannot claim");

    // Test claim() for Carol
    console.log("Testing claim() for Carol...");
    await expect(this.blindAuction.connect(carol).claim());
    // Verify balance after claim
    await expectDecryptedBalance(
      carol,
      this.fhevm,
      this.erc20,
      this.contractERC20Address,
      0
    );

    // Test withdraw() for non-winners (e.g., Carol or other scenarios if they exist)
    console.log("Testing withdraw() for Bob...");
    await expect(this.blindAuction.connect(bob).withdraw());

    console.log("Testing withdraw() for Carol...");
    await expect(this.blindAuction.connect(carol).withdraw());
  });


});
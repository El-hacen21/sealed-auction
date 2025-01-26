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
import { initGateway, awaitAllDecryptionResults } from "../asyncDecrypt";

import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
import { createInstance } from "../instance";
import { getSigners, initSigners } from '../signers';
import { deployConfidentialTokensAuctionFixture } from './ConfidentialTokensAuction.fixture';

import { network } from "hardhat";

import { getFHEGasFromTxReceipt } from "../coprocessorUtils";


describe('ConfidentialTokensAuction', function () {
  before(async function () {
    // 1) Initialize Zama Gateway. Must happen before any transaction that requests a decryption.
    await initGateway();
    // Initialize signers
    await initSigners();
    this.signers = await getSigners();


    const decryptionHelperContract = await ethers.getContractFactory("DecryptionHelper");
    this.decryptionHelperContract = await decryptionHelperContract.connect(this.signers.alice).deploy();
    await this.decryptionHelperContract.waitForDeployment();

    const sortingLibraryFactory = await ethers.getContractFactory("SortingNetworkLibrary");
    this.sortingLibrary = await sortingLibraryFactory.connect(this.signers.alice).deploy();
    await this.sortingLibrary.waitForDeployment();
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
    const mintTransaction = await this.erc20.mint(10000000);
    await mintTransaction.wait();

    // Deploy auction contract
    const [auctionContract] = await Promise.all([
      deployConfidentialTokensAuctionFixture(
        this.signers.alice,
        this.contractERC20Address,
        await this.sortingLibrary.getAddress(),
        this.decryptionHelperContract.getAddress(),
        100,     // Quantity
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

  // it("should revert if finalization is called before the auction ends", async function () {
  //   await expect(
  //     this.blindAuction.connect(this.signers.alice).finalizeAuction(1)
  //   ).to.be.revertedWithCustomError(this.blindAuction, "TooEarly")
  //     .withArgs(await this.blindAuction.endTime());
  // });

  // it("should revert if someone other than the owner tries to finalize", async function () {
  //   // Advance time to after the auction ends
  //   await jumpToAuctionEnd(this.blindAuction);

  //   // Non-owner attempts finalization
  //   await expectFinalizeAuctionRevert(this.blindAuction, this.signers.bob);
  // });

  // describe("TestAsyncDecrypt", function () {

  //   beforeEach(async function () {
  //     const contractFactory = await ethers.getContractFactory("TestAsyncDecrypt");
  //     this.contract = await contractFactory.connect(this.signers.alice).deploy();
  //   });


  // });

  // it("test async decrypt bool", async function () {
  //   const tx2 = await this.blindAuction.connect(this.signers.carol).requestBool();
  //   await tx2.wait();
  //   await awaitAllDecryptionResults();
  //   const y = await this.blindAuction.yBool(); // Updated from this.contract.yBool()
  //   expect(y).to.equal(true);
  // });



  it("should finalize successfully after auction ends", async function () {

    const { alice, bob, carol, dave, eve } = this.signers;

    // Give Bob and Carol tokens
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, bob, 1000);
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, carol, 1000);
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, dave, 2000);
    await transferTokens(this.fhevm, this.erc20, this.contractERC20Address, alice, eve, 2000);

    // Approve auction for Bob and Carol
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, bob, this.contractAddress, 1000);
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, carol, this.contractAddress, 1000);
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, dave, this.contractAddress, 1000);
    await approveTokens(this.fhevm, this.erc20, this.contractERC20Address, eve, this.contractAddress, 1000);

    // Place bids
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 4, 5);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 2, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 3, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, dave, 5, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, eve, 4, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);

    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);
    // await placeBid(this.fhevm, this.blindAuction, this.contractAddress, bob, 1, 1);


    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, carol, 3, 3);
    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, dave, 2, 1);
    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, dave, 30, 1);

    await placeBid(this.fhevm, this.blindAuction, this.contractAddress, eve, 15, 3);


    // const tx1 = await this.blindAuction.connect(alice).swap();
    // const receipt1 = await tx1.wait();
    // console.log("swap() gas used:", receipt1.gasUsed.toString());

    // const tx2 = await this.blindAuction.connect(alice).swap2();
    // const receipt2 = await tx2.wait();
    // console.log("swap2() gas used:", receipt2.gasUsed.toString());

    // Advance time to after the auction ends
    await jumpToAuctionEnd(this.blindAuction);


    // Fetch array length (if available via a `bidsCount()` or similar function)
    const length = 3; // Assuming you know the length, or have a function to get it
    let totalNativeGasUsed = BigInt(0); // Initialize as BigInt
    let totalFHEGasConsumed = 0; // Standard integer for FHE gas

    for (let i = 0; i < length; i++) {
      const tx = await this.blindAuction.connect(alice).swap(); // Trigger the swap
      const receipt = await tx.wait(); // Wait for the transaction to complete

      if (network.name === "hardhat") {
        // Calculate FHE gas consumed if on mocked FHEVM
        const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
        console.log(`FHE Gas Consumed during swap ${i + 1}:`, FHEGasConsumed);
        totalFHEGasConsumed += FHEGasConsumed;
      }

      // Log the native gas used for the transaction
      const nativeGasUsed = BigInt(receipt.gasUsed); // Convert to BigInt
      console.log(`Native Gas Used during swap ${i + 1}:`, nativeGasUsed.toString());
      totalNativeGasUsed += nativeGasUsed;

      // Await any additional decryption results if required
      await awaitAllDecryptionResults();
      console.log("---------------");
    }

    if (network.name === "hardhat") {
      console.log("Total FHE Gas Consumed:", totalFHEGasConsumed);
    }
    // Final totals
    console.log("Total Native Gas Used:", totalNativeGasUsed.toString());



    // Fetch individual elements
    for (let i = 0; i <= length; i++) {
      const bid = await this.blindAuction.bidsIndexs(i);
      console.log(`Bid Index ${i}:`, bid.toString());
    }

    await finalizeAuction(this.blindAuction.connect(alice), 10);
    // // Owner finalizes
    // const txfinalize = await this.blindAuction.connect(alice).finalizeAuction(10);
    // const txfinalizeReceipt = await txfinalize.wait();

    // if (network.name === "hardhat") {
    //   console.log("FHE Finalize gas:", getFHEGasFromTxReceipt(txfinalizeReceipt));
    // }
    // // Final totals
    // console.log("Finalize Native Gas Used:", BigInt(txfinalizeReceipt.gasUsed).toString());


    // const key = await this.blindAuction.getComparisonKey(1, 4);

    // const actualDecrypted = await this.blindAuction.decryptedComparaisons(key);
    // console.log("Decrypted Comparison for key ", key, ": ", actualDecrypted);
    // expect(actualDecrypted).to.equal(true);



    await displayAllBids(alice, this.fhevm, this.blindAuction, this.contractAddress, true);

    await displayAllBidOutputs(alice, this.fhevm, this.blindAuction, this.contractAddress, true);

  });

  // it("test async decrypt uint32", async function () {
  //   // 3) Call the function that requests a decryption
  //   const tx = await this.contract.requestUint32(5, 15, {
  //     gasLimit: 500_000, 
  //   });
  //   await tx.wait();

  //   // 4) Wait for all pending decryptions to be completed. 
  //   //    In a real fhEVM node, that usually means waiting 2 blocks.
  //   //    In mocked mode, it's instant as soon as you call this helper.
  //   await awaitAllDecryptionResults();

  //   // 5) Check that our callback did the addition: 5 + 15 + 32 = 52
  //   const y = await this.contract.yUint32();
  //   expect(y).to.equal(52);
  // });

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
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { reencryptEuint64, reencryptEbool } from "../reencrypt";
import { debug } from "../utils";

/**
 * Increases the EVM time by `seconds` and mines a new block.
 * @param {number} seconds - Number of seconds to jump forward
 */
export async function increaseTimeAndMine(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
}

/**
 * Advances time to after the auction end.
 * @param {Contract} auctionContract - The auction contract instance
 */
export async function jumpToAuctionEnd(auctionContract) {
    const endTime = await auctionContract.endTime();
    const currentTime = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const timeToJump = endTime - currentTime + 1n;
    await increaseTimeAndMine(Number(timeToJump));
}

/**
 * Places a bid on the auction with specified price and quantity using `fhevm` encryption.
 * Returns a transaction promise, so the caller can use `expect(...).to.emit(...)`.
 *
 * @param {object} fhevm - Instance for encrypted operations.
 * @param {Contract} auctionContract - Auction contract instance
 * @param {string} auctionAddress - Address of the auction contract
 * @param {Signer} bidderSigner - Signer placing the bid
 * @param {number} price - The bid price per token
 * @param {number} quantity - The quantity of tokens to buy
 */
export async function placeBid(fhevm, auctionContract, auctionAddress, bidderSigner, price, quantity) {
    const bidInput = fhevm.createEncryptedInput(auctionAddress, bidderSigner.address);
    bidInput.add64(price);
    bidInput.add64(quantity);

    const encryptedBid = await bidInput.encrypt();
    return auctionContract.connect(bidderSigner).bid(
        encryptedBid.handles[0],
        encryptedBid.handles[1],
        encryptedBid.inputProof,
        { gasLimit: 3000000 }
    );
}


export async function finalizeAuction(contract, batchSize) {
    let stillRunning = true;
    let totalGasUsed = BigInt(0);

    const tx = await contract.finalizeAuction(batchSize);

    // while (stillRunning) {
    //     // 1) Call the contract function
    //     const tx = await contract.finalizeAuction(batchSize);

    //     // 2) Wait for the tx receipt
    //     const receipt = await tx.wait();

    //     // 3) Accumulate gasUsed
    //     totalGasUsed = totalGasUsed + receipt.gasUsed;

    //     // 4) Check status
    //     const ci = await contract.currentIndex();    // currentIndex
    //     const bc = await contract.bidCounter();      // bidCounter
    //     const fin = await contract.isFinalized();    // bool

    //     if (fin || (ci == bc)) {
    //         stillRunning = false;
    //     }
    // }

    console.log("Auction fully finalized!");
    console.log("Total gas used across all batches:", totalGasUsed.toString());

    // You might also want the total cost in WEI/ETH:
    // If using a typical network with dynamic gas price:
    //   - Need the effectiveGasPrice from each receipt
    //   - Sum up gasUsed[i] * effectiveGasPrice[i].
    // For simplicity, here we only track total gasUsed (not cost).
}



/**
 * Attempts to finalize the auction and expects a revert if not the owner.
 * @param {Contract} auction - The auction contract instance
 * @param {Signer} nonOwner - A signer who is not the owner
 */
export async function expectFinalizeAuctionRevert(auction, nonOwner) {
    await expect(
        auction.connect(nonOwner).finalizeAuction()
    ).to.be.revertedWithCustomError(auction, "OwnableUnauthorizedAccount")
        .withArgs(nonOwner.address);
    // console.log(`Non-owner (${nonOwner.address}) finalization attempt reverted as expected.`);
}

/**
 * Decrypts fields of a given bid and returns a readable object.
 * If `minimal` is true, only `price` and `quantity` are decrypted.
 * 
 * @param {Signer} decryptSigner - The signer who can decrypt
 * @param {object} fhevm - The fhevm instance for decryption
 * @param {Contract} auction - Auction contract instance
 * @param {string} contractAddress - Auction contract instance
 * @param {number} bidIndex - The index of the bid to decrypt
 * @param {boolean} [minimal=false] - Whether to only decrypt `price` and `quantity`
 */
export async function getDecryptedBid(decryptSigner, fhevm, auction, contractAddress, bidIndex, minimal = false) {
    const bid = await auction.getBid(bidIndex);

    const price = await reencryptEuint64(decryptSigner, fhevm, bid.ePrice, contractAddress);
    const quantity = await reencryptEuint64(decryptSigner, fhevm, bid.eQuantity, contractAddress);

    if (minimal) {
        return {
            account: bid.account,
            price: price,
            quantity: quantity
        };
    }

    const index = await reencryptEuint64(decryptSigner, fhevm, bid.eIndex, contractAddress);
    const totalBuy = await reencryptEuint64(decryptSigner, fhevm, bid.eTotalBuy, contractAddress);
    const partialBuy = await reencryptEuint64(decryptSigner, fhevm, bid.ePartialBuy, contractAddress);

    return {
        account: bid.account,
        price: price,
        quantity: quantity,
        index: index,
        totalBuy: totalBuy,
        partialBuy: partialBuy
    };
}


/**
 * Helper function to decrypt or re-encrypt a given variable based on debug mode.
 * @param {object} deployer - The deployer account for re-encryption.
 * @param {object} fhevm - The fhevm instance for cryptographic operations.
 * @param {any} encryptedValue - The encrypted variable to be decrypted or re-encrypted.
 * @param {string} contractAddress - The contract address for re-encryption context.
 * @param {boolean} useDebug - Whether to use debug mode (true) or re-encrypt mode (false).
 * @param {string} debugType - Type of debug decryption function ('decrypt64' or 'decryptBool').
 * @returns {Promise<any>} - The decrypted or re-encrypted value.
 */
export async function decryptAndDisplay(deployer, fhevm, encryptedValue, contractAddress, useDebug, debugType = 'decrypt64') {
    if (useDebug) {
        if (debugType === 'decrypt64') {
            return await debug.decrypt64(encryptedValue);
        } else if (debugType === 'decryptBool') {
            return await debug.decryptBool(encryptedValue);
        } else {
            throw new Error(`Unsupported debug decryption type: ${debugType}`);
        }
    } else {
        if (debugType === 'decrypt64') {
            return await reencryptEuint64(deployer, fhevm, encryptedValue, contractAddress);
        } else if (debugType === 'decryptBool') {
            return await reencryptEbool(deployer, fhevm, encryptedValue, contractAddress);
        } else {
            throw new Error(`Unsupported re-encryption type: ${debugType}`);
        }
    }
}

/*******************************************************
 * HELPER: Create a padded string for console alignment
 *******************************************************/
function padString(value, length) {
    const strValue = String(value);
    if (strValue.length >= length) return strValue;
    return strValue + " ".repeat(length - strValue.length);
}

export async function displayAllBids(deployer, fhevm, blindAuction, contractAddress, useDebug = false) {
    const bidCounter = await blindAuction.bidCounter();
    const totalTokens = await blindAuction.totalTokens();
    const minBidPrice = await blindAuction.minBidPrice();

    console.log(`\n=== BIDS INFO ===`);
    console.log(`Nb bids: ${bidCounter} | Nb Tokens: ${totalTokens} | Min Bid Price: ${minBidPrice}\n`);

    console.log("---------------------------------------------------------------");
    console.log(
        "| " +
        padString("ID", 3) +
        " | " +
        padString("Price", 7) +
        " | " +
        padString("Quantity", 8) +
        " | " +
        padString("Index", 5) +
        " | " +
        padString("TotalBuy", 8) +
        " | " +
        padString("PartialBuy", 10) +
        " |"
    );
    console.log("---------------------------------------------------------------");

    for (let i = 0; i < bidCounter; i++) {
        const bid = await blindAuction.getBid(i);

        try {
            const decryptedPrice = await decryptAndDisplay(deployer, fhevm, bid.ePrice, contractAddress, useDebug, "decrypt64");
            const decryptedQuantity = await decryptAndDisplay(deployer, fhevm, bid.eQuantity, contractAddress, useDebug, "decrypt64");
            const decryptedIndex = await decryptAndDisplay(deployer, fhevm, bid.eIndex, contractAddress, useDebug, "decrypt64");
            // const decryptedTotalBuy = await decryptAndDisplay(deployer, fhevm, bid.eTotalBuy, contractAddress, useDebug, "decryptBool");
            // const decryptedPartialBuy = await decryptAndDisplay(deployer, fhevm, bid.ePartialBuy, contractAddress, useDebug, "decryptBool");

            console.log(
                "| " +
                padString(i, 3) +
                " | " +
                padString(decryptedPrice, 7) +
                " | " +
                padString(decryptedQuantity, 8) +
                " | " +
                padString(decryptedIndex, 5) +
                " | " +
                // padString(decryptedTotalBuy, 8) +
                // " | " +
                // padString(decryptedPartialBuy, 10) +
                " |"
            );
        } catch (err) {
            console.error(`Failed to decrypt bid ${i}: ${err.message}`);
        }
    }

    console.log("---------------------------------------------------------------\n");
}



/****************************************************************
 * Display the Bid Outputs table
 ****************************************************************/
export async function displayAllBidOutputs(deployer, fhevm, blindAuction, contractAddress, useDebug = false) {
    // Retrieve the total number of bid outputs
    const totalBids = await blindAuction.getTotalBidAccounts();

    console.log(`\n=== BID OUTPUTS INFO ===`);
    console.log(`Total number of bidding outputs: ${totalBids}\n`);

    // Print a table header for Bid Outputs
    console.log("--------------------------------------------");
    console.log(
        "| " +
        padString("ID", 3) +
        " | " +
        padString("Deposit", 7) +
        " | " +
        padString("Quantity", 8) +
        " | " +
        padString("Amount", 6) +
        " |"
    );
    console.log("--------------------------------------------");

    const settlementPrice = await blindAuction.settlementPrice();
    const decryptSettlementPrice = await debug.decrypt64(settlementPrice);
    // const decryptSettlementPrice = await decryptAndDisplay(deployer, fhevm, settlementPrice, contractAddress, useDebug, "decrypt64");
    // Loop through the bid outputs using the contract's getter
    for (let i = 0; i < totalBids; i++) {
        const bidOutput = await blindAuction.getBidOutput(i);



        const decryptedDeposit = await decryptAndDisplay(deployer, fhevm, bidOutput.eDeposit, contractAddress, useDebug, "decrypt64");
        const decryptedQuantity = await decryptAndDisplay(deployer, fhevm, bidOutput.eQuantity, contractAddress, useDebug, "decrypt64");

        // Print a row for the output
        console.log(
            "| " +
            padString(i, 3) +
            " | " +
            padString(decryptedDeposit, 7) +
            " | " +
            padString(decryptedQuantity, 8) +
            " | " +
            padString(BigInt(decryptSettlementPrice * decryptedQuantity), 6) +
            " |"
        );
    }

    // End line
    console.log("--------------------------------------------\n");

    console.log("SettlementPrice: ", decryptSettlementPrice);
}



/**
 * Logs a decrypted bid in a nice format.
 * @param {object} decryptedBid - Object with fully decrypted bid fields
 * @param {number} bidIndex - Index of the bid
 */
export function logDecryptedBid(decryptedBid, bidIndex) {
    console.log(`Bid #${bidIndex}:`);
    console.log(`  Account:     ${decryptedBid.account}`);
    console.log(`  Price:       ${decryptedBid.price}`);
    console.log(`  Quantity:    ${decryptedBid.quantity}`);
    console.log(`  Index:       ${decryptedBid.index}`);
    console.log(`  Total Buy:   ${decryptedBid.totalBuy}`);
    console.log(`  Partial Buy: ${decryptedBid.partialBuy}`);
    console.log("-------------------------------------------");
}

/**
 * Checks the decrypted balance of a given account against an expected value.
 * @param {Signer} account - The account whose balance to check
 * @param {object} fhevm - The fhevm instance
 * @param {Contract} erc20 - The ERC20 contract instance
 * @param {string} tokenAddress - The token contract address
 * @param {bigint|number} expectedBalance - The expected balance after decryption
 */
export async function expectDecryptedBalance(account, fhevm, erc20, tokenAddress, expectedBalance) {
    const encryptedBalanceHandle = await erc20.balanceOf(account);
    const decryptedBalance = await reencryptEuint64(account, fhevm, encryptedBalanceHandle, tokenAddress);
    expect(decryptedBalance).to.equal(BigInt(expectedBalance));
    // console.log(`Balance check passed for ${account.address}: ${decryptedBalance} == ${expectedBalance}`);
}

/**
 * Transfers tokens from `fromSigner` to `toSigner`.
 * @param {object} fhevm - The fhevm instance
 * @param {Contract} erc20 - The ERC20 contract instance
 * @param {string} tokenAddress - The token contract address
 * @param {Signer} fromSigner - The signer sending tokens
 * @param {Signer} toSigner - The signer receiving tokens
 * @param {number} amount - The amount to transfer
 */
export async function transferTokens(fhevm, erc20, tokenAddress, fromSigner, toSigner, amount) {
    const input = fhevm.createEncryptedInput(tokenAddress, fromSigner.address);
    input.add64(amount);
    const encryptedTransfer = await input.encrypt();
    const tx = await erc20.connect(fromSigner)["transfer(address,bytes32,bytes)"](
        toSigner.address,
        encryptedTransfer.handles[0],
        encryptedTransfer.inputProof
    );
    await tx.wait();
}

/**
 * Approves the auction (or any spender) to spend `amount` tokens from `ownerSigner`.
 * @param {object} fhevm - The fhevm instance
 * @param {Contract} erc20 - The ERC20 contract instance
 * @param {string} tokenAddress - The token contract address
 * @param {Signer} ownerSigner - The signer who owns the tokens
 * @param {string} spenderAddress - The address of the spender
 * @param {number} amount - The amount to approve
 */
export async function approveTokens(fhevm, erc20, tokenAddress, ownerSigner, spenderAddress, amount) {
    const approveInput = fhevm.createEncryptedInput(tokenAddress, ownerSigner.address);
    approveInput.add64(amount);
    const encryptedApprove = await approveInput.encrypt();
    const tx = await erc20.connect(ownerSigner)["approve(address,bytes32,bytes)"](
        spenderAddress,
        encryptedApprove.handles[0],
        encryptedApprove.inputProof
    );
    await tx.wait();
}


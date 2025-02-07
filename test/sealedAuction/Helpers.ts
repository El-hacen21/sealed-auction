import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { reencryptEuint64, reencryptEbool } from "../reencrypt";
import { debug } from "../utils";
import { getFHEGasFromTxReceipt } from "../coprocessorUtils";
import { awaitAllDecryptionResults } from "../asyncDecrypt";

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
    return auctionContract.connect(bidderSigner).placeBid(
        encryptedBid.handles[0],
        encryptedBid.handles[1],
        encryptedBid.inputProof
    );
}


export async function finalizeAuction(contract, batchSize) {
    let stillRunning = true;
    let totalGasUsed = BigInt(0);
    let totalFHEGasConsumed = 0;

    while (stillRunning) {
        // 1) Call the contract function to process a batch of finalization
        const tx = await contract.finalizeAuction(batchSize);

        // 2) Wait for the transaction receipt
        const receipt = await tx.wait();

        if (network.name === "hardhat") {
            // Calculate FHE gas consumed if on a mocked FHEVM network
            const FHEGasConsumed = getFHEGasFromTxReceipt(receipt);
            totalFHEGasConsumed += FHEGasConsumed;
        }

        // 3) Accumulate total gas used
        totalGasUsed += BigInt(receipt.gasUsed);

        // 4) Retrieve the auction state and bid counter from the contract
        const auctionState = await contract.auctionState();
        // Destructure the returned tuple (assuming the order: swapCallCount, currentIndex, isFinalized)
        const { currentIndex, isFinalized } = auctionState;
        const bidCounter = await contract.bidCounter();

        // 5) Determine if the auction processing is complete
        // We check if the auction is finalized or if the currentIndex equals bidCounter.
        // (Conversion to string is used if bidCounter/currentIndex are BigNumber objects.)
        if (isFinalized || currentIndex.toString() === bidCounter.toString()) {
            stillRunning = false;
        }
    }


    await awaitAllDecryptionResults();

    // Return gas usage data
    return {
        totalGasUsed: totalGasUsed.toString(),
        totalFHEGasConsumed
    };
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

export async function displayAllBids(deployer, fhevm, blindAuction, contractAddress, bidderInfo, useDebug = false) {
    const bidCounter = await blindAuction.bidCounter();
    const totalTokens = await blindAuction.totalTokens();
    const minBidPrice = await blindAuction.minBidPrice();

    console.log(`\n\t\t === BIDS INFO ===`);
    console.log(`\t\t Nb bids: ${bidCounter} | Nb Tokens: ${totalTokens} | Min Bid Price: ${minBidPrice}\n`);

    console.log("\t\t -----------------------------------------");
    console.log(
        "\t\t | " +
        padString("ID", 3) +
        " | " +
        padString("Surname", 10) +
        " | " +
        padString("Price", 7) +
        " | " +
        padString("Quantity", 8) +
        " |"
    );
    console.log("\t\t -----------------------------------------");

    for (let i = 0; i < bidCounter; i++) {
        const bid = await blindAuction.getBid(i);

        try {
            const decryptedPrice = await decryptAndDisplay(deployer, fhevm, bid.ePrice, contractAddress, useDebug, "decrypt64");
            const decryptedQuantity = await decryptAndDisplay(deployer, fhevm, bid.eQuantity, contractAddress, useDebug, "decrypt64");
            const decryptedRemain = await decryptAndDisplay(deployer, fhevm, bid.eRemain, contractAddress, useDebug, "decrypt64");

            // Find the corresponding surname using the bidder's address
            const bidderAddress = bid.account;
            const bidder = bidderInfo.find((b) => b.address === bidderAddress);

            // Extract the surname or use "Unknown" if not found
            const surname = bidder ? bidder.surname : "Unknown";

            console.log(
                "\t\t | " +
                padString(i, 3) +
                " | " +
                padString(surname, 10) +
                " | " +
                padString(decryptedPrice, 7) +
                " | " +
                padString(decryptedQuantity, 8) +
                " |" +
                padString(decryptedRemain, 8) +
                " |" 
            );
        } catch (err) {
            console.error(`\t\t Failed to decrypt bid ${i}: ${err.message}`);
        }
    }

    console.log("\t\t -----------------------------------------\n");
}




/**
 * @notice Display all bid outputs for specified bidders
 * @param bidderInfo List of objects containing bidder addresses and surnames
 */
export async function displayAllBidOutputs(
    deployer,
    fhevm,
    blindAuction,
    contractAddress,
    bidderInfo,
    useDebug = false
) {

    const decryptSettlementPrice = await blindAuction.decryptedSettlementPrice();
    // const decryptSettlementPrice = await debug.decrypt64(settlementPrice);

    console.log(`\n\t\t === BID OUTPUTS INFO ===`);
    console.log(`\t\t Nb bidders: ${bidderInfo.length} | Settlement Price: ${decryptSettlementPrice} \n`);



    // Print a table header for Bid Outputs
    console.log("\t\t -----------------------------------");
    console.log(
        "\t\t | " +
        padString("Surname", 10) +
        " | " +
        padString("Deposit", 7) +
        " | " +
        padString("Quantity", 8) +
        " | "
    );
    console.log("\t\t -----------------------------------");



    // Loop through the provided bidders
    for (const { address, surname } of bidderInfo) {
        // Retrieve the bid output for the current address
        const bidOutput = await blindAuction.getBidOutput(address);

        // Decrypt the relevant fields
        const decryptedDeposit = await decryptAndDisplay(deployer, fhevm, bidOutput.eDeposit, contractAddress, useDebug, "decrypt64");
        const decryptedQuantity = await decryptAndDisplay(deployer, fhevm, bidOutput.eQuantity, contractAddress, useDebug, "decrypt64");

        // Print a row for the output
        console.log(
            "\t\t | " +
            padString(surname, 10) +
            " | " +
            padString(decryptedDeposit, 7) +
            " | " +
            padString(decryptedQuantity, 8) +
            " | "
        );
    }

    // End line
    console.log("\t\t -----------------------------------\n");

}


// /**
//  * @notice Display all bid outputs based on the sorted `bidsIndexs` array
//  * @param bidderInfo List of objects containing bidder addresses and surnames
//  */
// export async function displayAllBidOutputs(
//     deployer,
//     fhevm,
//     blindAuction,
//     contractAddress,
//     bidderInfo,
//     useDebug = false
// ) {
//     const settlementPrice = await blindAuction.settlementPrice();
//     const decryptSettlementPrice = await debug.decrypt64(settlementPrice);

//     // Fetch the sorted bid indices
//     const bidsIndexs = await blindAuction.bidsIndexs();
//     console.log(`\n=== BID OUTPUTS INFO ===`);
//     console.log(`Total number of bidders: ${bidsIndexs.length} | Settlement price: ${decryptSettlementPrice} \n`);

//     // Print a table header for Bid Outputs
//     console.log("--------------------------------------------");
//     console.log(
//         "| " +
//         padString("Surname", 10) +
//         " | " +
//         padString("Deposit", 7) +
//         " | " +
//         padString("Quantity", 8) +
//         " | " +
//         padString("Amount", 6) +
//         " |"
//     );
//     console.log("--------------------------------------------");

//     // Loop through the sorted indices
//     for (let i = 0; i < bidsIndexs.length; i++) {
//         const bidIndex = bidsIndexs[i]; // Sorted index
//         const bid = await blindAuction.getBid(bidIndex); // Fetch the bid using the index

//         // Retrieve the address of the bidder
//         const bidderAddress = bid.bidder;

//         // Find the surname for the current bidder
//         const bidder = bidderInfo.find((b) => b.address === bidderAddress);
//         const surname = bidder ? bidder.surname : "Unknown";

//         // Decrypt the bid fields
//         const decryptedDeposit = await decryptAndDisplay(deployer, fhevm, bid.eDeposit, contractAddress, useDebug, "decrypt64");
//         const decryptedQuantity = await decryptAndDisplay(deployer, fhevm, bid.eQuantity, contractAddress, useDebug, "decrypt64");

//         // Print the row for the current bidder
//         console.log(
//             "| " +
//             padString(surname, 10) +
//             " | " +
//             padString(decryptedDeposit, 7) +
//             " | " +
//             padString(decryptedQuantity, 8) +
//             " | " +
//             padString(BigInt(decryptSettlementPrice * decryptedQuantity), 6) +
//             " |"
//         );
//     }

//     console.log("--------------------------------------------\n");
//     console.log("SettlementPrice: ", decryptSettlementPrice);
// }





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
 * Retrieves the decrypted balance of a specific account.
 * 
 * @param {Object} account - The account object whose balance is being retrieved.
 * @param {Object} fhevm - The FHEVM instance used for encryption and decryption operations.
 * @param {Object} erc20 - The ERC20 contract instance used to fetch the balance.
 * @param {string} tokenAddress - The address of the ERC20 token contract.
 * 
 * @returns {BigInt} - The decrypted balance of the account.
 */
export async function getDecryptedBalance(account, fhevm, erc20, tokenAddress) {
    try {
        // Retrieve the encrypted balance from the ERC20 contract
        const encryptedBalanceHandle = await erc20.balanceOf(account.address);

        // Decrypt the balance using the FHEVM instance
        const decryptedBalance = await reencryptEuint64(account, fhevm, encryptedBalanceHandle, tokenAddress);

        // Return the decrypted balance as a BigInt
        return BigInt(decryptedBalance);
    } catch (error) {
        console.error(`Failed to get decrypted balance for ${account.address}:`, error);
        throw error;
    }
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


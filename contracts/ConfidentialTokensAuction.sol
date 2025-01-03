// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/ConfidentialERC20.sol";

/// @notice Main contract for the blind auction
contract ConfidentialTokensAuction is SepoliaZamaFHEVMConfig, Ownable2Step, GatewayCaller {
    /// @notice Auction end time
    uint256 public endTime;

    /// @notice The number of tokens to buy
    uint64 public totalTokens;

    euint64 private encryptedTotalTokens;

    struct BidData {
        address account;
        euint64 ePrice; // Encrypted price per token
        euint64 eQuantity; // Encrypted quantity of tokens the user wants to buy
        euint64 eIndex;
        ebool eTotalBuy;
        ebool ePartialBuy;
    }

    // Minimum bid price required to participate
    euint64 public minBidPrice;

    struct BidOutPut {
        address account;
        euint64 eQuantity;
        euint64 eAmount;
        euint64 eDeposit;
        bool canClaim;
    }

    mapping(address => BidOutPut) private bidsOutput;

    // Array to store the list of unique addresses
    address[] private bidAccounts;

    /// @notice Mapping from bidder to their bid data
    mapping(uint256 => BidData) private bids;

    /// @notice Number of bids
    uint256 public bidCounter;

    /// @notice The maximum number of bids allowed, set at deployment
    /// @dev This value is immutable and set during contract deployment
    uint256 public immutable MAX_BIDS;

    /// @notice Number of total buys bids
    euint64 public encryptedTotalBuys;

    /// @notice Number of total buys bids
    euint64 public countTotalBuys;

    /// @notice Number of bids
    euint64 public totalPartialBuys;

    /// @notice Number of bids
    euint64 public encryptedRemaining;

    /// @notice The token contract used for encrypted bids
    ConfidentialERC20 public tokenContract;

    /// @notice Flag indicating whether the auction object has been claimed
    /// @dev WARNING : If there is a draw, only the first highest bidder will get the prize
    ///      An improved implementation could handle this case differently
    ebool private objectClaimed;

    /// @notice Flag to check if the token has been transferred to the beneficiary
    bool public tokensTransferred;

    /// @notice Flag to determine if the auction can be stopped manually
    bool public stoppable;

    /// @notice Flag to check if the auction has been manually stopped
    bool public manuallyStopped = false;

    /// @notice Error thrown when a function is called too early
    /// @dev Includes the time when the function can be called
    error TooEarly(uint256 time);

    /// @notice Error thrown when a function is called too late
    /// @dev Includes the time after which the function cannot be called
    error TooLate(uint256 time);

    /// @notice Constructor to initialize the auction
    /// @param _totalTokens The number of tokens to be sold
    /// @param _tokenContract Address of the ConfidentialERC20 token contract used for bidding
    /// @param biddingTime Duration of the auction in seconds
    /// @param isStoppable Flag to determine if the auction can be stopped manually
    constructor(
        ConfidentialERC20 _tokenContract,
        uint64 _totalTokens,
        uint256 biddingTime,
        bool isStoppable
    ) Ownable(msg.sender) {
        tokenContract = _tokenContract;
        endTime = block.timestamp + biddingTime;
        objectClaimed = TFHE.asEbool(false);
        TFHE.allowThis(objectClaimed);
        tokensTransferred = false;
        bidCounter = 0;
        stoppable = isStoppable;
        totalTokens = _totalTokens;
        encryptedTotalTokens = TFHE.asEuint64(totalTokens);
        TFHE.allowThis(encryptedTotalTokens);

        countTotalBuys = TFHE.asEuint64(0);
        TFHE.allowThis(countTotalBuys);

        // require(maxBids > 0, "Maximum bids must be greater than zero");
        // MAX_BIDS = maxBids;
    }

    /// @notice Submit a bid with an encrypted price and quntity
    /// @dev Transfers tokens from the bidder to the contract
    /// @param encryptedPrice The encrypted bid amount (or price)
    /// @param encryptedPrice The encrypted bid amount
    /// @param encryptedQuantity The encrypted bid quantity
    /// @param inputProof Proof for the encrypted price input
    function bid(einput encryptedPrice, einput encryptedQuantity, bytes calldata inputProof) external onlyBeforeEnd {
        euint64 price = TFHE.asEuint64(encryptedPrice, inputProof);
        euint64 quantity = TFHE.asEuint64(encryptedQuantity, inputProof);

        // Calculate the total amount to lock based on price and quantity.
        euint64 amountToLock = TFHE.mul(price, quantity);

        TFHE.allowThis(amountToLock);
        TFHE.allow(amountToLock, msg.sender);

        BidOutPut storage bidOutput = bidsOutput[msg.sender];

        bidOutput.eDeposit = TFHE.add(bidOutput.eDeposit, amountToLock);

        TFHE.allowThis(bidOutput.eDeposit);
        TFHE.allow(bidOutput.eDeposit, msg.sender);

        // Approve and transfer the calculated amount of tokens from the bidder to the contract.
        TFHE.allowTransient(amountToLock, address(tokenContract));
        tokenContract.transferFrom(msg.sender, address(this), amountToLock);

        // Initialize and store the new bid
        BidData storage newBid = bids[++bidCounter];

        newBid.account = msg.sender;
        newBid.ePrice = price;
        newBid.eQuantity = quantity;

        TFHE.allowThis(price);
        TFHE.allowThis(quantity);

        TFHE.allow(price, msg.sender);
        TFHE.allow(quantity, msg.sender);

        // Emit an event for the successful bid submission.
        emit BidSubmitted(msg.sender, bidCounter, price, quantity);
    }

    /**
     * @notice Event emitted when a new bid is submitted.
     * @param bidder Address of the bidder.
     * @param bidId Unique identifier for the bid.
     * @param price Encrypted price per token.
     * @param quantity Encrypted quantity of tokens.
     */
    event BidSubmitted(address indexed bidder, uint256 bidId, euint64 price, euint64 quantity);

    /**
     * @notice Finalizes the auction by:
     *         1. Assigning bid indexes
     *         2. Calculating total buys
     *         3. Calculating remaining tokens.
     * @dev This function should be called after the bidding period has ended by the contract owner.
     */
    function finalizeAuction() external onlyOwner onlyAfterEnd {
        // Step 1: Assign indexes to bids based on encrypted prices
        _assignIndexes();

        // Step 2: Calculate the total encrypted buys for each bidder
        _assignTotalBuys();

        // Step 3: Calculate the remaining tokens
        encryptedRemaining = TFHE.sub(encryptedTotalTokens, encryptedTotalBuys);

        // Step 4: Calculate the remaining tokens to buy to the last accepted bid
        _assignPartialBuys();

        // Step 5: Transfer the token to the winner

        // Emit an event to indicate the auction has been finalized successfully
        emit AuctionFinalized(block.timestamp, encryptedTotalBuys, encryptedRemaining);
    }

    /**
     * @notice Event emitted when the auction is finalized.
     * @param timestamp The time at which the auction was finalized.
     * @param totalBuys The total encrypted quantity of tokens bought during the auction.
     * @param remainingTokens The remaining encrypted quantity of tokens after the auction.
     */
    event AuctionFinalized(uint256 indexed timestamp, euint64 totalBuys, euint64 remainingTokens);

    /**
     * @notice Assigns encrypted indices to each bid based on their encrypted prices.
     */
    function _assignIndexes() internal {
        for (uint256 bidId = 1; bidId <= bidCounter; bidId++) {
            BidData storage currentBid = bids[bidId];

            // Start with an initial encrypted index of 0
            euint64 encryptedIndex = TFHE.asEuint64(0);
            TFHE.allowThis(encryptedIndex);

            // Check if the bid's price exceeds the minimum bid price
            ebool isBidHighEnough = TFHE.gt(currentBid.ePrice, minBidPrice);

            // Compare the current bid with all other bids to calculate its index
            for (uint256 comparisonId = 1; comparisonId <= bidCounter; comparisonId++) {
                BidData memory comparisonBid = bids[comparisonId];

                ebool isOtherHigher = TFHE.gt(comparisonBid.ePrice, currentBid.ePrice);
                TFHE.allowThis(isOtherHigher);

                ebool isEqual = TFHE.eq(currentBid.ePrice, comparisonBid.ePrice);

                // First In First Served
                ebool isFirst = TFHE.asEbool(comparisonId <= bidId);

                // Determine whether to increment the index
                ebool shouldIncrement = TFHE.and(TFHE.or(isOtherHigher, TFHE.and(isEqual, isFirst)), isBidHighEnough);

                // Increment the encrypted index if conditions are met
                encryptedIndex = TFHE.add(encryptedIndex, TFHE.asEuint64(shouldIncrement));
            }

            // Assign the encrypted index to the current bid
            currentBid.eIndex = encryptedIndex;
        }
    }

    /**
     * @notice Calculates the total encrypted buys for each bidder.
     * @dev Returns the total quantity bought.
     */
    function _assignTotalBuys() internal {
        euint64 totalBuyQuantity = TFHE.asEuint64(0);
        TFHE.allowThis(totalBuyQuantity);

        for (uint256 bidId = 1; bidId <= bidCounter; bidId++) {
            BidData storage currentBid = bids[bidId];

            euint64 tempTotalBuyQuantity = currentBid.eQuantity;
            TFHE.allowThis(tempTotalBuyQuantity);

            // Compare the current bid with all other bids
            for (uint256 comparisonId = 1; comparisonId <= bidCounter; comparisonId++) {
                if (bidId == comparisonId) continue; // Skip self-comparison

                BidData memory comparisonBid = bids[comparisonId];

                // Check if the current bid's index is less then the comparaison
                ebool isCurrentBetterRanked = TFHE.lt(comparisonBid.eIndex, currentBid.eIndex);
                TFHE.allowThis(isCurrentBetterRanked);

                euint64 compQuality = comparisonBid.eQuantity;
                TFHE.allowThis(compQuality);

                // Add the quantity of the comparison bid if the current bid is higher
                // tempTotalBuyQuantity = TFHE.add(
                //     tempTotalBuyQuantity,
                //     TFHE.select(isCurrentBetterRanked, comparisonBid.eQuantity, TFHE.asEuint64(0))
                // );

                tempTotalBuyQuantity = TFHE.select(
                    isCurrentBetterRanked,
                    TFHE.add(tempTotalBuyQuantity, comparisonBid.eQuantity),
                    tempTotalBuyQuantity
                );
            }

            // Check if the total buy quantity is within the total tokens and the bid has a valid index
            ebool isWithinTotalTokens = TFHE.le(tempTotalBuyQuantity, encryptedTotalTokens);
            ebool hasValidIndex = TFHE.gt(currentBid.eIndex, TFHE.asEuint64(0));

            ebool eTotalBuy = TFHE.and(isWithinTotalTokens, hasValidIndex);
            TFHE.allowThis(eTotalBuy);

            // Accumulate total buy quantities
            totalBuyQuantity = TFHE.select(
                eTotalBuy,
                TFHE.add(totalBuyQuantity, currentBid.eQuantity),
                totalBuyQuantity
            );

            // Count total buys
            countTotalBuys = TFHE.select(eTotalBuy, TFHE.add(countTotalBuys, TFHE.asEuint64(1)), countTotalBuys);

            // Update the encrypted total buy in the current bid
            currentBid.eTotalBuy = eTotalBuy;
        }

        // Update the total buy quantity
        encryptedTotalBuys = totalBuyQuantity;
        TFHE.allowThis(encryptedTotalBuys);
    }

    function _assignPartialBuys() internal {
        euint64 tempQuantity = TFHE.asEuint64(0);
        TFHE.allowThis(tempQuantity);

        // Iterate through all bids
        for (uint256 j = 1; j <= bidCounter; j++) {
            BidData storage currentBid = bids[j];

            // Encrypted ID of the current bid
            euint64 eIndex = currentBid.eIndex;

            euint64 _countTotalBuys = TFHE.add(countTotalBuys, TFHE.asEuint64(1));

            // Combine conditions using AND operation
            ebool ePartialBuy = TFHE.and(TFHE.eq(eIndex, _countTotalBuys), TFHE.gt(eIndex, TFHE.asEuint64(0)));
            TFHE.allowThis(ePartialBuy);

            // Update the bid's partial buy status
            currentBid.ePartialBuy = ePartialBuy;

            address account = currentBid.account;

            // Update the bidOutputs
            BidOutPut storage bidOutput = bidsOutput[account];

            tempQuantity = TFHE.select(currentBid.eTotalBuy, currentBid.eQuantity, TFHE.asEuint64(0));

            if (TFHE.isInitialized(bidOutput.eQuantity) && TFHE.isInitialized(bidOutput.eAmount)) {
                bidOutput.eQuantity = TFHE.add(bidOutput.eQuantity, tempQuantity);
                bidOutput.eAmount = TFHE.add(bidOutput.eAmount, TFHE.mul(bidOutput.eQuantity, currentBid.ePrice));
            } else {
                bidOutput.eQuantity = TFHE.select(
                    ePartialBuy,
                    TFHE.add(tempQuantity, encryptedRemaining),
                    tempQuantity
                );
                bidOutput.eAmount = TFHE.mul(bidOutput.eQuantity, currentBid.ePrice);
                TFHE.allowThis(bidOutput.eAmount);
                TFHE.allow(bidOutput.eAmount, account);
                bidOutput.canClaim = false;
                bidAccounts.push(account);
            }
        }
    }

    /**
     * @notice Get the bid data of a specific account.
     * @dev Can be used in a reencryption request.
     * @param index The ID of the bid.
     * @return The encrypted bid data.
     */
    function getBid(uint256 index) external view returns (BidData memory) {
        return bids[index];
    }

    // Function to retrieve a BidOutPut by index
    function getBidOutput(uint256 index) public view returns (BidOutPut memory) {
        require(index < bidAccounts.length, "Index out of bounds");
        address account = bidAccounts[index];
        return bidsOutput[account];
    }

    // Get the total number of bids
    function getTotalBidAccounts() public view returns (uint256) {
        return bidAccounts.length;
    }

    /// @notice Manually stop the auction
    /// @dev Can only be called by the owner and if the auction is stoppable
    function stop() external onlyOwner {
        require(stoppable);
        manuallyStopped = true;
    }

    /// @notice Transfer the  bid to the beneficiary
    /// @dev Can only be called once after the auction ends
    function claim() public onlyAfterEnd {
        BidOutPut storage bidOutput = bidsOutput[msg.sender];

        require(!bidOutput.canClaim, "Bid already claimed or user cannot claim");

        bidOutput.canClaim = true; // Persist change to storage

        TFHE.allowTransient(bidOutput.eAmount, address(tokenContract));
        tokenContract.transfer(msg.sender, bidOutput.eAmount);
    }

    /// @notice Withdraw a bid from the auction
    /// @dev Can only be called after the auction ends 
    function withdraw() public onlyAfterEnd {
        BidOutPut storage bidOutput = bidsOutput[msg.sender];
        require(bidOutput.canClaim, "Bid must be claimed before withdraw");

        euint64 amount = TFHE.sub(bidOutput.eDeposit, bidOutput.eAmount);

        TFHE.allowTransient(amount, address(tokenContract));
        tokenContract.transfer(msg.sender, amount);
    }

    /// @notice Checks if a new bid is better than the existing one.
    /// @dev Compares the new bid with the old bid
    /// @param oldBidAmount The amount (price*quantity) of the existing (old) bid.
    /// @param newBidAmount The amount (price*quantity) of the new bid.
    /// @return Returns `true` if the new bid is better (higher and not equal to the old bid), otherwise `false`.
    function _isBetterBid(euint64 oldBidAmount, euint64 newBidAmount) internal returns (ebool) {
        ebool isHigherPrice = TFHE.gt(newBidAmount, oldBidAmount);
        ebool notEqual = TFHE.ne(newBidAmount, oldBidAmount);

        return TFHE.and(notEqual, isHigherPrice);
    }

    /// @notice Modifier to ensure function is called before auction ends
    /// @dev Reverts if called after the auction end time or if manually stopped
    modifier onlyBeforeEnd() {
        if (block.timestamp >= endTime || manuallyStopped == true) revert TooLate(endTime);
        _;
    }

    /// @notice Modifier to ensure function is called after auction ends
    /// @dev Reverts if called before the auction end time and not manually stopped
    modifier onlyAfterEnd() {
        if (block.timestamp < endTime && manuallyStopped == false) revert TooEarly(endTime);
        _;
    }
}

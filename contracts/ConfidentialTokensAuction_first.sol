// // SPDX-License-Identifier: BSD-3-Clause-Clear
// pragma solidity ^0.8.24;

// import "fhevm/lib/TFHE.sol";
// import "fhevm/config/ZamaFHEVMConfig.sol";
// import "fhevm/config/ZamaGatewayConfig.sol";
// import "fhevm/gateway/GatewayCaller.sol";
// import "hardhat/console.sol";

// import "@openzeppelin/contracts/access/Ownable2Step.sol";
// import { ConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/ConfidentialERC20.sol";

// /// @notice Main contract for the blind auction
// contract ConfidentialTokensAuction is SepoliaZamaFHEVMConfig, Ownable2Step, GatewayCaller {
//     /// @notice Auction end time
//     uint256 public endTime;

//     /// @notice The number of tokens to buy
//     uint64 public totalTokens;

//     /// @notice Encrypted representation of totalTokens
//     euint64 private encryptedTotalTokens;

//     /// @notice The maximum number of bids allowed, set at deployment
//     /// @dev This value is immutable and set during contract deployment
//     uint256 public immutable MAX_BIDS;

//     /// @notice Minimum bid price required to participate (encrypted)
//     euint64 public minBidPrice;

//     /// @notice Stores the amount (quantity, deposit, etc.) for each bidder
//     struct BidOutPut {
//         address account; // Bidder's address
//         euint64 eQuantity; // Encrypted quantity of tokens
//         euint64 eAmount; // Encrypted total cost (price * quantity)
//         euint64 eDeposit; // Encrypted deposit locked in
//         bool canClaim; // Indicates whether the bidder can claim
//     }

//     /// @notice Mapping from a bidder's address to their output data
//     mapping(address => BidOutPut) private bidsOutput;

//     /// @notice List of unique addresses that have placed bids
//     address[] private bidAccounts;

//     /// @notice Contains the core data for each bid
//     struct BidData {
//         address account; // Bidder's address
//         euint64 ePrice; // Encrypted price per token
//         euint64 eQuantity; // Encrypted quantity of tokens
//         euint64 eIndex; // Encrypted ranking index
//         ebool eTotalBuy; // Flag to indicate if the entire bid is accepted
//         ebool ePartialBuy; // Flag to indicate a partial buy
//     }

//     /// @notice Mapping of bidId => BidData
//     mapping(uint256 => BidData) private bids;

//     /// @notice Count of total bids submitted
//     uint256 public bidCounter;

//     /// @notice The total number of tokens successfully allocated (encrypted)
//     euint64 public encryptedTotalBuys;

//     /// @notice Number of total buys bids
//     euint64 public countTotalBuys;

//     /// @notice Number of partial buys
//     euint64 public totalPartialBuys;

//     /// @notice The remaining tokens after full buys (encrypted)
//     euint64 public encryptedRemaining;

//     /// @notice The token contract used for encrypted bids
//     ConfidentialERC20 public tokenContract;

//     /// @notice Flag indicating whether the auction object has been claimed
//     /// @dev WARNING : If there is a draw, only the first highest bidder will get the prize
//     ebool private objectClaimed;

//     /// @notice Flag to check if the token has been transferred to the beneficiary
//     bool public tokensTransferred;

//     /// @notice Flag to determine if the auction can be stopped manually
//     bool public stoppable;

//     /// @notice Flag to check if the auction has been manually stopped
//     bool public manuallyStopped = false;

//     /// @notice Error thrown when a function is called too early
//     /// @dev Includes the time when the function can be called
//     error TooEarly(uint256 time);

//     /// @notice Error thrown when a function is called too late
//     /// @dev Includes the time after which the function cannot be called
//     error TooLate(uint256 time);

//     /**
//      * @notice Constructor to initialize the auction
//      * @param _tokenContract Address of the ConfidentialERC20 token contract used for bidding
//      * @param _totalTokens The number of tokens to be sold
//      * @param biddingTime Duration of the auction in seconds
//      * @param isStoppable Flag to determine if the auction can be stopped manually
//      */
//     constructor(
//         ConfidentialERC20 _tokenContract,
//         uint64 _totalTokens,
//         uint256 biddingTime,
//         bool isStoppable
//     ) Ownable(msg.sender) {
//         tokenContract = _tokenContract;
//         endTime = block.timestamp + biddingTime;
//         objectClaimed = TFHE.asEbool(false);
//         TFHE.allowThis(objectClaimed);
//         tokensTransferred = false;
//         bidCounter = 0;
//         stoppable = isStoppable;
//         totalTokens = _totalTokens;

//         // For demonstration: if you had a `maxBids` param, you could do:
//         // require(maxBids > 0, "Maximum bids must be greater than zero");
//         // MAX_BIDS = maxBids;
//         // In your snippet, we keep it just as an example
//         MAX_BIDS = 9999; // or any large number, purely as a placeholder

//         encryptedTotalTokens = TFHE.asEuint64(totalTokens);
//         TFHE.allowThis(encryptedTotalTokens);

//         countTotalBuys = TFHE.asEuint64(0);
//         TFHE.allowThis(countTotalBuys);

//         totalPartialBuys = TFHE.asEuint64(0);
//         TFHE.allowThis(totalPartialBuys);
//     }

//     /**
//      * @notice Event emitted when a new bid is submitted.
//      * @param bidder Address of the bidder.
//      * @param bidId Unique identifier for the bid.
//      * @param price Encrypted price per token.
//      * @param quantity Encrypted quantity of tokens.
//      */
//     event BidSubmitted(address indexed bidder, uint256 bidId, euint64 price, euint64 quantity);

//     /**
//      * @notice Submit a bid with an encrypted price and quantity
//      * @dev Transfers tokens from the bidder to the contract
//      * @param encryptedPrice The encrypted bid price
//      * @param encryptedQuantity The encrypted bid quantity
//      * @param inputProof Proof for the encrypted price/quantity
//      */
//     function bid(einput encryptedPrice, einput encryptedQuantity, bytes calldata inputProof) external onlyBeforeEnd {
//         euint64 price = TFHE.asEuint64(encryptedPrice, inputProof);
//         euint64 quantity = TFHE.asEuint64(encryptedQuantity, inputProof);

//         TFHE.allowThis(price);
//         TFHE.allowThis(quantity);
//         TFHE.allow(price, msg.sender);
//         TFHE.allow(quantity, msg.sender);

//         // Calculate the total amount to lock based on price * quantity
//         euint64 amountToLock = TFHE.mul(price, quantity);

//         // Allow the contract and the caller to use this ciphertext
//         TFHE.allowThis(amountToLock);
//         TFHE.allow(amountToLock, msg.sender);

//         BidOutPut storage bidOutput = bidsOutput[msg.sender];
//         bidOutput.eDeposit = TFHE.add(bidOutput.eDeposit, amountToLock);

//         TFHE.allowThis(bidOutput.eDeposit);
//         TFHE.allow(bidOutput.eDeposit, msg.sender);

//         // Approve and transfer the tokens from the bidder to this contract
//         TFHE.allowTransient(amountToLock, address(tokenContract));
//         tokenContract.transferFrom(msg.sender, address(this), amountToLock);

//         // Store the new bid
//         BidData storage newBid = bids[++bidCounter];
//         newBid.account = msg.sender;
//         newBid.ePrice = price;
//         newBid.eQuantity = quantity;

//         emit BidSubmitted(msg.sender, bidCounter, price, quantity);
//     }

//     /**
//      * @notice Event emitted when the auction is finalized.
//      * @param timestamp The time at which the auction was finalized.
//      * @param totalBuys The total encrypted quantity of tokens bought during the auction.
//      * @param remainingTokens The remaining encrypted quantity of tokens after the auction.
//      */
//     event AuctionFinalized(uint256 indexed timestamp, euint64 totalBuys, euint64 remainingTokens);

//     /**
//      * @notice Finalizes the auction by:
//      *         1. Assigning bid indexes
//      *         2. Calculating total buys
//      *         3. Calculating remaining tokens
//      *         4. Calculating partial buys
//      * @dev This function should be called after the bidding period has ended by the contract owner.
//      */
//     function finalizeAuction() external onlyOwner onlyAfterEnd {
//         _assignIndexes();
//         // _assignTotalBuys();
//         // encryptedRemaining = TFHE.sub(encryptedTotalTokens, encryptedTotalBuys);
//         // TFHE.allowThis(encryptedRemaining);
//         // _assignPartialBuys();
//     }

//     /**
//      * @notice Assigns encrypted indices to each bid based on their encrypted prices.
//      */
//     function _assignIndexes() internal {
//         for (uint256 bidId = 1; bidId <= bidCounter; bidId++) {
//             BidData storage currentBid = bids[bidId];

//             console.log("AISSIGN INDEXE", bidId);

//             // Local ephemeral variable: no need for allowThis.
//             euint64 encryptedIndex = TFHE.asEuint64(0);

//             // Compare the current bid with all others
//             ebool isBidHighEnough = TFHE.gt(currentBid.ePrice, minBidPrice);

//             for (uint256 comparisonId = 1; comparisonId <= bidCounter; comparisonId++) {
//                 BidData memory comparisonBid = bids[comparisonId];

//                 ebool isOtherHigher = TFHE.gt(comparisonBid.ePrice, currentBid.ePrice);
//                 ebool isEqual = TFHE.eq(currentBid.ePrice, comparisonBid.ePrice);
//                 ebool isFirst = TFHE.asEbool(comparisonId <= bidId); // "First In First Served"

//                 // If isOtherHigher || (isEqual && isFirst) is true, we increment
//                 ebool shouldIncrement = TFHE.and(TFHE.or(isOtherHigher, TFHE.and(isEqual, isFirst)), isBidHighEnough);

//                 encryptedIndex = TFHE.add(encryptedIndex, TFHE.asEuint64(shouldIncrement));
//             }

//             // Now we store it in the contract state => allow the contract to continue using it later
//             currentBid.eIndex = encryptedIndex;
//             TFHE.allowThis(currentBid.eIndex);
//         }
//         console.log("OUT AISSIGN INDEXE");
//     }

//     /**
//      * @notice Calculates the total encrypted buys for each bidder.
//      * @dev Returns the total quantity bought.
//      */
//     function _assignTotalBuys() internal {
//         // local ephemeral variable to accumulate
//         euint64 totalBuyQuantity = TFHE.asEuint64(0);

//         for (uint256 bidId = 1; bidId <= bidCounter; bidId++) {
//             BidData storage currentBid = bids[bidId];

//             // local ephemeral variable for calculation
//             euint64 tempTotalBuyQuantity = currentBid.eQuantity;

//             for (uint256 comparisonId = 1; comparisonId <= bidCounter; comparisonId++) {
//                 if (bidId == comparisonId) continue; // skip self-comparison

//                 BidData memory comparisonBid = bids[comparisonId];
//                 ebool isCurrentBetterRanked = TFHE.lt(comparisonBid.eIndex, currentBid.eIndex);

//                 // If the current bid is better ranked, add comparisonBid.eQuantity
//                 tempTotalBuyQuantity = TFHE.select(
//                     isCurrentBetterRanked,
//                     TFHE.add(tempTotalBuyQuantity, comparisonBid.eQuantity),
//                     tempTotalBuyQuantity
//                 );
//             }

//             ebool isWithinTotalTokens = TFHE.le(tempTotalBuyQuantity, encryptedTotalTokens);
//             ebool hasValidIndex = TFHE.gt(currentBid.eIndex, TFHE.asEuint64(0));

//             ebool eTotalBuy = TFHE.and(isWithinTotalTokens, hasValidIndex);

//             // If eTotalBuy, add the currentBid.eQuantity to totalBuyQuantity
//             totalBuyQuantity = TFHE.select(
//                 eTotalBuy,
//                 TFHE.add(totalBuyQuantity, currentBid.eQuantity),
//                 totalBuyQuantity
//             );

//             // If eTotalBuy, increment countTotalBuys
//             countTotalBuys = TFHE.select(eTotalBuy, TFHE.add(countTotalBuys, TFHE.asEuint64(1)), countTotalBuys);

//             // Store eTotalBuy in state
//             currentBid.eTotalBuy = eTotalBuy;
//             TFHE.allowThis(currentBid.eTotalBuy);
//         }

//         // Finally store totalBuyQuantity in a state variable
//         encryptedTotalBuys = totalBuyQuantity;
//         TFHE.allowThis(encryptedTotalBuys);

//         console.log("OUT TOTAL BUYS");
//     }

//     /**
//      * @notice Calculates partial buys for bids that are just beyond the accepted threshold
//      */
//     function _assignPartialBuys() internal {
//         // ephemeral variable used to track chosen quantity
//         euint64 tempQuantity = TFHE.asEuint64(0);

//         console.log("IN PARTIAL BUYS");

//         for (uint256 j = 1; j <= bidCounter; j++) {
//             BidData storage currentBid = bids[j];

//             euint64 eIndex = currentBid.eIndex;
//             // The index after the last accepted full buy => countTotalBuys + 1
//             euint64 _countTotalBuys = TFHE.add(countTotalBuys, TFHE.asEuint64(1));

//             // partial buy if eIndex == _countTotalBuys && eIndex != 0
//             ebool ePartialBuy = TFHE.and(TFHE.eq(eIndex, _countTotalBuys), TFHE.gt(eIndex, TFHE.asEuint64(0)));

//             // Store partial buy in the bid
//             currentBid.ePartialBuy = ePartialBuy;
//             TFHE.allowThis(currentBid.ePartialBuy);

//             address account = currentBid.account;
//             BidOutPut storage bidOutput = bidsOutput[account];

//             // If eTotalBuy is true => set tempQuantity to currentBid.eQuantity, else 0
//             tempQuantity = TFHE.select(currentBid.eTotalBuy, currentBid.eQuantity, TFHE.asEuint64(0));

//             // If there's existing quantity in the output, just add more
//             if (TFHE.isInitialized(bidOutput.eQuantity) && TFHE.isInitialized(bidOutput.eAmount)) {
//                 bidOutput.eQuantity = TFHE.add(bidOutput.eQuantity, tempQuantity);
//                 TFHE.allowThis(bidOutput.eQuantity);

//                 bidOutput.eAmount = TFHE.add(bidOutput.eAmount, TFHE.mul(bidOutput.eQuantity, currentBid.ePrice));
//                 TFHE.allowThis(bidOutput.eAmount);
//             } else {
//                 // If partial, add encryptedRemaining to quantity
//                 bidOutput.eQuantity = TFHE.select(
//                     ePartialBuy,
//                     TFHE.add(tempQuantity, encryptedRemaining),
//                     tempQuantity
//                 );
//                 TFHE.allowThis(bidOutput.eQuantity);

//                 bidOutput.eAmount = TFHE.mul(bidOutput.eQuantity, currentBid.ePrice);
//                 TFHE.allowThis(bidOutput.eAmount);

//                 // the user should also be able to decrypt or reencrypt eAmount
//                 TFHE.allow(bidOutput.eAmount, account);

//                 // canClaim defaults to false
//                 bidOutput.canClaim = false;

//                 // Keep track of new bidder addresses
//                 bidAccounts.push(account);
//             }
//         }

//         console.log("OUT PARTIAL BUYS");
//     }

//     /**
//      * @notice Get the bid data of a specific index
//      * @dev Can be used in a reencryption request.
//      * @param index The ID of the bid.
//      * @return The encrypted BidData struct.
//      */
//     function getBid(uint256 index) external view returns (BidData memory) {
//         return bids[index];
//     }

//     /**
//      * @notice Retrieve a BidOutPut by its index in bidAccounts array
//      * @param index Index in the bidAccounts array
//      * @return The corresponding BidOutPut struct
//      */
//     function getBidOutput(uint256 index) public view returns (BidOutPut memory) {
//         require(index < bidAccounts.length, "Index out of bounds");
//         address account = bidAccounts[index];
//         return bidsOutput[account];
//     }

//     /**
//      * @notice Get the total number of bids
//      * @return The length of the bidAccounts array
//      */
//     function getTotalBidAccounts() public view returns (uint256) {
//         return bidAccounts.length;
//     }

//     /**
//      * @notice Manually stop the auction
//      * @dev Can only be called by the owner and if the auction is stoppable
//      */
//     function stop() external onlyOwner {
//         require(stoppable);
//         manuallyStopped = true;
//     }

//     /**
//      * @notice Transfer the final bid amount to the bidder
//      * @dev Can only be called once after the auction ends
//      */
//     function claim() public onlyAfterEnd {
//         BidOutPut storage bidOutput = bidsOutput[msg.sender];
//         require(!bidOutput.canClaim, "Bid already claimed or user cannot claim");
//         bidOutput.canClaim = true;
//         TFHE.allowTransient(bidOutput.eAmount, address(tokenContract));
//         tokenContract.transfer(msg.sender, bidOutput.eAmount);
//     }

//     /**
//      * @notice Withdraw the difference between deposit and final amount
//      * @dev Must call `claim` before being allowed to withdraw
//      */
//     function withdraw() public onlyAfterEnd {
//         BidOutPut memory bidOutput = bidsOutput[msg.sender];
//         require(bidOutput.canClaim, "Bid must be claimed before withdraw");
//         euint64 amount = TFHE.sub(bidOutput.eDeposit, bidOutput.eAmount);
//         TFHE.allowTransient(amount, address(tokenContract));
//         tokenContract.transfer(msg.sender, amount);
//     }

//     /**
//      * @notice Checks if a new bid is better than the existing one
//      * @dev Compares the new bid with the old bid
//      * @param oldBidAmount The amount (price*quantity) of the existing (old) bid
//      * @param newBidAmount The amount (price*quantity) of the new bid
//      * @return Returns `true` if the new bid is better (higher and not equal), otherwise `false`
//      */
//     function _isBetterBid(euint64 oldBidAmount, euint64 newBidAmount) internal returns (ebool) {
//         ebool isHigherPrice = TFHE.gt(newBidAmount, oldBidAmount);
//         ebool notEqual = TFHE.ne(newBidAmount, oldBidAmount);
//         return TFHE.and(notEqual, isHigherPrice);
//     }

//     // ------------------------------------------------------------------------
//     // Modifiers
//     // ------------------------------------------------------------------------

//     modifier onlyBeforeEnd() {
//         if (block.timestamp >= endTime || manuallyStopped == true) revert TooLate(endTime);
//         _;
//     }

//     modifier onlyAfterEnd() {
//         if (block.timestamp < endTime && manuallyStopped == false) revert TooEarly(endTime);
//         _;
//     }
// }

// // SPDX-License-Identifier: BSD-3-Clause-Clear
// pragma solidity ^0.8.24;

// import "fhevm/lib/TFHE.sol";
// import "fhevm/config/ZamaFHEVMConfig.sol";
// import "fhevm/config/ZamaGatewayConfig.sol";
// import "fhevm/gateway/GatewayCaller.sol";
// import "hardhat/console.sol";

// import "@openzeppelin/contracts/access/Ownable2Step.sol";
// import { ConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/ConfidentialERC20.sol";

// import { SortingNetworkLibrary } from "./SortingNetworkLibrary.sol";

// /// @title Confidential Tokens Auction
// /// @notice Main contract for a blind auction using FHE operations.
// contract ConfidentialTokensAuction is SepoliaZamaFHEVMConfig, Ownable2Step, SepoliaZamaGatewayConfig, GatewayCaller {
//     // --------------------------
//     // Auction parameters and state
//     // --------------------------

//     /// @notice Auction end time (in Unix timestamp)
//     uint256 public endTime;

//     /// @notice Total tokens to be sold (using 64-bit since token amounts are assumed small)
//     uint64 public totalTokens;

//     /// @notice The maximum number of bids allowed (immutable; maximum is 32)
//     uint8 public immutable MAX_BIDS;

//     /// @notice Encrypted minimum bid price required to participate
//     euint64 public minBidPrice;

//     /// @notice The token contract used for encrypted bids
//     ConfidentialERC20 public tokenContract;

//     /// @notice Encrypted settlement price (set after finalization)
//     euint64 public settlementPrice;
//     /// @notice Decrypted settlement price (set via callback)
//     uint64 public decryptedSettlementPrice;
//     /// @notice Flag to indicate that settlement price has been decrypted
//     bool public isSettlementPriceDecrypted;

//     /// @notice Encrypted remaining token state (i.e. tokens available)
//     euint64 public eRemainState;

//     /// @notice Structure to hold variables that can be tightly packed into one storage slot.
//     struct AuctionState {
//         uint8 swapCallCount; // Number of swap() calls executed (for sorting layers)
//         uint8 currentIndex; // Current index for processing bids in finalizeAuction
//         bool isFinalized; // True if the auction is finalized
//     }
//     AuctionState public auctionState;

//     // --------------------------
//     // Bid storage
//     // --------------------------

//     /// @notice Structure to hold bid output information for a bidder.
//     struct BidOutput {
//         address account; // Bidder's address
//         euint64 eQuantity; // Encrypted quantity of tokens awarded
//         euint64 eAmount; // Encrypted total cost (price * quantity)
//         euint64 eDeposit; // Encrypted deposit locked in
//         bool canClaim; // True if the bidder can claim tokens
//     }
//     /// @notice Mapping from bidder address to their output data
//     mapping(address => BidOutput) private bidOutputs;

//     /// @notice Structure to hold core bid data.
//     struct BidData {
//         address account; // Bidder's address
//         euint64 ePrice; // Encrypted price per token
//         euint64 eQuantity; // Encrypted bid quantity
//     }
//     /// @notice Mapping from bid ID (uint8) to its bid data.
//     mapping(uint8 => BidData) private bids;

//     /// @notice Array of bid indices; these are used for sorting.
//     uint8[] public bidIndices;

//     // --------------------------
//     // Auxiliary mappings for FHE comparisons
//     // --------------------------
//     mapping(uint256 => ebool) public encryptedComparisons;
//     mapping(uint256 => bool) public decryptedComparisons;

//     /// @notice Total number of bids submitted (uint8 because MAX_BIDS = 32)
//     uint8 public bidCounter;

//     // --------------------------
//     // Custom errors
//     // --------------------------
//     /// @notice Thrown when a function is called before it is allowed.
//     error TooEarly(uint256 time);
//     /// @notice Thrown when a function is called after its allowed time.
//     error TooLate(uint256 time);

//     // --------------------------
//     // Constructor
//     // --------------------------
//     /**
//      * @notice Initialize the auction.
//      * @param _tokenContract Address of the ConfidentialERC20 token contract used for bidding.
//      * @param _totalTokens Number of tokens to be sold.
//      * @param biddingTime Duration of the auction in seconds.
//      */
//     constructor(ConfidentialERC20 _tokenContract, uint64 _totalTokens, uint256 biddingTime) Ownable(msg.sender) {
//         tokenContract = _tokenContract;
//         endTime = block.timestamp + biddingTime;
//         totalTokens = _totalTokens;
//         bidCounter = 0;

//         // Set the maximum bids (here fixed at 32)
//         MAX_BIDS = 32;

//         isSettlementPriceDecrypted = false;
//         settlementPrice = TFHE.asEuint64(0);
//         TFHE.allowThis(settlementPrice);

//         eRemainState = TFHE.asEuint64(totalTokens); // available tokens (encrypted)
//         TFHE.allowThis(eRemainState);

//         auctionState = AuctionState({ swapCallCount: 0, currentIndex: 0, isFinalized: false });
//     }

//     // --------------------------
//     // Events
//     // --------------------------
//     /**
//      * @notice Emitted when a new bid is submitted.
//      * @param bidder Address of the bidder.
//      * @param bidId Unique identifier for the bid.
//      * @param price Encrypted price per token.
//      * @param quantity Encrypted quantity of tokens.
//      */
//     event BidSubmitted(address indexed bidder, uint8 bidId, euint64 price, euint64 quantity);

//     // --------------------------
//     // Bid Submission
//     // --------------------------
//     /**
//      * @notice Submit a bid with an encrypted price and quantity.
//      * @dev Transfers tokens from the bidder to this contract.
//      * @param encryptedPrice The encrypted bid price.
//      * @param encryptedQuantity The encrypted bid quantity.
//      * @param inputProof Proof for the encrypted price/quantity.
//      */
//     function placeBid(
//         einput encryptedPrice,
//         einput encryptedQuantity,
//         bytes calldata inputProof
//     ) external onlyBeforeEnd {
//         euint64 price = TFHE.asEuint64(encryptedPrice, inputProof);
//         euint64 quantity = TFHE.asEuint64(encryptedQuantity, inputProof);
//         TFHE.allowThis(price);
//         TFHE.allowThis(quantity);
//         TFHE.allow(price, msg.sender);
//         TFHE.allow(quantity, msg.sender);

//         // Calculate total amount to lock: price * quantity.
//         euint64 amountToLock = TFHE.mul(price, quantity);
//         TFHE.allowThis(amountToLock);
//         TFHE.allow(amountToLock, msg.sender);

//         // Update bidder output: add deposit and initialize quantity.
//         BidOutput storage output = bidOutputs[msg.sender];
//         output.eDeposit = TFHE.add(output.eDeposit, amountToLock);
//         output.canClaim = false;
//         output.eQuantity = TFHE.asEuint64(0);
//         TFHE.allowThis(output.eQuantity);
//         TFHE.allow(output.eQuantity, msg.sender);
//         TFHE.allowThis(output.eDeposit);
//         TFHE.allow(output.eDeposit, msg.sender);

//         // Approve and transfer tokens from bidder to this contract.
//         TFHE.allowTransient(amountToLock, address(tokenContract));
//         tokenContract.transferFrom(msg.sender, address(this), amountToLock);

//         // Store the bid.
//         bids[bidCounter] = BidData({ account: msg.sender, ePrice: price, eQuantity: quantity });
//         bidIndices.push(bidCounter);
//         emit BidSubmitted(msg.sender, bidCounter, price, quantity);

//         bidCounter++;
//     }

//     // --------------------------
//     // Auction Finalization
//     // --------------------------
//     /**
//      * @notice Finalizes the auction by processing bids in batches.
//      * @param _batchSize Number of bids to process in this batch.
//      */
//     function finalizeAuction(uint256 _batchSize) external onlyOwner onlyAfterEnd {
//         require(!auctionState.isFinalized, "Auction already finalized");

//         // Edge Case 1: No bids submitted.
//         if (bidCounter == 0) {
//             auctionState.isFinalized = true;
//             return;
//         }

//         // Edge Case 2: Only one bid submitted.
//         if (bidCounter == 1) {
//             BidData storage singleBid = bids[bidIndices[0]];
//             // Determine fill amount as the minimum of bid quantity and remaining tokens.
//             euint64 fill = TFHE.min(singleBid.eQuantity, eRemainState);
//             TFHE.allowThis(fill);
//             TFHE.allow(fill, msg.sender);
//             bidOutputs[singleBid.account].eQuantity = fill;
//             bidOutputs[singleBid.account].canClaim = true;
//             settlementPrice = singleBid.ePrice;

//             // Request decryption of settlementPrice.
//             uint256[] memory cts = new uint256[](1);
//             cts[0] = Gateway.toUint256(settlementPrice);
//             Gateway.requestDecryption(cts, this.callbackSettlementPrice.selector, 0, block.timestamp + 100, false);

//             auctionState.isFinalized = true;
//             return;
//         }

//         // Ensure that all swap layers (i.e. sorting) have been completed.
//         require(
//             auctionState.swapCallCount >= SortingNetworkLibrary.getNumberOfLayers(bidCounter),
//             "Sorting incomplete"
//         );

//         // Process bids in the current batch.
//         euint64 remain = eRemainState;
//         euint64 finalPrice = settlementPrice;
//         uint8 batchSize = uint8(_batchSize);
//         uint8 endIndex = auctionState.currentIndex + batchSize > bidCounter
//             ? bidCounter
//             : auctionState.currentIndex + batchSize;

//         // Process each bid in storage (using bidIndices for sorted order).
//         for (uint8 i = auctionState.currentIndex; i < endIndex; i++) {
//             BidData storage bidData = bids[bidIndices[i]];
//             euint64 oldRemain = remain;
//             euint64 fill = TFHE.min(bidData.eQuantity, oldRemain);

//             bidOutputs[bidData.account].eQuantity = TFHE.add(bidOutputs[bidData.account].eQuantity, fill);
//             TFHE.allowThis(bidOutputs[bidData.account].eQuantity);
//             TFHE.allow(bidOutputs[bidData.account].eQuantity, bidData.account);
//             bidOutputs[bidData.account].canClaim = true;

//             // If this bid “fills” the remaining tokens, update the settlement price.
//             ebool isLastFill = TFHE.eq(fill, oldRemain);
//             finalPrice = TFHE.select(
//                 TFHE.and(TFHE.gt(fill, TFHE.asEuint64(0)), isLastFill),
//                 bidData.ePrice,
//                 finalPrice
//             );
//             remain = TFHE.sub(oldRemain, fill);
//         }

//         // Update state variables after batch processing.
//         eRemainState = remain;
//         settlementPrice = finalPrice;
//         TFHE.allowThis(eRemainState);
//         TFHE.allowThis(settlementPrice);
//         auctionState.currentIndex = endIndex;

//         // If all bids have been processed, finalize auction and request decryption.
//         if (auctionState.currentIndex == bidCounter) {
//             ebool hasRemaining = TFHE.gt(eRemainState, TFHE.asEuint64(0));
//             settlementPrice = TFHE.select(hasRemaining, bids[bidIndices[bidCounter - 1]].ePrice, settlementPrice);

//             uint256[] memory cts = new uint256[](1);
//             cts[0] = Gateway.toUint256(settlementPrice);
//             Gateway.requestDecryption(cts, this.callbackSettlementPrice.selector, 0, block.timestamp + 100, false);

//             auctionState.isFinalized = true;
//         }
//     }

//     /**
//      * @notice Callback function invoked by the Gateway to deliver the decrypted settlement price.
//      * @param decryptedInput The decrypted settlement price.
//      */
//     function callbackSettlementPrice(uint256, uint64 decryptedInput) public onlyGateway {
//         decryptedSettlementPrice = decryptedInput;
//         isSettlementPriceDecrypted = true;
//     }

//     // --------------------------
//     // Public Getters
//     // --------------------------
//     /**
//      * @notice Returns the bid data for a given bid index.
//      * @param index The bid ID.
//      * @return The corresponding BidData struct.
//      */
//     function getBid(uint8 index) external view returns (BidData memory) {
//         return bids[index];
//     }

//     /**
//      * @notice Retrieves the bid output for a given bidder address.
//      * @return The corresponding BidOutput struct.
//      */
//     function getBidOutput() public view returns (BidOutput memory) {
//         return bidOutputs[msg.sender];
//     }

//     // --------------------------
//     // Claim and Withdraw Functions
//     // --------------------------
//     /**
//      * @notice Claim the final token amount after the auction ends.
//      * @dev This function can be called only once per bidder.
//      */
//     function claim() public onlyAfterEnd {
//         require(isSettlementPriceDecrypted, "Settlement price not yet decrypted");
//         BidOutput storage output = bidOutputs[msg.sender];
//         require(output.canClaim, "Bid already claimed or cannot claim");
//         output.canClaim = false;
//         euint64 amount = TFHE.mul(output.eQuantity, decryptedSettlementPrice);
//         TFHE.allowTransient(amount, address(tokenContract));
//         tokenContract.transfer(msg.sender, amount);
//     }

//     /**
//      * @notice Withdraw the difference between the deposit and final bid amount.
//      * @dev Must call `claim` before withdrawal.
//      */
//     function withdraw() public onlyAfterEnd {
//         require(isSettlementPriceDecrypted, "Settlement price not yet decrypted");
//         BidOutput memory output = bidOutputs[msg.sender];
//         require(!output.canClaim, "Bid must be claimed before withdrawal");
//         euint64 amount = TFHE.mul(output.eQuantity, decryptedSettlementPrice);
//         euint64 result = TFHE.sub(output.eDeposit, amount);
//         TFHE.allowTransient(result, address(tokenContract));
//         tokenContract.transfer(msg.sender, result);
//     }

//     // --------------------------
//     // Internal Helper: Compare Bids
//     // --------------------------
//     /**
//      * @notice Checks if a new bid is better than an existing bid.
//      * @param oldBidAmount Encrypted amount (price * quantity) of the existing bid.
//      * @param newBidAmount Encrypted amount of the new bid.
//      * @return An encrypted boolean: true if new bid is higher and not equal, false otherwise.
//      */
//     function _isBetterBid(euint64 oldBidAmount, euint64 newBidAmount) internal returns (ebool) {
//         ebool isHigherPrice = TFHE.gt(newBidAmount, oldBidAmount);
//         ebool notEqual = TFHE.ne(newBidAmount, oldBidAmount);
//         return TFHE.and(notEqual, isHigherPrice);
//     }

//     // --------------------------
//     // Modifiers
//     // --------------------------
//     modifier onlyBeforeEnd() {
//         if (block.timestamp >= endTime) revert TooLate(endTime);
//         _;
//     }

//     modifier onlyAfterEnd() {
//         if (block.timestamp < endTime) revert TooEarly(endTime);
//         _;
//     }

//     // --------------------------
//     // Swap and Sorting (for bid ranking)
//     // --------------------------
//     /**
//      * @notice Perform a swap layer for the sorting network to rank bids.
//      * @dev This function calls the FHE library for encrypted comparisons and requests decryption in batches.
//      */
//     function swap() external onlyOwner onlyAfterEnd {
//         uint8 scCount = auctionState.swapCallCount;

//         // 1) Ensure there is a sorting layer to process.
//         require(scCount < SortingNetworkLibrary.getNumberOfLayers(bidCounter), "No more swap layers");

//         // 2) Retrieve the array of bid pairs for the current sorting layer.
//         uint8[] memory pairs = SortingNetworkLibrary.getNetworkLayer(bidCounter, scCount);
//         uint8 pairLength = uint8(pairs.length);
//         require(pairLength > 0 && (pairLength & 1) == 0, "Invalid pairs length");

//         uint8 nPairs = pairLength >> 1; // Number of bid pairs (each pair consists of two indices)
//         require(nPairs <= 16, "Too many pairs for a single callback (max 16)");

//         // 3) For each pair, perform an encrypted comparison and store the result.
//         for (uint8 idx = 0; idx < pairLength; idx += 2) {
//             uint8 i = pairs[idx];
//             uint8 j = pairs[idx + 1];

//             uint8 bidIndexI = bidIndices[i];
//             uint8 bidIndexJ = bidIndices[j];

//             // Encrypted comparison: is bid j's price greater than bid i's price?
//             ebool isGreater = TFHE.gt(bids[bidIndexJ].ePrice, bids[bidIndexI].ePrice);
//             TFHE.allowThis(isGreater);
//             encryptedComparisons[getComparisonKey(bidIndexI, bidIndexJ)] = isGreater;
//         }

//         // 4) Emit decryption requests in batches (maximum 8 pairs per batch).
//         uint8 offset = 0;
//         uint8 chunkSize = 8;

//         while (offset < nPairs) {
//             uint8 batchSize = nPairs - offset;
//             if (batchSize > chunkSize) {
//                 batchSize = chunkSize;
//             }

//             // Build an array of ciphertexts for the current batch.
//             uint256[] memory cts = new uint256[](batchSize);
//             for (uint8 k = 0; k < batchSize; k++) {
//                 uint8 pairIndex = (offset + k) * 2; // starting index for the pair in the array
//                 uint8 iIdx = pairs[pairIndex];
//                 uint8 jIdx = pairs[pairIndex + 1];

//                 cts[k] = Gateway.toUint256(encryptedComparisons[getComparisonKey(bidIndices[iIdx], bidIndices[jIdx])]);
//             }

//             bytes4 callbackSelector = _getCallbackSelector(batchSize);

//             // Emit decryption request.
//             uint256 requestID = Gateway.requestDecryption(
//                 cts,
//                 callbackSelector,
//                 0, // optional userData
//                 block.timestamp + 100, // deadline
//                 false
//             );

//             // 5) Store parameters (offset and batchSize) for the callback.
//             addParamsUint256(requestID, offset);
//             addParamsUint256(requestID, batchSize);

//             offset += batchSize;
//         }

//         // 6) Increment swap call count.
//         auctionState.swapCallCount = scCount + 1;
//     }

//     /**
//      * @notice Generate a unique key for a bid comparison using keccak256.
//      * @param smallerID The smaller bid index.
//      * @param biggerID The bigger bid index.
//      * @return A uint256 hash key.
//      */
//     function getComparisonKey(uint8 smallerID, uint8 biggerID) public pure returns (uint256) {
//         return uint256(keccak256(abi.encodePacked(smallerID, biggerID)));
//     }

//     /**
//      * @notice Common callback logic for processing decrypted comparisons.
//      * @param requestID The ID of the decryption request.
//      * @param results An array of decrypted booleans.
//      */
//     function _commonCallbackLogic(uint256 requestID, bool[] memory results) internal {
//         // Retrieve stored parameters (offset and batchSize)
//         uint256[] memory stored = getParamsUint256(requestID);
//         require(stored.length == 2, "Missing params");
//         uint8 offset = uint8(stored[0]);
//         uint8 batchSize = uint8(stored[1]);

//         // Determine the sorting layer (swapCallCount was incremented in swap(), so layer = swapCallCount - 1).
//         uint8 scCount = auctionState.swapCallCount - 1;

//         // Retrieve the bid pairs for the current layer.
//         uint8[] memory pairs = SortingNetworkLibrary.getNetworkLayer(bidCounter, scCount);

//         // Process each decrypted comparison and swap bids if necessary.
//         for (uint8 k = 0; k < batchSize; k++) {
//             bool res = results[k];
//             uint8 pairIndex = (offset + k) * 2;
//             uint8 iIdx = pairs[pairIndex];
//             uint8 jIdx = pairs[pairIndex + 1];

//             uint256 compKey = getComparisonKey(bidIndices[iIdx], bidIndices[jIdx]);
//             decryptedComparisons[compKey] = res;

//             // If the result is true, swap the bid indices.
//             if (res) {
//                 uint8 temp = bidIndices[jIdx];
//                 bidIndices[jIdx] = bidIndices[iIdx];
//                 bidIndices[iIdx] = temp;
//             }
//         }
//     }

//     // --------------------------
//     // Gateway Callback Functions
//     // --------------------------
//     /// @notice Callback for a single decrypted comparison.
//     function callback1(uint256 requestID, bool dec0) external onlyGateway {
//         bool[] memory arr = new bool[](1);
//         arr[0] = dec0;
//         _commonCallbackLogic(requestID, arr);
//     }

//     /// @notice Callback for two decrypted comparisons.
//     function callback2(uint256 requestID, bool dec0, bool dec1) external onlyGateway {
//         bool[] memory arr = new bool[](2);
//         arr[0] = dec0;
//         arr[1] = dec1;
//         _commonCallbackLogic(requestID, arr);
//     }

//     function callback3(uint256 requestID, bool dec0, bool dec1, bool dec2) external onlyGateway {
//         bool[] memory arr = new bool[](3);
//         arr[0] = dec0;
//         arr[1] = dec1;
//         arr[2] = dec2;
//         _commonCallbackLogic(requestID, arr);
//     }

//     function callback4(uint256 requestID, bool dec0, bool dec1, bool dec2, bool dec3) external onlyGateway {
//         bool[] memory arr = new bool[](4);
//         arr[0] = dec0;
//         arr[1] = dec1;
//         arr[2] = dec2;
//         arr[3] = dec3;
//         _commonCallbackLogic(requestID, arr);
//     }

//     function callback5(uint256 requestID, bool dec0, bool dec1, bool dec2, bool dec3, bool dec4) external onlyGateway {
//         bool[] memory arr = new bool[](5);
//         arr[0] = dec0;
//         arr[1] = dec1;
//         arr[2] = dec2;
//         arr[3] = dec3;
//         arr[4] = dec4;
//         _commonCallbackLogic(requestID, arr);
//     }

//     function callback6(
//         uint256 requestID,
//         bool dec0,
//         bool dec1,
//         bool dec2,
//         bool dec3,
//         bool dec4,
//         bool dec5
//     ) external onlyGateway {
//         bool[] memory arr = new bool[](6);
//         arr[0] = dec0;
//         arr[1] = dec1;
//         arr[2] = dec2;
//         arr[3] = dec3;
//         arr[4] = dec4;
//         arr[5] = dec5;
//         _commonCallbackLogic(requestID, arr);
//     }

//     function callback7(
//         uint256 requestID,
//         bool dec0,
//         bool dec1,
//         bool dec2,
//         bool dec3,
//         bool dec4,
//         bool dec5,
//         bool dec6
//     ) external onlyGateway {
//         bool[] memory arr = new bool[](7);
//         arr[0] = dec0;
//         arr[1] = dec1;
//         arr[2] = dec2;
//         arr[3] = dec3;
//         arr[4] = dec4;
//         arr[5] = dec5;
//         arr[6] = dec6;
//         _commonCallbackLogic(requestID, arr);
//     }

//     function callback8(
//         uint256 requestID,
//         bool dec0,
//         bool dec1,
//         bool dec2,
//         bool dec3,
//         bool dec4,
//         bool dec5,
//         bool dec6,
//         bool dec7
//     ) external onlyGateway {
//         bool[] memory arr = new bool[](8);
//         arr[0] = dec0;
//         arr[1] = dec1;
//         arr[2] = dec2;
//         arr[3] = dec3;
//         arr[4] = dec4;
//         arr[5] = dec5;
//         arr[6] = dec6;
//         arr[7] = dec7;
//         _commonCallbackLogic(requestID, arr);
//     }

//     /**
//      * @notice Returns the appropriate callback selector based on the number of pairs.
//      * @param nPairs Number of bid pairs in the current batch.
//      * @return The callback function selector.
//      */
//     function _getCallbackSelector(uint8 nPairs) internal pure returns (bytes4) {
//         bytes4[8] memory selectors = [
//             this.callback1.selector,
//             this.callback2.selector,
//             this.callback3.selector,
//             this.callback4.selector,
//             this.callback5.selector,
//             this.callback6.selector,
//             this.callback7.selector,
//             this.callback8.selector
//         ];
//         require(nPairs > 0 && nPairs <= 8, "Unsupported nPairs");
//         return selectors[nPairs - 1];
//     }
// }

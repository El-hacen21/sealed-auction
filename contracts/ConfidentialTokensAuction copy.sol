// // SPDX-License-Identifier: BSD-3-Clause-Clear
// pragma solidity ^0.8.24;

// import "fhevm/lib/TFHE.sol";
// import "fhevm/config/ZamaFHEVMConfig.sol";
// import "fhevm/config/ZamaGatewayConfig.sol";
// import "fhevm/gateway/GatewayCaller.sol";
// import "hardhat/console.sol";

// import "@openzeppelin/contracts/access/Ownable2Step.sol";
// import { ConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/ConfidentialERC20.sol";

// import { DecryptionHelper } from "./DecryptionHelper.sol";
// import { SortingNetworkLibrary } from "./SortingNetworkLibrary.sol";

// /// @notice Main contract for the blind auction
// contract ConfidentialTokensAuction is SepoliaZamaFHEVMConfig, Ownable2Step, SepoliaZamaGatewayConfig, GatewayCaller {
//     /// @notice Auction end time
//     uint256 public endTime;

//     /// @notice The number of tokens to buy
//     uint64 public totalTokens;

//     /// @notice Encrypted representation of totalTokens
//     euint256 private encryptedTotalTokens;

//     /// @notice The maximum number of bids allowed, set at deployment
//     /// @dev This value is immutable and set during contract deployment
//     uint256 public immutable MAX_BIDS;

//     /// @notice Minimum bid price required to participate (encrypted)
//     euint64 public minBidPrice;

//     ebool xBool;
//     bool public yBool;

//     /// @dev Tracks the latest decryption request ID
//     uint256 public latestRequestID;

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

//     uint256[] public bidsIndexs;

//     mapping(uint256 => ebool) public encryptedComparaisons;
//     mapping(uint256 => bool) public decryptedComparaisons;

//     /// @notice Count of total bids submitted
//     uint256 public bidCounter;

//     /// @notice The total number of tokens successfully allocated (encrypted)
//     euint256 public encryptedTotalBuys;

//     /// @notice Number of total buys bids
//     euint64 public countTotalBuys;

//     /// @notice Number of partial buys
//     euint64 public totalPartialBuys;

//     /// @notice The remaining tokens after full buys (encrypted)
//     euint256 public encryptedRemaining;

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

//     bool private isGreatetFlag;
//     bool private isNotGreateFlag;

//     struct Pair {
//         uint256 lowId;
//         uint256 highId;
//     }

//     DecryptionHelper public decryptionHelper;

//     // Store the count of function calls
//     uint8 public swapCallCount;

//     // using SortingNetworkLibrary for sortingLibrary;

//     /**
//      * @notice Constructor to initialize the auction
//      * @param _tokenContract Address of the ConfidentialERC20 token contract used for bidding
//      * @param _totalTokens The number of tokens to be sold
//      * @param biddingTime Duration of the auction in seconds
//      * @param isStoppable Flag to determine if the auction can be stopped manually
//      */
//     constructor(
//         ConfidentialERC20 _tokenContract,
//         DecryptionHelper _heldecryptionHelperper,
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
//         decryptionHelper = _heldecryptionHelperper;

//         swapCallCount = 0;
//         // For demonstration: if you had a `maxBids` param, you could do:
//         // require(maxBids > 0, "Maximum bids must be greater than zero");
//         // MAX_BIDS = maxBids;
//         // In your snippet, we keep it just as an example
//         MAX_BIDS = 9999; // or any large number, purely as a placeholder

//         encryptedTotalTokens = TFHE.asEuint256(totalTokens);
//         TFHE.allowThis(encryptedTotalTokens);

//         countTotalBuys = TFHE.asEuint64(0);
//         TFHE.allowThis(countTotalBuys);

//         totalPartialBuys = TFHE.asEuint64(0);
//         TFHE.allowThis(totalPartialBuys);

//         xBool = TFHE.asEbool(true);
//         TFHE.allowThis(xBool);
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
//         BidData storage newBid = bids[bidCounter];
//         newBid.account = msg.sender;
//         newBid.ePrice = price;
//         newBid.eQuantity = quantity;
//         newBid.eIndex = TFHE.asEuint64(bidCounter);
//         TFHE.allowThis(newBid.eIndex);
//         bidsIndexs.push(bidCounter);

//         bidCounter++;

//         emit BidSubmitted(msg.sender, bidCounter, price, quantity);
//     }

//     /**
//      * @notice Event emitted when the auction is finalized.
//      * @param timestamp The time at which the auction was finalized.
//      * @param totalBuys The total encrypted quantity of tokens bought during the auction.
//      * @param remainingTokens The remaining encrypted quantity of tokens after the auction.
//      */
//     event AuctionFinalized(uint256 indexed timestamp, euint64 totalBuys, euint64 remainingTokens);

//     // function requestBool() public {
//     //     uint256[] memory cts = new uint256[](1);
//     //     cts[0] = Gateway.toUint256(xBool);
//     //     console.log("::::>SWAP: ");
//     //     Gateway.requestDecryption(cts, this.callbackBool.selector, 0, block.timestamp + 100, false);
//     //     console.log("!!::::>SWAP: ");
//     // }

//     // function callbackBool(uint256, bool decryptedInput) public onlyGateway returns (bool) {
//     //     console.log("Called ", decryptedInput);
//     //     yBool = decryptedInput;
//     //     return yBool;
//     // }

//     // function isGreater(uint256 i, uint256 j) internal returns (bool) {
//     //     // 1) Effectuer la comparaison homomorphique
//     //     ebool isGt = TFHE.gt(bids[i].ePrice, bids[j].ePrice);

//     //     euint4 eTrue = TFHE.asEuint4(0);

//     //     // 4) Sélectionner entre eTrue et eFalse basé sur isGt
//     //     TFHE.select(isGt, _isGreateTrue(true), _isGreateTrue(false));

//     //     console.log("IsCgreater::", isGreatetFlag);

//     //     // 5) Retourner le flag correspondant
//     //     return isGreatetFlag;
//     // }

//     // function _isGreateTrue() internal returns (euint4) {

//     //     isGreatetFlag = true;
//     //     return TFHE.asEuint4(0);
//     // }

//     // function sortIndices() internal {
//     //     uint256 n = bidCounter;
//     //     // On crée un tableau d'indices [0, 1, 2, ..., n-1]
//     //     uint256[] memory indices = new uint256[](n);
//     //     for (uint256 i = 0; i < n; i++) {
//     //         indices[i] = i;
//     //     }

//     //     // Insertion sort sur le tableau indices,
//     //     // en utilisant la fonction isGreater(...) pour comparer.
//     //     for (uint256 i = 1; i < n; i++) {
//     //         uint256 key = indices[i];
//     //         uint256 j = i;
//     //         console.log("AISSIGN INDEXE", i);
//     //         // Tant que j > 0 ET que realValues[indices[j-1]] > realValues[key]
//     //         // alors on décale.
//     //         while (j > 0 && isGreater(indices[j - 1], key)) {
//     //             indices[j] = indices[j - 1];
//     //             j--;
//     //         }
//     //         indices[j] = key;
//     //     }
//     //     console.log("END AISSIGN INDEXE");
//     // }

//     // Fonction pour effectuer un swap conditionnel sur les indices
//     // function swap(uint256 i, uint256 j) internal {
//     //     BidData storage temp1 = bids[i];
//     //     BidData storage temp2 = bids[j];

//     //     compareOnePairCallback(i,j);

//     //     ebool isGreater = TFHE.gt(temp1.ePrice, temp2.ePrice);
//     //     encryptedComparaisons[getComparisonKey(smallerID, biggerID)]
//     //     uint64 step = j - i;

//     //     euint64 temp1Front = TFHE.add(bids[i].eIndex, TFHE.asEuint64(step));
//     //     euint64 temp2Back = TFHE.sub(bids[j].eIndex, TFHE.asEuint64(step));

//     //     TFHE.allowThis(temp1Front);
//     //     TFHE.allowThis(temp2Back);

//     //     bids[i].eIndex = TFHE.select(isGreater, temp1Front, bids[i].eIndex);
//     //     bids[j].eIndex = TFHE.select(isGreater, temp2Back, bids[j].eIndex);

//     //     console.log("SWAP: ", i, ", ", j);
//     // }

//     /**
//      * @notice Finalizes the auction by:
//      *         1. Assigning bid indexes
//      *         2. Calculating total buys
//      *         3. Calculating remaining tokens
//      *         4. Calculating partial buys
//      * @dev This function should be called after the bidding period has ended by the contract owner.
//      */
//     function finalizeAuction() public onlyOwner onlyAfterEnd {
//         require(swapCallCount >= SortingNetworkLibrary.getNumberOfLayers(uint8(bidCounter)), "You cannot swap");
//         euint256 eBuyQuatity = TFHE.asEuint256(0);
//         TFHE.allowThis(eBuyQuatity);

//         for (uint256 i = 0; i < bidCounter; ++i) {
//             BidData storage currentBid = bids[bidsIndexs[i]];

//             eBuyQuatity = TFHE.add(eBuyQuatity, currentBid.eQuantity);

//             ebool isETotalBuy = TFHE.le(eBuyQuatity, encryptedTotalTokens);
//             ebool isPartialBuy = TFHE.gt(eBuyQuatity, encryptedTotalTokens);

//             TFHE.allowThis(isETotalBuy);
//             currentBid.eTotalBuy = isETotalBuy;
//         }

//         encryptedTotalBuys = eBuyQuatity;
//         encryptedRemaining = TFHE.sub(encryptedTotalTokens, encryptedTotalBuys);
//     }

//     function swap() public onlyOwner onlyAfterEnd {
//         require(swapCallCount < SortingNetworkLibrary.getNumberOfLayers(uint8(bidCounter)), "You cannot swap");

//         uint8[] memory pairs = SortingNetworkLibrary.getNetworkLayer(uint8(bidCounter), swapCallCount);

//         // Iterate over the pairs and perform swaps
//         for (uint256 index = 0; index < pairs.length; index += 2) {
//             uint8 i = pairs[index];
//             uint8 j = pairs[index + 1];

//             console.log("SWAP: ", i, ", ", j);

//             BidData memory temp1 = bids[bidsIndexs[i]];
//             BidData memory temp2 = bids[bidsIndexs[j]];

//             ebool isGreater = TFHE.gt(temp1.ePrice, temp2.ePrice);
//             TFHE.allowThis(isGreater);

//             uint256 key = getComparisonKey(bidsIndexs[i], bidsIndexs[j]);
//             encryptedComparaisons[key] = isGreater;

//             requestCompareOnePair(i, j);
//         }

//         swapCallCount += 1;
//         // requestBool(); // Uncomment if needed elsewhere
//     }

//     function requestCompareOnePair(uint256 smallerID, uint256 biggerID) public {
//         uint256[] memory cts = new uint256[](1);
//         uint256 key = getComparisonKey(bidsIndexs[smallerID], bidsIndexs[biggerID]);
//         cts[0] = Gateway.toUint256(encryptedComparaisons[key]);

//         // console.log("*****SWAP: ", bidsIndexs[smallerID], ", ", bidsIndexs[biggerID]);
//         // console.log("Encrypted Comparison for key ", key, ": ", cts[0]);

//         uint256 requestID = Gateway.requestDecryption(
//             cts,
//             this.compareOnePairCallback.selector,
//             0,
//             block.timestamp + 100,
//             false
//         );

//         // console.log("-------key: ", key);
//         // console.log("-------requestID: ", requestID);

//         addParamsUint256(requestID, smallerID);
//         addParamsUint256(requestID, biggerID);
//     }

//     function compareOnePairCallback(uint256 requestID, bool result) public onlyGateway returns (bool) {
//         uint256[] memory params = getParamsUint256(requestID);
//         uint256 smallerID = params[0];
//         uint256 biggerID = params[1];

//         // console.log("Callback invoked for requestID: ", requestID);
//         // console.log("Decryption result: ", result);

//         decryptedComparaisons[getComparisonKey(smallerID, biggerID)] = result;

//         //swap the indexs
//         if (result) {
//             uint256 temp = bidsIndexs[biggerID];
//             bidsIndexs[biggerID] = bidsIndexs[smallerID];
//             bidsIndexs[smallerID] = temp;
//         }

//         return result;
//     }

//     function getComparisonKey(uint256 smallerID, uint256 biggerID) public pure returns (uint256) {
//         // Always pack smaller first, bigger second
//         // return keccak256(abi.encodePacked(smallerID, biggerID));
//         uint256 result = (smallerID + biggerID) + (smallerID * biggerID);
//         return result;
//     }

//     function swap2() public {
//         // 1. Ensure we haven't exceeded the total number of layers (same logic as swap)
//         require(swapCallCount < SortingNetworkLibrary.getNumberOfLayers(uint8(bidCounter)), "You cannot swap anymore");

//         // 2. Get the pairs for the current layer (same as swap)
//         uint8[] memory pairs = SortingNetworkLibrary.getNetworkLayer(uint8(bidCounter), swapCallCount);
//         // We'll process them in chunks of 4, because each chunk = 2 pairs = 4 indices

//         // 3. Iterate in steps of 4 (2 pairs at a time)
//         for (uint256 index = 0; index + 3 < pairs.length; index += 4) {
//             // Pair A
//             uint8 i1 = pairs[index];
//             uint8 j1 = pairs[index + 1];

//             // Pair B
//             uint8 i2 = pairs[index + 2];
//             uint8 j2 = pairs[index + 3];

//             console.log("SWAP2: ");

//             // -- Perform local ePrice comparisons and store them in encryptedComparaisons --

//             // Compare for Pair A
//             BidData memory bidA1 = bids[bidsIndexs[i1]];
//             BidData memory bidA2 = bids[bidsIndexs[j1]];
//             ebool isGreaterA = TFHE.gt(bidA1.ePrice, bidA2.ePrice);
//             TFHE.allowThis(isGreaterA);
//             uint256 keyA = getComparisonKey(bidsIndexs[i1], bidsIndexs[j1]);
//             encryptedComparaisons[keyA] = isGreaterA;

//             // Compare for Pair B
//             BidData memory bidB1 = bids[bidsIndexs[i2]];
//             BidData memory bidB2 = bids[bidsIndexs[j2]];
//             ebool isGreaterB = TFHE.gt(bidB1.ePrice, bidB2.ePrice);
//             TFHE.allowThis(isGreaterB);
//             uint256 keyB = getComparisonKey(bidsIndexs[i2], bidsIndexs[j2]);
//             encryptedComparaisons[keyB] = isGreaterB;

//             // 4. Make ONE request to compare both pairs at once
//             requestCompare2Pairs(i1, j1, i2, j2);
//         }

//         // 5. Increment the same counter as swap()
//         swapCallCount += 1;
//     }

//     function requestCompare2Pairs(uint8 i1, uint8 j1, uint8 i2, uint8 j2) internal {
//         // We'll request decryption for 2 ebool values in a single call
//         uint256[] memory cts = new uint256[](2);

//         // Comparison keys
//         uint256 keyA = getComparisonKey(bidsIndexs[i1], bidsIndexs[j1]);
//         uint256 keyB = getComparisonKey(bidsIndexs[i2], bidsIndexs[j2]);

//         cts[0] = Gateway.toUint256(encryptedComparaisons[keyA]);
//         cts[1] = Gateway.toUint256(encryptedComparaisons[keyB]);

//         // NOTE: You need a Gateway function that can handle returning two booleans,
//         // often called `requestDecryption2` or similar. If you only have `requestDecryption`,
//         // you'll need a custom approach or a callback signature that can handle two results.

//         uint256 requestID = Gateway.requestDecryption(
//             cts,
//             this.callback2.selector, // This callback returns (bool dec0, bool dec1)
//             0,
//             block.timestamp + 100,
//             false
//         );

//         // Store the 4 indices so callback2 knows which pairs they belong to.
//         addParamsUint256(requestID, i1);
//         addParamsUint256(requestID, j1);
//         addParamsUint256(requestID, i2);
//         addParamsUint256(requestID, j2);
//     }

//     function callback2(uint256 requestID, bool dec0, bool dec1) public onlyGateway {
//         // Retrieve the 4 indices that correspond to the two pairs
//         uint256[] memory storedPairs = getParamsUint256(requestID);

//         // storedPairs layout: [i1, j1, i2, j2]
//         uint256 i1 = storedPairs[0];
//         uint256 j1 = storedPairs[1];
//         uint256 i2 = storedPairs[2];
//         uint256 j2 = storedPairs[3];

//         // dec0 => result for Pair(i1, j1)
//         // dec1 => result for Pair(i2, j2)

//         // 1. Store final decrypted comparison for Pair A
//         decryptedComparaisons[getComparisonKey(i1, j1)] = dec0;

//         // Swap indexes if dec0 is true
//         if (dec0) {
//             uint256 temp = bidsIndexs[j1];
//             bidsIndexs[j1] = bidsIndexs[i1];
//             bidsIndexs[i1] = temp;
//         }

//         // 2. Store final decrypted comparison for Pair B
//         decryptedComparaisons[getComparisonKey(i2, j2)] = dec1;

//         // Swap indexes if dec1 is true
//         if (dec1) {
//             uint256 temp = bidsIndexs[j2];
//             bidsIndexs[j2] = bidsIndexs[i2];
//             bidsIndexs[i2] = temp;
//         }
//     }

//     // function swap3() public {
//     //     // Suppose we get 3 pairs from the sorting network
//     //     // For demonstration: [0,1], [2,3], [4,5]
//     //     uint8[] memory pairs = new uint8[](6);
//     //     pairs[0] = 0;
//     //     pairs[1] = 1;
//     //     pairs[2] = 2;
//     //     pairs[3] = 3;
//     //     pairs[4] = 4;
//     //     pairs[5] = 5;

//     //     ebool[] memory ebools = new ebool[](3);

//     //     for (uint256 i = 0; i < 3; i++) {
//     //         uint8 left = pairs[i * 2];
//     //         uint8 right = pairs[i * 2 + 1];

//     //         BidData memory tempLeft = bids[bidsIndexs[left]];
//     //         BidData memory tempRight = bids[bidsIndexs[right]];

//     //         ebool isGreater = TFHE.gt(tempLeft.ePrice, tempRight.ePrice);
//     //         TFHE.allowThis(isGreater);

//     //         ebools[i] = isGreater;

//     //         uint256 key = getComparisonKey(bidsIndexs[left], bidsIndexs[right]);
//     //         encryptedComparaisons[key] = isGreater;
//     //     }

//     //     // Convert to ciphertext array
//     //     uint256[] memory ciphertexts = new uint256[](3);
//     //     for (uint256 i = 0; i < 3; i++) {
//     //         ciphertexts[i] = Gateway.toUint256(ebools[i]);
//     //     }

//     //     // Single request that expects 3 boolean results
//     //     // (Assuming your Gateway has a "requestDecryption3" method)
//     //     uint256 requestID = Gateway.requestDecryption3(
//     //         ciphertexts,
//     //         this.callback3.selector,
//     //         0,
//     //         block.timestamp + 100,
//     //         false
//     //     );

//     //     // Store pairs
//     //     addParamsUint256(requestID, pairs);
//     // }

//     // function callback3(uint256 requestID, bool dec0, bool dec1, bool dec2) public onlyGateway returns (bool[3] memory) {
//     //     uint256[] memory storedPairs = getParamsUint256(requestID);
//     //     // storedPairs = [0,1, 2,3, 4,5]
//     //     // dec0 -> compare [0,1]
//     //     // dec1 -> compare [2,3]
//     //     // dec2 -> compare [4,5]

//     //     // dec0
//     //     {
//     //         uint256 smallerID = storedPairs[0];
//     //         uint256 biggerID = storedPairs[1];

//     //         decryptedComparaisons[getComparisonKey(smallerID, biggerID)] = dec0;
//     //         if (dec0) {
//     //             uint256 temp = bidsIndexs[biggerID];
//     //             bidsIndexs[biggerID] = bidsIndexs[smallerID];
//     //             bidsIndexs[smallerID] = temp;
//     //         }
//     //     }

//     //     // dec1
//     //     {
//     //         uint256 smallerID = storedPairs[2];
//     //         uint256 biggerID = storedPairs[3];

//     //         decryptedComparaisons[getComparisonKey(smallerID, biggerID)] = dec1;
//     //         if (dec1) {
//     //             uint256 temp = bidsIndexs[biggerID];
//     //             bidsIndexs[biggerID] = bidsIndexs[smallerID];
//     //             bidsIndexs[smallerID] = temp;
//     //         }
//     //     }

//     //     // dec2
//     //     {
//     //         uint256 smallerID = storedPairs[4];
//     //         uint256 biggerID = storedPairs[5];

//     //         decryptedComparaisons[getComparisonKey(smallerID, biggerID)] = dec2;
//     //         if (dec2) {
//     //             uint256 temp = bidsIndexs[biggerID];
//     //             bidsIndexs[biggerID] = bidsIndexs[smallerID];
//     //             bidsIndexs[smallerID] = temp;
//     //         }
//     //     }

//     //     return [dec0, dec1, dec2];
//     // }

//     // Fonction pour effectuer un swap conditionnel sur les indices
//     // function swap() public {
//     //     require(swapCallCount < SortingNetworkLibrary.getNumberOfLayers(uint8(bidCounter)), "You cannot swap");
//     //     uint8[] memory pairs = SortingNetworkLibrary.getNetworkLayer(uint8(bidCounter), swapCallCount);

//     //     // To be optimized for parallelisation
//     //     for (int i = 1; i < pairs.length; ++i) {
//     //         console.log("1. SWAP: ", bidsIndexs[i], ", ", bidsIndexs[i+1]);
//     //         BidData memory temp1 = bids[bidsIndexs[i]];
//     //         BidData memory temp2 = bids[bidsIndexs[i+1]];
//     //     }

//     //     console.log("1. SWAP: ", bidsIndexs[i], ", ", bidsIndexs[j]);
//     //     BidData memory temp1 = bids[bidsIndexs[i]];
//     //     BidData memory temp2 = bids[bidsIndexs[j]];

//     //     ebool isGreater = TFHE.gt(temp1.ePrice, temp2.ePrice);
//     //     TFHE.allowThis(isGreater);

//     //     uint256 key = getComparisonKey(bidsIndexs[i], bidsIndexs[j]);
//     //     encryptedComparaisons[key] = isGreater;

//     //     requestCompareOnePair(i, j);

//     //     swapCallCount += 1;
//     //     // requestBool();
//     // }

//     /**
//      * @notice Assigns encrypted indices to each bid based on their encrypted prices.
//      */
//     function _assignIndexes() public {
//         swap();
//         // swap(1, 2);
//         // swap(2, 3);

//         // swap(2, 4);
//         // swap(1, 2);
//         // swap(3, 5);
//         // swap(2, 3);
//         // swap(4, 5);
//         // swap(3, 4);

//         // for (uint256 bidId = 1; bidId <= bidCounter; bidId++) {

//         //     BidData storage currentBid = bids[bidId];

//         //     // Local ephemeral variable: no need for allowThis.
//         //     euint64 encryptedIndex = TFHE.asEuint64(0);

//         //     // Compare the current bid with all others
//         //     ebool isBidHighEnough = TFHE.gt(currentBid.ePrice, minBidPrice);

//         //     for (uint256 comparisonId = 1; comparisonId <= bidCounter; comparisonId++) {
//         //         BidData memory comparisonBid = bids[comparisonId];

//         //         // ebool isOtherHigher = TFHE.gt(comparisonBid.ePrice, currentBid.ePrice);

//         //         // ebool isEqual = TFHE.eq(currentBid.ePrice, comparisonBid.ePrice);
//         //         // ebool isFirst = TFHE.asEbool(comparisonId <= bidId); // "First In First Served"

//         //         console.log("AISSIGN INDEXE", comparisonId);

//         //         // If isOtherHigher || (isEqual && isFirst) is true, we increment
//         //         ebool shouldIncrement = TFHE.and(TFHE.asEbool(true), isBidHighEnough);

//         //         encryptedIndex = TFHE.add(encryptedIndex, TFHE.asEuint64(shouldIncrement));
//         //     }

//         //     // Now we store it in the contract state => allow the contract to continue using it later
//         //     currentBid.eIndex = encryptedIndex;
//         //     TFHE.allowThis(currentBid.eIndex);
//         // }
//         console.log("OUT AISSIGN INDEXE");
//     }

//     // function requestDecryptComparisons(Pair[] callback pairs) public {
//     //     require(pairs.length <= bidCounter/2, "Error");

//     //     // 1. Prepare the array of ciphertexts
//     //     uint256[] memory cts = new uint256[](pairs.length);
//     //     for (uint256 i = 0; i < pairs.length; ++i) {
//     //         Pair memory pair=pairs[i];
//     //         uint256 key= getComparisonKey(pair.ID, pair.ID)
//     //         encryptedComparaisons[]=TFHE.asEbool(true);
//     //         TFHE.allowThis(encryptedComparaisons[i]);
//     //          console.log("KEY::", i);
//     //         cts[i] = Gateway.toUint256(encryptedComparaisons[i]);
//     //     }

//     //     // 2. Send a single decryption request
//     //     uint256 requestID = Gateway.requestDecryption(
//     //         cts,
//     //         this.compareBatchCallback.selector,
//     //         0, // fee
//     //         block.timestamp + 10000, // deadline (example: +1000 seconds)
//     //         false // autoReencrypt
//     //     );

//     //     // 3. Store the indexes so we know which slot belongs to which result
//     //     for (uint256 i = 0; i < bidCounter; i++) {
//     //         addParamsUint256(requestID, i);
//     //     }
//     // }

//     // function compareBatchCallback(uint256 requestID, bool decryptedInput1, bool decryptedInput2) public  {

//     //     // 1. Retrieve the indexes we stored
//     //     uint256[] memory params = getParamsUint256(requestID);

//     //     // 2. Map each result back to its 'index' in the contract
//     //     for (uint256 i = 0; i < params.length; i++) {
//     //         uint256 idx = params[i];
//     //         decryptedComparaisons[idx] = decryptedInputs[i];
//     //     }
//     // }

//     function requestDecryptComparisons() public {
//         // 1) Suppose we have two ebool ciphertexts from somewhere (for demonstration, trivial):
//         ebool c0 = TFHE.asEbool(true);
//         ebool c1 = TFHE.asEbool(false);

//         TFHE.allowThis(c0);
//         TFHE.allowThis(c1);

//         // 2) Convert them to the raw handles
//         uint256[] memory cts = new uint256[](2);
//         cts[0] = Gateway.toUint256(c0);
//         cts[1] = Gateway.toUint256(c1);

//         console.log("latestRequestID", latestRequestID);
//         // 3) Ask the helper to do the decryption request
//         latestRequestID = decryptionHelper.requestComparisons(cts);

//         // Possibly store the requestID if you want to later read from helper
//         // or if the helper calls you back, you can track it that way.
//     }

//     function readDecryptionResult(uint256 requestID) public view returns (bool[] memory) {
//         // Read results from the helper
//         return decryptionHelper.getDecryptedResults(requestID);
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

// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";
import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/ConfidentialERC20.sol";

import { DecryptionHelper } from "./DecryptionHelper.sol";
import { SortingNetworkLibrary } from "./SortingNetworkLibrary.sol";

/// @notice Main contract for the blind auction
contract ConfidentialTokensAuction is SepoliaZamaFHEVMConfig, Ownable2Step, SepoliaZamaGatewayConfig, GatewayCaller {
    /// @notice Auction end time
    uint256 public endTime;

    /// @notice The number of tokens to buy
    uint64 public totalTokens;

    /// @notice Encrypted representation of totalTokens
    euint256 private encryptedTotalTokens;

    /// @notice The maximum number of bids allowed, set at deployment
    /// @dev This value is immutable and set during contract deployment
    uint256 public immutable MAX_BIDS;

    /// @notice Minimum bid price required to participate (encrypted)
    euint64 public minBidPrice;

    ebool xBool;
    bool public yBool;

    /// @dev Tracks the latest decryption request ID
    uint256 public latestRequestID;

    /// @notice Stores the amount (quantity, deposit, etc.) for each bidder
    struct BidOutPut {
        address account; // Bidder's address
        euint64 eQuantity; // Encrypted quantity of tokens
        euint64 eAmount; // Encrypted total cost (price * quantity)
        euint64 eDeposit; // Encrypted deposit locked in
        bool canClaim; // Indicates whether the bidder can claim
    }

    /// @notice Mapping from a bidder's address to their output data
    mapping(address => BidOutPut) private bidsOutput;

    /// @notice List of unique addresses that have placed bids
    address[] private bidAccounts;

    /// @notice Contains the core data for each bid
    struct BidData {
        address account; // Bidder's address
        euint64 ePrice; // Encrypted price per token
        euint64 eQuantity; // Encrypted quantity of tokens
        euint64 eIndex; // Encrypted ranking index
        ebool eTotalBuy; // Flag to indicate if the entire bid is accepted
        ebool ePartialBuy; // Flag to indicate a partial buy
    }

    /// @notice Mapping of bidId => BidData
    mapping(uint256 => BidData) private bids;

    uint256[] public bidsIndexs;

    mapping(uint256 => ebool) public encryptedComparaisons;
    mapping(uint256 => bool) public decryptedComparaisons;

    /// @notice Count of total bids submitted
    uint256 public bidCounter;

    /// @notice The total number of tokens successfully allocated (encrypted)
    euint256 public encryptedTotalBuys;

    /// @notice Number of total buys bids
    euint64 public countTotalBuys;

    /// @notice Number of partial buys
    euint64 public totalPartialBuys;

    /// @notice The remaining tokens after full buys (encrypted)
    euint256 public encryptedRemaining;

    /// @notice The token contract used for encrypted bids
    ConfidentialERC20 public tokenContract;

    /// @notice Flag indicating whether the auction object has been claimed
    /// @dev WARNING : If there is a draw, only the first highest bidder will get the prize
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

    euint64 public settlementPrice;

    DecryptionHelper public decryptionHelper;

    // Store the count of function calls
    uint8 public swapCallCount;

    // Pour savoir si TOUT est terminé
    bool public isFinalized;

    // --- Pour la logique par batch ---
    // On mémorise la progression dans le traitement
    uint256 public currentIndex; // Index du prochain bid à traiter
    euint64 public eRemainState; // État "restant" crypté
    ebool public soldOutState; // État "déjà épuisé ?" crypté

    // using SortingNetworkLibrary for sortingLibrary;

    /**
     * @notice Constructor to initialize the auction
     * @param _tokenContract Address of the ConfidentialERC20 token contract used for bidding
     * @param _totalTokens The number of tokens to be sold
     * @param biddingTime Duration of the auction in seconds
     * @param isStoppable Flag to determine if the auction can be stopped manually
     */
    constructor(
        ConfidentialERC20 _tokenContract,
        DecryptionHelper _heldecryptionHelperper,
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
        decryptionHelper = _heldecryptionHelperper;

        swapCallCount = 0;
        // For demonstration: if you had a `maxBids` param, you could do:
        // require(maxBids > 0, "Maximum bids must be greater than zero");
        // MAX_BIDS = maxBids;
        // In your snippet, we keep it just as an example
        MAX_BIDS = 9999; // or any large number, purely as a placeholder

        encryptedTotalTokens = TFHE.asEuint256(totalTokens);
        TFHE.allowThis(encryptedTotalTokens);

        countTotalBuys = TFHE.asEuint64(0);
        TFHE.allowThis(countTotalBuys);

        totalPartialBuys = TFHE.asEuint64(0);
        TFHE.allowThis(totalPartialBuys);

        xBool = TFHE.asEbool(true);
        TFHE.allowThis(xBool);

        settlementPrice = TFHE.asEuint64(0);
        TFHE.allowThis(settlementPrice);

        eRemainState = TFHE.asEuint64(totalTokens); // nombre de tokens dispo
        TFHE.allowThis(eRemainState);

        soldOutState = TFHE.asEbool(false); // pas encore épuisé
        TFHE.allowThis(soldOutState);

        currentIndex = 0;

        isFinalized=false;
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
     * @notice Submit a bid with an encrypted price and quantity
     * @dev Transfers tokens from the bidder to the contract
     * @param encryptedPrice The encrypted bid price
     * @param encryptedQuantity The encrypted bid quantity
     * @param inputProof Proof for the encrypted price/quantity
     */
    function bid(einput encryptedPrice, einput encryptedQuantity, bytes calldata inputProof) external onlyBeforeEnd {
        euint64 price = TFHE.asEuint64(encryptedPrice, inputProof);
        euint64 quantity = TFHE.asEuint64(encryptedQuantity, inputProof);

        TFHE.allowThis(price);
        TFHE.allowThis(quantity);
        TFHE.allow(price, msg.sender);
        TFHE.allow(quantity, msg.sender);

        // Calculate the total amount to lock based on price * quantity
        euint64 amountToLock = TFHE.mul(price, quantity);

        // Allow the contract and the caller to use this ciphertext
        TFHE.allowThis(amountToLock);
        TFHE.allow(amountToLock, msg.sender);

        BidOutPut storage bidOutput = bidsOutput[msg.sender];
        bidOutput.eDeposit = TFHE.add(bidOutput.eDeposit, amountToLock);

        TFHE.allowThis(bidOutput.eDeposit);
        TFHE.allow(bidOutput.eDeposit, msg.sender);

        // Approve and transfer the tokens from the bidder to this contract
        TFHE.allowTransient(amountToLock, address(tokenContract));
        tokenContract.transferFrom(msg.sender, address(this), amountToLock);

        // Store the new bid
        BidData storage newBid = bids[bidCounter];
        newBid.account = msg.sender;
        newBid.ePrice = price;
        newBid.eQuantity = quantity;
        newBid.eIndex = TFHE.asEuint64(bidCounter);
        TFHE.allowThis(newBid.eIndex);
        bidsIndexs.push(bidCounter);

        bidCounter++;

        emit BidSubmitted(msg.sender, bidCounter, price, quantity);
    }

    /**
     * @notice Event emitted when the auction is finalized.
     * @param timestamp The time at which the auction was finalized.
     * @param totalBuys The total encrypted quantity of tokens bought during the auction.
     * @param remainingTokens The remaining encrypted quantity of tokens after the auction.
     */
    event AuctionFinalized(uint256 indexed timestamp, euint64 totalBuys, euint64 remainingTokens);


    function finalizeAuction(uint256 _batchSize) public onlyOwner onlyAfterEnd {
        require(!isFinalized, "All bids already finalized");
        // Vérifie qu'on a bien exécuté le tri (Sorting Network) sur les bids
        require(swapCallCount >= SortingNetworkLibrary.getNumberOfLayers(uint8(bidCounter)), "You cannot swap yet");

        // 2) Calcul du nombre d’items qu’on va vraiment traiter maintenant
        uint256 end = currentIndex + _batchSize;
        if (end > bidCounter) {
            end = bidCounter; // on ne dépasse pas le total
        }

        // Récupération en local pour bosser plus vite
        euint64 eRemain = eRemainState;
        ebool soldOut = soldOutState;

        // 3) Boucle sur la plage [currentIndex .. end-1]
        for (uint256 i = currentIndex; i < end; i++) {
            console.log("Finailize", i);

            // Récupération du bid, trié par ordre décroissant de prix
            BidData storage currentBid = bids[bidsIndexs[i]];

            // 3.1) fill = min(currentBid.eQuantity, eRemain)
            ebool isPartial = TFHE.gt(currentBid.eQuantity, eRemain);
            euint64 fill = TFHE.select(isPartial, eRemain, currentBid.eQuantity);
            TFHE.allowThis(fill);

            // 3.2) eRemain = eRemain - fill
            eRemain = TFHE.sub(eRemain, fill);
            TFHE.allowThis(eRemain);

            // 3.3) Enregistre la quantité effectivement achetée
            BidOutPut storage bidOutput = bidsOutput[currentBid.account];

            bidOutput.eQuantity = fill;
            
            bidOutput.canClaim = true;

            // 3.4) Vérifie si on vient de s'épuiser **grâce** à ce bid
            ebool usedSomeTokens = TFHE.gt(fill, TFHE.asEuint64(0));
            ebool wasNotSoldBefore = TFHE.not(soldOut);

            ebool isNowEmpty = TFHE.eq(eRemain, TFHE.asEuint64(0));
            ebool doSetPrice = TFHE.and(TFHE.and(usedSomeTokens, wasNotSoldBefore), isNowEmpty);
            // => On met settlementPrice = currentBid.ePrice si doSetPrice == true
            settlementPrice = TFHE.select(doSetPrice, currentBid.ePrice, settlementPrice);
            TFHE.allowThis(settlementPrice);

            // 3.5) Met à jour 'soldOut' si on est tombé à 0
            soldOut = TFHE.or(soldOut, isNowEmpty);
            TFHE.allowThis(soldOut);

            // Optionnel : on stocke l'adresse du bidder
            bidAccounts.push(currentBid.account);
        }

        // 4) Stocker l’état mis à jour
        eRemainState = eRemain;
        TFHE.allowThis(eRemainState);

        soldOutState = soldOut;
        TFHE.allowThis(soldOutState);

        // 5) On a traité `end - currentIndex` enchères ; on met à jour currentIndex
        currentIndex = end;

        // 6) Si on a tout traité (end == bidCounter), on fait la logique finale
        if (currentIndex == bidCounter) {
            // ------------------------------------------------------------------
            // On regarde s'il reste des tokens (eRemain > 0)
            // ET si on n'a jamais été soldOut, alors on fixe le prix = lastBid.ePrice
            // ------------------------------------------------------------------
            ebool isStillRemaining = TFHE.gt(eRemain, TFHE.asEuint64(0));
            ebool mustSetLastPrice = TFHE.and(isStillRemaining, TFHE.not(soldOut));

            // On récupère le dernier bid
            BidData memory lastBid = bids[bidsIndexs[bidCounter - 1]];

            // On le sélectionne
            settlementPrice = TFHE.select(mustSetLastPrice, lastBid.ePrice, settlementPrice);
            TFHE.allowThis(settlementPrice);

            console.log("***********Is FInalized************");

            // Marque la fin
            isFinalized = true;
        }
    }

    function swap() public onlyOwner onlyAfterEnd {
        require(swapCallCount < SortingNetworkLibrary.getNumberOfLayers(uint8(bidCounter)), "You cannot swap");

        uint8[] memory pairs = SortingNetworkLibrary.getNetworkLayer(uint8(bidCounter), swapCallCount);

        // Iterate over the pairs and perform swaps
        for (uint256 index = 0; index < pairs.length; index += 2) {
            uint8 i = pairs[index];
            uint8 j = pairs[index + 1];

            console.log("SWAP: ", i, ", ", j);

            BidData memory temp1 = bids[bidsIndexs[i]];
            BidData memory temp2 = bids[bidsIndexs[j]];

            ebool isGreater = TFHE.gt(temp2.ePrice, temp1.ePrice);
            TFHE.allowThis(isGreater);

            uint256 key = getComparisonKey(bidsIndexs[i], bidsIndexs[j]);
            encryptedComparaisons[key] = isGreater;

            requestCompareOnePair(i, j);
            // requestCompareNPairs(pairs);
        }

        // requestCompareNPairs(pairs);
        swapCallCount += 1;
        // requestBool(); // Uncomment if needed elsewhere
    }


    // function swap() public onlyOwner onlyAfterEnd {
    //     require(swapCallCount < SortingNetworkLibrary.getNumberOfLayers(uint8(bidCounter)), "No more swap layers");

    //     // Retrieve the pairs for the current layer from the sorting network
    //     uint8[] memory pairs = SortingNetworkLibrary.getNetworkLayer(uint8(bidCounter), swapCallCount);

    //     // Example: if pairs = [0,1, 2,3, 1,2], that means we have 3 pairs:
    //     //   (0,1), (2,3), (1,2)
    //     // Make sure we don't exceed 8 pairs in a single batch:
    //     require(pairs.length / 2 <= 8, "Too many pairs for one batch (max 8)");

    //     // For each pair (i, j), compute the homomorphic comparison ePrice[i] > ePrice[j]
    //     // and store it in `encryptedComparaisons`.
    //     for (uint256 idx = 0; idx < pairs.length; idx += 2) {
    //         uint8 i = pairs[idx];
    //         uint8 j = pairs[idx + 1];

    //         // Retrieve the two bids (in memory)
    //         BidData memory bidI = bids[bidsIndexs[i]];
    //         BidData memory bidJ = bids[bidsIndexs[j]];

    //         // Homomorphic comparison
    //         ebool isGreater = TFHE.gt(bidI.ePrice, bidJ.ePrice);

    //         // Approve the usage of the resulting ebool
    //         TFHE.allowThis(isGreater);

    //         // Build a unique key for storing the ebool
    //         uint256 key = getComparisonKey(bidsIndexs[i], bidsIndexs[j]);
    //         encryptedComparaisons[key] = isGreater;
    //     }

    //     // Now request a batch *decryption* of these pairs in one go.
    //     // This will call back our callback function (e.g. `callbackBitmask` or `callback8`)
    //     // to do the actual swap in clear if needed.
    //     requestCompareNPairs(pairs);

    //     // Move to the next layer
    //     swapCallCount++;
    // }

    function requestCompareNPairs(uint8[] memory pairs) internal {
        // pairs = [i1, j1, i2, j2, ... iN, jN]
        require(pairs.length % 2 == 0, "Must be an even number of indices");
        uint256 nPairs = pairs.length / 2;
        require(nPairs <= 16, "Max 16 comparisons in one call");

        // On prépare un tableau cts pour stocker les ciphertexts de chaque comparaison
        uint256[] memory cts = new uint256[](nPairs);

        for (uint256 k = 0; k < nPairs; k++) {
            uint8 iIdx = pairs[2 * k];
            uint8 jIdx = pairs[2 * k + 1];

            // On récupère la clé (ou l'ID) stockée on-chain qui pointe vers l'ebool comparé
            // ex: getComparisonKey(bidsIndexs[iIdx], bidsIndexs[jIdx])
            uint256 key = getComparisonKey(bidsIndexs[iIdx], bidsIndexs[jIdx]);

            // On stocke le ciphertext associé
            cts[k] = Gateway.toUint256(encryptedComparaisons[key]);
        }

        // Appel de déchiffrement (simultané pour nPairs ebool)
        // Attention : ta passerelle doit pouvoir gérer "nPairs" booleans en callback.
        uint256 requestID = Gateway.requestDecryption(
            cts,
            this.callback16.selector, // on suppose qu'on a la version "16 booléens"
            0,
            block.timestamp + 100,
            false
        );

        console.log("Hello World");

        // On packe les paires dans un seul uint256
        uint256 packed = packPairs(pairs);

        // => Stockage en un seul param
        addParamsUint256(requestID, packed);
    }

    function callback16(
        uint256 requestID,
        bool dec0,
        bool dec1,
        bool dec2,
        bool dec3,
        bool dec4,
        bool dec5,
        bool dec6,
        bool dec7
    )
        public
        // bool dec8,
        // bool dec9,
        // bool dec10,
        // bool dec11,
        // bool dec12,
        // bool dec13,
        // bool dec14,
        // bool dec15
        onlyGateway
    {
        // On récupère les paires [i1, j1, i2, j2, ... iN, jN] qu'on avait stockées
        uint256[] memory pairs = getParamsUint256(requestID);

        uint256 nPairs = pairs.length / 2;

        // On place tous les bools de la signature dans un array local
        // pour pouvoir itérer plus facilement
        bool[8] memory results = [
            dec0,
            dec1,
            dec2,
            dec3,
            dec4,
            dec5,
            dec6,
            dec7

        ];

        // Pour chaque comparaison, on stocke le résultat en clair, et
        // on fait le swap si nécessaire
        for (uint256 k = 0; k < nPairs; k++) {
            bool res = results[k];
            uint256 iIdx = pairs[2 * k];
            uint256 jIdx = pairs[2 * k + 1];

            // On enregistre la valeur déchiffrée
            decryptedComparaisons[getComparisonKey(iIdx, jIdx)] = res;

            // Swap si nécessaire
            if (res) {
                uint256 temp = bidsIndexs[jIdx];
                bidsIndexs[jIdx] = bidsIndexs[iIdx];
                bidsIndexs[iIdx] = temp;
            }
        }

        // Fin !
    }

    /// @dev packPairs([i1, j1, i2, j2, ..., iN, jN]) => uint256
    function packPairs(uint8[] memory pairs) internal pure returns (uint256 packed) {
        // On veut stocker 2*N indices (puisque pairs.length doit être pair)
        // i.e. pairs.length <= 32 => max 16 paires
        require(pairs.length % 2 == 0, "pairs.length must be even");
        require(pairs.length <= 32, "Cannot fit more than 16 pairs in 256 bits");

        // Au fur et à mesure, on déplace le 'packed' de 8 bits et on insère pairs[i]
        // Ex: si pairs = [i1, j1, i2, j2], on aura dans packed (en binaire):
        //   [i1, j1, i2, j2] (chaque élément = 1 octet)
        for (uint256 i = 0; i < pairs.length; i++) {
            packed = (packed << 8) | uint256(pairs[i]);
        }
    }

    function unpackPairs(uint256 packed, uint256 nPairs) internal pure returns (uint8[] memory) {
        // On va recréer un tableau [i1, j1, i2, j2, ..., iN, jN]
        uint8[] memory pairs = new uint8[](2 * nPairs);

        // On relit depuis la droite (bits de poids faible) dans l'ordre inverse
        // pour reconstituer le tableau dans le même ordre qu’au départ.
        for (uint256 i = 0; i < 2 * nPairs; i++) {
            // Extraire l’octet de droite
            pairs[2 * nPairs - 1 - i] = uint8(packed & 0xFF);
            // Décaler
            packed >>= 8;
        }
        return pairs;
    }

    function requestCompareOnePair(uint256 smallerID, uint256 biggerID) public {
        uint256[] memory cts = new uint256[](1);
        uint256 key = getComparisonKey(bidsIndexs[smallerID], bidsIndexs[biggerID]);
        cts[0] = Gateway.toUint256(encryptedComparaisons[key]);

        // console.log("*****SWAP: ", bidsIndexs[smallerID], ", ", bidsIndexs[biggerID]);
        // console.log("Encrypted Comparison for key ", key, ": ", cts[0]);

        uint256 requestID = Gateway.requestDecryption(
            cts,
            this.compareOnePairCallback.selector,
            0,
            block.timestamp + 100,
            false
        );

        // console.log("-------key: ", key);
        // console.log("-------requestID: ", requestID);

        addParamsUint256(requestID, smallerID);
        addParamsUint256(requestID, biggerID);
    }

    function compareOnePairCallback(uint256 requestID, bool result) public onlyGateway returns (bool) {
        uint256[] memory params = getParamsUint256(requestID);
        uint256 smallerID = params[0];
        uint256 biggerID = params[1];

        // console.log("Callback invoked for requestID: ", requestID);
        // console.log("Decryption result: ", result);

        decryptedComparaisons[getComparisonKey(smallerID, biggerID)] = result;

        //swap the indexs
        if (result) {
            uint256 temp = bidsIndexs[biggerID];
            bidsIndexs[biggerID] = bidsIndexs[smallerID];
            bidsIndexs[smallerID] = temp;
        }

        return result;
    }

    function getComparisonKey(uint256 smallerID, uint256 biggerID) public pure returns (uint256) {
        // Always pack smaller first, bigger second
        // return keccak256(abi.encodePacked(smallerID, biggerID));
        uint256 result = (smallerID + biggerID) + (smallerID * biggerID);
        return result;
    }

    function requestDecryptComparisons() public {
        // 1) Suppose we have two ebool ciphertexts from somewhere (for demonstration, trivial):
        ebool c0 = TFHE.asEbool(true);
        ebool c1 = TFHE.asEbool(false);

        TFHE.allowThis(c0);
        TFHE.allowThis(c1);

        // 2) Convert them to the raw handles
        uint256[] memory cts = new uint256[](2);
        cts[0] = Gateway.toUint256(c0);
        cts[1] = Gateway.toUint256(c1);

        console.log("latestRequestID", latestRequestID);
        // 3) Ask the helper to do the decryption request
        latestRequestID = decryptionHelper.requestComparisons(cts);

        // Possibly store the requestID if you want to later read from helper
        // or if the helper calls you back, you can track it that way.
    }

    /**
     * @notice Get the bid data of a specific index
     * @dev Can be used in a reencryption request.
     * @param index The ID of the bid.
     * @return The encrypted BidData struct.
     */
    function getBid(uint256 index) external view returns (BidData memory) {
        return bids[index];
    }

    /**
     * @notice Retrieve a BidOutPut by its index in bidAccounts array
     * @param index Index in the bidAccounts array
     * @return The corresponding BidOutPut struct
     */
    function getBidOutput(uint256 index) public view returns (BidOutPut memory) {
        require(index < bidAccounts.length, "Index out of bounds");
        address account = bidAccounts[index];
        return bidsOutput[account];
    }

    /**
     * @notice Get the total number of bids
     * @return The length of the bidAccounts array
     */
    function getTotalBidAccounts() public view returns (uint256) {
        return bidAccounts.length;
    }

    /**
     * @notice Manually stop the auction
     * @dev Can only be called by the owner and if the auction is stoppable
     */
    function stop() external onlyOwner {
        require(stoppable);
        manuallyStopped = true;
    }

    /**
     * @notice Transfer the final bid amount to the bidder
     * @dev Can only be called once after the auction ends
     */
    function claim() public onlyAfterEnd {
        BidOutPut storage bidOutput = bidsOutput[msg.sender];
        require(bidOutput.canClaim, "Bid already claimed or user cannot claim");
        bidOutput.canClaim = false;
        euint64 amount = TFHE.mul(bidOutput.eQuantity, settlementPrice);
        TFHE.allowTransient(amount, address(tokenContract));
        tokenContract.transfer(msg.sender, amount);
    }

    /**
     * @notice Withdraw the difference between deposit and final amount
     * @dev Must call `claim` before being allowed to withdraw
     */
    function withdraw() public onlyAfterEnd {
        BidOutPut memory bidOutput = bidsOutput[msg.sender];
        require(bidOutput.canClaim, "Bid must be claimed before withdraw");
        euint64 amount = TFHE.mul(bidOutput.eQuantity, settlementPrice);
        euint64 result = TFHE.sub(bidOutput.eDeposit, amount);
        TFHE.allowTransient(amount, address(tokenContract));
        tokenContract.transfer(msg.sender, result);
    }

    /**
     * @notice Checks if a new bid is better than the existing one
     * @dev Compares the new bid with the old bid
     * @param oldBidAmount The amount (price*quantity) of the existing (old) bid
     * @param newBidAmount The amount (price*quantity) of the new bid
     * @return Returns `true` if the new bid is better (higher and not equal), otherwise `false`
     */
    function _isBetterBid(euint64 oldBidAmount, euint64 newBidAmount) internal returns (ebool) {
        ebool isHigherPrice = TFHE.gt(newBidAmount, oldBidAmount);
        ebool notEqual = TFHE.ne(newBidAmount, oldBidAmount);
        return TFHE.and(notEqual, isHigherPrice);
    }

    // ------------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------------

    modifier onlyBeforeEnd() {
        if (block.timestamp >= endTime || manuallyStopped == true) revert TooLate(endTime);
        _;
    }

    modifier onlyAfterEnd() {
        if (block.timestamp < endTime && manuallyStopped == false) revert TooEarly(endTime);
        _;
    }
}

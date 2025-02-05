// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";
import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/ConfidentialERC20.sol";

contract ConfidentialTokensAuctionAlternative is
    SepoliaZamaFHEVMConfig,
    Ownable2Step,
    SepoliaZamaGatewayConfig,
    GatewayCaller
{
    // Auction parameters
    uint256 public endTime;
    uint64 public totalTokens;
    uint8 public immutable MAX_BIDS;
    euint64 public minBidPrice; // Minimum acceptable bid (encrypted)
    ConfidentialERC20 public tokenContract;
    euint64 public settlementPrice; // Settlement price (encrypted)
    uint64 public decryptedSettlementPrice;
    bool public isSettlementPriceDecrypted;

    // Bid storage
    struct BidData {
        address account;
        euint64 ePrice;
        euint64 eQuantity;
        euint64 eRemain;
    }
    mapping(uint8 => BidData) public bids;
    uint8 public bidCounter;

    // Cache bid validity (true if bid's ePrice >= minBidPrice)
    mapping(uint8 => ebool) public bidValidity;

    // Allocated quantities for each bid
    mapping(uint8 => euint64) public allocatedQuantity;

    // Batch allocation state
    uint8 public allocationIndex;
    bool public globalOfferExceedsDemand;

    // Custom errors
    error TooEarly(uint256 time);
    error TooLate(uint256 time);

    modifier onlyBeforeEnd() {
        if (block.timestamp >= endTime) revert TooLate(endTime);
        _;
    }
    modifier onlyAfterEnd() {
        if (block.timestamp < endTime) revert TooEarly(endTime);
        _;
    }

    constructor(
        ConfidentialERC20 _tokenContract,
        uint64 _totalTokens,
        uint256 biddingTime,
        uint256 _minBidPrice
    ) Ownable(msg.sender) {
        tokenContract = _tokenContract;
        endTime = block.timestamp + biddingTime;
        totalTokens = _totalTokens;
        MAX_BIDS = 32;
        bidCounter = 0;

        minBidPrice = TFHE.asEuint64(_minBidPrice);
        TFHE.allowThis(minBidPrice);

        settlementPrice = TFHE.asEuint64(0);
        TFHE.allowThis(settlementPrice);
        isSettlementPriceDecrypted = false;

        allocationIndex = 0;
    }

    function placeBid(
        einput encryptedPrice,
        einput encryptedQuantity,
        bytes calldata inputProof
    ) external onlyBeforeEnd {
        euint64 price = TFHE.asEuint64(encryptedPrice, inputProof);
        euint64 quantity = TFHE.asEuint64(encryptedQuantity, inputProof);
        TFHE.allowThis(price);
        TFHE.allowThis(quantity);
        TFHE.allow(price, msg.sender);
        TFHE.allow(quantity, msg.sender);

        euint64 amountToLock = TFHE.mul(price, quantity);
        TFHE.allowThis(amountToLock);
        TFHE.allow(amountToLock, msg.sender); // for claim and withdraw

        TFHE.allowTransient(amountToLock, address(tokenContract));
        tokenContract.transferFrom(msg.sender, address(this), amountToLock);

        ebool valid = TFHE.ge(price, minBidPrice);
        TFHE.allowThis(valid);
        bidValidity[bidCounter] = valid;

        bids[bidCounter] = BidData({
            account: msg.sender,
            ePrice: price,
            eQuantity: quantity,
            eRemain: TFHE.asEuint64(0)
        });
        bidCounter++;
    }

    function getBid(uint8 index) external view returns (BidData memory) {
        return bids[index];
    }

    function finalize() external onlyOwner onlyAfterEnd {
        euint64 eTotalOffer = TFHE.asEuint64(0);
        for (uint8 i = 0; i < bidCounter; i++) {
            euint64 qtyContribution = TFHE.select(bidValidity[i], bids[i].eQuantity, TFHE.asEuint64(0));
            eTotalOffer = TFHE.add(eTotalOffer, qtyContribution);
        }
        // TFHE.allowThis(eTotalOffer);
        ebool isMoreOfferEnc = TFHE.ge(totalTokens, eTotalOffer);
        TFHE.allowThis(isMoreOfferEnc);
        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(isMoreOfferEnc);
        Gateway.requestDecryption(cts, this.allocationCallback.selector, 0, block.timestamp + 100, false);
    }

    // Callback for decryption of the global offer test.
    function allocationCallback(uint256, bool isMoreOfferThanDemand) external onlyGateway {
        globalOfferExceedsDemand = isMoreOfferThanDemand;
        allocationIndex = 0;
    }

    // Compute eRemain for each bid (used when total offer <= demand)
    function assignERemain() external {
        for (uint8 i = 0; i < bidCounter; ++i) {
            BidData storage currentBid = bids[i];
            euint64 eBidsBefore_i = TFHE.asEuint64(0);
            for (uint8 j = 0; j < bidCounter; ++j) {
                if (j == i) continue;
                BidData storage bidJ = bids[j];
                ebool cond1 = TFHE.gt(bidJ.ePrice, currentBid.ePrice);
                ebool cond2 = TFHE.and(TFHE.eq(bidJ.ePrice, currentBid.ePrice), j < i); //FIFO
                ebool combinedCond = TFHE.or(cond1, cond2);
                eBidsBefore_i = TFHE.add(eBidsBefore_i, TFHE.select(combinedCond, bidJ.eQuantity, TFHE.asEuint64(0)));
            }
            eBidsBefore_i = TFHE.min(eBidsBefore_i, totalTokens);
        }
    }

    function allocateBatch(uint8 _batchSize) external onlyOwner onlyAfterEnd {
        if (globalOfferExceedsDemand) {
            euint64 eMarketPrice = TFHE.asEuint64(type(uint64).max);
            euint64 eTotalAllocated = TFHE.asEuint64(0);
            for (uint8 i = allocationIndex; i < bidCounter; i++) {
                ebool isValid = bidValidity[i];
                euint64 allocated = TFHE.select(isValid, bids[i].eQuantity, TFHE.asEuint64(0));
                allocatedQuantity[i] = allocated;
                ebool shouldUpdatePrice = TFHE.and(isValid, TFHE.gt(allocated, TFHE.asEuint64(0)));
                eMarketPrice = TFHE.select(shouldUpdatePrice, TFHE.min(eMarketPrice, bids[i].ePrice), eMarketPrice);
                eTotalAllocated = TFHE.add(eTotalAllocated, allocated);
            }
            settlementPrice = eMarketPrice;
            TFHE.allowThis(settlementPrice);
            allocationIndex = bidCounter;
        } else {
            require(allocationIndex <= bidCounter, "Allocation complete");
            uint8 start = allocationIndex;
            uint8 end = (allocationIndex + _batchSize) > bidCounter ? bidCounter : allocationIndex + _batchSize;
            euint64 eBatchPrice = TFHE.asEuint64(type(uint64).max);
            for (uint8 i = start; i < end; i++) {
                ebool isValid = bidValidity[i];
                euint64 eRemain_i = bids[i].eRemain;
                euint64 allocated = TFHE.select(isValid, TFHE.min(bids[i].eQuantity, eRemain_i), TFHE.asEuint64(0));
                allocatedQuantity[i] = allocated;
                ebool shouldUpdatePrice = TFHE.gt(allocated, TFHE.asEuint64(0));
                eBatchPrice = TFHE.select(shouldUpdatePrice, TFHE.min(eBatchPrice, bids[i].ePrice), eBatchPrice);
            }
            settlementPrice = TFHE.select(
                TFHE.eq(settlementPrice, TFHE.asEuint64(0)),
                eBatchPrice,
                TFHE.min(settlementPrice, eBatchPrice)
            );
            allocationIndex = end;
        }
        TFHE.allowThis(settlementPrice);
    }

    // Callback for settlement price decryption.
    function callbackSettlementPrice(uint256, uint64 decryptedInput) public onlyGateway {
        decryptedSettlementPrice = decryptedInput;
        isSettlementPriceDecrypted = true;
    }
}

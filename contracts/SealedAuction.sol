// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "hardhat/console.sol";

import { ConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/ConfidentialERC20.sol";

contract SealedAuction is SepoliaZamaFHEVMConfig, Ownable2Step, SepoliaZamaGatewayConfig, GatewayCaller {
    // Auction parameters
    uint256 public endTime;
    uint64 public supply;
    uint64 public immutable MAX_BIDS;
    uint64 public immutable MAX_BIDS_PER_ADDRESS;
    ConfidentialERC20 public token;
    uint64 public bidCount;

    // Price and quantity constraints
    euint64 public eMinPrice;
    euint64 public eMinQty;

    // Renamed for clarity
    euint64 public eSettlementPrice;
    uint64 public decryptedPrice;
    bool public isDecPrice;

    // Improved naming for bids tracking
    struct Bid {
        address bidder;
        euint64 eBidPrice;
        euint64 eBidQty;
        ebool isValid;
    }
    mapping(uint64 => Bid) public bids;
    mapping(address => uint64) public bidsPerAddress;

    // Renamed for better understanding
    mapping(uint64 => euint64) public eCumulativeBetterBids;

    // Allocation outcomes
    struct Outcome {
        euint64 eAllocatedQty;
        euint64 eTotalDeposit;
        bool canClaim;
    }
    mapping(address => Outcome) private outcomes;

    // Auction state
    uint64 public allocIndex;
    uint64 public compIndex;
    bool public isOverDemand;

    euint128 private eTotalOffer;

    error TooEarly(uint256 time);
    error TooLate(uint256 time);
    error MaxBidsExceeded();
    error InvalidMinPrice();
    error InvalidMinQty();

    modifier onlyBeforeEnd() {
        if (block.timestamp >= endTime) revert TooLate(endTime);
        _;
    }

    modifier onlyAfterEnd() {
        if (block.timestamp < endTime) revert TooEarly(endTime);
        _;
    }

    modifier onlyWhenPriceDecrypted() {
        require(isDecPrice, "Settlement price not yet decrypted");
        _;
    }

    constructor(
        ConfidentialERC20 _token,
        uint64 _supply,
        uint256 biddingTime,
        uint64 _minPrice,
        uint64 _minQty,
        uint64 _maxBidsPerAddress
    ) Ownable(msg.sender) {
        if (_minPrice <= 0) revert InvalidMinPrice();
        if (_minQty <= 0) revert InvalidMinQty();

        token = _token;
        endTime = block.timestamp + biddingTime;
        supply = _supply;
        MAX_BIDS = 32;
        MAX_BIDS_PER_ADDRESS = _maxBidsPerAddress;
        bidCount = 0;

        eMinPrice = TFHE.asEuint64(_minPrice);
        eMinQty = TFHE.asEuint64(_minQty);
        TFHE.allowThis(eMinPrice);
        TFHE.allowThis(eMinQty);

        eSettlementPrice = eMinPrice;
        decryptedPrice = 0;
        isDecPrice = false;

        eTotalOffer = TFHE.asEuint128(0);
        TFHE.allowThis(eTotalOffer);
    }

    function placeBid(einput encPrice, einput encQty, bytes calldata proof) external onlyBeforeEnd {
        if (bidsPerAddress[msg.sender] >= MAX_BIDS_PER_ADDRESS) revert MaxBidsExceeded();

        euint64 price = TFHE.asEuint64(encPrice, proof);
        euint64 qty = TFHE.asEuint64(encQty, proof);

        TFHE.allowThis(price);
        TFHE.allowThis(qty);
        TFHE.allow(price, msg.sender);
        TFHE.allow(qty, msg.sender);

        // Combined validity check for both price and quantity
        ebool priceValid = TFHE.ge(price, eMinPrice);
        ebool qtyValid = TFHE.ge(qty, eMinQty);
        ebool isValid = TFHE.and(priceValid, qtyValid);
        TFHE.allowThis(isValid);

        euint64 eDeposit = TFHE.mul(price, qty);
        TFHE.allowThis(eDeposit);
        TFHE.allow(eDeposit, msg.sender);

        Outcome storage o = outcomes[msg.sender];
        o.eTotalDeposit = TFHE.add(o.eTotalDeposit, eDeposit);
        o.canClaim = false;
        o.eAllocatedQty = TFHE.asEuint64(0);
        TFHE.allowThis(o.eAllocatedQty);
        TFHE.allow(o.eAllocatedQty, msg.sender);
        TFHE.allowThis(o.eTotalDeposit);
        TFHE.allow(o.eTotalDeposit, msg.sender);

        bids[bidCount] = Bid({ bidder: msg.sender, eBidPrice: price, eBidQty: qty, isValid: isValid });

        bidsPerAddress[msg.sender]++;
        bidCount++;

        eTotalOffer = TFHE.select(isValid, TFHE.add(eTotalOffer, qty), eTotalOffer);
        TFHE.allowThis(eTotalOffer);

        TFHE.allowTransient(eDeposit, address(token));
        token.transferFrom(msg.sender, address(this), eDeposit);
    }

    function finalize() external onlyOwner onlyAfterEnd {
        ebool eIsOverDemand = TFHE.ge(eTotalOffer, supply);
        TFHE.allowThis(eIsOverDemand);
        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(eIsOverDemand);
        Gateway.requestDecryption(cts, this.allocationCallback.selector, 0, block.timestamp + 100, false);
    }

    function allocationCallback(uint256, bool result) external onlyGateway {
        isOverDemand = result;
    }

    function computeBidsBefore(uint64 batchSize) external onlyOwner onlyAfterEnd {
        require(isOverDemand, "No partial computation needed");
        uint64 start = compIndex;
        uint64 end = (start + batchSize > bidCount) ? bidCount : start + batchSize;

        for (uint64 i = start; i < end; i++) {
            euint64 sumBefore = TFHE.asEuint64(0);
            for (uint64 j = 0; j < bidCount; j++) {
                if (j == i) continue;
                // Only consider valid bids in comparison
                ebool isValidAndBetter = TFHE.or(
                    TFHE.and(bids[j].isValid, TFHE.gt(bids[j].eBidPrice, bids[i].eBidPrice)),
                    TFHE.and(
                        TFHE.and(bids[j].isValid, TFHE.eq(bids[j].eBidPrice, bids[i].eBidPrice)),
                        TFHE.asEbool(j < i)
                    )
                );
                euint64 addQty = TFHE.select(isValidAndBetter, bids[j].eBidQty, TFHE.asEuint64(0));
                sumBefore = TFHE.add(sumBefore, addQty);
            }
            eCumulativeBetterBids[i] = TFHE.min(sumBefore, supply);
            TFHE.allowThis(eCumulativeBetterBids[i]);
        }
        compIndex = end;
    }

    function allocateBids(uint64 batchSize) external onlyOwner onlyAfterEnd {
        require(allocIndex <= bidCount, "Allocation completed");
        uint64 start = allocIndex;
        uint64 end = (allocIndex + batchSize > bidCount) ? bidCount : allocIndex + batchSize;

        // Only first time use the max
        euint64 eMarketPrice = (allocIndex == 0) ? TFHE.asEuint64(type(uint64).max) : eSettlementPrice;

        if (!isOverDemand) {
            for (uint64 i = start; i < end; i++) {
                Bid storage b = bids[i];
                outcomes[b.bidder].eAllocatedQty = TFHE.select(b.isValid, b.eBidQty, TFHE.asEuint64(0));
                TFHE.allowThis(outcomes[b.bidder].eAllocatedQty);
                outcomes[b.bidder].canClaim = true;
                eMarketPrice = TFHE.select(b.isValid, TFHE.min(eMarketPrice, b.eBidPrice), eMarketPrice);
            }
        } else {
            for (uint64 i = start; i < end; i++) {
                Bid storage b = bids[i];
                ebool canSell = TFHE.and(TFHE.lt(eCumulativeBetterBids[i], supply), b.isValid);

                euint64 eSold = TFHE.select(
                    canSell,
                    TFHE.min(b.eBidQty, TFHE.sub(supply, eCumulativeBetterBids[i])),
                    TFHE.asEuint64(0)
                );

                TFHE.allowThis(eSold);
                outcomes[b.bidder].eAllocatedQty = eSold;
                outcomes[b.bidder].canClaim = true;
                eMarketPrice = TFHE.select(canSell, TFHE.min(eMarketPrice, b.eBidPrice), eMarketPrice);
            }
        }
        eSettlementPrice = eMarketPrice;
        allocIndex = end;
        TFHE.allowThis(eSettlementPrice);

        //Decrypt the settlement price if necessary
        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(eSettlementPrice);
        Gateway.requestDecryption(cts, this.callbackSettlementPrice.selector, 0, block.timestamp + 100, false);
    }

    function callbackSettlementPrice(uint256, uint64 result) external onlyGateway {
        decryptedPrice = result;
        isDecPrice = true;
    }

    function claim() external onlyAfterEnd onlyWhenPriceDecrypted {
        Outcome storage o = outcomes[msg.sender];
        require(o.canClaim, "Bid already claimed or cannot claim");
        o.canClaim = false;
        euint64 totalCost = TFHE.mul(o.eAllocatedQty, decryptedPrice);
        //compute the refund
        o.eTotalDeposit = TFHE.sub(o.eTotalDeposit, totalCost);
        TFHE.allowThis(o.eTotalDeposit);
        TFHE.allowTransient(totalCost, address(token));
        token.transfer(msg.sender, totalCost);
    }

    function withdraw() external onlyAfterEnd onlyWhenPriceDecrypted {
        Outcome storage o = outcomes[msg.sender];
        require(!o.canClaim, "Bid must be claimed before withdrawal");
        euint64 refund = o.eTotalDeposit;
        o.eTotalDeposit = TFHE.asEuint64(0);
        TFHE.allowTransient(refund, address(token));
        token.transfer(msg.sender, refund);
    }
}

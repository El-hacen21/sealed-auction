// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "hardhat/console.sol"; // for debug
import { IConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/IConfidentialERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract SealedAuction is
    SepoliaZamaFHEVMConfig,
    Ownable2Step,
    SepoliaZamaGatewayConfig,
    ReentrancyGuardTransient,
    GatewayCaller
{
    // Auction parameters
    uint256 public endTime;
    uint64 public supply;
    // uint64 public immutable MAX_BIDS;
    uint64 public immutable MAX_BIDS_PER_ADDRESS;

    address public constant OFFICIAL_FACTORY = address(0xb4e45cEB442932EA2aE441e7573CA1B8233a3285);

    // assetToken is locked on creation; paymentToken is used for bids.
    IConfidentialERC20 public assetToken;
    IConfidentialERC20 public paymentToken;

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
        euint64 ePenalty;
        bool canClaim;
    }

    euint64 public ePenaltyFee; // 1 Ether par exemple
    // Global running total of penalty fees collected from invalid bids.
    euint64 private eTotalPenaltyFees;

    mapping(address => Outcome) public outcomes;

    // Auction state
    uint64 public allocIndex;
    uint64 public compIndex;
    bool public isDemandOverSupply;

    euint64 private eTotalDemand;

    bool private ownerHasWithdrawn;

    error TooEarly(uint256 time);
    error TooLate(uint256 time);
    error MaxBidsExceeded();

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
        address auctionOwner,
        IConfidentialERC20 _assetToken,
        IConfidentialERC20 _paymentToken,
        uint64 _supply,
        uint256 biddingTime,
        uint64 _minPrice,
        uint64 _minQty,
        uint64 _maxBidsPerAddress,
        uint64 _penaltyFee
    ) Ownable(auctionOwner) {
        // require(msg.sender == OFFICIAL_FACTORY, "Must be deployed via factory");
        assetToken = _assetToken;
        paymentToken = _paymentToken;

        endTime = block.timestamp + biddingTime;
        supply = _supply;

        MAX_BIDS_PER_ADDRESS = _maxBidsPerAddress;
        bidCount = 0;

        eMinPrice = TFHE.asEuint64(_minPrice);
        eMinQty = TFHE.asEuint64(_minQty);
        TFHE.allowThis(eMinPrice);
        TFHE.allowThis(eMinQty);

        eSettlementPrice = TFHE.asEuint64(0);
        decryptedPrice = 0;
        isDecPrice = false;

        eTotalDemand = TFHE.asEuint64(0);
        TFHE.allowThis(eTotalDemand);

        ownerHasWithdrawn = false;

        // Initialize global total penalty fees to 0.
        eTotalPenaltyFees = TFHE.asEuint64(0);
        TFHE.allowThis(eTotalPenaltyFees);

        ePenaltyFee = TFHE.asEuint64(_penaltyFee);
        TFHE.allowThis(ePenaltyFee);
    }

    function placeBid(einput encPrice, einput encQty, bytes calldata proof) external nonReentrant onlyBeforeEnd {
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

        euint64 eDeposit = TFHE.add(TFHE.mul(price, qty), ePenaltyFee);
        TFHE.allowThis(eDeposit);
        TFHE.allow(eDeposit, msg.sender);
        TFHE.allowTransient(eDeposit, address(paymentToken));
        require(paymentToken.transferFrom(msg.sender, address(this), eDeposit), "Payment transfer failed");

        Outcome storage o = outcomes[msg.sender];
        o.canClaim = false;
        o.eAllocatedQty = TFHE.asEuint64(0);
        if (TFHE.isInitialized(o.ePenalty)) {
            o.ePenalty = TFHE.select(isValid, TFHE.asEuint64(0), TFHE.add(o.ePenalty, ePenaltyFee));
            o.eTotalDeposit = TFHE.add(o.eTotalDeposit, eDeposit);
        } else {
            o.eTotalDeposit = eDeposit;
            o.ePenalty = TFHE.select(isValid, TFHE.asEuint64(0), ePenaltyFee);
        }
        TFHE.allowThis(o.ePenalty);
        TFHE.allowThis(o.eAllocatedQty);
        TFHE.allowThis(o.eTotalDeposit);
        TFHE.allow(o.eAllocatedQty, msg.sender);
        TFHE.allow(o.eTotalDeposit, msg.sender);
        TFHE.allow(o.ePenalty, msg.sender);

        bids[bidCount] = Bid({ bidder: msg.sender, eBidPrice: price, eBidQty: qty, isValid: isValid });

        bidsPerAddress[msg.sender]++;
        bidCount++;

        eTotalDemand = TFHE.select(isValid, TFHE.add(eTotalDemand, qty), eTotalDemand);
        TFHE.allowThis(eTotalDemand);

        eTotalPenaltyFees = TFHE.add(eTotalPenaltyFees, o.ePenalty);
        TFHE.allowThis(eTotalPenaltyFees);
    }

    function finalize() external onlyOwner onlyAfterEnd {
        if (bidCount == 0) {
            isDecPrice = true;
            decryptedPrice = 0;
            return;
        }
        ebool eDemandOverSupply = TFHE.ge(eTotalDemand, supply);
        TFHE.allowThis(eDemandOverSupply);
        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(eDemandOverSupply);
        Gateway.requestDecryption(cts, this.allocationCallback.selector, 0, block.timestamp + 100, false);
    }

    function allocationCallback(uint256, bool result) external onlyGateway {
        isDemandOverSupply = result;
    }

    /**
     * @dev Pre-computes cumulative quantities of higher/earlier bids for each bid in batch.
     * - For each bid in the batch, calculates sum of quantities from valid bids that:
     *   1. Have higher bid price than current bid, OR
     *   2. Same price but submitted earlier (using bid index)
     * - Stores results in eCumulativeBetterBids to determine supply allocation priority.
     * - Required when demand > supply to establish cutoff point for allocations.
     * @param batchSize Number of bids to process in this batch
     */
    function computeBidsBefore(uint64 batchSize) external onlyOwner onlyAfterEnd {
        require(isDemandOverSupply && bidCount > 0, "No need to call computeBidsBefore");
        uint64 start = compIndex;
        uint64 end = (start + batchSize > bidCount) ? bidCount : start + batchSize;

        for (uint64 i = start; i < end; i++) {
            // Initialize the cumulative quantity of better bids for bid i.
            euint64 sumBefore = TFHE.asEuint64(0);
            for (uint64 j = 0; j < bidCount; j++) {
                if (j == i) continue;
                ebool isValidAndBetter;
                if (j < i) {
                    // For j < i: A bid is considered "better" if it is valid and its price is
                    // greater than or equal to the price of bid i (covering the case of equality since j < i).
                    isValidAndBetter = TFHE.and(bids[j].isValid, TFHE.ge(bids[j].eBidPrice, bids[i].eBidPrice));
                } else {
                    // j > i
                    // For j > i: A bid is considered "better" only if it is valid
                    // and its price is strictly greater than bid i's price.
                    isValidAndBetter = TFHE.and(bids[j].isValid, TFHE.gt(bids[j].eBidPrice, bids[i].eBidPrice));
                }
                euint64 addQty = TFHE.select(isValidAndBetter, bids[j].eBidQty, TFHE.asEuint64(0));
                sumBefore = TFHE.add(sumBefore, addQty);
            }
            eCumulativeBetterBids[i] = TFHE.min(sumBefore, supply);
            TFHE.allowThis(eCumulativeBetterBids[i]);
        }
        compIndex = end;
    }

    /**
     * @dev Processes bid allocations in batches, determining final settlement price.
     * Two allocation modes:
     * 1. Demand <= Supply: All valid bids fully allocated. Settlement price = minimum bid price.
     * 2. Demand > Supply: Bids allocated based on:
     *    - Priority given to higher prices (using precomputed eCumulativeBetterBids)
     *    - Settlement price becomes highest price where cumulative allocations <= supply
     * Updates eSettlementPrice with the clearing price and initiates decryption.
     * @param batchSize Number of bids to process in this batch
     */
    function allocateBids(uint64 batchSize) external onlyOwner onlyAfterEnd {
        require(allocIndex <= bidCount && bidCount > 0, "Allocation completed");
        uint64 start = allocIndex;
        uint64 end = (allocIndex + batchSize > bidCount) ? bidCount : allocIndex + batchSize;

        // Only first time use the max
        euint64 eMarketPrice = (allocIndex == 0) ? TFHE.asEuint64(type(uint64).max) : eSettlementPrice;

        if (!isDemandOverSupply) {
            for (uint64 i = start; i < end; i++) {
                Bid storage b = bids[i];
                outcomes[b.bidder].eAllocatedQty = TFHE.select(
                    b.isValid,
                    TFHE.add(outcomes[b.bidder].eAllocatedQty, b.eBidQty),
                    TFHE.asEuint64(0)
                );

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
                outcomes[b.bidder].eAllocatedQty = TFHE.add(outcomes[b.bidder].eAllocatedQty, eSold);
                TFHE.allowThis(outcomes[b.bidder].eAllocatedQty);
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

    // nonReentrant for extra protection
    function claim() external onlyAfterEnd onlyWhenPriceDecrypted {
        Outcome storage o = outcomes[msg.sender];
        require(o.canClaim, "Bid already claimed or cannot claim");
        o.canClaim = false;

        //compute the refund
        o.eTotalDeposit = TFHE.sub(o.eTotalDeposit, TFHE.add(o.ePenalty, TFHE.mul(o.eAllocatedQty, decryptedPrice)));
        TFHE.allowThis(o.eTotalDeposit);
        TFHE.allowTransient(o.eAllocatedQty, address(assetToken));
        require(assetToken.transfer(msg.sender, o.eAllocatedQty), "Asset transfer failed");
        //withdraw
        TFHE.allowTransient(o.eTotalDeposit, address(paymentToken));
        require(paymentToken.transfer(msg.sender, o.eTotalDeposit), "Withdraw failed");
        //  o.eTotalDeposit = TFHE.asEuint64(0); not needed claim=false
    }

    // nonReentrant for extra protection
    function ownerWithdraw() external onlyOwner onlyAfterEnd nonReentrant onlyWhenPriceDecrypted {
        require(!ownerHasWithdrawn, "Owner already withdrawn");
        ownerHasWithdrawn = true;

        // Add the penalty fees collected from invalid bids.
        euint64 soldAmount = TFHE.add(TFHE.mul(eTotalDemand, decryptedPrice), eTotalPenaltyFees);

        if (!isDemandOverSupply) {
            //else all tokens are sold
            euint64 unsoldToken = TFHE.sub(supply, eTotalDemand);
            TFHE.allowTransient(unsoldToken, address(assetToken));
            require(assetToken.transfer(msg.sender, unsoldToken), "Asset transfer failed");
        }
        TFHE.allowTransient(soldAmount, address(paymentToken));
        require(paymentToken.transfer(msg.sender, soldAmount), "Payment transfer failed");
    }
}

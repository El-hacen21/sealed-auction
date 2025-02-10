// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import { ConfidentialWETH } from "fhevm-contracts/contracts/token/ERC20/ConfidentialWETH.sol";
import { IConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/IConfidentialERC20.sol";
import "hardhat/console.sol"; // for debug

import "./SealedAuction.sol";

enum TokenType {
    ERC20,
    Ether
}

contract SealedAuctionFactory is SepoliaZamaFHEVMConfig, Ownable {
    address[] public auctions;

    uint64 public constant DEFAULT_MAX_BIDS_PER_ADDRESS = 2;
    uint64 public constant DEFAULT_PENALTY_FEE = 50;

    // The asset token is always the default ERC20 token.
    IConfidentialERC20 public defaultAssetERC20;
    // The payment token depends on the user's choice.
    IConfidentialERC20 public defaultPaymentERC20;
    // Use ConfidentialWETH when payment is to be made in Ether.
    IConfidentialERC20 public defaultWETH;

    event AuctionCreated(address indexed auctionAddress, address indexed auctionOwner);

    error InvalidMinPrice();
    error InvalidMinQty();
    error InvalidSupply();

    constructor(
        IConfidentialERC20 _defaultAssetERC20,
        IConfidentialERC20 _defaultPaymentERC20,
        IConfidentialERC20 _defaultWETH
    ) Ownable(msg.sender) {
        defaultAssetERC20 = _defaultAssetERC20;
        defaultPaymentERC20 = _defaultPaymentERC20;
        defaultWETH = _defaultWETH;
    }

    // Allow the owner to update default tokens if needed.
    function setDefaultAssetERC20(IConfidentialERC20 token) external onlyOwner {
        defaultAssetERC20 = token;
    }

    function setDefaultPaymentERC20(IConfidentialERC20 token) external onlyOwner {
        defaultPaymentERC20 = token;
    }

    function setDefaultWETH(IConfidentialERC20 token) external onlyOwner {
        defaultWETH = token;
    }

    /// @notice Creates a new auction.
    /// @param auctionOwner The auction owner.
    /// @param supply The asset supply (in token units).
    /// @param biddingTime Auction duration (in seconds).
    /// @param minPrice Minimum bid price.
    /// @param minQty Minimum bid quantity.
    /// @param paymentType Whether the payment token is ERC20 or Ether.
    /// @dev For asset tokens the auction owner must have approved a transfer of supply from defaultAssetERC20.
    ///      For payment tokens, if Ether is chosen, the auction will use the ConfidentialWETH contract.
    function createAuction(
        address auctionOwner,
        uint64 supply,
        uint256 biddingTime,
        uint64 minPrice,
        uint64 minQty,
        TokenType paymentType
    ) external payable returns (address auctionAddress) {
        // Enforce that all parameters are strictly positive.
        if (minPrice == 0) revert InvalidMinPrice();
        if (minQty == 0) revert InvalidMinQty();
        if (supply == 0) revert InvalidSupply();

        // The asset token is fixed.
        IConfidentialERC20 assetToken = defaultAssetERC20;
        IConfidentialERC20 paymentToken;

        // Select the payment token based on the user's preference.
        if (paymentType == TokenType.ERC20) {
            paymentToken = defaultPaymentERC20;
        } else if (paymentType == TokenType.Ether) {
            paymentToken = defaultWETH;
            // (No Ether deposit or wrapping is needed here in the factory –
            //  the auction will later use paymentToken.transferFrom as usual.)
        } else {
            revert("Unsupported payment type");
        }

        // Create the auction with the selected tokens.
        SealedAuction auction = new SealedAuction(
            auctionOwner,
            assetToken,
            paymentToken,
            supply,
            biddingTime,
            minPrice,
            minQty,
            DEFAULT_MAX_BIDS_PER_ADDRESS,
            DEFAULT_PENALTY_FEE
        );
        auctionAddress = address(auction);

        // Transfer the asset tokens to the auction.
        // The auction owner must have approved this transfer from defaultAssetERC20.
        euint64 eSupply = TFHE.asEuint64(supply);
        TFHE.allowThis(eSupply);
        TFHE.allow(eSupply, auctionOwner);
        TFHE.allowTransient(eSupply, address(assetToken));
        require(assetToken.transferFrom(auctionOwner, auctionAddress, eSupply), "Asset token transfer failed");
        auctions.push(auctionAddress);
        emit AuctionCreated(auctionAddress, auctionOwner);
        return auctionAddress;
    }

    /// @notice Returns a batch of auctions for pagination.
    /// @param start The starting index.
    /// @param count The number of auctions to return.
    function getAuctions(uint256 start, uint256 count) external view returns (address[] memory) {
        uint256 total = auctions.length;
        if (start >= total) return new address[](0);
        uint256 end = start + count;
        if (end > total) end = total;
        uint256 len = end - start;
        address[] memory batch = new address[](len);
        for (uint256 i = 0; i < len; i++) {
            batch[i] = auctions[start + i];
        }
        return batch;
    }

    /// @notice Returns the total number of auctions.
    function getTotalAuctions() external view returns (uint256) {
        return auctions.length;
    }

    /// @notice Returns up to `count` active auctions (those with endTime in the future),
    ///         starting at index `start` in the auctions array.
    function getActiveAuctions(uint256 start, uint256 count) external view returns (address[] memory) {
        uint256 total = auctions.length;
        address[] memory temp = new address[](count);
        uint256 activeCount = 0;
        for (uint256 i = start; i < total && activeCount < count; i++) {
            SealedAuction auction = SealedAuction(auctions[i]);
            if (block.timestamp < auction.endTime()) {
                temp[activeCount] = auctions[i];
                activeCount++;
            }
        }
        address[] memory activeAuctions = new address[](activeCount);
        for (uint256 i = 0; i < activeCount; i++) {
            activeAuctions[i] = temp[i];
        }
        return activeAuctions;
    }

    /// @notice Returns the total number of active auctions.
    function getTotalActiveAuctions() external view returns (uint256) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < auctions.length; i++) {
            SealedAuction auction = SealedAuction(auctions[i]);
            if (block.timestamp < auction.endTime()) {
                activeCount++;
            }
        }
        return activeCount;
    }
}

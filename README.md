

# Sealed single price auction using Zama's fhEVM by El-Hacen Diallo & Matthieu Rambaud

This repository implements **confidential single-price auctions** using [Zama's FHEVM](https://docs.zama.ai/fhevm). Bidders submit **encrypted** prices and quantities for a batch of tokens, ensuring privacy on-chain. The final **single settlement price** is the **lowest** price required to sell the last token.

---

## Table of Contents

1. [Overview](#overview)  
2. [Global Architecture](#global-architecture)  
3. [Core Contracts](#core-contracts)  
   - [SealedAuction](#1-sealedauction)  
   - [SealedAuctionFactory](#2-sealedauctionfactory)  
4. [Workflow](#workflow)  
   - [1. Auction Creation](#1-auction-creation)  
   - [2. Placing Bids](#2-placing-bids)  
   - [3. Finalization & Allocation](#3-finalization--allocation)  
   - [4. Claims and Owner Withdrawal](#4-claims-and-owner-withdrawal)  
5. [Deployment & Usage](#deployment--usage)  
6. [Important Notes & Security](#important-notes--security)  
7. [Configuration](#configuration)  
8. [Development & Build](#development--build)  
9. [Documentation](#documentation)

---

## Overview

A **Single-Price Sealed Auction** is one where participants submit **encrypted bids** consisting of:
- The **quantity** of tokens (encrypted) they are willing to buy.
- The **maximum price** (encrypted) they are willing to pay per token.

The auction contract:
1. **Locks** the seller’s supply of the confidential ERC20 token.
2. Accepts sealed bids for a limited time (`biddingTime`).
3. Validates bids using FHE operations against minimum price/quantity constraints.
4. Computes a **single clearing price** that every winning bidder pays (the lowest successful price for the last token sold).
5. Refunds any leftover deposit to bidders who overpaid and returns unsold tokens to the seller if demand is under-subscribed.

> **Note**: To discourage invalid or excessively low bids, the contract can charge a **penalty fee** (`DEFAULT_PENALTY_FEE`). Such bids remain encrypted on-chain (`isValid` remains hidden), so the contract never explicitly reveals who placed an invalid bid.

---

## Global Architecture

```
                                 +-----------------------+
                                 |    SealedAuction     |
                                 |  (Main Auction Logic)|
                                 +----------+------------+
                                            |
                                            |   Created by
                                            |
+---------------------------+     +-----------------------+
|   Bidding Participants   | --> | SealedAuctionFactory |
|  (placing encrypted bids)|     | (Deploys SealedAuctions)
+---------------------------+     +----------+------------+
                                            |
             --------------------------------------------------------------------
             |                                                                 |
    (Payment ERC20 or Confidential WETH)                              (Asset ERC20)
    defaultPaymentERC20 / defaultWETH                           defaultAssetERC20 (Tokens sold)
```

1. **SealedAuction**  
   - Stores and processes encrypted bids, compares them homomorphically, determines the final single settlement price, and handles claims/refunds.

2. **SealedAuctionFactory**  
   - Deploys new `SealedAuction` contracts with consistent parameters (penalty fees, token addresses, etc.).
   - Ensures the asset tokens (`supply`) are locked when creating the auction.

---

## Core Contracts

### 1. `SealedAuction`

**Path**: [contracts/SealedAuction.sol](https://github.com/El-hacen21/confidential-tokens-auction/blob/main/contracts/SealedAuction.sol)  
**Role**: Manages a single instance of the auction, from bidding phase to final settlement.

**Key Variables**
- `endTime`: Deadline after which no new bids can be placed.  
- `supply`: Total tokens to be sold.  
- `assetToken`: Confidential ERC20 for the asset (seller’s tokens).  
- `paymentToken`: Confidential ERC20 or wrapped Ether (for bidder payments).  
- `eMinPrice`, `eMinQty`: Encrypted minimum price & quantity.  
- `eSettlementPrice`: The encrypted clearing price, decrypted later into `decryptedPrice`.  
- `bids`: A mapping of bid IDs to bid data (`eBidPrice`, `eBidQty`, and an encrypted boolean `isValid`).  
- `outcomes`: A mapping of bidder addresses to allocations, total deposits, penalties, etc.

> **Important**:  
> For production, uncomment the line:
> ```solidity
> require(msg.sender == OFFICIAL_FACTORY, "Must be deployed via factory");
> ```
> to ensure only the official factory can create this contract.

**Key Functions**

- **Constructor** – Initializes the auction (supply, penalty fee, etc.).  
- **`placeBid(einput encPrice, einput encQty, bytes calldata proof)`**  
  - Stores the bid, locking `price * qty + penaltyFee`. Checks validity with FHE operations.  
- **`finalize()`**  
  - Called by the auction owner after `endTime` to move to the settlement phase.  
- **`allocateBids(...)`, `computeBidsBefore(...)`**  
  - Process bids in batches to determine each bidder’s allocated tokens and the final clearing price.  
- **`claim()`**  
  - Bidders withdraw their tokens and any deposit refunds.  
- **`ownerWithdraw()`**  
  - Owner claims proceeds (sold tokens * settlement price + penalties) and unsold tokens (if any).

### 2. `SealedAuctionFactory`

**Path**: [contracts/SealedAuctionFactory.sol](https://github.com/El-hacen21/confidential-tokens-auction/blob/main/contracts/SealedAuctionFactory.sol)  
**Role**: Central contract for deploying `SealedAuction` instances in a standardized way.

**Key Variables**
- `auctions`: Addresses of all deployed auctions.  
- `defaultAssetERC20`, `defaultPaymentERC20`, `defaultWETH`: Default confidential tokens.  
- `DEFAULT_MAX_BIDS_PER_ADDRESS`, `DEFAULT_PENALTY_FEE`: Defaults for new auctions.

**Key Functions**

- **`createAuction(...)`**  
  1. Validates parameters (supply, minPrice, etc.).  
  2. Deploys a new `SealedAuction`.  
  3. Transfers `supply` from the owner to the newly created auction.  
  4. Emits `AuctionCreated`.

- **`getAuctions(...)`, `getActiveAuctions(...)`**  
  - Retrieve the list of auctions, filtered by active/inactive status.

---

## Workflow

### 1. Auction Creation

1. **Initialization**  
   - The seller (Alice) has `supply` tokens of a confidential ERC20 (`defaultAssetERC20`).  
   - Through a user interface or direct contract call, she calls `SealedAuctionFactory.createAuction(...)` specifying:
     - `auctionOwner`, `supply`, `biddingTime` (duration), `minPrice`, `minQty`, etc.
   - The factory deploys `SealedAuction` and **locks** Alice’s `supply` tokens inside it.

2. **Owner vs. Factory**  
   - In production, the `SealedAuction` constructor ensures only the factory can create auctions.  
   - For development, you may comment out `require(msg.sender == OFFICIAL_FACTORY, ...)` for direct testing.

### 2. Placing Bids

1. **Bidding Phase**  
   - The auction is open for a certain time: `biddingTime`.  
   - Each bidder can place **one or several** sealed bids, up to `MAX_BIDS_PER_ADDRESS`.  
   - A sealed bid includes:
     - Encrypted max price (`encPrice`).
     - Encrypted max quantity (`encQty`).  
   - Bidders must lock a deposit `encPrice * encQty + penaltyFee` (using FHE arithmetic).

2. **Validity & Penalties**  
   - If a bid is below the published `minPrice` or `minQty` (both stored in encrypted form), it is flagged internally as invalid (`isValid = 0`) but not revealed on-chain.  
   - A penalty may apply to invalid bids (`DEFAULT_PENALTY_FEE`).

3. **No Modification**  
   - Once placed, a bid cannot be modified before the auction ends.  
   - Bidders rely on their off-chain encryption to keep prices hidden from others.

### 3. Finalization & Allocation

1. **Settlement Phase**  
   - After `endTime`, only the owner can call `finalize()`.  
   - The contract checks if the total (encrypted) demand exceeds `supply`.  
   - If over-subscribed, the settlement price becomes the lowest among the valid bids needed to sell all tokens.  
   - The contract requests an off-chain decryption of `eSettlementPrice` after batch computations (`computeBidsBefore` & `allocateBids`).

2. **Revealing the Final Price**  
   - Once the settlement price is decrypted, each winner effectively pays that same price.  
   - Losers or invalid bidders can claim partial refunds minus penalties.

### 4. Claims and Owner Withdrawal

1. **Bidders (Claim)**  
   - Call `claim()` to receive the allocated quantity of tokens and to be refunded any excess deposit.  
   - Invalid or losing bids may forfeit part or all of their penalty fee.

2. **Owner (Withdrawal)**  
   - Calls `ownerWithdraw()` to collect the final proceeds:
     - **Settlement Price** * **Number of tokens sold**  
     - Total penalty fees.  
   - If under-subscribed, unsold tokens are returned to the owner.

---

### Test Output
Here, you can describe or show typical test results, any coverage reports, screenshots of logs, etc.

#### SealAuction test
![SealAuction test](https://github.com/El-hacen21/sealed-auction/blob/main/tests_output.png)


#### 100% test converage of SealedAuction.sol
![100% test converage of SealedAuction.sol](https://github.com/El-hacen21/sealed-auction/blob/main/coverage.png)


####  Gas cost
![Gas Test](https://github.com/El-hacen21/sealed-auction/blob/main/gas.png)


----

## Limitations & Ongoing Work

1. **ConfidentialWETH Payment Flow**  
   - Currently, the auction logic supports confidentialERC20 tokens for payment.  
   - We have partially prepared a flow for using ConfidentialWETH, but **this functionality has not been fully tested or finalized**.  
   - Ongoing development will focus on validating ConfidentialWETH transactions and ensuring compatibility.

2. **React Frontend Interface**  
   - A basic React interface has been set up for user interaction with the contracts, but additional features and UX improvements are still in progress.  
   - Future updates will provide a more user-friendly bidding process, real-time status updates, and extended error-handling.

We appreciate any feedback on these areas and are actively working to enhance and complete the above features.

---

## Deployment & Usage

1. **Install Dependencies**
   ```bash
   npm install     # or yarn install
   npm install fhevm fhevm-contracts @openzeppelin/contracts
   ```
2. **Compile**
   ```bash
   npm compile
   ```
3. **Tests**
   ```bash
   npm test
   ```
   - **Note**: For local testing, you can comment out:
     ```solidity
     // require(msg.sender == OFFICIAL_FACTORY, "Must be deployed via factory");
     ```
     in the `SealedAuction` constructor if you want to deploy it directly without the factory.

---

## Important Notes & Security

1. **Factory Enforcement**  
   - In production, **uncomment** the line:
     ```solidity
     require(msg.sender == OFFICIAL_FACTORY, "Must be deployed via factory");
     ```
     This prevents malicious actors from creating auctions with altered parameters.

2. **Penalty Fee**  
   - A default penalty for invalid/too-low bids helps deter spamming. Adjust `DEFAULT_PENALTY_FEE` as necessary.

3. **Batch Processing**  
   - If many bids exist, calls like `computeBidsBefore` and `allocateBids` can process them in batches to avoid gas limits.

---

## Configuration

Copy `.env.example` to `.env` and update the **gateway URL**, **ACL address**, and **KMS address** to match your FHEVM environment.

---

## Development & Build

- **Development Server**  
  ```bash
  npm run dev
  ```
  Access your local server at [http://localhost:5173](http://localhost:5173).


- **Build**  
  ```bash
  npm run build
  ```

---

## Documentation

For more details on `fhevmjs` and the Zama FHEVM, refer to [the official documentation](https://docs.zama.ai/fhevm).


// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";
import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ConfidentialERC20 } from "fhevm-contracts/contracts/token/ERC20/ConfidentialERC20.sol";

/// @title Confidential Tokens Auction – Version Allocation Alternative with Batch Finalization
/// @notice Cette version finalise l'enchère en deux étapes distinctes pour réduire le coût en gas :
///  1) Une première étape (finalizeAuctionAlternative) qui calcule globalement si la somme des offres dépasse la demande,
///     et qui déchiffre un booléen unique.
///  2) Une seconde étape (allocateBatch) qui répartit le calcul des allocations sur plusieurs transactions (traitement en batch).
contract ConfidentialTokensAuctionAlternative is
    SepoliaZamaFHEVMConfig,
    Ownable2Step,
    SepoliaZamaGatewayConfig,
    GatewayCaller
{
    // --------------------------------------------------
    // Auction Parameters and State
    // --------------------------------------------------
    uint256 public endTime;
    uint64 public totalTokens;
    uint8 public immutable MAX_BIDS;

    // Prix minimal accepté (chiffré) – pmin dans le pseudo‑code.
    euint64 public minBidPrice;

    ConfidentialERC20 public tokenContract;

    // Prix de règlement chiffré (sera déterminé dans la phase d’allocation)
    euint64 public settlementPrice;
    uint64 public decryptedSettlementPrice;
    bool public isSettlementPriceDecrypted;

    // --------------------------------------------------
    // Bid Storage
    // --------------------------------------------------
    struct BidData {
        address account;
        euint64 ePrice; // ep_i : prix chiffré
        euint64 eQuantity; // eq_i : quantité chiffrée
        euint64 eRemain;
    }
    mapping(uint8 => BidData) public bids;
    uint8 public bidCounter;

    // Pour stocker l'allocation (quantité vendue) par bid, calculée dans l'alternative
    mapping(uint8 => euint64) public allocatedQuantity;

    // --------------------------------------------------
    // Batch Allocation State
    // --------------------------------------------------
    uint8 public allocationIndex; // Index courant pour le traitement en batch des allocations
    bool public globalOfferExceedsDemand; // Résultat déchiffré global : true si eTotalOffer >= totalTokens

    // --------------------------------------------------
    // Custom Errors et Modifiers
    // --------------------------------------------------
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

    // --------------------------------------------------
    // Constructor
    // --------------------------------------------------
    constructor(
        ConfidentialERC20 _tokenContract,
        uint64 _totalTokens,
        uint256 biddingTime,
        uint256 _minBidPrice // prix minimal chiffré
    ) Ownable(msg.sender) {
        tokenContract = _tokenContract;
        endTime = block.timestamp + biddingTime;
        totalTokens = _totalTokens;
        MAX_BIDS = 32;
        bidCounter = 0;

        // Le prix minimal (pmin) est fixé lors de la création.
        minBidPrice = TFHE.asEuint64(_minBidPrice);
        TFHE.allowThis(minBidPrice);

        // Initialisation du prix de règlement (sera mis à jour)
        settlementPrice = TFHE.asEuint64(0);
        TFHE.allowThis(settlementPrice);
        isSettlementPriceDecrypted = false;

        // Initialisation de l'index de batch
        allocationIndex = 0;
    }

    // --------------------------------------------------
    // Bid Submission (inchangé)
    // --------------------------------------------------
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

        // Transfert et gestion des tokens omis pour se concentrer sur l’allocation
        bids[bidCounter] = BidData({
            account: msg.sender,
            ePrice: price,
            eQuantity: quantity,
            eRemain: TFHE.asEuint64(0)
        });
        bidCounter++;
    }

    /**
     * @notice Returns the bid data for a given bid index.
     * @param index The bid ID.
     * @return The corresponding BidData struct.
     */
    function getBid(uint8 index) external view returns (BidData memory) {
        return bids[index];
    }

    // --------------------------------------------------
    // Finalisation Alternative de l'Enchère (Étape 1: Global)
    // --------------------------------------------------
    /**
     * @notice Calcule la somme totale des quantités offertes par les bids valides (avec ePrice >= minBidPrice)
     * et demande la décryption d’un booléen indiquant si cette somme est supérieure ou égale au total des tokens.
     * Cette étape détermine globalement le cas simple (offre < demande) ou compliqué (offre >= demande).
     */
    function finalizeAuctionAlternative() external onlyOwner onlyAfterEnd {
        // 1) Calculer eTotalOffer = somme_{i=0}^{bidCounter-1} select( (bids[i].ePrice >= minBidPrice), bids[i].eQuantity, 0)
        euint64 eTotalOffer = TFHE.asEuint64(0);
        TFHE.allowThis(eTotalOffer);
        for (uint8 i = 0; i < bidCounter; i++) {
            euint64 qtyContribution = TFHE.select(
                TFHE.ge(bids[i].ePrice, minBidPrice),
                bids[i].eQuantity,
                TFHE.asEuint64(0)
            );
            eTotalOffer = TFHE.add(eTotalOffer, qtyContribution);
        }

        // 2) Comparer eTotalOffer avec T (totalTokens)
        ebool isMoreOfferEnc = TFHE.ge(totalTokens, eTotalOffer);

        // 3) Demander la décryption du booléen (une seule valeur)
        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(isMoreOfferEnc);
        Gateway.requestDecryption(cts, this.allocationCallback.selector, 0, block.timestamp + 100, false);
    }

    /**
     * @notice Callback appelé par le Gateway avec la décryption du booléen indiquant
     *         si l'offre totale est supérieure ou égale au total des tokens.
     *         Cette étape initialise le traitement batch des allocations.
     * @param isMoreOfferThanDemand Résultat décrypté du test : eTotalOffer >= totalTokens.
     */
    function allocationCallback(uint256 /*requestID*/, bool isMoreOfferThanDemand) external onlyGateway {
        console.log("Decrypted : ", isMoreOfferThanDemand);
        globalOfferExceedsDemand = isMoreOfferThanDemand;
        // Initialiser l'index de batch à 0 et le prix de marché à minBidPrice
        allocationIndex = 0;
    }

    function assignERemain() external {
        // Tri implicite des bids par prix décroissant (simulé via la logique de calcul)
        for (uint8 i = 0; i < bidCounter; i++) {
            BidData storage currentBid = bids[i];
            euint64 eBidsBefore_i = TFHE.asEuint64(0);

            // 1. Ajouter toutes les offres avec prix > price_i (peu importe leur position)
            for (uint8 j = 0; j < bidCounter; j++) {
                if (j == i) continue;
                BidData storage bidJ = bids[j];

                // Condition : (prix_j > prix_i) ET (prix_j >= minBidPrice)
                ebool cond = TFHE.and(TFHE.gt(bidJ.ePrice, currentBid.ePrice), TFHE.ge(bidJ.ePrice, minBidPrice));
                eBidsBefore_i = TFHE.add(eBidsBefore_i, TFHE.select(cond, bidJ.eQuantity, TFHE.asEuint64(0)));
            }

            // 2. Ajouter les offres avec même prix mais index inférieur (priorité d'ordre)
            for (uint8 j = 0; j < i; j++) {
                BidData storage bidJ = bids[j];
                // Condition : (prix_j == prix_i) ET (prix_j >= minBidPrice)
                ebool cond = TFHE.and(TFHE.eq(bidJ.ePrice, currentBid.ePrice), TFHE.ge(bidJ.ePrice, minBidPrice));
                eBidsBefore_i = TFHE.add(eBidsBefore_i, TFHE.select(cond, bidJ.eQuantity, TFHE.asEuint64(0)));
            }

            // Calcul final de eRemain_i
            eBidsBefore_i = TFHE.min(eBidsBefore_i, totalTokens); // Pas de dépassement
            currentBid.eRemain = TFHE.sub(totalTokens, eBidsBefore_i);
            currentBid.eRemain = TFHE.max(currentBid.eRemain, TFHE.asEuint64(0)); // Clamp à zéro
            TFHE.allowThis(currentBid.eRemain);
        }
    }

    

    function allocateBatch(uint8 _batchSize) external onlyOwner onlyAfterEnd {
        if (globalOfferExceedsDemand) {
            // Cas Offre > Demande : Prix de règlement = prix du dernier bid accepté (le plus bas)
            euint64 eMarketPrice = TFHE.asEuint64(type(uint64).max);
            euint64 eTotalAllocated = TFHE.asEuint64(0);

            for (uint8 i = allocationIndex; i < bidCounter; i++) {
                ebool isValid = TFHE.ge(bids[i].ePrice, minBidPrice);
                euint64 allocated = TFHE.select(
                    isValid,
                    TFHE.min(bids[i].eQuantity, bids[i].eRemain),
                    TFHE.asEuint64(0)
                );
                allocatedQuantity[i] = allocated;

                // Mise à jour du prix SEULEMENT si le bid est valide et alloué
                ebool shouldUpdatePrice = TFHE.and(isValid, TFHE.gt(allocated, TFHE.asEuint64(0)));
                eMarketPrice = TFHE.select(shouldUpdatePrice, TFHE.min(eMarketPrice, bids[i].ePrice), eMarketPrice);
                eTotalAllocated = TFHE.add(eTotalAllocated, allocated);
            }

            settlementPrice = eMarketPrice;
            allocationIndex = bidCounter;
        } else {
            // Cas Offre <= Demande : Prix de règlement = prix MIN de tous les bids alloués
            require(allocationIndex < bidCounter, "Allocation complete");
            uint8 start = allocationIndex;
            uint8 end = (allocationIndex + _batchSize) > bidCounter ? bidCounter : allocationIndex + _batchSize;

            euint64 eBatchPrice = TFHE.asEuint64(type(uint64).max);
            for (uint8 i = start; i < end; i++) {
                ebool isValid = TFHE.ge(bids[i].ePrice, minBidPrice);
                euint64 eRemain_i = bids[i].eRemain;

                // Calcul de la quantité allouée
                euint64 allocated = TFHE.select(isValid, TFHE.min(bids[i].eQuantity, eRemain_i), TFHE.asEuint64(0));
                allocatedQuantity[i] = allocated;

                // Mise à jour du prix SEULEMENT si le bid est alloué
                ebool shouldUpdatePrice = TFHE.gt(allocated, TFHE.asEuint64(0));
                eBatchPrice = TFHE.select(shouldUpdatePrice, TFHE.min(eBatchPrice, bids[i].ePrice), eBatchPrice);
            }

            // Mise à jour globale du prix de règlement (min absolu)
            settlementPrice = TFHE.select(
                TFHE.eq(settlementPrice, TFHE.asEuint64(0)),
                eBatchPrice,
                TFHE.min(settlementPrice, eBatchPrice)
            );
            allocationIndex = end;
        }
        TFHE.allowThis(settlementPrice);
    }

    // --------------------------------------------------
    // Fonctions de Claim/Withdraw (inchangées)
    // --------------------------------------------------
    /**
     * @notice Callback standard pour la décryption du prix de règlement (peut rester inchangé).
     */
    function callbackSettlementPrice(uint256, uint64 decryptedInput) public onlyGateway {
        decryptedSettlementPrice = decryptedInput;
        isSettlementPriceDecrypted = true;
    }
}

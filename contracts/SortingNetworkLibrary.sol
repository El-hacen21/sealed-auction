// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title SortingNetworkLibrary
 * @dev Hardcoded comparator data for an optimal 4-input sorting network (5 comparators, 3 layers).
 *
 * Usage Example:
 *   1) Determine how many layers: getNumberOfLayers() → 3.
 *   2) For each layer i in [0..2], retrieve comparator pairs via getLayer(i).
 *      - If getLayer(i) returns [0,2, 1,3], that means two comparators: (0,2) and (1,3).
 *   3) Perform each compare-and-swap in your calling contract using these pairs.
 *
 * This avoids passing arrays or verifying hashes at runtime.
 */
library SortingNetworkLibrary {
    /**
     * @dev Returns the total number of layers in the 4-input sorting network.
     * A minimal-depth sorting network for 4 inputs has 3 layers.
     */
    function getNumberOfLayers(uint8 inputSize) internal pure returns (uint8) {
        if (inputSize == 4) {
            return 3;
        }
        if (inputSize == 32) {
            return 14;
        }
        return 0;
    }

    /**
     * @dev Returns the comparator pairs for the specified layer, in a flat array:
     *      [leftIndex1, rightIndex1, leftIndex2, rightIndex2, ...].
     *
     * For example, if layer 0 returns [0,2, 1,3], it means:
     *    - Compare/Swap (0,2)
     *    - Compare/Swap (1,3)
     *
     * Layers for 4-input optimal network:
     *    Layer 0: (0,2), (1,3)
     *    Layer 1: (0,1), (2,3)
     *    Layer 2: (1,2)
     *
     * @param layerIndex Index in [0..2].
     * @return A new uint8[] array describing that layer's comparators.
     */
    function getNetwork4Layer(uint8 layerIndex) internal pure returns (uint8[] memory) {
        if (layerIndex == 0) {
            // layer 0 has 2 comparator pairs
            //   (0,2) and (1,3)
            uint8[] memory pairs = new uint8[](4);
            pairs[0] = 0;
            pairs[1] = 2;
            pairs[2] = 1;
            pairs[3] = 3;
            return pairs;
        } else if (layerIndex == 1) {
            // layer 1 has 2 comparator pairs
            //   (0,1) and (2,3)
            uint8[] memory pairs = new uint8[](4);
            pairs[0] = 0;
            pairs[1] = 1;
            pairs[2] = 2;
            pairs[3] = 3;
            return pairs;
        } else if (layerIndex == 2) {
            // layer 2 has 1 comparator pair
            //   (1,2)
            uint8[] memory pairs = new uint8[](2);
            pairs[0] = 1;
            pairs[1] = 2;
            return pairs;
        }

        revert("Invalid layer index");
    }

    /**
     * @dev Retourne les comparateurs pour un réseau optimal à 32 entrées basé sur l'index de couche.
     * Chaque paire de comparateurs est représentée séquentiellement dans le tableau.
     *
     * @param layerIndex Index de la couche dans [0..13].
     * @return Un tableau uint8[] décrivant les comparateurs de la couche spécifiée.
     */
    function getNetwork32Layer(uint8 layerIndex) internal pure returns (uint8[] memory) {
        if (layerIndex == 0) {
            // Layer 0: 16 paires -> 32 éléments
            uint8[] memory pairs = new uint8[](32);
            pairs[0] = 0;
            pairs[1] = 1;
            pairs[2] = 2;
            pairs[3] = 3;
            pairs[4] = 4;
            pairs[5] = 5;
            pairs[6] = 6;
            pairs[7] = 7;
            pairs[8] = 8;
            pairs[9] = 9;
            pairs[10] = 10;
            pairs[11] = 11;
            pairs[12] = 12;
            pairs[13] = 13;
            pairs[14] = 14;
            pairs[15] = 15;
            pairs[16] = 16;
            pairs[17] = 17;
            pairs[18] = 18;
            pairs[19] = 19;
            pairs[20] = 20;
            pairs[21] = 21;
            pairs[22] = 22;
            pairs[23] = 23;
            pairs[24] = 24;
            pairs[25] = 25;
            pairs[26] = 26;
            pairs[27] = 27;
            pairs[28] = 28;
            pairs[29] = 29;
            pairs[30] = 30;
            pairs[31] = 31;
            return pairs;
        } else if (layerIndex == 1) {
            // Layer 1: 16 paires -> 32 éléments
            uint8[] memory pairs = new uint8[](32);
            pairs[0] = 0;
            pairs[1] = 2;
            pairs[2] = 1;
            pairs[3] = 3;
            pairs[4] = 4;
            pairs[5] = 6;
            pairs[6] = 5;
            pairs[7] = 7;
            pairs[8] = 8;
            pairs[9] = 10;
            pairs[10] = 9;
            pairs[11] = 11;
            pairs[12] = 12;
            pairs[13] = 14;
            pairs[14] = 13;
            pairs[15] = 15;
            pairs[16] = 16;
            pairs[17] = 18;
            pairs[18] = 17;
            pairs[19] = 19;
            pairs[20] = 20;
            pairs[21] = 22;
            pairs[22] = 21;
            pairs[23] = 23;
            pairs[24] = 24;
            pairs[25] = 26;
            pairs[26] = 25;
            pairs[27] = 27;
            pairs[28] = 28;
            pairs[29] = 30;
            pairs[30] = 29;
            pairs[31] = 31;
            return pairs;
        } else if (layerIndex == 2) {
            // Layer 2: 16 paires -> 32 éléments
            uint8[] memory pairs = new uint8[](32);
            pairs[0] = 0;
            pairs[1] = 4;
            pairs[2] = 1;
            pairs[3] = 5;
            pairs[4] = 2;
            pairs[5] = 6;
            pairs[6] = 3;
            pairs[7] = 7;
            pairs[8] = 8;
            pairs[9] = 12;
            pairs[10] = 9;
            pairs[11] = 13;
            pairs[12] = 10;
            pairs[13] = 14;
            pairs[14] = 11;
            pairs[15] = 15;
            pairs[16] = 16;
            pairs[17] = 20;
            pairs[18] = 17;
            pairs[19] = 21;
            pairs[20] = 18;
            pairs[21] = 22;
            pairs[22] = 19;
            pairs[23] = 23;
            pairs[24] = 24;
            pairs[25] = 28;
            pairs[26] = 25;
            pairs[27] = 29;
            pairs[28] = 26;
            pairs[29] = 30;
            pairs[30] = 27;
            pairs[31] = 31;
            return pairs;
        } else if (layerIndex == 3) {
            // Layer 3: 16 paires -> 32 éléments
            uint8[] memory pairs = new uint8[](32);
            pairs[0] = 0;
            pairs[1] = 8;
            pairs[2] = 1;
            pairs[3] = 9;
            pairs[4] = 2;
            pairs[5] = 10;
            pairs[6] = 3;
            pairs[7] = 11;
            pairs[8] = 4;
            pairs[9] = 12;
            pairs[10] = 5;
            pairs[11] = 13;
            pairs[12] = 6;
            pairs[13] = 14;
            pairs[14] = 7;
            pairs[15] = 15;
            pairs[16] = 16;
            pairs[17] = 24;
            pairs[18] = 17;
            pairs[19] = 25;
            pairs[20] = 18;
            pairs[21] = 26;
            pairs[22] = 19;
            pairs[23] = 27;
            pairs[24] = 20;
            pairs[25] = 28;
            pairs[26] = 21;
            pairs[27] = 29;
            pairs[28] = 22;
            pairs[29] = 30;
            pairs[30] = 23;
            pairs[31] = 31;
            return pairs;
        } else if (layerIndex == 4) {
            // Layer 4: 16 paires -> 32 éléments
            uint8[] memory pairs = new uint8[](32);
            pairs[0] = 0;
            pairs[1] = 16;
            pairs[2] = 1;
            pairs[3] = 8;
            pairs[4] = 2;
            pairs[5] = 4;
            pairs[6] = 3;
            pairs[7] = 12;
            pairs[8] = 5;
            pairs[9] = 10;
            pairs[10] = 6;
            pairs[11] = 9;
            pairs[12] = 7;
            pairs[13] = 14;
            pairs[14] = 11;
            pairs[15] = 13;
            pairs[16] = 15;
            pairs[17] = 31;
            pairs[18] = 17;
            pairs[19] = 24;
            pairs[20] = 18;
            pairs[21] = 20;
            pairs[22] = 19;
            pairs[23] = 28;
            pairs[24] = 21;
            pairs[25] = 26;
            pairs[26] = 22;
            pairs[27] = 25;
            pairs[28] = 23;
            pairs[29] = 30;
            pairs[30] = 27;
            pairs[31] = 29;
            return pairs;
        } else if (layerIndex == 5) {
            // Layer 5: 14 paires -> 28 éléments
            uint8[] memory pairs = new uint8[](28);
            pairs[0] = 1;
            pairs[1] = 2;
            pairs[2] = 3;
            pairs[3] = 5;
            pairs[4] = 4;
            pairs[5] = 8;
            pairs[6] = 6;
            pairs[7] = 22;
            pairs[8] = 7;
            pairs[9] = 11;
            pairs[10] = 9;
            pairs[11] = 25;
            pairs[12] = 10;
            pairs[13] = 12;
            pairs[14] = 13;
            pairs[15] = 14;
            pairs[16] = 17;
            pairs[17] = 18;
            pairs[18] = 19;
            pairs[19] = 21;
            pairs[20] = 20;
            pairs[21] = 24;
            pairs[22] = 23;
            pairs[23] = 27;
            pairs[24] = 26;
            pairs[25] = 28;
            pairs[26] = 29;
            pairs[27] = 30;
            return pairs;
        } else if (layerIndex == 6) {
            // Layer 6: 12 paires -> 24 éléments
            uint8[] memory pairs = new uint8[](24);
            pairs[0] = 1;
            pairs[1] = 17;
            pairs[2] = 2;
            pairs[3] = 18;
            pairs[4] = 3;
            pairs[5] = 19;
            pairs[6] = 4;
            pairs[7] = 20;
            pairs[8] = 5;
            pairs[9] = 10;
            pairs[10] = 7;
            pairs[11] = 23;
            pairs[12] = 8;
            pairs[13] = 24;
            pairs[14] = 11;
            pairs[15] = 27;
            pairs[16] = 12;
            pairs[17] = 28;
            pairs[18] = 13;
            pairs[19] = 29;
            pairs[20] = 14;
            pairs[21] = 30;
            pairs[22] = 21;
            pairs[23] = 26;
            return pairs;
        } else if (layerIndex == 7) {
            // Layer 7: 12 paires -> 24 éléments
            uint8[] memory pairs = new uint8[](24);
            pairs[0] = 3;
            pairs[1] = 17;
            pairs[2] = 4;
            pairs[3] = 16;
            pairs[4] = 5;
            pairs[5] = 21;
            pairs[6] = 6;
            pairs[7] = 18;
            pairs[8] = 7;
            pairs[9] = 9;
            pairs[10] = 8;
            pairs[11] = 20;
            pairs[12] = 10;
            pairs[13] = 26;
            pairs[14] = 11;
            pairs[15] = 23;
            pairs[16] = 13;
            pairs[17] = 25;
            pairs[18] = 14;
            pairs[19] = 28;
            pairs[20] = 15;
            pairs[21] = 27;
            pairs[22] = 22;
            pairs[23] = 24;
            return pairs;
        } else if (layerIndex == 8) {
            // Layer 8: 12 paires -> 24 éléments
            uint8[] memory pairs = new uint8[](24);
            pairs[0] = 1;
            pairs[1] = 4;
            pairs[2] = 3;
            pairs[3] = 8;
            pairs[4] = 5;
            pairs[5] = 16;
            pairs[6] = 7;
            pairs[7] = 17;
            pairs[8] = 9;
            pairs[9] = 21;
            pairs[10] = 10;
            pairs[11] = 22;
            pairs[12] = 11;
            pairs[13] = 19;
            pairs[14] = 12;
            pairs[15] = 20;
            pairs[16] = 14;
            pairs[17] = 24;
            pairs[18] = 15;
            pairs[19] = 26;
            pairs[20] = 23;
            pairs[21] = 28;
            pairs[22] = 27;
            pairs[23] = 30;
            return pairs;
        } else if (layerIndex == 9) {
            // Layer 9: 10 paires -> 20 éléments
            uint8[] memory pairs = new uint8[](20);
            pairs[0] = 2;
            pairs[1] = 5;
            pairs[2] = 7;
            pairs[3] = 8;
            pairs[4] = 9;
            pairs[5] = 18;
            pairs[6] = 11;
            pairs[7] = 17;
            pairs[8] = 12;
            pairs[9] = 16;
            pairs[10] = 13;
            pairs[11] = 22;
            pairs[12] = 14;
            pairs[13] = 20;
            pairs[14] = 15;
            pairs[15] = 19;
            pairs[16] = 23;
            pairs[17] = 24;
            pairs[18] = 26;
            pairs[19] = 29;
            return pairs;
        } else if (layerIndex == 10) {
            // Layer 10: 10 paires -> 20 éléments
            uint8[] memory pairs = new uint8[](20);
            pairs[0] = 2;
            pairs[1] = 4;
            pairs[2] = 6;
            pairs[3] = 12;
            pairs[4] = 9;
            pairs[5] = 16;
            pairs[6] = 10;
            pairs[7] = 11;
            pairs[8] = 13;
            pairs[9] = 17;
            pairs[10] = 14;
            pairs[11] = 18;
            pairs[12] = 15;
            pairs[13] = 22;
            pairs[14] = 19;
            pairs[15] = 25;
            pairs[16] = 20;
            pairs[17] = 21;
            pairs[18] = 27;
            pairs[19] = 29;
            return pairs;
        } else if (layerIndex == 11) {
            // Layer 11: 10 paires -> 20 éléments
            uint8[] memory pairs = new uint8[](20);
            pairs[0] = 5;
            pairs[1] = 6;
            pairs[2] = 8;
            pairs[3] = 12;
            pairs[4] = 9;
            pairs[5] = 10;
            pairs[6] = 11;
            pairs[7] = 13;
            pairs[8] = 14;
            pairs[9] = 16;
            pairs[10] = 15;
            pairs[11] = 17;
            pairs[12] = 18;
            pairs[13] = 20;
            pairs[14] = 19;
            pairs[15] = 23;
            pairs[16] = 21;
            pairs[17] = 22;
            pairs[18] = 25;
            pairs[19] = 26;
            return pairs;
        } else if (layerIndex == 12) {
            // Layer 12: 12 paires -> 24 éléments
            uint8[] memory pairs = new uint8[](24);
            pairs[0] = 3;
            pairs[1] = 5;
            pairs[2] = 6;
            pairs[3] = 7;
            pairs[4] = 8;
            pairs[5] = 9;
            pairs[6] = 10;
            pairs[7] = 12;
            pairs[8] = 11;
            pairs[9] = 14;
            pairs[10] = 13;
            pairs[11] = 16;
            pairs[12] = 15;
            pairs[13] = 18;
            pairs[14] = 17;
            pairs[15] = 20;
            pairs[16] = 19;
            pairs[17] = 21;
            pairs[18] = 22;
            pairs[19] = 23;
            pairs[20] = 24;
            pairs[21] = 25;
            pairs[22] = 26;
            pairs[23] = 28;
            return pairs;
        } else if (layerIndex == 13) {
            // Layer 13: 13 paires -> 26 éléments
            uint8[] memory pairs = new uint8[](26);
            pairs[0] = 3;
            pairs[1] = 4;
            pairs[2] = 5;
            pairs[3] = 6;
            pairs[4] = 7;
            pairs[5] = 8;
            pairs[6] = 9;
            pairs[7] = 10;
            pairs[8] = 11;
            pairs[9] = 12;
            pairs[10] = 13;
            pairs[11] = 14;
            pairs[12] = 15;
            pairs[13] = 16;
            pairs[14] = 17;
            pairs[15] = 18;
            pairs[16] = 19;
            pairs[17] = 20;
            pairs[18] = 21;
            pairs[19] = 22;
            pairs[20] = 23;
            pairs[21] = 24;
            pairs[22] = 25;
            pairs[23] = 26;
            pairs[24] = 27;
            pairs[25] = 28;
            return pairs;
        }

        revert("Invalid layer index");
    }

    /**
     * @dev Verifies the hash for a specific layer of a sorting network.
     * @param inputSize The size of the sorting network input.
     * @param layerIndex The index of the layer to verify.
     * @return True if the hash matches the precomputed hash, otherwise false.
     */
    function getNetworkLayer(uint8 inputSize, uint8 layerIndex) external pure returns (uint8[] memory) {
        if (inputSize == 4) {
            return getNetwork4Layer(layerIndex);
        }

        if (inputSize == 32) {
            return getNetwork32Layer(layerIndex);
        }
        revert("Sorting network not defined for this input size");
    }
}

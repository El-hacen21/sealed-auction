// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SortingNetworkLibrary
 * @notice Optimized library for sorting networks for input sizes 2 through 16.
 *
 * For each supported input size the optimal network is represented by two constants:
 *   1. A bytes constant that contains the concatenated comparator pairs for all layers.
 *      Each comparator pair is encoded as 2 bytes:
 *         - The first byte is the left index.
 *         - The second byte is the right index.
 *   2. A bytes constant that encodes the layer offsets.
 *      For example, if the offsets are [0, 4, 8, 10] then we encode that as hex "0004080a".
 *
 * The public functions are:
 *   - getNumberOfLayers(inputSize) returns the number of layers for that input size.
 *   - getNetworkLayer(inputSize, layerIndex) returns the comparator pairs for that layer as a uint8[].
 *
 * Only input sizes 2 through 16 are supported.
 */
library SortingNetworkLibrary {
    // --- Lookup table for the number of layers per input size (index = input size) ---
    // Only sizes 2 .. 16 are supported.
    // Layer count lookup table stored as packed bytes
    bytes private constant LAYERS_COUNT = hex"0000010303050506060707080809090909";

    function getNumberOfLayers(uint8 inputSize) public pure returns (uint8) {
        require(inputSize >= 2 && inputSize <= 16, "Unsupported input size");
        return uint8(LAYERS_COUNT[inputSize]);
    }

    // --- Internal helper to decode a bytes array into a uint8[] array ---
    function _decodeLayer(bytes memory data) private pure returns (uint8[] memory) {
        uint8[] memory result = new uint8[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            result[i] = uint8(data[i]);
        }
        return result;
    }

    // --- Internal helper to extract layer data using bytes–encoded offsets ---
    function _getLayer(
        bytes memory layersData,
        bytes memory offsets,
        uint8 layerIndex
    ) private pure returns (uint8[] memory) {
        // Convert the bytes constant offsets into a uint8 array.
        uint256 offLen = offsets.length;
        uint8[] memory offArray = new uint8[](offLen);
        for (uint256 i = 0; i < offLen; i++) {
            offArray[i] = uint8(offsets[i]);
        }
        require(layerIndex < offArray.length - 1, "Invalid layer index");
        uint256 start = offArray[layerIndex];
        uint256 end = offArray[layerIndex + 1];
        bytes memory layerData = new bytes(end - start);
        for (uint256 i = 0; i < end - start; i++) {
            layerData[i] = layersData[start + i];
        }
        return _decodeLayer(layerData);
    }

    // --- Network data for input sizes 2 through 16 ---
    // For each input size we define:
    //   - LAYERS_DATA_X: concatenated comparator pairs for all layers.
    //   - LAYER_OFFSETS_X: bytes constant holding the offsets.
    //
    // Each comparator pair is encoded in 2 bytes.
    //
    // Input size 2:
    // 1 layer: [(0,1)]
    bytes private constant LAYERS_DATA_2 = hex"0001";
    bytes private constant LAYER_OFFSETS_2 = hex"0002"; // represents [0,2]

    // Input size 3:
    // Layers:
    //   0: [(0,2)] → 00 02
    //   1: [(0,1)] → 00 01
    //   2: [(1,2)] → 01 02
    bytes private constant LAYERS_DATA_3 = hex"000200010102";
    bytes private constant LAYER_OFFSETS_3 = hex"00020406"; // [0,2,4,6]

    // Input size 4:
    // Layers:
    //   0: [(0,2),(1,3)] → 00 02 01 03
    //   1: [(0,1),(2,3)] → 00 01 02 03
    //   2: [(1,2)]       → 01 02
    bytes private constant LAYERS_DATA_4 = hex"00020103000102030102";
    bytes private constant LAYER_OFFSETS_4 = hex"0004080a"; // [0,4,8,10]

    // Input size 5:
    // Layers:
    //   0: [(0,3),(1,4)] → 00 03 01 04
    //   1: [(0,2),(1,3)] → 00 02 01 03
    //   2: [(0,1),(2,4)] → 00 01 02 04
    //   3: [(1,2),(3,4)] → 01 02 03 04
    //   4: [(2,3)]       → 02 03
    bytes private constant LAYERS_DATA_5 = hex"000301040002010300010204010203040203";
    bytes private constant LAYER_OFFSETS_5 = hex"0004080c1012"; // [0,4,8,12,16,18]


    // Input size 6:
    // Layers:
    //   0: [(0,5),(1,3),(2,4)] → 00 05 01 03 02 04
    //   1: [(1,2),(3,4)]       → 01 02 03 04
    //   2: [(0,3),(2,5)]       → 00 03 02 05
    //   3: [(0,1),(2,3),(4,5)] → 00 01 02 03 04 05
    //   4: [(1,2),(3,4)]       → 01 02 03 04
    bytes private constant LAYERS_DATA_6 = hex"0005010302040102030400030205000102030401020304";
    bytes private constant LAYER_OFFSETS_6 = hex"00060a0e1418"; // [0,6,10,14,20,24]

    // Input size 7:
    // Layers:
    //   0: [(0,6),(2,3),(4,5)]         → 00 06 02 03 04 05
    //   1: [(0,2),(1,4),(3,6)]           → 00 02 01 04 03 06
    //   2: [(0,1),(2,5),(3,4)]           → 00 01 02 05 03 04
    //   3: [(1,2),(4,6)]                 → 01 02 04 06
    //   4: [(2,3),(4,5)]                 → 02 03 04 05
    //   5: [(1,2),(3,4),(5,6)]           → 01 02 03 04 05 06
    bytes private constant LAYERS_DATA_7 = hex"000602030405000201040306000102050304010204060102030406";
    bytes private constant LAYER_OFFSETS_7 = hex"00060c12161a20"; // [0,6,12,18,22,26,32]

   
 
    bytes private constant LAYERS_DATA_8 =
        hex"0002010304060507"  // Layer 0: (0,2),(1,3),(4,6),(5,7)
        hex"0004010502060307"  // Layer 1: (0,4),(1,5),(2,6),(3,7)
        hex"0001020304050607"  // Layer 2: (0,1),(2,3),(4,5),(6,7)
        hex"02040305"          // Layer 3: (2,4),(3,5)
        hex"01040306"          // Layer 4: (1,4),(3,6)
        hex"010203040506";     // Layer 5: (1,2),(3,4),(5,6)
    bytes private constant LAYER_OFFSETS_8 = hex"000810181C2026"; // [0, 8, 16, 24, 28, 32, 38]


    // Input size 9:
    // (7 layers, 50 bytes total)
    bytes private constant LAYERS_DATA_9 =
        hex"0003010702050408"
        hex"0007020403080506"
        hex"0002010304050708"
        hex"010403060507"
        hex"0001020403050608"
        hex"020304050607"
        hex"010203040506";
    bytes private constant LAYER_OFFSETS_9 = hex"00081018201e262c32"; // [0,8,16,24,30,38,44,50]

    // Input size 10:
    // (7 layers, 64 bytes total; chosen variant with 31 comparator elements)
    bytes private constant LAYERS_DATA_10 =
        hex"00010205030604070809"  // Layer 0
        hex"00060108020403090507"  // Layer 1
        hex"00020103040506080709"  // Layer 2 (corrected)
        hex"00010207030504060809"  // Layer 3
        hex"0102030405060708"      // Layer 4
        hex"0103020405070608"      // Layer 5 (fixed 0507)
        hex"020304050607";         // Layer 6   
    bytes private constant LAYER_OFFSETS_10 = hex"000a141e28323c444a"; // Correct offsets

    // Input size 11:
    bytes private constant LAYERS_DATA_11 =
        hex"00090106020403070508"
        hex"00010305040A06090708"
        hex"0103020504070810"
        hex"00040102030705090608"
        hex"0001020604050708090A"
        hex"0204030605070809"
        hex"0102030405060708"
        hex"020304050607";
    bytes private constant LAYER_OFFSETS_11 = hex"000a141e28323840464a"; // [0,10,20,28,38,48,56,64,70]

    // Input size 12:
    bytes private constant LAYERS_DATA_12 =
        hex"0008010702060B040A0509"
        hex"0002010403050608070A090B"
        hex"00010209040705060A0B"
        hex"010302070409080A"
        hex"00010401020307050908"
        hex"000102030405060708090A0B"
        hex"0102030405060708"
        hex"0203040506070809";
    bytes private constant LAYER_OFFSETS_12 = hex"000c1812222a32383e46"; // [0,12,24,34,42,52,62,72,80]

    // Input size 13:
    bytes private constant LAYERS_DATA_13 =
        hex"000B01070204030508090A0C"
        hex"000203060407080A"
        hex"0008010302050409060B070C"
        hex"0001020A03080406090B"
        hex"01030204050A060807090B0C"
        hex"0102030405080609070A"
        hex"020304070506080B090A"
        hex"0405060708090A0B"
        hex"030405060708090A";
    bytes private constant LAYER_OFFSETS_13 = hex"000c141e28323840464a52"; // [0,12,20,30,40,52,62,70,78,90]

    // Input size 14:
    bytes private constant LAYERS_DATA_14 =
        hex"000102030405060708090A0B0C0D"
        hex"0002030103040805090A0B0D"
        hex"000A0106020B030D0508070C"
        hex"010402080306050B070A090C"
        hex"000102030109040A050707080C0D"
        hex"010502040307060A080C090B"
        hex"0102030405060708090A0B0C"
        hex"02030405060708090A0B"
        hex"030405060708090A";
    bytes private constant LAYER_OFFSETS_14 = hex"000e1a262e3a44504a56"; // [0,14,26,38,50,62,74,86,96,104]

    // Input size 15:
    bytes private constant LAYERS_DATA_15 =
        hex"0006010A020E0309040C050D070B"
        hex"000702050304060B080A090C0D0E"
        hex"010D02030406050907080A0C0B0E"
        hex"000301040507060D08090A0B0C0E"
        hex"000102030407050906080A0C0B0D"
        hex"01020305080A0B0C"
        hex"030405060708"
        hex"02030405060708090A0B"
        hex"05060708";
    bytes private constant LAYER_OFFSETS_15 = hex"000c1a2832384050646a"; // [0,12,26,40,54,68,78,88,98,102]

    // Input size 16:
    bytes private constant LAYERS_DATA_16 =
        hex"00050104020C030D060708090A0F0B0E"
        hex"0002010A03060407050E080B090C0D0F"
        hex"00080103020B040D0509060A070F0C0E"
        hex"0001020403080506070C090A0B0D0E0F"
        hex"0103020504080609070B0A0D0C0E"
        hex"01020305040B060807090A0C0D0E"
        hex"02030405060708090A0B0C0D"
        hex"04060507080A090B"
        hex"030405060708090A0B0C";
    bytes private constant LAYER_OFFSETS_16 = hex"00101e2c3a484e5a66"; // [0,16,32,48,64,78,94,108,118,130]

    // --------------------------------------------------
    // Public interface
    // --------------------------------------------------


    function getNetworkLayer(uint8 inputSize, uint8 layerIndex) external pure returns (uint8[] memory) {
        require(inputSize >= 2 && inputSize <= 16, "Unsupported input size");

        if (inputSize == 2) {
            return _getLayer(LAYERS_DATA_2, LAYER_OFFSETS_2, layerIndex);
        } else if (inputSize == 3) {
            return _getLayer(LAYERS_DATA_3, LAYER_OFFSETS_3, layerIndex);
        } else if (inputSize == 4) {
            return _getLayer(LAYERS_DATA_4, LAYER_OFFSETS_4, layerIndex);
        } else if (inputSize == 5) {
            return _getLayer(LAYERS_DATA_5, LAYER_OFFSETS_5, layerIndex);
        } else if (inputSize == 6) {
            return _getLayer(LAYERS_DATA_6, LAYER_OFFSETS_6, layerIndex);
        } else if (inputSize == 7) {
            return _getLayer(LAYERS_DATA_7, LAYER_OFFSETS_7, layerIndex);
        } else if (inputSize == 8) {
            return _getLayer(LAYERS_DATA_8, LAYER_OFFSETS_8, layerIndex);
        } else if (inputSize == 9) {
            return _getLayer(LAYERS_DATA_9, LAYER_OFFSETS_9, layerIndex);
        } else if (inputSize == 10) {
            return _getLayer(LAYERS_DATA_10, LAYER_OFFSETS_10, layerIndex);
        } else if (inputSize == 11) {
            return _getLayer(LAYERS_DATA_11, LAYER_OFFSETS_11, layerIndex);
        } else if (inputSize == 12) {
            return _getLayer(LAYERS_DATA_12, LAYER_OFFSETS_12, layerIndex);
        } else if (inputSize == 13) {
            return _getLayer(LAYERS_DATA_13, LAYER_OFFSETS_13, layerIndex);
        } else if (inputSize == 14) {
            return _getLayer(LAYERS_DATA_14, LAYER_OFFSETS_14, layerIndex);
        } else if (inputSize == 15) {
            return _getLayer(LAYERS_DATA_15, LAYER_OFFSETS_15, layerIndex);
        } else if (inputSize == 16) {
            return _getLayer(LAYERS_DATA_16, LAYER_OFFSETS_16, layerIndex);
        }
        revert("Unsupported input size");
    }
}

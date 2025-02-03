// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SortingNetworkLibrary.sol";

contract Wrapper {
    function getNumberOfLayers(uint8 inputSize) public pure returns (uint8) {
        return SortingNetworkLibrary.getNumberOfLayers(inputSize);
    }

    function getNetworkLayer(uint8 inputSize, uint8 layerIndex) public pure returns (uint8[] memory) {
        return SortingNetworkLibrary.getNetworkLayer(inputSize, layerIndex);
    }
}
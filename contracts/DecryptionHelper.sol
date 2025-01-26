// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";
import "hardhat/console.sol";

contract DecryptionHelper is SepoliaZamaFHEVMConfig, SepoliaZamaGatewayConfig, GatewayCaller {
    // We’ll store the results temporarily for the calling main contract
    // (One possible approach)
    mapping(uint256 => bool[]) private _decryptedResults;

    // Let the main contract read them (or you can pass them in a callback)
    function getDecryptedResults(uint256 requestID) external view returns (bool[] memory) {
        return _decryptedResults[requestID];
    }

    /**
     * @dev Request the decryption of an array of ebool ciphertexts. 
     * @param ciphertexts The array of ciphertext handles (uint256 from Gateway.toUint256()).
     * @return requestID The ID that will be used in the callback.
     */
    function requestComparisons(uint256[] memory ciphertexts) external returns (uint256 requestID) {
        require(ciphertexts.length <= 32, "Max 32 in one call for this example");
        
        // We'll define a callback that has exactly 'ciphertexts.length' bool parameters.
        // For a simple example, let's assume it’s always exactly 2 booleans:
        //    function callback2(uint256 requestID, bool dec0, bool dec1)
        // If you want a dynamic approach, you would create multiple versions
        // or chunk the calls in fixed sizes.
        require(ciphertexts.length == 2, "This helper only supports 2 for demonstration");

        console.log("requestComparisons");
        // 1) Call the Gateway
        requestID = Gateway.requestDecryption(
            ciphertexts,
            this.callback2.selector,  // callback that expects 2 bools
            0,                        // fee (usually 0)
            block.timestamp + 1000,   // some deadline
            false                     // not trustless in this example
        );

        // 2) Optionally store something that helps us reference the data
        //    Or pass back to main contract later.
    }

    /**
     * @dev The callback that receives 2 decrypted booleans.
     * @param requestID The request ID
     * @param dec0 Decrypted boolean 0
     * @param dec1 Decrypted boolean 1
     */
    function callback2(
        uint256 requestID,
        bool dec0,
        bool dec1
    ) 
        public 
        onlyGateway 
    {
        console.log("callback2");
        bool[] storage results = _decryptedResults[requestID];
        // If it’s the first time we store them, we do a push:
        results.push(dec0);
        results.push(dec1);

        // Optionally, we can also "call back" the main contract here:
        // MainContract(callingContract).onHelperDecryptionFinished(requestID, dec0, dec1);
    }
}

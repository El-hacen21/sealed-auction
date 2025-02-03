import { expect } from "chai";
import { ethers } from "hardhat";

describe("SortingNetworkLibrary", function () {

    let sortingLibrary: Contract;
    let wrapper: Contract;

    // Expected layer counts for input sizes 0-16 derived from LAYERS_COUNT hex string
    const expectedLayerCounts = [
        0, 0, 1, 3, 3, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 9
    ];
    before(async () => {
        // 1. Deploy the SortingNetworkLibrary
        const SortingNetworkLibrary = await ethers.getContractFactory("SortingNetworkLibrary");
        sortingLibrary = await SortingNetworkLibrary.deploy();
        await sortingLibrary.waitForDeployment();

        const sortingLibraryAdress = await sortingLibrary.getAddress();

        // 2. Get the Wrapper contract factory with the library linked
        const WrapperFactory = await ethers.getContractFactory("Wrapper", {
            libraries: {
                // Ensure this key matches the library name in your Solidity file.
                SortingNetworkLibrary: sortingLibraryAdress,
            },
        });

        // 3. Deploy the Wrapper contract
        wrapper = await WrapperFactory.deploy();
        await wrapper.waitForDeployment();
    });

    describe("getNumberOfLayers", () => {
        for (let inputSize = 2; inputSize <= 16; inputSize++) {
            it(`should return correct layer count for inputSize ${inputSize}`, async () => {
                const expected = expectedLayerCounts[inputSize];
                expect(await wrapper.getNumberOfLayers(inputSize)).to.equal(expected);
            });
        }
    });

    describe("getNetworkLayer specific cases", () => {
        it("should return correct layer for inputSize 2, layer 0", async () => {
            const layer = await wrapper.getNetworkLayer(2, 0);
            expect(layer).to.deep.equal([0, 1]);
        });

        it("should return correct layers for inputSize 3", async () => {
            const expectedLayers = [
                [0, 2],
                [0, 1],
                [1, 2]
            ];
            for (let i = 0; i < expectedLayers.length; i++) {
                const layer = await wrapper.getNetworkLayer(3, i);
                expect(layer).to.deep.equal(expectedLayers[i]);
            }
        });

        it("should return correct layers for inputSize 4", async () => {
            const expectedLayers = [
                [0, 2, 1, 3],
                [0, 1, 2, 3],
                [1, 2]
            ];
            for (let i = 0; i < expectedLayers.length; i++) {
                const layer = await wrapper.getNetworkLayer(4, i);
                expect(layer).to.deep.equal(expectedLayers[i]);
            }
        });

        it("should return correct layers for inputSize 5", async () => {
            const expectedLayers = [
                [0, 3, 1, 4],
                [0, 2, 1, 3],
                [0, 1, 2, 4],
                [1, 2, 3, 4],
                [2, 3]
            ];

            for (let i = 0; i < expectedLayers.length; i++) {
                const layer = await wrapper.getNetworkLayer(5, i);
                expect(layer).to.deep.equal(expectedLayers[i]);
            }
        });



        it("should return correct layers for inputSize 8", async () => {
            const expectedLayers = [
                [0, 2, 1, 3, 4, 6, 5, 7], // Layer 0
                [0, 4, 1, 5, 2, 6, 3, 7], // Layer 1
                [0, 1, 2, 3, 4, 5, 6, 7], // Layer 2
                [2, 4, 3, 5],             // Layer 3
                [1, 4, 3, 6],             // Layer 4
                [1, 2, 3, 4, 5, 6]        // Layer 5
            ];
            const layerCount = expectedLayerCounts[8];
            expect(layerCount).to.equal(6);
            for (let i = 0; i < layerCount; i++) {
                const layer = await wrapper.getNetworkLayer(8, i);
                expect(layer).to.deep.equal(expectedLayers[i]);
            }
        });
    });

});
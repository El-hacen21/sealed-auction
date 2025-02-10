import { BigNumberish, Signer } from "ethers";
import { ethers } from "hardhat";
import type { SealedAuction } from "../../types";
import type { SealedAuctionFactory } from "../../types";
import { SealedAuctionFactoryFixture } from "./SealedAuctionFactory.fixture";
import { createInstance } from "../instance";
import { approveTokens } from "../sealedAuction/Helpers"

/**
 * Creates an auction via the factory.
 *
 * @param auctionOwner - The Signer who will own the auction.
 * @param totalTokens - The asset supply.
 * @param biddingDuration - Auction duration (in seconds).
 * @param minBidPrice - Minimum bid price.
 * @param minBidQuantity - Minimum bid quantity.
 * @param paymentType - The payment type (0 for ERC20, 1 for Ether).
 * @param factoryInstance - (Optional) An already deployed SealedAuctionFactory instance.
 * @returns The deployed SealedAuction contract instance.
 */
export async function createAuctionViaFactory(
  auctionOwner: Signer,
  totalTokens: BigNumberish,
  biddingDuration: BigNumberish,
  minBidPrice: BigNumberish,
  minBidQuantity: BigNumberish,
  paymentType: BigNumberish,
  factoryInstance?: SealedAuctionFactory
): Promise<SealedAuction> {
  // Use the provided factory instance if available; otherwise, deploy via the fixture.
  const factory: SealedAuctionFactory = factoryInstance || await SealedAuctionFactoryFixture();

  const auctionOwnerAddress = await auctionOwner.getAddress();
  const factoryAddress = await factory.getAddress();

  // Retrieve the asset token instance from the factory.
  const defaultAssetAddress = await factory.defaultAssetERC20(); // Returns the asset token address.
  const assetToken = await ethers.getContractAt("MyConfidentialERC20", defaultAssetAddress);

  // Create an instance of fhevm if needed for your approve helper.
  const fhevm = await createInstance();

  // Mint tokens to the auction owner if needed.
  const mintTx = await assetToken.mint(totalTokens);
  await mintTx.wait();

  // Approve the factory to spend the auction owner's tokens on this asset token.
  await approveTokens(fhevm, assetToken, defaultAssetAddress, auctionOwner, factoryAddress, totalTokens);

  // Call createAuction on the factory.
  const tx = await factory.createAuction(
    auctionOwnerAddress,
    totalTokens,
    biddingDuration,
    minBidPrice,
    minBidQuantity,
    paymentType
  );
  const receipt = await tx.wait();

  // Manually decode the logs to find the AuctionCreated event.
  const parsedLogs = receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter((log) => log !== null);

  const auctionCreatedLog = parsedLogs.find((log) => log!.name === "AuctionCreated");

  if (!auctionCreatedLog || !auctionCreatedLog.args) {
    throw new Error("AuctionCreated event not emitted or missing args");
  }

  // Use the correct parameter names as declared in the contract.
  const auctionAddress = auctionCreatedLog.args.auctionAddress;
  // Return a contract instance at the auction address.
  return (await ethers.getContractAt("SealedAuction", auctionAddress)) as SealedAuction;
}

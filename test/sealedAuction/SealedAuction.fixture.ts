// // SealedAuctionFixture.ts
// import { AddressLike, BigNumberish, Signer } from 'ethers';
// import { ethers } from 'hardhat';

// import type { SealedAuction } from '../../types';
// import type { SealedAuctionFactory } from '../../types';
// import { SealedAuctionFactoryFixture } from '../sealedAuctionFactory/SealedAuctionFactory.fixture';
// import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
// import { deployConfidentialWETHFixture } from "../confidentialERC20/ConfidentialWETH.fixture";

// /**
//  * Deploys a SealedAuction contract via the factory.
//  *
//  * @param auctionOwner - The Signer who will be the auction owner.
//  * @param totalTokens - The asset supply (in token units).
//  * @param biddingTime - The auction duration (in seconds).
//  * @param minBidPrice - The minimum bid price.
//  * @param minBidQuantity - The minimum bid quantity.
//  * @param paymentType - Payment type: use 0 for ERC20 or 1 for Ether.
//  *
//  * @returns The deployed SealedAuction contract instance.
//  *
//  * @remarks
//  * Before calling this fixture, ensure that the auction owner has approved the transfer of
//  * asset tokens to the factory (since the factory will call `transferFrom` on the asset token).
//  */
// export async function SealedAuctionFixture(
//   auctionOwner: Signer,
//   totalTokens: BigNumberish,
//   biddingTime: BigNumberish,
//   minBidPrice: BigNumberish,
//   minBidQuantity: BigNumberish,
//   paymentType: BigNumberish // 0 for ERC20, 1 for Ether
// ): Promise<SealedAuction> {
//   // Deploy the asset token using the confidential ERC20 fixture.
//   const assetToken = await deployConfidentialERC20Fixture();

//   // For the payment token, choose based on paymentType.
//   let paymentToken;
//   if (paymentType === 0) {
//     // Payment in ERC20.
//     paymentToken = await deployConfidentialERC20Fixture();
//   } else if (paymentType === 1) {
//     // Payment in Ether, so we use ConfidentialWETH.
//     paymentToken = await deployConfidentialWETHFixture();
//   } else {
//     throw new Error("Invalid paymentType: expected 0 (ERC20) or 1 (Ether)");
//   }

//   // Deploy the default WETH token.
//   // (Even if payment is in ERC20, the factory requires a default WETH address.)
//   const defaultWETH = await deployConfidentialWETHFixture();

//   // Deploy the auction factory using the deployed confidential tokens.
//   const factory: SealedAuctionFactory = await SealedAuctionFactoryFixture(
//     assetToken.address,      // defaultAssetERC20
//     paymentToken.address,    // defaultPaymentERC20 (if paymentType is 0, otherwise this is not used)
//     defaultWETH.address      // defaultWETH
//   );

//   // Ensure that the auction owner has already approved the transfer of asset tokens
//   // to the factory before calling createAuction.

//   const auctionOwnerAddress = await auctionOwner.getAddress();

//   // Create the auction via the factory.
//   // The factory function signature is now:
//   // createAuction(auctionOwner, supply, biddingTime, minPrice, minQty, paymentType)
//   const tx = await factory.connect(auctionOwner).createAuction(
//     auctionOwnerAddress,
//     totalTokens,
//     biddingTime,
//     minBidPrice,
//     minBidQuantity,
//     paymentType
//   );
//   const receipt = await tx.wait();

//   // Extract the auction address from the AuctionCreated event.
//   const event = receipt.events?.find((e: any) => e.event === "AuctionCreated");
//   if (!event) {
//     throw new Error("AuctionCreated event not emitted");
//   }
//   const auctionAddress = event.args?.auctionAddress;
//   if (!auctionAddress) {
//     throw new Error("Auction address not found in event");
//   }

//   // Return the deployed auction instance.
//   return (await ethers.getContractAt("SealedAuction", auctionAddress)) as SealedAuction;
// }

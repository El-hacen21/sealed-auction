// import { AddressLike, BigNumberish, Signer } from 'ethers';
// import { ethers } from 'hardhat';
// import { FactoryOptions } from "@nomicfoundation/hardhat-ethers/types";

// import type { SealedAuction } from '../../types';

// export async function SealedAucitonFixture(
//   account: Signer,
//   tokenContractAddress: AddressLike,
//   totalTokens: BigNumberish,
//   biddingTime: BigNumberish,
//   minBidPrice: BigNumberish,
//   minBidQuantity: BigNumberish,
//   maxBidsPerAddress: BigNumberish
// ): Promise<SealedAuction> {
//   // Définir les options de la factory avec le Signer
//   const factoryOptions: FactoryOptions = {
//     signer: account
//   };

//   // Récupérer la factory pour le contrat alternatif (sans librairies supplémentaires)
//   const contractFactory = await ethers.getContractFactory(
//     "SealedAuction",
//     factoryOptions
//   );

//   // Déployer le contrat en passant les 4 paramètres attendus par le constructeur :
//   // (tokenContractAddress, totalTokens, biddingTime, minBidPrice)
//   const contract = await contractFactory.deploy(
//     tokenContractAddress,
//     totalTokens,
//     biddingTime,
//     minBidPrice,
//     minBidQuantity,
//     maxBidsPerAddress,
//   );

//   await contract.waitForDeployment();
//   return contract as SealedAuction;
// }


import { AddressLike, BigNumberish, Signer } from 'ethers';
import { ethers } from 'hardhat';

import type { SealedAuction } from '../../types';

export async function SealedAuctionFixture(
  account: Signer,
  tokenContractAddress: AddressLike,
  totalTokens: BigNumberish,
  biddingTime: BigNumberish,
  minBidPrice: BigNumberish,
  minBidQuantity: BigNumberish,
  maxBidsPerAddress: BigNumberish
): Promise<SealedAuction> {

  // Ensure that the signer is connected to a provider
  const provider = ethers.provider;
  const signer = account || (await ethers.getSigners())[0];

  // Get the contract factory with a proper signer
  const contractFactory = await ethers.getContractFactory("SealedAuction", signer);

  // Deploy the contract
  const contract = await contractFactory.deploy(
    tokenContractAddress,
    totalTokens,
    biddingTime,
    minBidPrice,
    minBidQuantity,
    maxBidsPerAddress
  );

  await contract.waitForDeployment();

  return contract as SealedAuction;
}

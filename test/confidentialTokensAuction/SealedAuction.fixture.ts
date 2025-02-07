import { AddressLike, BigNumberish, Signer } from 'ethers';
import { ethers } from 'hardhat';
import { FactoryOptions } from "@nomicfoundation/hardhat-ethers/types";

import type { SealedAuction } from '../../types';

export async function SealedAucitonFixture(
  account: Signer,
  tokenContractAddress: AddressLike,
  totalTokens: BigNumberish,
  biddingTime: BigNumberish,
  minBidPrice: BigNumberish,
  minBidQuantity: BigNumberish,
  maxBidsPerAddress: BigNumberish
): Promise<SealedAuction> {
  // Définir les options de la factory avec le Signer
  const factoryOptions: FactoryOptions = {
    signer: account
  };

  // Récupérer la factory pour le contrat alternatif (sans librairies supplémentaires)
  const contractFactory = await ethers.getContractFactory(
    "SealedAuciton",
    factoryOptions
  );

  // Déployer le contrat en passant les 4 paramètres attendus par le constructeur :
  // (tokenContractAddress, totalTokens, biddingTime, minBidPrice)
  const contract = await contractFactory.deploy(
    tokenContractAddress,
    totalTokens,
    biddingTime,
    minBidPrice,
    minBidQuantity,
    maxBidsPerAddress,
  );

  await contract.waitForDeployment();
  return contract as SealedAuction;
}

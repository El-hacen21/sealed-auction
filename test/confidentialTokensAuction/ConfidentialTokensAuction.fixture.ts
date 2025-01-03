import { AddressLike, BigNumberish, Signer } from 'ethers';
import { ethers } from 'hardhat';

import type { ConfidentialTokensAuction } from '../../types';

export async function deployConfidentialTokensAuctionFixture(
  account: Signer,
  tokenContract: AddressLike,
  totalTokens:BigNumberish,
  biddingTime: BigNumberish,
  isStoppable: boolean
): Promise<ConfidentialTokensAuction> {
  const contractFactory = await ethers.getContractFactory('ConfidentialTokensAuction');
  const contract = await contractFactory
    .connect(account)
    .deploy(tokenContract, totalTokens, biddingTime, isStoppable);
  await contract.waitForDeployment();
  return contract;
}
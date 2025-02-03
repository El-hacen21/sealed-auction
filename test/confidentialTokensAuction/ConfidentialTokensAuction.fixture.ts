import { AddressLike, BigNumberish, Signer } from 'ethers';
import { ethers } from 'hardhat';
import {
  FactoryOptions,
} from "@nomicfoundation/hardhat-ethers/types";

import type { ConfidentialTokensAuction } from '../../types';

export async function deployConfidentialTokensAuctionFixture(
  account: Signer,
  tokenContractAddress: AddressLike,
  sortingLibraryAddress: AddressLike,
  totalTokens:BigNumberish,
  biddingTime: BigNumberish
): Promise<ConfidentialTokensAuction> {

  

  // Define factory options with signer and libraries
  const factoryOptions: FactoryOptions = {
    signer: account, // Specify the signer to resolve overload
    libraries: {
      SortingNetworkLibrary: sortingLibraryAddress, // Ensure this is a string address
    },
  };

  // Get the contract factory with the specified options
  const contractFactory = await ethers.getContractFactory(
    "ConfidentialTokensAuction",
    factoryOptions 
  );

  // Deploy the contract without needing to connect again
  const contract = await contractFactory.deploy(
    tokenContractAddress,
    totalTokens,
    biddingTime
  );


  await contract.waitForDeployment();
  return contract as ConfidentialTokensAuction;

  // // const contractFactory = await ethers.getContractFactory('ConfidentialTokensAuction');
  // const contract = await contractFactory
  //   .connect(account)
  //   .deploy(tokenContractAddress, decryptionHelperAddress, totalTokens, biddingTime, isStoppable);
  // await contract.waitForDeployment();
  // return contract;
}
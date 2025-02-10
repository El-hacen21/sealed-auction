// SealedAuctionFactory.fixture.ts

import { ethers } from "hardhat";
import type { SealedAuctionFactory } from "../../types";
import { deployConfidentialERC20Fixture } from "../confidentialERC20/ConfidentialERC20.fixture";
import { deployConfidentialWETHFixture } from "../confidentialERC20/ConfidentialWETH.fixture";
import { getSigners, initSigners } from "../signers";

export async function SealedAuctionFactoryFixture(): Promise<SealedAuctionFactory> {
  await initSigners();
  const signers = await getSigners();
  const deployer = signers.alice;


  // Deploy confidential tokens to serve as the default tokens.
  const defaultAsset = await deployConfidentialERC20Fixture();
  const defaultPayment = await deployConfidentialERC20Fixture();
  const defaultWETH = await deployConfidentialWETHFixture(deployer);

  // console.log("deployer: ", deployer);

  // Get the deployer's current nonce.
  const nonce = await ethers.provider.getTransactionCount(deployer);

  // Precompute the factory address.
  const predictedFactoryAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: nonce,
  });

  // Deploy the factory contract with all three token addresses.
  const factoryFactory = await ethers.getContractFactory("SealedAuctionFactory", deployer);
  const factory = await factoryFactory.deploy(defaultAsset.getAddress(), defaultPayment.getAddress(), defaultWETH.getAddress());
  await factory.waitForDeployment();

  const contractAddress = await factory.getAddress();
  console.log("Deployed factory address:", contractAddress);

  // (Optional) Ensure that the deployed address matches the predicted address.
  if (contractAddress !== predictedFactoryAddress) {
    throw new Error("Deployed factory address does not match the hardcoded adress in SealedAuction");
  }

  return factory as SealedAuctionFactory;
}

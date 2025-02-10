import { ethers } from "hardhat";

import type { MyConfidentialERC20 } from "../../types";
import { getSigners } from "../signers";

export async function deployConfidentialERC20Fixture(): Promise<MyConfidentialERC20> {
  const signers = await getSigners();

  const contractFactory = await ethers.getContractFactory("MyConfidentialERC20", signers.alice);
  const contract = await contractFactory.deploy("Naraggara", "NARA"); // City of Zama's battle
  await contract.waitForDeployment();

  return contract;
}



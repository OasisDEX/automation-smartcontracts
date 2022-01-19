// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat'

async function main() {
    let delay: number
    let CDP_MANAGER_ADDRESS: string

  let delay : number;
  let CDP_MANAGER_ADDRESS : string;
  
  const provider = hre.ethers.provider;
  const signer = await provider.getSigner(0);
  console.log('Deployer address:',await signer.getAddress());
  console.log('Network :',hre.hardhatArguments.network);

  if(hre.hardhatArguments.network == "goerli"){
    delay = 0;
    CDP_MANAGER_ADDRESS = "0xdcBf58c9640A7bd0e062f8092d70fb981Bb52032";
  }else{
    delay = 1800;
    CDP_MANAGER_ADDRESS = "0x5ef30b9986345249bc32d8928B7ee64DE9435E39";
  }
  
  const ServiceRegistry = await hre.ethers.getContractFactory("ServiceRegistry");
  const AutomationBot = await hre.ethers.getContractFactory("AutomationBot");
  console.log("Deploying ServiceRegistry....");
  const instance = await ServiceRegistry.deploy(delay);
  const sr = await instance.deployed();
  console.log("Deploying AutomationBot....");
  const automationBotDeployment = await AutomationBot.deploy(sr.address);

  const bot = await automationBotDeployment.deployed();
  
  console.log("Adding CDP_MANAGER to ServiceRegistry....");
  await sr.addNamedService(
    await sr.getServiceNameHash("CDP_MANAGER"),
    CDP_MANAGER_ADDRESS
  ,{gasLimit:"100000"});

  console.log("Adding AUTOMATION_BOT to ServiceRegistry....");
  await sr.addNamedService(
    await sr.getServiceNameHash("AUTOMATION_BOT"),
    bot.address
  ,{gasLimit:"100000"});

  console.log("ServiceRegistry deployed to:",sr.address);
  console.log("AutomationBot deployed to:",bot.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})

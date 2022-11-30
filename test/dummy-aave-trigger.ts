import { DeployedSystem, deploySystem } from "../scripts/common/deploy-system";
import hre from 'hardhat'
import { utils as EthUtils, ethers } from 'ethers'
import { AutomationServiceName, getAdapterNameHash, getCommandHash, getEvents, getExecuteAdapterNameHash, getServiceNameHash, HardhatUtils } from "../scripts/common";
import { AccountFactoryLike, AutomationBot, DummyAaveWithdrawCommand, IAccountGuard, IAccountImplementation } from "../typechain";
import { CommandContractType, TriggerGroupType, TriggerType } from "@oasisdex/automation";
import { getDefinitionForCommandType } from "@oasisdex/automation/lib/src/mapping";
import { expect } from "chai";


describe.only('AAVE integration', async () => {

    let snapshotId: string
    let system : DeployedSystem
    let executorAddress: string
    let DPMAccount: IAccountImplementation
    let DPMFactory: AccountFactoryLike
    let DPMGuard: IAccountGuard
    let AutomationBotInstance: AutomationBot
    let AaveCommandInstance : DummyAaveWithdrawCommand
    let utils : HardhatUtils
    let triggerData : string

    before(async () => {


        utils = new HardhatUtils(hre);
        const provider = new ethers.providers.JsonRpcProvider(
            "http://localhost:8545"
          );
        await provider.send("hardhat_impersonateAccount", ['0x1b3cb81e51011b549d78bf720b0d924ac763a7c2']);
        const donor = provider.getSigner('0x1b3cb81e51011b549d78bf720b0d924ac763a7c2');

        donor.sendTransaction({
            to: '0x060c23F67FEBb04F4b5d5c205633a04005985a94',
            value: ethers.utils.parseEther('100')
        })
        
        executorAddress = await hre.ethers.provider.getSigner(0).getAddress()
        system = await deploySystem({ utils, addCommands: true, logDebug:true })
        console.log("System deployed")
        DPMFactory = await hre.ethers.getContractAt('AccountFactoryLike', "0x24432a08869578aAf4d1eadA12e1e78f171b1a2b");//utils.addresses.DPM_FACTORY);
        AutomationBotInstance = await hre.ethers.getContractAt('AutomationBot', utils.addresses.AUTOMATION_BOT_V2);
        DPMGuard = await hre.ethers.getContractAt('IAccountGuard', "0x707531c9999AaeF9232C8FEfBA31FBa4cB78d84a");// utils.addresses.DPM_GUARD);
        console.log("before account creation", DPMFactory.address)
        const tx = await (await DPMFactory["createAccount(address)"](executorAddress)).wait();
        console.log("account created")
        DPMAccount = await hre.ethers.getContractAt('IAccountImplementation', tx.events![1].args!.proxy);
        let signer = await utils.impersonate('0x060c23F67FEBb04F4b5d5c205633a04005985a94');
        console.log("Imperosnated signer", await signer.getAddress());
        console.log("executorAddress", executorAddress);

        AaveCommandInstance =  (await utils.deployContract(
            hre.ethers.getContractFactory('DummyAaveWithdrawCommand'),
            [system.aaveProxyActions!.address, utils.addresses.USDC_AAVE],
        )) as DummyAaveWithdrawCommand


        await system.serviceRegistry.addNamedService(getCommandHash(TriggerType.SimpleAAVESell), AaveCommandInstance!.address);
        await system.serviceRegistry.addNamedService(getAdapterNameHash(AaveCommandInstance.address), system.dpmAdapter!.address);
        await system.serviceRegistry.addNamedService(getExecuteAdapterNameHash(AaveCommandInstance.address), system.aaveAdapter!.address);
    
        console.log("DPMAccount", await DPMAccount.address);

        await DPMGuard.connect(signer)["setWhitelist(address,bool)"](system.aaveProxyActions?.address ,true);
        await DPMGuard.connect(signer)["setWhitelist(address,bool)"](system.automationBot.address ,true);
        console.log("APA whitelisted", (await system.aaveProxyActions?.aave()));
        const encodedData = system.aaveProxyActions!.interface.encodeFunctionData('openPosition');
        await (await DPMAccount.connect(await hre.ethers.provider.getSigner(0)).execute(system.aaveProxyActions?.address!,encodedData, {
            gasLimit: 10000000,
            value: hre.ethers.BigNumber.from(10).mul(hre.ethers.BigNumber.from(10).pow(18)),
        })).wait();

        
        const args = [DPMAccount.address, TriggerType.SimpleAAVESell, "1000000", 1800, DPMAccount.address]
        const types = getDefinitionForCommandType(CommandContractType.SimpleAAVESellCommand)
        triggerData =  EthUtils.defaultAbiCoder.encode(types, args)


    });
    
    beforeEach(async () => {
        snapshotId = await hre.ethers.provider.send('evm_snapshot', [])
    })

    afterEach(async () => {
        await hre.ethers.provider.send('evm_revert', [snapshotId])
    })

    it('should be able to add Trigger', async () => {
        const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
            TriggerGroupType.SingleTrigger,
            [true],
            [0],
            [triggerData],
            [TriggerType.SimpleAAVESell],
        ])
        const tx = DPMAccount.execute(system.automationBot.address, dataToSupply, {
            gasLimit: 10000000,
        })

        await expect(tx).to.not.be.reverted;

        const receipt = await( (await tx).wait());
    });
    
    describe('Trigger added', async () => {
        let triggerId: string

        before(async () => {
            const dataToSupply = AutomationBotInstance.interface.encodeFunctionData('addTriggers', [
                TriggerGroupType.SingleTrigger,
                [true],
                [0],
                [triggerData],
                [TriggerType.SimpleAAVESell],
            ])
            const tx = await DPMAccount.execute(system.automationBot.address, dataToSupply, {
                gasLimit: 10000000,
            })
            const receipt = await tx.wait();
            const addEvents = getEvents(receipt, system.automationBot.interface.getEvent('TriggerAdded'));
            triggerId = addEvents[0].args!.triggerId.toString();
            await system.serviceRegistry.updateNamedService(getServiceNameHash(AutomationServiceName.AUTOMATION_EXECUTOR), executorAddress);
        });
        
        it('trigger should be immediatelly eligible', async () => {
            const status = await AaveCommandInstance.isExecutionLegal(triggerData);
            expect(status).to.be.true;
        });
        it('trigger execution should not fail', async () => {
            const tx = DPMAccount.execute(system.automationBot.address, AutomationBotInstance.interface.encodeFunctionData('execute', 
            [
                "0x",
                triggerData,
                AaveCommandInstance.address,
                triggerId,
                "0",
                utils.addresses.USDC_AAVE,
            ]), {
                gasLimit: 10000000,
            })
            await expect(tx).to.not.be.reverted;
        });
    });
});
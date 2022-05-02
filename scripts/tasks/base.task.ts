import { task } from 'hardhat/config'
import { ConfigurableTaskDefinition } from 'hardhat/types'
import { Network } from '../common'

export interface BaseTaskArgs {
    dryrun: boolean
    forked?: Network
}

export function createTask<T extends BaseTaskArgs>(name: string, description: string): ConfigurableTaskDefinition {
    return task<T>(name, description)
        .addOptionalParam('forked', 'Forked network')
        .addFlag('dryrun', 'The flag indicating whether the task should be executed')
}

import { CLIArgumentType } from 'hardhat/types'
import { HardhatError } from 'hardhat/internal/core/errors'
import { ERRORS } from 'hardhat/internal/core/errors-list'
import { utils } from 'ethers'
import { BigNumber } from 'bignumber.js'
import { tryF, isError } from 'ts-try'

export const params = {
    address: {
        name: 'address',
        parse: (_argName, value) => value,
        validate: (argName, value) => {
            if (!utils.isAddress(value)) {
                throw new HardhatError(ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: 'address',
                })
            }
        },
    } as CLIArgumentType<string>,
    bignumber: {
        name: 'bignumber',
        parse: (argName, value) => {
            const val = tryF(() => new BigNumber(value))
            if (isError(val)) {
                throw new HardhatError(ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: 'bignumber',
                })
            }
            return val
        },
        validate: (argName, value) => {
            if (!BigNumber.isBigNumber(value)) {
                throw new HardhatError(ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
                    value,
                    name: argName,
                    type: 'bignumber',
                })
            }
        },
    } as CLIArgumentType<BigNumber>,
}

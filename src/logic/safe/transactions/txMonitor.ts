import { TransactionReceipt } from 'web3-core'

import { web3ReadOnly } from 'src/logic/wallets/getWeb3'
import { sameAddress } from 'src/logic/wallets/ethAddresses'
import { sameString } from 'src/utils/strings'

type TxMonitorProps = {
  sender: string
  hash: string
  data: string
  nonce?: number
  gasPrice?: string
}

type TxMonitorOptions = {
  delay?: number
}

/**
 * Recursively inspects a pending tx. Until it's found, and returns the mined tx receipt
 *
 * @param {object} txParams
 * @param {string} txParams.sender
 * @param {string} txParams.hash
 * @param {string} txParams.data
 * @param {number | undefined} txParams.nonce
 * @param {string | undefined} txParams.gasPrice
 * @param {function(txReceipt: TransactionReceipt): void} cb - called with the tx receipt as argument when tx is mined
 * @param {object} options
 * @param {number} options.delay
 */
export const txMonitor = async (
  { sender, hash, data, nonce, gasPrice }: TxMonitorProps,
  cb: (txReceipt: TransactionReceipt) => void,
  options?: TxMonitorOptions,
): Promise<void> => {
  setTimeout(async () => {
    if (nonce === undefined || gasPrice === undefined) {
      // this block is accessed only the first time, to lookup the tx nonce and gasPrice
      // find the nonce for the current tx
      const transaction = await web3ReadOnly.eth.getTransaction(hash)

      if (transaction !== null) {
        // transaction found
        console.info({ transaction })
        return txMonitor({ sender, hash, data, nonce: transaction.nonce, gasPrice: transaction.gasPrice }, cb, options)
      } else {
        return txMonitor({ sender, hash, data }, cb, options)
      }
    }

    web3ReadOnly.eth.getTransactionReceipt(hash).then((receipt) => {
      console.info({ receipt })
    })

    const latestBlock = await web3ReadOnly.eth.getBlock('latest', true)
    console.info({ latestBlock })

    const replacementTransaction = latestBlock.transactions.find((transaction) => {
      // TODO: use gasPrice, timestamp or another better way to differentiate
      return (
        sameAddress(transaction.from, sender) &&
        transaction.nonce === nonce &&
        !sameString(transaction.hash, hash) &&
        // if `data` differs, then it's a replacement tx, not a speedup
        sameString(transaction.input, data) &&
        // finally we make sure that we keep the latest tx or the one with the greatest `gasPrice`
        web3ReadOnly.utils.toBN(transaction.gasPrice).gt(web3ReadOnly.utils.toBN(gasPrice as string))
      )
    })
    console.info({ replacementTransaction })

    if (replacementTransaction) {
      const transactionReceipt = await web3ReadOnly.eth.getTransactionReceipt(replacementTransaction.hash)
      if (transactionReceipt === null) {
        // pending transaction
        return txMonitor(
          {
            sender,
            hash: replacementTransaction.hash,
            data: replacementTransaction.input,
            nonce,
            gasPrice: replacementTransaction.gasPrice,
          },
          cb,
          options,
        )
      }

      console.info({ transactionReceipt })
      cb(transactionReceipt)
      return
    }

    return txMonitor({ sender, hash, data, nonce, gasPrice }, cb, options)
  }, options?.delay ?? 500)
}
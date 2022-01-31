import Web3 from 'web3';
import chai from 'chai';
import compose from 'docker-compose';
import path from 'path';
import config from 'config';
import { fileURLToPath } from 'url';
import rand from '../common-files/utils/crypto/crypto-random.mjs';

const { dirname } = path;
const __dirname = dirname(fileURLToPath(import.meta.url));
const { expect } = chai;

const USE_INFURA = process.env.USE_INFURA === 'true';
const USE_ROPSTEN_NODE = process.env.USE_ROPSTEN_NODE === 'true';

export const topicEventMapping = {
  BlockProposed: '0x566d835e602d4aa5802ee07d3e452e755bc77623507825de7bc163a295d76c0b',
  Rollback: '0xea34b0bc565cb5f2ac54eaa86422ae05651f84522ef100e16b54a422f2053852',
  CommittedToChallenge: '0d5ea452ac7e354069d902d41e41e24f605467acd037b8f5c1c6fee5e27fb5e2',
};
export class Web3Client {
  constructor(url) {
    this.url = url || process.env.web3WsUrl;
    this.provider = new Web3.providers.WebsocketProvider(this.url, config.WEB3_PROVIDER_OPTIONS);
    this.web3 = new Web3(this.provider);
    this.isSubmitTxLocked = false;
  }

  getWeb3() {
    return this.web3;
  }

  getInfo() {
    return this.web3.eth.getNodeInfo();
  }

  // eslint-disable-next-line consistent-return
  connectWeb3(useState = true) {
    if (useState) {
      return new Promise(resolve => {
        console.log('Blockchain Connecting ...');

        this.provider.on('error', err => console.error(`web3 error: ${JSON.stringify(err)}`));
        this.provider.on('connect', () => {
          console.log('Blockchain Connected ...');
          resolve(this.web3);
        });
        this.provider.on('end', () => console.log('Blockchain disconnected'));
      });
    }
  }

  subscribeTo(event, queue, options) {
    this.web3.eth.subscribe(event, options).on('data', log => {
      if (log.topics[0] === topicEventMapping.BlockProposed) queue.push('blockProposed');
    });
  }

  closeWeb3() {
    this.web3.currentProvider.connection.close();
  }

  setNonce(privateKey, _nonce) {
    // This will be a mapping of privateKeys to nonces;
    this.nonceDict[privateKey] = _nonce;
  }

  getAccounts() {
    if (process.env.FROM_ADDRESS) return [process.env.FROM_ADDRESS];
    const accounts = this.web3.eth.getAccounts();
    return accounts;
  }

  getBalance(account) {
    return this.web3.eth.getBalance(account);
  }

  getIsSubmitTxLocked() {
    return this.isSubmitTxLocked;
  }

  async submitTransaction(unsignedTransaction, privateKey, shieldAddress, gasCount, value = 0) {
    while (this.isSubmitTxLocked) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    this.isSubmitTxLocked = true;
    let gas = gasCount;
    let gasPrice = 10000000000;
    let receipt;
    let nonce = this.nonceDict[privateKey];
    // if the nonce hasn't been set, then use the transaction count
    try {
      if (nonce === undefined) {
        const accountAddress = await this.web3.eth.accounts.privateKeyToAccount(privateKey);
        nonce = await this.web3.eth.getTransactionCount(accountAddress.address);
      }
      if (USE_INFURA || USE_ROPSTEN_NODE) {
        // get gaslimt from latest block as gaslimt may vary
        gas = (await this.web3.eth.getBlock('latest')).gasLimit;
        const blockGasPrice = Number(await this.web3.eth.getGasPrice());
        if (blockGasPrice > gasPrice) gasPrice = blockGasPrice;
      }
      const tx = {
        to: shieldAddress,
        data: unsignedTransaction,
        value,
        gas,
        gasPrice,
        nonce,
      };
      const signed = await this.web3.eth.accounts.signTransaction(tx, privateKey);
      nonce++;
      this.nonceDict[privateKey] = nonce;
      receipt = await this.web3.eth.sendSignedTransaction(signed.rawTransaction);
    } finally {
      this.isSubmitTxLocked = false;
    }
    return receipt;
  }

  // This only works with Ganache but it can move block time forwards
  async timeJump(secs) {
    await this.web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [secs],
      id: 0,
    });

    await this.web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_mine',
      params: [],
      id: 0,
    });
  }

  // This function polls for a particular event to be emitted by the blockchain
  // from a specified contract.  After retries, it will give up and error.
  // TODO could we make a neater job with setInterval()?
  async testForEvents(contractAddress, topics, retries) {
    // console.log('Listening for events');
    const WAIT = 1000;
    let counter = retries || Number(process.env.EVENT_RETRIEVE_RETRIES) || 3;
    let events;
    while (
      counter < 0 ||
      events === undefined ||
      events[0] === undefined ||
      events[0].transactionHash === undefined
    ) {
      // eslint-disable-next-line no-await-in-loop
      events = await this.web3.eth.getPastLogs({
        fromBlock: this.web3.utils.toHex(0),
        address: contractAddress,
        topics,
      });
      // console.log('EVENTS WERE', events);
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, WAIT));
      counter--;
    }
    if (counter < 0) {
      throw new Error(
        `No events found with in ${
          retries || Number(process.env.EVENT_RETRIEVE_RETRIES) || 3
        }retries of ${WAIT}ms wait`,
      );
    }
    // console.log('Events found');
    return events;
  }
}

export async function createBadBlock(badBlockType, block, transactions, args) {
  const badBlock = block;
  const badTransactions = transactions;
  switch (badBlockType) {
    case 'IncorrectRoot': {
      badBlock.root = (await rand(32)).hex();
      break;
    }
    case 'DuplicateTransaction': {
      delete badBlock.root; // we delete root, so that /proposer/encode below can recalculate the root.
      // We don't want the check-block in NO catch wrong root error. Hence this statement
      badTransactions[badTransactions.length - 1] = args.duplicateTransaction;
      break;
    }
    case 'InvalidDepositTransaction': {
      // if both tokenID and value are 0 for deposit, then this is an invalid deposit transaction
      badTransactions[0].tokenId =
        '0x0000000000000000000000000000000000000000000000000000000000000000';
      badTransactions[0].value =
        '0x0000000000000000000000000000000000000000000000000000000000000000';
      break;
    }
    case 'IncorrectHistoricRoot': {
      // Replace the historic root with a wrong historic root
      badTransactions[1].historicRootBlockNumberL2[0] = (await rand(8)).hex();
      break;
    }
    case 'IncorrectProof': {
      // use the proof of a prior transaction
      badTransactions[0].proof = args.proof;
      break;
    }
    case 'DuplicateNullifier': {
      // Find a transaction with a nullifier and replace one we have from earlier
      for (let i = 0; i < badTransactions.length; i++) {
        const nonZeroNullifier = badTransactions[i].nullifiers.findIndex(
          n => n !== '0x0000000000000000000000000000000000000000000000000000000000000000',
        );
        if (nonZeroNullifier >= 0) {
          badTransactions[i].nullifiers[nonZeroNullifier] = args.duplicateNullifier;
          break;
        }
      }
      break;
    }
    case 'IncorrectLeafCount': {
      // leafCount is normally re-computed by the /encode endpoint, to ensure
      // that it is correct. Of course that's not much use for this test, so we
      // make the value negative (and wrong). A negative value will tell /encode
      // not to recompute but to use the value we've given it (after flipping
      // the sign back)
      badBlock.leafCount = -badBlock.leafCount - 100;
      break;
    }
    default:
      break;
  }
  const {
    body: { txDataToSign, block: newBlock, transactions: newTransactions },
  } = await chai
    .request('http://localhost:8081')
    .post('/proposer/encode')
    .send({ block: badBlock, transactions: badTransactions });
  return { txDataToSign, block: newBlock, transactions: newTransactions };
}

/**
function to pause one client and one miner in the Geth blockchain for the
purposes of rollback testing.  This creates a sort of split-brain, that we can
use to force a change reorg when we reconnect the two halves.
It will only work with the standalone geth network!
*/
export async function pauseBlockchain(side) {
  const options = {
    cwd: path.join(__dirname),
    log: false,
    config: ['../docker-compose.standalone.geth.yml'],
    composeOptions: ['-p geth'],
  };
  const client = `blockchain${side}`;
  const miner = `blockchain-miner${side}`;
  try {
    await Promise.all([compose.pauseOne(client, options), compose.pauseOne(miner, options)]);
  } catch (err) {
    console.log(err);
    throw new Error(err);
  }
}
export async function unpauseBlockchain(side) {
  const options = {
    cwd: path.join(__dirname),
    log: false,
    config: ['../docker-compose.standalone.geth.yml'],
    composeOptions: ['-p geth'],
  };
  const client = `blockchain${side}`;
  const miner = `blockchain-miner${side}`;
  return Promise.all([compose.unpauseOne(client, options), compose.unpauseOne(miner, options)]);
}

/**
These are helper functions to reduce the repetitive code bloat in test files
 */

export const makeTransactions = async (txType, numTxs, url, txArgs) => {
  const transactions = (
    await Promise.all(
      Array.from({ length: numTxs }, () => chai.request(url).post(`/${txType}`).send(txArgs)),
    )
  ).map(res => res.body);

  return transactions;
};

export const sendTransactions = async (transactions, submitArgs, web3) => {
  const receiptArr = [];
  for (let i = 0; i < transactions.length; i++) {
    const { txDataToSign } = transactions[i];
    // eslint-disable-next-line no-await-in-loop
    const receipt = await web3.submitTransaction(txDataToSign, ...submitArgs);
    receiptArr.push(receipt);
  }
  return receiptArr;
};

export const expectTransaction = res => {
  expect(res).to.have.property('transactionHash');
  expect(res).to.have.property('blockHash');
};

export const depositNTransactions = async (nf3, N, ercAddress, tokenType, value, tokenId, fee) => {
  const depositTransactions = [];
  for (let i = 0; i < N; i++) {
    // eslint-disable-next-line no-await-in-loop
    const res = await nf3.deposit(ercAddress, tokenType, value, tokenId, fee);
    expectTransaction(res);
    depositTransactions.push(res);
  }
  return depositTransactions;
};

export const waitForEvent = async (eventLogs, expectedEvents, count = 1) => {
  const length = count !== 1 ? count : expectedEvents.length;
  let timeout = 10;
  while (eventLogs.length < length) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 3000));
    timeout--;
    if (timeout === 0) throw new Error('Timeout in waitForEvent');
  }

  while (eventLogs[0] !== expectedEvents[0]) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  expect(eventLogs[0]).to.equal(expectedEvents[0]);

  for (let i = 0; i < length; i++) {
    eventLogs.shift();
  }

  // Have to wait here as client block proposal takes longer now
  await new Promise(resolve => setTimeout(resolve, 3000));
  return eventLogs;
};

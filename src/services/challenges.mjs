import config from 'config';
import logger from '../utils/logger.mjs';
import { getContractInstance } from '../utils/contract.mjs';
import {
  getBlockByBlockHash,
  getTransactionByTransactionHash,
  getBlockByTransactionHash,
  retrieveMinedNullifiers,
  saveCommit,
} from './database.mjs';
import { getTreeHistory } from '../utils/timber.mjs';
import Web3 from '../utils/web3.mjs';
import rand from '../utils/crypto/crypto-random.mjs';

const { CHALLENGES_CONTRACT_NAME } = config;

let ws;

export function setChallengeWebSocketConnection(_ws) {
  ws = _ws;
}

async function commitToChallenge(txDataToSign) {
  const web3 = Web3.connection();
  const commitHash = web3.utils.soliditySha3({ t: 'bytes', v: txDataToSign });
  const challengeContractInstance = await getContractInstance(CHALLENGES_CONTRACT_NAME);
  const commitToSign = await challengeContractInstance.methods
    .commitToChallenge(commitHash)
    .encodeABI();
  logger.debug(
    `raw transaction for committing to challenge has been sent to be signed and submitted ${JSON.stringify(
      commitToSign,
      null,
      2,
    )}`,
  );
  ws.send(JSON.stringify({ type: 'commit', txDataToSign: commitToSign }));
  saveCommit(commitHash, txDataToSign);
}

export async function revealChallenge(txDataToSign) {
  logger.debug('raw challenge transaction has been sent to be signed and submitted');
  ws.send(JSON.stringify({ type: 'challenge', txDataToSign }));
}

/*
async function submitChallenge(txDataToSign) {
  await commitToChallenge(txDataToSign);
  revealChallenge(txDataToSign);
}
*/

export async function getTransactionsBlock(transactions, block, length) {
  if (length === block.transactionHashes.length) {
    return transactions;
  }
  transactions.push(await getTransactionByTransactionHash(block.transactionHashes[length]));
  return getTransactionsBlock(transactions, block, length + 1);
}

export async function createChallenge(block, transactions, err) {
  let txDataToSign;
  if (process.env.IS_CHALLENGER === 'true') {
    const challengeContractInstance = await getContractInstance(CHALLENGES_CONTRACT_NAME);
    const salt = (await rand(32)).hex(32);
    switch (err.code) {
      // Challenge wrong root
      case 0: {
        // Getting prior block hash for the current block
        const { previousHash } = await challengeContractInstance.methods
          .blockHashes(block.blockHash)
          .call();

        // Retrieve prior block from its block hash
        const priorBlock = await getBlockByBlockHash(previousHash);

        // Retrieve last transaction from prior block using its transaction hash.
        // Note that not all transactions in a block will have commitments. Loop until one is found
        let priorBlockTransactions = [];
        priorBlockTransactions = await getTransactionsBlock(priorBlockTransactions, priorBlock, 0);
        const priorBlockCommitmentsCount = priorBlockTransactions.reduce(
          (acc, priorBlockTransaction) => {
            return acc + priorBlockTransaction.commitments.length;
          },
          0,
        );

        const priorBlockHistory = await getTreeHistory(priorBlock.root);

        // Create a challenge
        txDataToSign = await challengeContractInstance.methods
          .challengeNewRootCorrect(
            priorBlock,
            priorBlockTransactions,
            priorBlockHistory.frontier,
            block,
            transactions,
            priorBlockHistory.leafIndex + priorBlockCommitmentsCount, // priorBlockHistory.leafIndex + number of commitments  in prior block
            salt,
          )
          .encodeABI();
        break;
      }
      // Challenge Duplicate Transaction
      case 1: {
        const transactionIndex1 = err.metadata.transactionHashIndex;

        // Get the block that contains the duplicate of the transaction
        const block2 = await getBlockByTransactionHash(
          block.transactionHashes[transactionIndex1],
          // true,
        );
        // Find the index of the duplication transaction in this block
        const transactionIndex2 = block2.transactionHashes.findIndex(
          transactionHash => transactionHash === block.transactionHashes[transactionIndex1],
        );

        // Create a challenge
        txDataToSign = await challengeContractInstance.methods
          .challengeNoDuplicateTransaction(
            block,
            block2,
            transactionIndex1, // index of duplicate transaction in block
            transactionIndex2,
            salt,
          )
          .encodeABI();
        break;
      }
      // invalid transaction type
      case 2: {
        const { transaction, transactionHashIndex: transactionIndex } = err.metadata;
        // Create a challenge
        txDataToSign = await challengeContractInstance.methods
          .challengeTransactionType(block, transaction, transactionIndex, salt)
          .encodeABI();
        logger.debug('returning raw transaction');
        logger.silly(`raw transaction is ${JSON.stringify(txDataToSign, null, 2)}`);
        break;
      }
      // invalid public input hash
      case 3: {
        const { transaction, transactionHashIndex: transactionIndex } = err.metadata;
        // Create a challenge
        txDataToSign = await challengeContractInstance.methods
          .challengePublicInputHash(block, transaction, transactionIndex, salt)
          .encodeABI();
        break;
      }
      // proof does not verify
      case 4: {
        const { transaction, transactionHashIndex: transactionIndex } = err.metadata;
        // Create a challenge
        txDataToSign = await challengeContractInstance.methods
          .challengeProofVerification(block, transaction, transactionIndex, salt)
          .encodeABI();
        break;
      }
      // Challenge Duplicate Nullfier
      case 5: {
        const storedMinedNullifiers = await retrieveMinedNullifiers(); // List of Nullifiers stored by blockProposer
        const blockNullifiers = transactions.map(tNull => tNull.nullifiers.toString()); // List of Nullifiers in block
        const alreadyMinedNullifiers = storedMinedNullifiers.filter(sNull =>
          blockNullifiers.includes(sNull.hash),
        );
        if (alreadyMinedNullifiers.length > 0) {
          const n = alreadyMinedNullifiers[0]; // We can only slash this block no matter which nullifier we pick anyways.
          const oldBlock = await getBlockByBlockHash(n.blockHash);
          const oldBlockTransactions = await Promise.all(
            oldBlock.transactionHashes.map(tx => getTransactionByTransactionHash(tx)),
          );
          const [oldTxIdx, oldNullifierIdx] = oldBlockTransactions
            .map((txs, txIndex) => [
              txIndex,
              txs.nullifiers.findIndex(oldN => oldN.toString() === n.hash),
            ])
            .filter(oldIdxs => oldIdxs[1] >= 0)
            .flat(Infinity);
          const [currentTxIdx, currentNullifierIdx] = transactions
            .map((txs, txIndex) => [
              txIndex,
              txs.nullifiers.findIndex(currN => currN.toString() === n.hash),
            ])
            .filter(currentIdx => currentIdx[1] >= 0)
            .flat(Infinity);
          txDataToSign = await challengeContractInstance.methods
            .challengeNullifier(
              block,
              transactions[currentTxIdx],
              currentTxIdx,
              currentNullifierIdx,
              oldBlock,
              oldBlockTransactions[oldTxIdx],
              oldTxIdx,
              oldNullifierIdx,
              salt,
            )
            .encodeABI();
        }
        break;
      }
      default:
      // code block
    }
    // now we need to commit to this challenge. When we have, this fact will be
    // picked up by the challenge-commit event-handler and a reveal will be sent
    // to intiate the challenge transaction (after checking we haven't been
    // front-run)
    commitToChallenge(txDataToSign);
  } else {
    // only proposer not a challenger
    logger.info(
      "Faulty block detected. Don't submit new blocks until the faulty blocks are removed",
    );
  }
}

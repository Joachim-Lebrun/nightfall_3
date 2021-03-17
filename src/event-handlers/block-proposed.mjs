import config from 'config';
import logger from '../utils/logger.mjs';
import checkBlock from '../services/check-block.mjs';
import BlockError from '../classes/block-error.mjs';
import createChallenge from '../services/challenges.mjs';
import {
  removeTransactionsFromMemPool,
  saveBlock,
  markBlockChecked,
} from '../services/database.mjs';
import mappedBlock from '../event-mappers/block-proposed.mjs';
import { getLeafCount } from '../utils/timber.mjs';

/**
This handler runs whenever a BlockProposed event is emitted by the blockchain
*/
const { TIMBER_SYNC_RETRIES } = config;
async function blockProposedEventHandler(data) {
  // convert web3js' version of a struct into our node objects.
  const { block, transactions, currentLeafCount } = mappedBlock(data);

  // Sync Optimist with Timber by checking number of leaves
  for (let i = 0; i < TIMBER_SYNC_RETRIES; i++) {
    const timberLeafCount = await getLeafCount();
    // Exponential Backoff
    const backoff = 2 ** i * 1000;
    if (currentLeafCount > timberLeafCount) {
      // Need to wait if the latest leaf count from the block is ahead of Timber
      logger.debug(`Timber doesn't appear synced: Waiting ${backoff}`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      if (i === TIMBER_SYNC_RETRIES) {
        throw new Error('Timber and Optimist appear out of sync');
      }
    } else break;
  }
  logger.info('Received BlockProposed event');
  // TODO this waits to be sure Timber is updated.  Instead write some proper syncing code!
  try {
    // and save the block to facilitate later lookup of block data
    // we will save before checking because the database at any time should reflect the state the blockchain holds
    // when a challenge is raised because the is correct block data, then the corresponding block deleted event will
    // update this collection
    await saveBlock(block);
    // we also need to mark as used the transactions in the block from our database of unprocessed transactions,
    // so we don't try to use them in a block which we're proposing.
    await removeTransactionsFromMemPool(block); // TODO is await needed?
    // we'll check the block and issue a challenge if appropriate
    await checkBlock(block, transactions);
    // mark that the block has been validated. Because a block is saved without checking when it is received, this flag will help
    // differentiate the state of the block in the collection
    await markBlockChecked(block);
    // signal to the block-making routines that a block is received: they
    // won't make a new block until their previous one is stored on-chain.
    logger.info('Block Checker - Block was valid');
  } catch (err) {
    if (err instanceof BlockError) {
      logger.warn(`Block Checker - Block invalid, with code ${err.code}! ${err.message}`);
      await createChallenge(block, transactions, err);
    } else throw new Error(err);
  }
}

export default blockProposedEventHandler;

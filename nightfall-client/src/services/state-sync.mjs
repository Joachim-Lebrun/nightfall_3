/* eslint-disable no-await-in-loop */

import config from 'config';
import blockProposedEventHandler from '../event-handlers/block-proposed.mjs';
import rollbackEventHandler from '../event-handlers/rollback.mjs';
import { waitForContract } from '../event-handlers/subscribe.mjs';

// TODO can we remove these await-in-loops?

const { STATE_CONTRACT_NAME } = config;

async function replay(pastStateEvents) {
  const splicedList = pastStateEvents.sort((a, b) => a.blockNumber - b.blockNumber);
  for (let i = 0; i < splicedList.length; i++) {
    const pastEvent = splicedList[i];
    switch (pastEvent.event) {
      case 'Rollback':
        // eslint-disable-next-line no-await-in-loop
        await rollbackEventHandler(pastEvent);
        break;
      case 'BlockProposed':
        // eslint-disable-next-line no-await-in-loop
        await blockProposedEventHandler(pastEvent);
        break;
      default:
        break;
    }
  }
  // return the block of the last event replayed.  Useful for chaining
  return pastStateEvents.slice(-1).blockNumber;
}
/*
Syncing nightfall client is relatively straightforward. We don't really
have the possibility to look for gaps in its blockchain record because it only
saves blockhashes when it has an interest in them i.e they contain a nullifier
for one of its commitments. Thus we simply replay the events from the begining.
If we do that, we will end up with all of the commitments in the correct state.
Note that, unlike Timber and Optimist, Client cannot recover its database
from the blockchain record.  The best it can do is recover the spend state of
each commitment.
*/
async function syncState(
  proposer,
  fromBlock = 'earliest',
  toBlock = 'latest',
  eventFilter = 'allEvents',
) {
  const stateContractInstance = await waitForContract(STATE_CONTRACT_NAME); // Rollback, BlockProposed
  // We'll replay all the events, then check that no events have happened while
  // we're busy doing the replay and loop like that until all events are replayed
  let lastBlockNumber = fromBlock;
  let pastStateEvents = [];
  do {
    pastStateEvents = await stateContractInstance.getPastEvents(eventFilter, {
      fromBlock: lastBlockNumber,
      toBlock,
    });
    lastBlockNumber = await replay(pastStateEvents);
  } while (pastStateEvents.length > 1);
}

export default syncState;

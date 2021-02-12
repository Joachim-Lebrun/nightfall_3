import logger from './utils/logger.mjs';
import app from './app.mjs';
import {
  subscribeToBlockProposedEvent,
  blockProposedEventHandler,
  subscribeToNewCurrentProposer,
  newCurrentProposerEventHandler,
  subscribeToTransactionSubmitted,
  transactionSubmittedEventHandler,
  subscribeToBlockAssembledWebSocketConnection,
  subscribeToChallengeWebSocketConnection,
} from './event-handlers/index.mjs';
import Proposer from './classes/proposer.mjs';
import {
  conditionalMakeBlock,
  setBlockAssembledWebSocketConnection,
} from './services/propose-block.mjs';
import { setChallengeWebSocketConnection } from './services/challenges.mjs';

const main = async () => {
  try {
    const proposer = new Proposer();
    // subscribe to blockchain events
    subscribeToBlockProposedEvent(blockProposedEventHandler);
    subscribeToNewCurrentProposer(newCurrentProposerEventHandler, proposer);
    subscribeToTransactionSubmitted(transactionSubmittedEventHandler);
    // subscribe to WebSocket events
    subscribeToBlockAssembledWebSocketConnection(setBlockAssembledWebSocketConnection);
    subscribeToChallengeWebSocketConnection(setChallengeWebSocketConnection);
    // start making blocks whenever we can
    conditionalMakeBlock(proposer);
    app.listen(80);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

main();

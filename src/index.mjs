import logger from './utils/logger.mjs';
import app from './app.mjs';
import {
  subscribeToBlockProposedEvent,
  blockProposedEventHandler,
  subscribeToNewCurrentProposer,
  newCurrentProposerEventHandler,
  subscribeToChallengeWebSocketConnection,
} from './event-handlers/index.mjs';
import { setChallengeWebSocketConnection } from './services/challenges.mjs';

const main = async () => {
  try {
    await subscribeToBlockProposedEvent(blockProposedEventHandler);
    await subscribeToNewCurrentProposer(newCurrentProposerEventHandler);
    await subscribeToChallengeWebSocketConnection(setChallengeWebSocketConnection);
    app.listen(80);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

main();

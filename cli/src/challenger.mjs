/**
Module that runs up as a challenger
*/
import { Command } from 'commander/esm.mjs';
import clear from 'clear';
import Nf3 from '../lib/nf3.mjs';

const defaultKey = '0xd42905d0582c476c4b74757be6576ec323d715a0c7dcff231b6348b7ab0190eb';
const program = new Command();
program.option('-k, --key', 'Ethereum signing key', defaultKey);
program.option('-h', '--help', 'Help');
if (program.opts().help) console.log('-k | --key input an Ethereum signing key to use');
const ethereumSigningKey = program.opts().key || defaultKey;

/**
Does the preliminary setup and starts listening on the websocket
*/
async function startChallenger() {
  clear();
  console.log('Starting Challenger...');
  const nf3 = new Nf3(
    'http://localhost:8080',
    'http://localhost:8081',
    'ws://localhost:8082',
    'ws://localhost:8546',
    ethereumSigningKey,
  );
  await nf3.init();
  if (await nf3.healthcheck('optimist')) console.log('Healthcheck passed');
  else throw new Error('Healthcheck failed');
  await nf3.registerChallenger();
  console.log('Challenger registration complete');
  nf3.startChallenger();
  console.log('Listening for incoming events');
}

startChallenger();
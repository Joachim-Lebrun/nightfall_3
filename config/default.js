module.exports = {
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
  MONGO_URL: process.env.MONGO_URL || 'mongodb://localhost:27017/',
  COMMITMENTS_DB: 'nightfall_commitments',
  WALLETS_COLLECTION: 'wallets',
  COMMITMENTS_COLLECTION: 'commitments',
  ZKP_KEY_LENGTH: 32, // use a 32 byte key length for SHA compatibility
  PROTOCOL: 'http://', // connect to zokrates microservice like this
  ZOKRATES_WORKER_HOST: process.env.ZOKRATES_WORKER_HOST || 'worker',
  BLOCKCHAIN_WS_HOST: process.env.BLOCKCHAIN_WS_HOST || 'openethereum',
  BLOCKCHAIN_PORT: process.env.BLOCKCHAIN_PORT || '8546',
  TIMBER_HOST: process.env.TIMBER_HOST || 'timber',
  TIMBER_PORT: process.env.TIMBER_PORT || 80,
  WEB3_OPTIONS: {
    gas: process.env.GAS || 1000000,
    gasPrice: process.env.GAS_PRICE || '20000000000',
    from: process.env.FROM_ADDRESS || undefined,
  },
  CONTRACT_ARTIFACTS: '/app/build/contracts',
  SHIELD_CONTRACT_NAME: 'Shield',
  PROVING_SCHEME: 'gm17',
  BACKEND: 'libsnark',
  CURVE: 'bn128',
  PROOF_QUEUE: 'generate-proof',
  BN128_PRIME:  21888242871839275222246405745257275088548364400416034343698204186575808495617n,
};

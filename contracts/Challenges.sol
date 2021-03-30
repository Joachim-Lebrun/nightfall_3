// SPDX-License-Identifier: CC0-1.0

/**
Contract to enable someone to challenge a proposed transaction, on a number of
grounds.
@Author Westlad
*/

pragma solidity ^0.8.0;
//pragma experimental ABIEncoderV2;

import './Proposers.sol';
import './Key_Registry.sol';
import './MerkleTree_Stateless.sol';
import './Utils.sol';
import './ChallengesUtil.sol';


contract Challenges is Proposers, Key_Registry {

  mapping(bytes32 => address) public committers;

  // a transaction proof is challenged as incorrect
  function challengeProofVerifies(
    Block memory blockL2,
    Transaction memory transaction,
    uint transactionIndex, // the location of the transaction in the block (saves a loop)
    bytes32 salt // salt for the commitementHash
  ) public {
    checkCommit(msg.data, salt);
    isBlockReal(blockL2); // check the block exists
    ChallengesUtil.libChallengeProofVerifies(blockL2,transaction,transactionIndex,vks[transaction.transactionType]);
    challengeAccepted(blockL2);
  }

  // a transaction proof is challenged as incorrect.  Does not require the
  // index of the transaction in the block, but uses more Gas as it has to
  // search for it
  function challengeProofVerifies(
    Block memory blockL2,
    Transaction memory transaction,
    bytes32 salt
  ) external {
    isBlockReal(blockL2); // check the block exists
    for (uint i = 0; i < blockL2.transactionHashes.length; i++){
      if (transaction.transactionHash == blockL2.transactionHashes[i] ) {
        challengeProofVerifies(blockL2, transaction, i, salt);
        return;
      }
    }
    revert('Transaction not found in this block');
  }

  // the new commitment Merkle-tree root is challenged as incorrect
  function challengeNewRootCorrect(
    Block memory priorBlockL2, // the block immediately prior to this one
    Transaction[] memory priorBlockTransactions, // the transactions in the prior block
    bytes32[33] calldata frontierPriorBlock, // frontier path before prior block is added. The same frontier used in calculating root when prior block is added
    Block memory blockL2,
    Transaction[] memory transactions,
    uint commitmentIndex, // the index *in the Merkle Tree* of the commitment that we are providing a SiblingPath for.
    bytes32 salt
  ) external {
    checkCommit(msg.data, salt);
    // first, check we have real, in-train, contiguous blocks
    require(blockHashes[priorBlockL2.blockHash].nextHash == blockHashes[blockL2.blockHash].thisHash, 'The blocks are not contiguous');
    // check if the block hash is correct and the block hash exists for the prior block
    isBlockReal(priorBlockL2);
    isBlockHashCorrect(priorBlockL2);
    isBlockReal(blockL2);
    isBlockHashCorrect(blockL2);
    ChallengesUtil.libChallengeNewRootCorrect(priorBlockL2, priorBlockTransactions, frontierPriorBlock, blockL2, transactions, commitmentIndex);
    challengeAccepted(blockL2);
  }


  function challengeNoDuplicateTransaction(
    Block memory block1,
    Block memory block2,
    uint transactionIndex1,
    uint transactionIndex2,
    bytes32 salt
  ) external {
    checkCommit(msg.data, salt);
    // first, check we have real, in-train, contiguous blocks
    isBlockReal(block1);
    isBlockHashCorrect(block1);
    isBlockReal(block2);
    isBlockHashCorrect(block2);
    // Check if a duplicate transaction exists in these blocks
    require(block1.transactionHashes[transactionIndex1] == block1.transactionHashes[transactionIndex2],
      'There is no duplicate transaction in these blocks');
    // Delete the latest block of the two
    if(blockHashes[block1.blockHash].data > blockHashes[block2.blockHash].data) {
      challengeAccepted(block1);
    } else {
      challengeAccepted(block2);
    }
  }

  // TODO more challenges must be added but these will do to demo the principle

  // This gets called when a challenge succeeds
  function challengeAccepted(Block memory badBlock) private {
    // emit the leafCount where the bad block was added. Timber will pick this
    // up and rollback its database to that point.
    emit Rollback(badBlock.root, badBlock.leafCount);
    // as we have a rollback, we need to reset the leafcount to the point
    // where the bad block was created.  Luckily, we noted that value in
    // the block when the block was proposed. It was check onchain so must be
    // correct.
    leafCount = badBlock.leafCount;
    // we need to remove the block that has been successfully
    // challenged from the linked list of blocks and all of the subsequent
    // blocks
    removeBlockHashes(badBlock.blockHash);
    // remove the proposer and re-join the chain where they've been removed
    removeProposer(badBlock.proposer);
    // give the proposer's block stake to the challenger
    pendingWithdrawals[msg.sender] += BLOCK_STAKE;
    // TODO repay the fees of the transactors and any escrowed funds held by the
    // Shield contract.
  }

  /*
   This is a challenge that a nullifier has already been spent
   For this challenge to succeed a challenger provides:
   the indices for the same nullifier in two **different** transactions contained in two blocks (note it should also be ok for the blocks to be the same)
  */
  function challengeNullifier(
    Block memory block1,
    Transaction memory tx1,
    uint transactionIndex1,
    uint nullifierIndex1,
    Block memory block2,
    Transaction memory tx2,
    uint transactionIndex2,
    uint nullifierIndex2,
    bytes32 salt
  ) public {
    checkCommit(msg.data, salt);
    require(tx1.nullifiers[nullifierIndex1] == tx2.nullifiers[nullifierIndex2], 'Not matching nullifiers' );
    require(tx1.transactionHash != tx2.transactionHash, 'Transactions need to be different' );
    require(Utils.hashTransaction(tx1) == block1.transactionHashes[transactionIndex1], 'First Tx not in block' );
    require(Utils.hashTransaction(tx2) == block2.transactionHashes[transactionIndex2], 'Second Tx not in block' );
    isBlockReal(block1);
    isBlockReal(block2);

    if (block1.blockHash == block2.blockHash){ //They are the same block
      challengeAccepted(block1);
    }

    // The blocks are different and we prune the later block of the two
    // simplest first check is to use the timestamp
    if (blockHashes[block1.blockHash].data > blockHashes[block2.blockHash].data){
      challengeAccepted(block1);
    } else if (blockHashes[block1.blockHash].data < blockHashes[block2.blockHash].data) {
      challengeAccepted(block2);
    } else {
      // They are within the same L1 blocktime so we need to walk the linked hashmap
      bytes32 checkHash = endHash;

      // Check safety of this condition (gas costs?)
      while(blockHashes[checkHash].previousHash != ZERO) {
          if(blockHashes[checkHash].previousHash == block1.blockHash) {
            challengeAccepted(block1);
            break;
          }
          if(blockHashes[checkHash].previousHash == block2.blockHash) {
            challengeAccepted(block2);
            break;
          }
          checkHash = blockHashes[checkHash].previousHash;
      }
    }
  }
  function removeBlockHashes(bytes32 blockHash) internal {
    bytes32 hash = blockHash;
    endHash = blockHashes[hash].previousHash;
    do {
      emit BlockDeleted(hash);
      bytes32 nextHash = blockHashes[hash].nextHash;
      delete blockHashes[hash];
      hash = nextHash;
    } while(hash != ZERO);
    blockHashes[endHash].nextHash = ZERO; // terminate the chain correctly
  }

  //To prevent frontrunning, we need to commit to a challenge before we send it
  function commitToChallenge(bytes32 commitmentHash) external {
    require(committers[commitmentHash] == address(0), 'This hash is already committed to');
    committers[commitmentHash] = msg.sender;
    emit CommittedToChallenge(commitmentHash, msg.sender);
  }
  // and having sent it, we need to check that commitment to a challenge from
  // within the challenge function using this function:
  function checkCommit(bytes calldata messageData, bytes32 salt) private {
    bytes32 hash = keccak256(messageData);
    salt = 0; // not really required as salt is in msg.data but stops the unused variable compiler warning. Bit of a waste of gas though.
    require(committers[hash] == msg.sender, 'The commitment hash is invalid');
    delete committers[hash];
  }
}

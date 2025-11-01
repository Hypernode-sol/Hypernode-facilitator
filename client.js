/**
 * Hypernode Facilitator Client
 *
 * Integration with the official Facilitator smart contract
 * for x402 payments, node registration, and reward distribution
 */

import pkg from '@coral-xyz/anchor';
const { AnchorProvider, Program, web3, BN } = pkg;
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import facilitatorIdl from './idl.json' with { type: 'json' };
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const FACILITATOR_PROGRAM_ID = new PublicKey(
  process.env.FACILITATOR_PROGRAM_ID || 'HYPRfaci11tator1111111111111111111111111111'
);

const HYPER_MINT = new PublicKey(
  process.env.HYPER_MINT || '92s9qna3djkMncZzkacyNQ38UKnNXZFh4Jgqe3Cmpump'
);

// Oracle authority (in production, use a secure keypair)
const ORACLE_AUTHORITY = process.env.ORACLE_PRIVATE_KEY
  ? Keypair.fromSecretKey(new Uint8Array(JSON.parse(process.env.ORACLE_PRIVATE_KEY)))
  : Keypair.generate();

class FacilitatorClient {
  constructor(connection, programId = FACILITATOR_PROGRAM_ID) {
    this.connection = connection || new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      'confirmed'
    );

    this.programId = programId;
    this.oracleAuthority = ORACLE_AUTHORITY;

    // Create wallet for backend operations
    const wallet = {
      publicKey: this.oracleAuthority.publicKey,
      signTransaction: async (tx) => {
        tx.partialSign(this.oracleAuthority);
        return tx;
      },
      signAllTransactions: async (txs) => {
        return txs.map(tx => {
          tx.partialSign(this.oracleAuthority);
          return tx;
        });
      },
    };

    const provider = new AnchorProvider(
      this.connection,
      wallet,
      { commitment: 'confirmed' }
    );

    this.program = new Program(facilitatorIdl, provider);

    console.log('[Facilitator] Initialized');
    console.log(`[Facilitator] Program ID: ${this.programId.toString()}`);
    console.log(`[Facilitator] Oracle: ${this.oracleAuthority.publicKey.toString()}`);
  }

  /**
   * Derive Node PDA
   */
  deriveNodePDA(nodeId) {
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from('node'), Buffer.from(nodeId)],
      this.programId
    );
    return { pda, bump };
  }

  /**
   * Derive Payment Intent PDA
   */
  derivePaymentIntentPDA(intentId) {
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from('intent'), Buffer.from(intentId)],
      this.programId
    );
    return { pda, bump };
  }

  /**
   * Derive Usage Proof PDA
   */
  deriveUsageProofPDA(intentId) {
    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from('proof'), Buffer.from(intentId)],
      this.programId
    );
    return { pda, bump };
  }

  /**
   * Register a node in the Facilitator
   */
  async registerNode(authorityPubkey, nodeId, stakeAmount = 0) {
    try {
      console.log(`[Facilitator] Registering node: ${nodeId}`);

      const authority = new PublicKey(authorityPubkey);
      const { pda: nodeAccount } = this.deriveNodePDA(nodeId);

      // Get token accounts
      const stakingAccount = await getAssociatedTokenAddress(
        HYPER_MINT,
        nodeAccount,
        true // allowOwnerOffCurve
      );

      const tx = await this.program.methods
        .registerNode(nodeId, new BN(stakeAmount))
        .accounts({
          node: nodeAccount,
          authority,
          stakingAccount,
          hyperMint: HYPER_MINT,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`[Facilitator] Node registered. TX: ${tx}`);

      return {
        success: true,
        nodeAccount: nodeAccount.toString(),
        stakingAccount: stakingAccount.toString(),
        txSignature: tx,
      };

    } catch (error) {
      console.error('[Facilitator] Failed to register node:', error);
      throw error;
    }
  }

  /**
   * Create and authorize a payment intent (x402 protocol)
   */
  async authorizePayment(clientPubkey, intentId, amount, expiresAt) {
    try {
      console.log(`[Facilitator] Authorizing payment: ${intentId}`);

      const client = new PublicKey(clientPubkey);
      const { pda: paymentIntent } = this.derivePaymentIntentPDA(intentId);

      // Get escrow PDA
      const [escrow] = PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), Buffer.from(intentId)],
        this.programId
      );

      // Get token accounts
      const clientTokenAccount = await getAssociatedTokenAddress(
        HYPER_MINT,
        client
      );

      const escrowTokenAccount = await getAssociatedTokenAddress(
        HYPER_MINT,
        escrow,
        true
      );

      // Create payment intent data
      const intentData = {
        intentId,
        amount: new BN(amount),
        expiresAt: new BN(expiresAt),
      };

      const tx = await this.program.methods
        .authorizePayment(intentData)
        .accounts({
          paymentIntent,
          client,
          escrow,
          clientTokenAccount,
          escrowTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`[Facilitator] Payment authorized. TX: ${tx}`);

      return {
        success: true,
        paymentIntent: paymentIntent.toString(),
        escrow: escrow.toString(),
        txSignature: tx,
        amount,
      };

    } catch (error) {
      console.error('[Facilitator] Failed to authorize payment:', error);
      throw error;
    }
  }

  /**
   * Submit usage proof from Oracle
   * This releases payment to the node
   */
  async submitUsageProof(intentId, nodeId, executionHash, logsHash) {
    try {
      console.log(`[Facilitator] Submitting usage proof for: ${intentId}`);

      const { pda: usageProof } = this.deriveUsageProofPDA(intentId);
      const { pda: paymentIntent } = this.derivePaymentIntentPDA(intentId);
      const { pda: nodeAccount } = this.deriveNodePDA(nodeId);

      // Get escrow
      const [escrow] = PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), Buffer.from(intentId)],
        this.programId
      );

      // Get node token account
      const nodeTokenAccount = await getAssociatedTokenAddress(
        HYPER_MINT,
        nodeAccount,
        true
      );

      const proofData = {
        intentId,
        nodeId,
        executionHash,
        logsHash,
      };

      const tx = await this.program.methods
        .submitUsageProof(proofData)
        .accounts({
          usageProof,
          paymentIntent,
          node: nodeAccount,
          oracle: this.oracleAuthority.publicKey,
          escrow,
          nodeTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([this.oracleAuthority])
        .rpc();

      console.log(`[Facilitator] Usage proof submitted. TX: ${tx}`);

      return {
        success: true,
        usageProof: usageProof.toString(),
        txSignature: tx,
      };

    } catch (error) {
      console.error('[Facilitator] Failed to submit usage proof:', error);
      throw error;
    }
  }

  /**
   * Claim rewards (node owner withdraws earnings)
   */
  async claimRewards(authorityPubkey, nodeId, amount) {
    try {
      console.log(`[Facilitator] Claiming rewards for node: ${nodeId}`);

      const authority = new PublicKey(authorityPubkey);
      const { pda: nodeAccount } = this.deriveNodePDA(nodeId);

      const stakingAccount = await getAssociatedTokenAddress(
        HYPER_MINT,
        nodeAccount,
        true
      );

      const authorityTokenAccount = await getAssociatedTokenAddress(
        HYPER_MINT,
        authority
      );

      const tx = await this.program.methods
        .claimRewards(new BN(amount))
        .accounts({
          node: nodeAccount,
          authority,
          stakingAccount,
          authorityTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(`[Facilitator] Rewards claimed. TX: ${tx}`);

      return {
        success: true,
        amount,
        txSignature: tx,
      };

    } catch (error) {
      console.error('[Facilitator] Failed to claim rewards:', error);
      throw error;
    }
  }

  /**
   * Get node account data
   */
  async getNodeAccount(nodeId) {
    try {
      const { pda } = this.deriveNodePDA(nodeId);
      const account = await this.program.account.nodeAccount.fetch(pda);

      return {
        address: pda.toString(),
        authority: account.authority.toString(),
        nodeId: account.nodeId,
        stakeAmount: account.stakeAmount.toString(),
        totalEarned: account.totalEarned.toString(),
        jobsCompleted: account.jobsCompleted.toString(),
        isActive: account.isActive,
        registeredAt: new Date(account.registeredAt.toNumber() * 1000),
      };

    } catch (error) {
      if (error.message.includes('Account does not exist')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get payment intent data
   */
  async getPaymentIntent(intentId) {
    try {
      const { pda } = this.derivePaymentIntentPDA(intentId);
      const account = await this.program.account.paymentIntent.fetch(pda);

      return {
        address: pda.toString(),
        client: account.client.toString(),
        intentId: account.intentId,
        amount: account.amount.toString(),
        status: Object.keys(account.status)[0], // enum to string
        createdAt: new Date(account.createdAt.toNumber() * 1000),
        expiresAt: new Date(account.expiresAt.toNumber() * 1000),
      };

    } catch (error) {
      if (error.message.includes('Account does not exist')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Generate x402 payment intent hash
   */
  generateIntentHash(intentData) {
    const message = JSON.stringify(intentData);
    return crypto.createHash('sha256').update(message).digest('hex');
  }

  /**
   * Generate execution proof hash
   */
  generateExecutionHash(logs, result) {
    const data = JSON.stringify({ logs, result, timestamp: Date.now() });
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

// Lazy singleton instance to avoid startup errors
let facilitatorClientInstance = null;

function getFacilitatorClient() {
  if (!facilitatorClientInstance) {
    try {
      facilitatorClientInstance = new FacilitatorClient();
    } catch (error) {
      console.warn('[Facilitator] Failed to initialize (likely due to invalid program ID):', error.message);
      // Return mock client for development
      facilitatorClientInstance = {
        authorizePayment: async () => ({ escrow: 'mock-escrow', txSignature: 'mock-tx' }),
        submitUsageProof: async () => ({ txSignature: 'mock-tx' }),
        getNodeAccount: async () => null,
        getPaymentIntent: async () => null,
        generateExecutionHash: (logs, result) => 'mock-hash',
      };
    }
  }
  return facilitatorClientInstance;
}

export default getFacilitatorClient();
export { FacilitatorClient, FACILITATOR_PROGRAM_ID, HYPER_MINT, getFacilitatorClient };

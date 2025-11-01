/**
 * Facilitator Integration Routes (Hybrid x402-solana Implementation)
 *
 * API routes that integrate with Hypernode Facilitator
 * for x402 payments and node management
 *
 * Now supports x402-solana client format with HYPER token
 */

import express from 'express';
import multer from 'multer';
import facilitatorClient from '../facilitator/client.js';
import { PaymentIntent, X402Verifier, intentStore } from '../facilitator/x402.js';
import { createX402SolanaAdapter } from '../facilitator/x402-solana-adapter.js';
import { requireAuth } from '../auth.js';
import * as jobs from '../db/dao/jobs.js';
import * as nodes from '../db/dao/nodes.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Create x402-solana adapter instance
const x402Adapter = createX402SolanaAdapter({
  network: process.env.SOLANA_NETWORK || 'solana-devnet',
  treasuryAddress: process.env.TREASURY_WALLET_ADDRESS,
  hyperTokenMint: process.env.HYPER_TOKEN_MINT_DEVNET,
});

/**
 * POST /api/facilitator/register-node
 * Register a node using Facilitator smart contract
 */
router.post('/register-node', requireAuth, async (req, res) => {
  try {
    const { nodeId, stakeAmount } = req.body;
    const walletAddress = req.user.wallet;

    // Register node on-chain via Facilitator
    const result = await facilitatorClient.registerNode(
      walletAddress,
      nodeId,
      stakeAmount || 0
    );

    // Also register in database for off-chain tracking
    await nodes.createNode({
      nodeId,
      walletAddress,
      hostname: req.body.hostname,
      gpuInfo: req.body.gpuInfo,
      location: req.body.location,
      stakeAmount: stakeAmount || 0,
    });

    res.json({
      success: true,
      ...result,
      message: 'Node registered successfully on Facilitator',
    });

  } catch (error) {
    console.error('[Facilitator API] Register node failed:', error);
    res.status(500).json({
      error: 'Failed to register node',
      message: error.message,
    });
  }
});

/**
 * POST /api/facilitator/submit-job
 * Submit job with x402-solana payment (Hybrid Implementation)
 *
 * Supports both FormData and JSON payloads
 * Compatible with x402-solana client format
 */
router.post('/submit-job', upload.fields([
  { name: 'script', maxCount: 1 },
  { name: 'dataset_0', maxCount: 1 },
  { name: 'dataset_1', maxCount: 1 },
  { name: 'dataset_2', maxCount: 1 },
]), async (req, res) => {
  try {
    const {
      jobId,
      jobType,
      resourceType,
      description,
      estimatedTime,
      paymentAmount,
      tokenMint,
      network,
      requirements,
    } = req.body;

    // Extract wallet from body or payment header
    const walletAddress = req.body.wallet;

    // 1. Extract payment from x402-solana header (if present)
    const paymentHeader = x402Adapter.extractPayment(req.headers);

    // 2. Create payment requirements
    const paymentRequirements = x402Adapter.createPaymentRequirements({
      jobId,
      amount: paymentAmount,
      description,
      resource: '/api/facilitator/submit-job',
      estimatedTime: parseInt(estimatedTime) || 3600,
      tokenMint: tokenMint || x402Adapter.hyperTokenMint,
      jobType,
      resourceType,
    });

    // 3. If no payment provided, return 402 with requirements
    if (!paymentHeader) {
      const response402 = x402Adapter.create402Response(paymentRequirements);

      return res.status(response402.status)
        .set(response402.headers)
        .json(response402.body);
    }

    // 4. Verify payment
    const verification = await x402Adapter.verifyPayment(
      paymentHeader,
      paymentRequirements
    );

    if (!verification.valid) {
      return res.status(402).json({
        error: 'Payment Required',
        message: verification.error,
        code: 'INVALID_PAYMENT',
      });
    }

    // 5. Settle payment and create escrow
    const settlementResult = await x402Adapter.settlePayment(
      paymentHeader,
      paymentRequirements,
      {
        jobId,
        nodeId: null, // Will be assigned later
        jobType,
        resourceType,
      }
    );

    // 6. Create job in database
    const job = await jobs.createJob({
      jobId,
      walletAddress: walletAddress || verification.intent.client,
      jobType,
      resourceType,
      description,
      paymentAmount,
      estimatedTime: parseInt(estimatedTime) || 1,
      escrowPubkey: settlementResult.escrow,
      txSignature: settlementResult.txSignature,
      intentId: settlementResult.intentId,
    });

    // 7. Store uploaded files (if any)
    if (req.files) {
      // Handle script file
      if (req.files.script && req.files.script[0]) {
        job.scriptFile = {
          originalname: req.files.script[0].originalname,
          buffer: req.files.script[0].buffer,
          mimetype: req.files.script[0].mimetype,
        };
      }

      // Handle dataset files
      const datasets = [];
      for (let i = 0; i < 10; i++) {
        const datasetKey = `dataset_${i}`;
        if (req.files[datasetKey] && req.files[datasetKey][0]) {
          datasets.push({
            originalname: req.files[datasetKey][0].originalname,
            buffer: req.files[datasetKey][0].buffer,
            mimetype: req.files[datasetKey][0].mimetype,
          });
        }
      }
      if (datasets.length > 0) {
        job.datasets = datasets;
      }
    }

    console.log(`[Facilitator API] Job ${jobId} submitted with x402-solana payment`);

    res.json({
      success: true,
      jobId: job.job_id || jobId,
      intentId: settlementResult.intentId,
      escrow: settlementResult.escrow,
      txSignature: settlementResult.txSignature,
      message: 'Job submitted successfully with x402 payment',
    });

  } catch (error) {
    console.error('[Facilitator API] Submit job failed:', error);
    res.status(500).json({
      error: 'Failed to submit job',
      message: error.message,
    });
  }
});

/**
 * POST /api/facilitator/complete-job
 * Complete job and submit usage proof to Oracle
 */
router.post('/complete-job', async (req, res) => {
  try {
    const { jobId, nodeId, success, logs, result } = req.body;

    // 1. Get job data
    const job = await jobs.getJobById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // 2. Generate execution proof hash
    const executionHash = facilitatorClient.generateExecutionHash(logs, result);
    const logsHash = facilitatorClient.generateExecutionHash(logs, { timestamp: Date.now() });

    // 3. Submit usage proof to Facilitator Oracle
    // This will release payment to the node
    const proofResult = await facilitatorClient.submitUsageProof(
      job.escrow_pubkey, // intentId
      nodeId,
      executionHash,
      logsHash
    );

    // 4. Update job status in database
    const actualTime = Math.floor((Date.now() - new Date(job.created_at).getTime()) / 1000);

    await jobs.updateJobStatus(jobId, success ? 'completed' : 'failed', {
      actualTime,
      logs,
      result,
      txSignature: proofResult.txSignature,
    });

    // 5. Update node earnings if successful
    if (success) {
      await nodes.incrementNodeEarnings(nodeId, job.payment_amount);
    } else {
      await nodes.decrementNodeReputation(nodeId, 10);
    }

    res.json({
      success: true,
      jobId,
      proofTx: proofResult.txSignature,
      paymentReleased: success,
      message: success
        ? 'Job completed and payment released to node'
        : 'Job failed and payment refunded to client',
    });

  } catch (error) {
    console.error('[Facilitator API] Complete job failed:', error);
    res.status(500).json({
      error: 'Failed to complete job',
      message: error.message,
    });
  }
});

/**
 * POST /api/facilitator/claim-rewards
 * Node claims accumulated rewards
 */
router.post('/claim-rewards', requireAuth, async (req, res) => {
  try {
    const { nodeId, amount } = req.body;
    const walletAddress = req.user.wallet;

    // Verify node ownership
    const node = await nodes.getNodeById(nodeId);

    if (!node || node.wallet_address !== walletAddress) {
      return res.status(403).json({ error: 'Not authorized to claim for this node' });
    }

    // Claim rewards via Facilitator
    const amountInLamports = Math.floor(amount * 1e6);

    const result = await facilitatorClient.claimRewards(
      walletAddress,
      nodeId,
      amountInLamports
    );

    // Update database
    await nodes.incrementNodeEarnings(nodeId, -amountInLamports);

    res.json({
      success: true,
      amount,
      txSignature: result.txSignature,
      message: `Successfully claimed ${amount} HYPER`,
    });

  } catch (error) {
    console.error('[Facilitator API] Claim rewards failed:', error);
    res.status(500).json({
      error: 'Failed to claim rewards',
      message: error.message,
    });
  }
});

/**
 * GET /api/facilitator/node/:nodeId
 * Get node account data from Facilitator
 */
router.get('/node/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;

    const nodeAccount = await facilitatorClient.getNodeAccount(nodeId);

    if (!nodeAccount) {
      return res.status(404).json({ error: 'Node not found on-chain' });
    }

    res.json(nodeAccount);

  } catch (error) {
    console.error('[Facilitator API] Get node failed:', error);
    res.status(500).json({
      error: 'Failed to get node data',
      message: error.message,
    });
  }
});

/**
 * GET /api/facilitator/payment-intent/:intentId
 * Get payment intent data
 */
router.get('/payment-intent/:intentId', async (req, res) => {
  try {
    const { intentId } = req.params;

    const paymentIntent = await facilitatorClient.getPaymentIntent(intentId);

    if (!paymentIntent) {
      return res.status(404).json({ error: 'Payment intent not found' });
    }

    res.json(paymentIntent);

  } catch (error) {
    console.error('[Facilitator API] Get payment intent failed:', error);
    res.status(500).json({
      error: 'Failed to get payment intent',
      message: error.message,
    });
  }
});

/**
 * GET /api/facilitator/stats
 * Get x402 payment intent statistics
 */
router.get('/stats', (req, res) => {
  const stats = intentStore.stats();

  res.json({
    paymentIntents: stats,
    facilitatorProgram: facilitatorClient.programId.toString(),
    oracle: facilitatorClient.oracleAuthority.publicKey.toString(),
  });
});

/**
 * POST /api/facilitator/create-intent
 * Helper endpoint to create payment intent (client-side use)
 */
router.post('/create-intent', (req, res) => {
  try {
    const { wallet, amount, jobId } = req.body;

    const intent = new PaymentIntent({
      client: wallet,
      amount,
      jobId,
      timestamp: Date.now(),
      expiresAt: Date.now() + (3600 * 1000), // 1 hour
    });

    res.json({
      intent: intent.toJSON(),
      message: intent.toSigningMessage(),
      hash: intent.hash(),
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to create payment intent',
      message: error.message,
    });
  }
});

export default router;

# Implementation Examples

Practical examples for integrating x402 payment protocol in your applications.

---

## Table of Contents

1. [Client-Side Examples](#client-side-examples)
2. [Server-Side Examples](#server-side-examples)
3. [Smart Contract Examples](#smart-contract-examples)
4. [Complete Workflows](#complete-workflows)

---

## Client-Side Examples

### Example 1: Simple Payment Flow

```typescript
import { createPaymentIntent, X402Verifier } from './x402.js';
import { useWallet } from '@solana/wallet-adapter-react';

async function requestComputeJob(jobData) {
  const wallet = useWallet();

  // Step 1: Request resource
  const response = await fetch('https://api.hypernode.ai/compute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobData),
  });

  // Step 2: Check if payment required
  if (response.status === 402) {
    const { paymentRequirements } = await response.json();

    console.log('Payment required:', paymentRequirements);

    // Step 3: Create payment intent
    const intent = createPaymentIntent({
      client: wallet.publicKey.toString(),
      amount: paymentRequirements.price.amount,
      jobId: paymentRequirements.config.metadata.jobId,
      expiresAt: Date.now() + 3600000, // 1 hour
    });

    // Step 4: Sign message with wallet
    const message = new TextEncoder().encode(intent.toSigningMessage());
    const signature = await wallet.signMessage(message);

    // Step 5: Convert signature to base58
    const signatureBase58 = bs58.encode(signature);

    // Step 6: Create payment payload
    const paymentPayload = {
      intent: intent.toJSON(),
      signature: signatureBase58,
    };

    // Step 7: Retry request with payment
    const retryResponse = await fetch('https://api.hypernode.ai/compute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
      },
      body: JSON.stringify(jobData),
    });

    // Step 8: Handle success
    if (retryResponse.ok) {
      const result = await retryResponse.json();
      console.log('Job completed:', result);
      return result;
    } else {
      throw new Error('Payment failed');
    }
  }

  // No payment required - direct response
  return await response.json();
}
```

---

### Example 2: React Component with x402

```tsx
import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

function ComputeJobForm() {
  const wallet = useWallet();
  const [jobData, setJobData] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [paymentInfo, setPaymentInfo] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!wallet.connected) {
      alert('Please connect your wallet first');
      return;
    }

    setLoading(true);

    try {
      // First request - may return 402
      const response = await fetch('/api/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: jobData }),
      });

      if (response.status === 402) {
        // Payment required
        const { paymentRequirements } = await response.json();
        setPaymentInfo(paymentRequirements);

        // Ask user to confirm payment
        const confirmed = window.confirm(
          `This job costs ${paymentRequirements.price.amount / 1e6} HYPER. Continue?`
        );

        if (!confirmed) {
          setLoading(false);
          return;
        }

        // Create and sign payment
        const intent = createPaymentIntent({
          client: wallet.publicKey.toString(),
          amount: paymentRequirements.price.amount,
          jobId: paymentRequirements.config.metadata.jobId,
        });

        const message = new TextEncoder().encode(intent.toSigningMessage());
        const signature = await wallet.signMessage(message);

        const paymentPayload = {
          intent: intent.toJSON(),
          signature: bs58.encode(signature),
        };

        // Retry with payment
        const retryResponse = await fetch('/api/compute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PAYMENT': btoa(JSON.stringify(paymentPayload)),
          },
          body: JSON.stringify({ code: jobData }),
        });

        const jobResult = await retryResponse.json();
        setResult(jobResult);
      } else {
        // No payment required
        const jobResult = await response.json();
        setResult(jobResult);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to execute job: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>AI Compute Job</h1>

      <WalletMultiButton />

      <form onSubmit={handleSubmit}>
        <textarea
          value={jobData}
          onChange={(e) => setJobData(e.target.value)}
          placeholder="Enter your code here..."
          rows={10}
          cols={50}
        />
        <br />
        <button type="submit" disabled={loading || !wallet.connected}>
          {loading ? 'Processing...' : 'Submit Job'}
        </button>
      </form>

      {paymentInfo && (
        <div>
          <h3>Payment Info</h3>
          <p>Amount: {paymentInfo.price.amount / 1e6} HYPER</p>
          <p>Description: {paymentInfo.config.description}</p>
        </div>
      )}

      {result && (
        <div>
          <h3>Result</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default ComputeJobForm;
```

---

## Server-Side Examples

### Example 3: Express.js API with x402

```javascript
import express from 'express';
import { createX402SolanaAdapter } from './x402-solana-adapter.js';
import crypto from 'crypto';

const app = express();
const adapter = createX402SolanaAdapter({
  network: 'solana-devnet',
  hyperTokenMint: process.env.HYPER_TOKEN_MINT,
  treasuryAddress: process.env.TREASURY_WALLET,
});

app.use(express.json());
app.use(adapter.middleware());

// Protected endpoint - requires payment
app.post('/api/compute', async (req, res) => {
  const { code } = req.body;

  // Define payment requirements
  const requirements = adapter.createPaymentRequirements({
    jobId: crypto.randomUUID(),
    amount: '1000000', // 1 HYPER
    description: 'Code execution job',
    resourceType: 'compute',
    estimatedTime: 300, // 5 minutes
  });

  // Check if payment provided
  if (!req.x402.paymentProvided) {
    return res.status(402).json({
      error: 'Payment Required',
      code: 'PAYMENT_REQUIRED',
      paymentRequirements: requirements,
    });
  }

  // Verify payment
  const verification = await adapter.verifyPayment(
    req.x402.paymentHeader,
    requirements
  );

  if (!verification.valid) {
    return res.status(402).json({
      error: 'Invalid Payment',
      code: 'INVALID_PAYMENT',
      reason: verification.error,
      paymentRequirements: requirements,
    });
  }

  // Settle payment (creates escrow)
  const settlement = await adapter.settlePayment(
    req.x402.paymentHeader,
    requirements,
    { jobId: requirements.config.metadata.jobId }
  );

  console.log('Payment settled:', settlement);

  // Execute job
  try {
    const result = await executeCode(code);

    // Report completion to adapter (triggers oracle verification)
    await adapter.handleJobCompletion({
      jobId: requirements.config.metadata.jobId,
      nodeId: process.env.NODE_ID,
      success: true,
      logs: result.logs,
      executionHash: crypto.createHash('sha256').update(result.output).digest('hex'),
      logsHash: crypto.createHash('sha256').update(JSON.stringify(result.logs)).digest('hex'),
      completedAt: Date.now(),
    });

    res.json({
      success: true,
      jobId: requirements.config.metadata.jobId,
      result: result.output,
      logs: result.logs,
      payment: {
        settled: true,
        txSignature: settlement.txSignature,
      },
    });

  } catch (error) {
    console.error('Job execution failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Helper function to execute code
async function executeCode(code) {
  // Simulated execution
  return {
    output: `Executed: ${code}`,
    logs: ['Starting execution...', 'Code executed successfully', 'Exit code: 0'],
  };
}

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

### Example 4: Payment Verification Middleware

```javascript
import { X402Verifier, intentStore } from './x402.js';

/**
 * Middleware to verify x402 payments
 */
export function requirePayment(config) {
  return async (req, res, next) => {
    // Extract payment header
    const paymentHeader = req.headers['x-payment'];

    if (!paymentHeader) {
      return res.status(402).json({
        error: 'Payment Required',
        message: 'x402: Missing X-PAYMENT header',
        paymentRequirements: config.getRequirements(req),
      });
    }

    try {
      // Parse payment payload
      const paymentData = JSON.parse(
        Buffer.from(paymentHeader, 'base64').toString()
      );

      const { intent, signature } = paymentData;

      // Verify signature
      const verification = X402Verifier.verify(
        intent,
        signature,
        intent.client
      );

      if (!verification.valid) {
        return res.status(402).json({
          error: 'Invalid Payment',
          message: `x402: ${verification.error}`,
        });
      }

      // Check if already used
      if (intentStore.isUsed(intent.intentId)) {
        return res.status(409).json({
          error: 'Payment Already Used',
          message: 'x402: This payment intent has already been consumed',
        });
      }

      // Verify amount matches requirements
      const requirements = config.getRequirements(req);
      if (BigInt(intent.amount) < BigInt(requirements.price.amount)) {
        return res.status(402).json({
          error: 'Insufficient Payment',
          message: 'x402: Payment amount is less than required',
          required: requirements.price.amount,
          provided: intent.amount,
        });
      }

      // Mark as used
      intentStore.markUsed(intent.intentId);

      // Attach to request
      req.payment = {
        intent,
        signature,
        verified: true,
      };

      next();

    } catch (error) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `x402: ${error.message}`,
      });
    }
  };
}

// Usage:
app.get(
  '/api/premium-feature',
  requirePayment({
    getRequirements: () => ({
      price: { amount: '5000000', asset: HYPER_MINT },
      description: 'Premium feature access',
    }),
  }),
  (req, res) => {
    res.json({ message: 'Welcome to premium features!' });
  }
);
```

---

## Smart Contract Examples

### Example 5: Registering a Node

```typescript
import { AnchorProvider, Program, web3 } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import idl from './idl.json';

async function registerNode(wallet, nodeId) {
  const connection = new web3.Connection('https://api.devnet.solana.com');
  const provider = new AnchorProvider(connection, wallet, {});
  const program = new Program(idl, provider);

  // Derive node PDA
  const [nodePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('node'), Buffer.from(nodeId)],
    program.programId
  );

  // Derive staking account
  const stakingAccount = await getAssociatedTokenAddress(
    HYPER_MINT,
    nodePDA,
    true
  );

  // Register node
  const tx = await program.methods
    .registerNode(nodeId, new BN(0))
    .accounts({
      node: nodePDA,
      authority: wallet.publicKey,
      stakingAccount,
      hyperMint: HYPER_MINT,
      systemProgram: web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log('Node registered:', tx);
  return { nodePDA, stakingAccount, tx };
}
```

---

### Example 6: Authorizing Payment

```typescript
async function authorizePayment(wallet, paymentIntent) {
  const connection = new web3.Connection('https://api.devnet.solana.com');
  const provider = new AnchorProvider(connection, wallet, {});
  const program = new Program(idl, provider);

  // Derive PDAs
  const [intentPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), Buffer.from(paymentIntent.intentId)],
    program.programId
  );

  const [escrowPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(paymentIntent.intentId)],
    program.programId
  );

  // Get token accounts
  const clientTokenAccount = await getAssociatedTokenAddress(
    HYPER_MINT,
    wallet.publicKey
  );

  // Authorize payment
  const tx = await program.methods
    .authorizePayment({
      intentId: paymentIntent.intentId,
      amount: new BN(paymentIntent.amount),
      expiresAt: new BN(Math.floor(paymentIntent.expiresAt / 1000)),
    })
    .accounts({
      paymentIntent: intentPDA,
      client: wallet.publicKey,
      escrow: escrowPDA,
      clientTokenAccount,
      hyperMint: HYPER_MINT,
      systemProgram: web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log('Payment authorized:', tx);
  return { intentPDA, escrowPDA, tx };
}
```

---

### Example 7: Oracle Submitting Proof

```typescript
async function submitProof(oracleKeypair, intentId, nodeId, executionData) {
  const connection = new web3.Connection('https://api.devnet.solana.com');
  const wallet = new Wallet(oracleKeypair);
  const provider = new AnchorProvider(connection, wallet, {});
  const program = new Program(idl, provider);

  // Derive PDAs
  const [proofPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), Buffer.from(intentId)],
    program.programId
  );

  const [intentPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('intent'), Buffer.from(intentId)],
    program.programId
  );

  const [nodePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('node'), Buffer.from(nodeId)],
    program.programId
  );

  const [escrowPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(intentId)],
    program.programId
  );

  const nodeTokenAccount = await getAssociatedTokenAddress(
    HYPER_MINT,
    nodePDA,
    true
  );

  // Submit proof
  const tx = await program.methods
    .submitUsageProof({
      intentId,
      nodeId,
      executionHash: executionData.executionHash,
      logsHash: executionData.logsHash,
    })
    .accounts({
      usageProof: proofPDA,
      paymentIntent: intentPDA,
      node: nodePDA,
      oracle: oracleKeypair.publicKey,
      escrow: escrowPDA,
      nodeTokenAccount,
      hyperMint: HYPER_MINT,
      systemProgram: web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([oracleKeypair])
    .rpc();

  console.log('Proof submitted:', tx);
  return tx;
}
```

---

## Complete Workflows

### Example 8: End-to-End Payment Flow

```typescript
/**
 * Complete payment flow from client request to settlement
 */
async function completePaymentFlow() {
  // 1. Client: Request resource
  const response = await fetch('https://api.example.com/compute', {
    method: 'POST',
    body: JSON.stringify({ code: 'print("hello")' }),
  });

  // 2. Server responds with 402
  if (response.status === 402) {
    const { paymentRequirements } = await response.json();

    // 3. Client: Create payment intent
    const intent = createPaymentIntent({
      client: wallet.publicKey.toString(),
      amount: paymentRequirements.price.amount,
      jobId: paymentRequirements.config.metadata.jobId,
    });

    // 4. Client: Sign message
    const message = new TextEncoder().encode(intent.toSigningMessage());
    const signature = await wallet.signMessage(message);

    // 5. Client: Retry with payment
    const paymentResponse = await fetch('https://api.example.com/compute', {
      method: 'POST',
      headers: {
        'X-PAYMENT': btoa(JSON.stringify({
          intent: intent.toJSON(),
          signature: bs58.encode(signature),
        })),
      },
      body: JSON.stringify({ code: 'print("hello")' }),
    });

    // 6. Server: Verifies and settles payment
    // (Creates escrow on-chain)

    // 7. Server: Executes job
    const result = await paymentResponse.json();

    // 8. Server: Submits proof to Oracle
    // (Oracle verifies and releases payment)

    return result;
  }
}
```

---

### Example 9: Node Claiming Rewards

```typescript
async function claimNodeRewards(wallet, nodeId, amount) {
  const connection = new web3.Connection('https://api.devnet.solana.com');
  const provider = new AnchorProvider(connection, wallet, {});
  const program = new Program(idl, provider);

  // Derive PDAs
  const [nodePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('node'), Buffer.from(nodeId)],
    program.programId
  );

  const stakingAccount = await getAssociatedTokenAddress(
    HYPER_MINT,
    nodePDA,
    true
  );

  const authorityTokenAccount = await getAssociatedTokenAddress(
    HYPER_MINT,
    wallet.publicKey
  );

  // Claim rewards
  const tx = await program.methods
    .claimRewards(new BN(amount))
    .accounts({
      node: nodePDA,
      authority: wallet.publicKey,
      stakingAccount,
      authorityTokenAccount,
      hyperMint: HYPER_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log('Rewards claimed:', tx);
  return tx;
}
```

---

## Testing Examples

### Example 10: Integration Test

```typescript
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { Keypair } from '@solana/web3.js';

describe('x402 Payment Flow', () => {
  let client: Keypair;
  let oracle: Keypair;
  let nodeId: string;

  before(async () => {
    client = Keypair.generate();
    oracle = Keypair.generate();
    nodeId = 'test-node-' + Date.now();

    // Airdrop SOL for testing
    await connection.requestAirdrop(client.publicKey, 2 * LAMPORTS_PER_SOL);
  });

  it('should register a node', async () => {
    const { tx } = await registerNode(client, nodeId);
    expect(tx).to.be.a('string');
  });

  it('should authorize payment', async () => {
    const intent = createPaymentIntent({
      client: client.publicKey.toString(),
      amount: '1000000',
      jobId: 'test-job-123',
    });

    const { tx } = await authorizePayment(client, intent);
    expect(tx).to.be.a('string');
  });

  it('should submit usage proof', async () => {
    const tx = await submitProof(oracle, 'intent-123', nodeId, {
      executionHash: 'a'.repeat(64),
      logsHash: 'b'.repeat(64),
    });

    expect(tx).to.be.a('string');
  });
});
```

---

## Environment Setup

### Example .env File

```bash
# Solana Configuration
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com

# Token Configuration
HYPER_TOKEN_MINT_DEVNET=92s9qna3djkMncZzkacyNQ38UKnNXZFh4Jgqe3Cmpump

# Program IDs
FACILITATOR_PROGRAM_ID=HYPRfaci11tator1111111111111111111111111111

# Oracle Configuration
ORACLE_PRIVATE_KEY=[1,2,3,...]  # Uint8Array as JSON

# Node Configuration
NODE_ID=my-node-001
TREASURY_WALLET_ADDRESS=7xKx...

# API Configuration
API_PORT=3000
API_HOST=0.0.0.0
```

---

## Additional Resources

- [x402 Protocol Specification](./x402-protocol.md)
- [Smart Contract Reference](./contract-reference.md)
- [Integration Guide](./integration-guide.md)
- [Oracle API Documentation](./oracle-api.md)

---

## License

MIT License

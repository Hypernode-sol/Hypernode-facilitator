# Integration Guide

Complete guide for integrating the x402 payment protocol into your application.

---

## Table of Contents

1. [Overview](#overview)
2. [Server Integration](#server-integration)
3. [Client Integration](#client-integration)
4. [Node Integration](#node-integration)
5. [Testing Integration](#testing-integration)
6. [Production Deployment](#production-deployment)

---

## Overview

This guide walks through integrating the Hypernode Facilitator x402 payment protocol into your application. The integration process varies based on your role:

- **Server Operators**: Protect API endpoints with payment requirements
- **Client Developers**: Handle payment flows in your frontend
- **Node Operators**: Register nodes and claim earnings

---

## Server Integration

### Step 1: Install Dependencies

```bash
npm install @solana/web3.js @solana/spl-token @coral-xyz/anchor
npm install express bs58 tweetnacl dotenv
```

### Step 2: Environment Configuration

Create a `.env` file:

```bash
# Solana Network
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com

# Token Configuration
HYPER_TOKEN_MINT=92s9qna3djkMncZzkacyNQ38UKnNXZFh4Jgqe3Cmpump

# Program Configuration
FACILITATOR_PROGRAM_ID=HYPRfaci11tator1111111111111111111111111111

# Oracle Configuration (generate securely)
ORACLE_PRIVATE_KEY=[...]

# API Configuration
PORT=3000
NODE_ID=your-node-id
```

### Step 3: Initialize Adapter

```javascript
import express from 'express';
import { createX402SolanaAdapter } from './x402-solana-adapter.js';

const app = express();
const adapter = createX402SolanaAdapter({
  network: process.env.SOLANA_NETWORK,
  hyperTokenMint: process.env.HYPER_TOKEN_MINT,
  treasuryAddress: process.env.TREASURY_WALLET,
});

app.use(express.json());
app.use(adapter.middleware());
```

### Step 4: Create Protected Endpoints

```javascript
import crypto from 'crypto';

app.post('/api/compute', async (req, res) => {
  // 1. Define payment requirements
  const jobId = crypto.randomUUID();
  const requirements = adapter.createPaymentRequirements({
    jobId,
    amount: '1000000', // 1 HYPER (6 decimals)
    description: 'AI Compute Job',
    resource: '/api/compute',
    estimatedTime: 300, // 5 minutes
    jobType: 'code-execution',
    resourceType: 'compute',
  });

  // 2. Check if payment provided
  if (!req.x402 || !req.x402.paymentProvided) {
    return res.status(402).json({
      error: 'Payment Required',
      code: 'PAYMENT_REQUIRED',
      paymentRequirements: requirements,
    });
  }

  // 3. Verify payment
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

  // 4. Settle payment on-chain
  try {
    const settlement = await adapter.settlePayment(
      req.x402.paymentHeader,
      requirements,
      {
        jobId,
        nodeId: process.env.NODE_ID,
        resourceType: 'compute',
      }
    );

    console.log('Payment settled:', settlement.txSignature);

    // 5. Perform actual work
    const result = await executeJob(req.body, jobId);

    // 6. Report completion (triggers Oracle verification)
    await adapter.handleJobCompletion({
      jobId,
      nodeId: process.env.NODE_ID,
      success: result.success,
      logs: result.logs,
      executionHash: generateExecutionHash(result),
      logsHash: generateLogsHash(result.logs),
      completedAt: Date.now(),
    });

    // 7. Return success response
    res.json({
      success: true,
      jobId,
      result: result.output,
      payment: {
        settled: true,
        escrow: settlement.escrow,
        txSignature: settlement.txSignature,
      },
    });

  } catch (error) {
    console.error('Job execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Helper functions
function generateExecutionHash(result) {
  const data = JSON.stringify({
    output: result.output,
    success: result.success,
    timestamp: Date.now(),
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

function generateLogsHash(logs) {
  const data = JSON.stringify({ logs, timestamp: Date.now() });
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function executeJob(jobData, jobId) {
  // Implement your job execution logic here
  return {
    success: true,
    output: 'Job completed successfully',
    logs: ['Started job', 'Processing...', 'Completed'],
  };
}
```

### Step 5: Start Server

```javascript
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Network: ${process.env.SOLANA_NETWORK}`);
  console.log(`Node ID: ${process.env.NODE_ID}`);
});
```

---

## Client Integration

### Step 1: Install Dependencies

```bash
npm install @solana/web3.js @solana/wallet-adapter-react
npm install @solana/wallet-adapter-wallets bs58
```

### Step 2: Setup Wallet Provider

```tsx
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';

function App() {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = clusterApiUrl(network);
  const wallets = [new PhantomWalletAdapter()];

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <YourApp />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

### Step 3: Create Payment Hook

```typescript
import { useWallet } from '@solana/wallet-adapter-react';
import { createPaymentIntent } from './x402';
import bs58 from 'bs58';

export function useX402Payment() {
  const wallet = useWallet();

  const requestWithPayment = async (url, options = {}) => {
    if (!wallet.connected || !wallet.publicKey) {
      throw new Error('Wallet not connected');
    }

    // 1. Initial request
    const response = await fetch(url, options);

    // 2. Check if payment required
    if (response.status !== 402) {
      return response;
    }

    // 3. Get payment requirements
    const { paymentRequirements } = await response.json();

    // 4. Create payment intent
    const intent = createPaymentIntent({
      client: wallet.publicKey.toString(),
      amount: paymentRequirements.price.amount,
      jobId: paymentRequirements.config.metadata.jobId,
      expiresAt: Date.now() + 3600000, // 1 hour
    });

    // 5. Sign message
    const message = new TextEncoder().encode(intent.toSigningMessage());
    const signature = await wallet.signMessage(message);

    // 6. Create payment payload
    const paymentPayload = {
      intent: intent.toJSON(),
      signature: bs58.encode(signature),
    };

    // 7. Retry with payment
    const retryResponse = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'X-PAYMENT': btoa(JSON.stringify(paymentPayload)),
      },
    });

    return retryResponse;
  };

  return { requestWithPayment };
}
```

### Step 4: Use in Component

```tsx
import { useX402Payment } from './hooks/useX402Payment';

function ComputeJob() {
  const { requestWithPayment } = useX402Payment();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (jobData) => {
    setLoading(true);

    try {
      const response = await requestWithPayment('/api/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        throw new Error(data.error);
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
      <button onClick={() => handleSubmit({ code: 'console.log("hello")' })}>
        Execute Job
      </button>
      {loading && <p>Processing...</p>}
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
```

---

## Node Integration

### Step 1: Register Node

```javascript
import { FacilitatorClient } from './client.js';
import { Keypair } from '@solana/web3.js';

async function registerNode() {
  // Load or generate node keypair
  const nodeAuthority = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(process.env.NODE_KEYPAIR))
  );

  // Initialize facilitator client
  const client = new FacilitatorClient();

  // Register node
  const nodeId = process.env.NODE_ID || 'node-' + Date.now();
  const stakeAmount = 0; // Optional initial stake

  const result = await client.registerNode(
    nodeAuthority.publicKey.toString(),
    nodeId,
    stakeAmount
  );

  console.log('Node registered successfully!');
  console.log('Node Account:', result.nodeAccount);
  console.log('Staking Account:', result.stakingAccount);
  console.log('Transaction:', result.txSignature);

  // Save node ID for future use
  console.log('Save this Node ID:', nodeId);
}

registerNode().catch(console.error);
```

### Step 2: Monitor Earnings

```javascript
async function checkNodeEarnings(nodeId) {
  const client = new FacilitatorClient();
  const nodeAccount = await client.getNodeAccount(nodeId);

  if (!nodeAccount) {
    console.log('Node not found');
    return;
  }

  console.log('Node Statistics:');
  console.log('- Total Earned:', nodeAccount.totalEarned, 'lamports');
  console.log('- Jobs Completed:', nodeAccount.jobsCompleted);
  console.log('- Active:', nodeAccount.isActive);
  console.log('- Registered:', nodeAccount.registeredAt);
}
```

### Step 3: Claim Rewards

```javascript
async function claimRewards(nodeId, amount) {
  const nodeAuthority = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(process.env.NODE_KEYPAIR))
  );

  const client = new FacilitatorClient();

  const result = await client.claimRewards(
    nodeAuthority.publicKey.toString(),
    nodeId,
    amount
  );

  console.log('Rewards claimed!');
  console.log('Amount:', amount, 'lamports');
  console.log('Transaction:', result.txSignature);
}
```

---

## Testing Integration

### Local Development Testing

```javascript
// test/integration.test.js
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import fetch from 'node-fetch';

describe('x402 Integration', () => {
  let server;

  before(async () => {
    // Start test server
    server = await startTestServer();
  });

  it('should return 402 for unpaid request', async () => {
    const response = await fetch('http://localhost:3000/api/compute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'test' }),
    });

    expect(response.status).to.equal(402);

    const data = await response.json();
    expect(data).to.have.property('paymentRequirements');
  });

  it('should accept valid payment', async () => {
    // Create and sign payment intent
    const intent = createPaymentIntent({
      client: testWallet.publicKey.toString(),
      amount: '1000000',
      jobId: 'test-job-123',
    });

    const message = new TextEncoder().encode(intent.toSigningMessage());
    const signature = await testWallet.signMessage(message);

    const paymentPayload = {
      intent: intent.toJSON(),
      signature: bs58.encode(signature),
    };

    // Make request with payment
    const response = await fetch('http://localhost:3000/api/compute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': btoa(JSON.stringify(paymentPayload)),
      },
      body: JSON.stringify({ code: 'test' }),
    });

    expect(response.status).to.equal(200);

    const data = await response.json();
    expect(data.success).to.be.true;
  });
});
```

---

## Production Deployment

### Environment Checklist

- [ ] Set `SOLANA_NETWORK=mainnet-beta`
- [ ] Use production RPC endpoint (e.g., QuickNode, Alchemy)
- [ ] Generate secure Oracle keypair and store safely
- [ ] Set mainnet HYPER token mint address
- [ ] Deploy Facilitator program to mainnet
- [ ] Configure proper logging and monitoring
- [ ] Set up error alerting
- [ ] Implement rate limiting
- [ ] Add request validation
- [ ] Configure CORS properly

### Security Best Practices

```javascript
// Rate limiting
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);

// Input validation
import { body, validationResult } from 'express-validator';

app.post('/api/compute',
  body('code').isString().isLength({ max: 10000 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // Continue with payment flow...
  }
);

// CORS configuration
import cors from 'cors';

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['GET', 'POST'],
  credentials: true,
}));
```

### Monitoring

```javascript
// Track payment metrics
import prometheus from 'prom-client';

const paymentCounter = new prometheus.Counter({
  name: 'x402_payments_total',
  help: 'Total number of x402 payments',
  labelNames: ['status'],
});

const paymentAmount = new prometheus.Histogram({
  name: 'x402_payment_amount',
  help: 'Payment amounts in HYPER',
  buckets: [0.1, 1, 5, 10, 50, 100],
});

// In your endpoint:
paymentCounter.inc({ status: 'success' });
paymentAmount.observe(Number(intent.amount) / 1e6);
```

---

## Troubleshooting

### Common Issues

**Issue: "Payment intent has expired"**
```javascript
// Increase expiration time
const intent = createPaymentIntent({
  ...data,
  expiresAt: Date.now() + (3600 * 1000), // 1 hour instead of default
});
```

**Issue: "Invalid signature"**
```javascript
// Ensure correct message encoding
const message = new TextEncoder().encode(intent.toSigningMessage());
// Not: Buffer.from(intent.toSigningMessage())
```

**Issue: "Insufficient balance"**
```javascript
// Check token balance before payment
const balance = await connection.getTokenAccountBalance(tokenAccount);
console.log('Balance:', balance.value.uiAmount, 'HYPER');
```

---

## Support

For additional help:
- Review [Examples](./examples.md)
- Check [x402 Protocol Spec](./x402-protocol.md)
- Open an issue on GitHub

---

## Next Steps

After integration:
1. Test thoroughly on devnet
2. Monitor transaction success rates
3. Optimize payment amounts based on usage
4. Implement analytics and reporting
5. Plan for mainnet deployment

---

## License

MIT License

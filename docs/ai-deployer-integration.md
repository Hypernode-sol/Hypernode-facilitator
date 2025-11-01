# AI Deployer Integration

Complete guide for integrating the Hypernode Facilitator with the Hypernode AI Deployer system.

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Integration Components](#integration-components)
4. [Operational Flow](#operational-flow)
5. [Data Schema](#data-schema)
6. [API Contracts](#api-contracts)
7. [Implementation Guide](#implementation-guide)

---

## Overview

The Hypernode Facilitator and Hypernode AI Deployer work together to create the **incentive and execution backbone** of the decentralized AI compute network. This integration enables:

- Automatic payment distribution for completed compute jobs
- Verifiable usage tracking and reward attribution
- Seamless coordination between job execution and settlement
- Transparent on-chain record of all transactions

### Key Benefits

- **For Nodes**: Automatic rewards after completing compute tasks
- **For Clients**: Pay-per-use pricing tied to actual resource consumption
- **For the Network**: Verifiable attribution and audit trail

---

## System Architecture

### Four-Actor Model

```
┌─────────────┐         ┌──────────────┐
│ AI Deployer │ ◄─────► │ Facilitator  │
│  (Tasks)    │         │  (Payments)  │
└──────┬──────┘         └──────┬───────┘
       │                       │
       │    ┌─────────┐        │
       └───►│ Oracle  │◄───────┘
            │(Verify) │
            └────┬────┘
                 │
            ┌────▼────┐
            │ Client  │
            │ (Payer) │
            └─────────┘
```

**Actors:**

1. **AI Deployer**: Schedules and executes LLM inference jobs
2. **Facilitator**: Manages node registration and reward distribution
3. **Oracle Service**: Verifies task completion and submits proofs
4. **Client**: Submits payments for completed work

---

## Integration Components

### AI Deployer Responsibilities

**Job Management:**
- Assign tasks to registered compute nodes
- Monitor execution progress
- Record completion metadata

**Event Emission:**
- Emit completion events with execution details
- Calculate resource usage (tokens, time, model)
- Post completion data to Oracle API

**Data Collection:**
- Track execution duration
- Count token usage
- Record model type and configuration
- Generate execution logs

### Facilitator Responsibilities

**Node Management:**
- Create Program Derived Accounts (PDAs) for nodes
- Maintain node registry with staking information
- Track node performance and earnings

**Payment Settlement:**
- Accept Oracle-verified usage proofs
- Execute SPL Token transfers to nodes
- Update on-chain reward balances
- Mark tasks as accounted

**Verification:**
- Validate Oracle signatures
- Verify task completion proofs
- Ensure payment amounts match usage

---

## Operational Flow

### Complete 8-Step Integration Flow

```
1. Node Registration
   └─> Node calls Facilitator.register_node()
   └─> PDA created on-chain

2. Task Assignment
   └─> AI Deployer assigns job to node
   └─> Node receives task specification

3. Job Execution
   └─> Node executes LLM inference
   └─> AI Deployer monitors progress

4. Completion Recording
   └─> AI Deployer records completion metadata
   └─> Execution logs captured

5. Oracle Notification
   └─> AI Deployer posts completion to Oracle API
   └─> Includes usage data and execution hash

6. Verification
   └─> Oracle verifies execution (6 checks)
   └─> Generates cryptographic proof

7. Proof Submission
   └─> Oracle submits proof to Facilitator
   └─> Calls Facilitator.submit_usage_proof()

8. Payment Release
   └─> Facilitator transfers tokens to node
   └─> Updates on-chain balances
   └─> Emits PaymentSettled event
```

### State Transitions

```
Job: [Created] → [Assigned] → [Running] → [Completed]
Payment: [Pending] → [Authorized] → [Escrowed] → [Verified] → [Settled]
```

---

## Data Schema

### Job Completion Event

Schema emitted by AI Deployer upon task completion:

```typescript
interface JobCompletionEvent {
  // Identity
  jobId: string;                    // Unique job identifier
  nodeId: string;                   // Executing node ID
  intentId: string;                 // Associated payment intent

  // Execution Details
  modelType: string;                // e.g., "llama-2-7b", "gpt-3.5-turbo"
  tokenUsage: {
    promptTokens: number;           // Input tokens
    completionTokens: number;       // Output tokens
    totalTokens: number;            // Total tokens processed
  };
  executionDuration: number;        // Milliseconds

  // Verification Data
  executionHash: string;            // SHA256 of execution result
  logsHash: string;                 // SHA256 of execution logs
  timestamp: number;                // Completion timestamp (ms)

  // Status
  success: boolean;                 // Execution success flag
  errorMessage?: string;            // Error details if failed
}
```

### Oracle Verification Request

Schema sent from AI Deployer to Oracle:

```typescript
interface VerificationRequest {
  jobId: string;
  nodeId: string;
  intentId: string;
  executionData: JobCompletionEvent;

  // Signatures
  deployerSignature: string;        // AI Deployer's signature
  deployerPublicKey: string;        // AI Deployer's public key
}
```

### Usage Proof Submission

Schema submitted by Oracle to Facilitator:

```typescript
interface UsageProofData {
  intentId: string;                 // Payment intent ID
  nodeId: string;                   // Node that executed job
  executionHash: string;            // SHA256 hex (64 chars)
  logsHash: string;                 // SHA256 hex (64 chars)

  // Oracle Attestation
  oracleSignature: string;          // Oracle's signature
  verificationScore: number;        // 0.0 - 1.0
  timestamp: number;                // Verification timestamp
}
```

---

## API Contracts

### AI Deployer → Oracle API

**Endpoint:** `POST /api/oracle/verify`

**Request:**
```json
{
  "jobId": "job-abc-123",
  "nodeId": "node-xyz-789",
  "intentId": "intent-def-456",
  "executionData": {
    "modelType": "llama-2-7b",
    "tokenUsage": {
      "promptTokens": 150,
      "completionTokens": 300,
      "totalTokens": 450
    },
    "executionDuration": 5420,
    "executionHash": "a1b2c3d4...",
    "logsHash": "e5f6g7h8...",
    "timestamp": 1698765432000,
    "success": true
  },
  "deployerSignature": "base58...",
  "deployerPublicKey": "7xKx..."
}
```

**Response:**
```json
{
  "success": true,
  "verificationId": "verify-ghi-012",
  "verificationScore": 1.0,
  "message": "Job queued for verification"
}
```

### Oracle → Facilitator Smart Contract

**Instruction:** `submit_usage_proof`

**Accounts:**
```rust
{
  usage_proof: UsageProofPDA,      // Created by instruction
  payment_intent: PaymentIntentPDA,
  node: NodeAccountPDA,
  oracle: OracleSigner,
  escrow: EscrowPDA,
  node_token_account: TokenAccount,
  token_program: TokenProgram
}
```

**Data:**
```rust
UsageProofData {
  intent_id: String,
  node_id: String,
  execution_hash: String,
  logs_hash: String,
}
```

---

## Implementation Guide

### Step 1: Configure AI Deployer

```javascript
// config/facilitator.js
export const facilitatorConfig = {
  programId: 'HYPRfaci11tator1111111111111111111111111111',
  oracleEndpoint: 'https://oracle.hypernode.ai',
  oracleApiKey: process.env.ORACLE_API_KEY,
};
```

### Step 2: Emit Completion Events

```javascript
// In AI Deployer job completion handler
import { emitJobCompletion } from './facilitator-integration';

async function handleJobCompletion(job) {
  const executionData = {
    jobId: job.id,
    nodeId: job.assignedNode,
    intentId: job.paymentIntentId,
    modelType: job.model,
    tokenUsage: calculateTokenUsage(job),
    executionDuration: job.endTime - job.startTime,
    executionHash: generateExecutionHash(job),
    logsHash: generateLogsHash(job.logs),
    timestamp: Date.now(),
    success: job.status === 'completed',
  };

  // Emit to Oracle
  await emitJobCompletion(executionData);
}
```

### Step 3: Oracle Verification

```javascript
// Oracle service receives completion event
async function handleCompletionEvent(event) {
  // 1. Verify AI Deployer signature
  const deployerVerified = verifySignature(
    event,
    event.deployerSignature,
    event.deployerPublicKey
  );

  if (!deployerVerified) {
    throw new Error('Invalid deployer signature');
  }

  // 2. Perform 6-check verification
  const verification = await verifyExecution(event);

  if (verification.score < 0.8) {
    throw new Error('Verification failed');
  }

  // 3. Submit proof to Facilitator
  await submitUsageProof(
    event.intentId,
    event.nodeId,
    event.executionData
  );
}
```

### Step 4: Monitor Settlement

```javascript
// AI Deployer monitors payment settlement
import { FacilitatorClient } from './client';

async function monitorPaymentSettlement(intentId) {
  const client = new FacilitatorClient();

  // Check payment intent status
  const intent = await client.getPaymentIntent(intentId);

  if (intent.status === 'settled') {
    console.log('Payment settled successfully');
    console.log('Amount:', intent.amount);

    // Update internal database
    await updateJobPaymentStatus(intent.intentId, 'settled');
  }
}
```

---

## Event Handling

### Listen for Facilitator Events

```typescript
// Subscribe to payment settlement events
import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com');

connection.onLogs(
  FACILITATOR_PROGRAM_ID,
  (logs) => {
    if (logs.logs.includes('PaymentSettled')) {
      handlePaymentSettled(logs);
    }
  },
  'confirmed'
);

function handlePaymentSettled(logs) {
  // Parse event data
  // Update AI Deployer database
  // Notify relevant parties
}
```

---

## Testing Integration

### Integration Test Example

```typescript
import { describe, it, before } from 'mocha';
import { expect } from 'chai';

describe('AI Deployer - Facilitator Integration', () => {
  let jobId, intentId, nodeId;

  before(async () => {
    // Setup test environment
    nodeId = await registerTestNode();
  });

  it('should complete full payment flow', async () => {
    // 1. Create job in AI Deployer
    const job = await aiDeployer.createJob({
      model: 'llama-2-7b',
      prompt: 'Test prompt',
    });

    jobId = job.id;
    intentId = job.paymentIntentId;

    // 2. Simulate job execution
    await aiDeployer.executeJob(jobId, nodeId);

    // 3. Wait for Oracle verification
    await waitForVerification(intentId);

    // 4. Check payment settlement
    const intent = await facilitator.getPaymentIntent(intentId);
    expect(intent.status).to.equal('settled');

    // 5. Verify node received payment
    const node = await facilitator.getNodeAccount(nodeId);
    expect(node.totalEarned).to.be.greaterThan(0);
  });
});
```

---

## Design Philosophy

### Separation of Concerns

**AI Deployer:**
- Focus: Job scheduling and execution
- Does not handle payments directly
- Emits events for external verification

**Facilitator:**
- Focus: Payment authorization and settlement
- Does not execute compute jobs
- Relies on Oracle for verification

**Oracle:**
- Focus: Independent verification
- Bridges execution and payment
- Maintains trust through attestation

### Deterministic Attribution

All components maintain deterministic linkage:
- `jobId` → unique job identifier
- `intentId` → unique payment identifier
- `nodeId` → unique node identifier

This enables complete audit trails across systems.

### Auditability

**On-Chain:**
- All payment settlements recorded on Solana
- Immutable proof of payment history
- Public verification of Oracle attestations

**Off-Chain:**
- AI Deployer logs all job executions
- Oracle maintains verification records
- Complete event history for debugging

---

## Troubleshooting

### Common Issues

**Issue: Payment not settling**
```javascript
// Check if Oracle received completion event
const verificationStatus = await oracle.getVerificationStatus(jobId);

if (!verificationStatus) {
  // Resend completion event
  await emitJobCompletion(executionData);
}
```

**Issue: Verification failing**
```javascript
// Check verification score
const verification = await oracle.getVerification(jobId);
console.log('Score:', verification.score);
console.log('Checks:', verification.validations);

// Address failing checks
```

**Issue: Node not receiving payment**
```javascript
// Check node account
const node = await facilitator.getNodeAccount(nodeId);
console.log('Total earned:', node.totalEarned);
console.log('Jobs completed:', node.jobsCompleted);

// Check if payment intent settled
const intent = await facilitator.getPaymentIntent(intentId);
console.log('Intent status:', intent.status);
```

---

## Best Practices

1. **Always emit completion events** even for failed jobs
2. **Include comprehensive execution logs** for Oracle verification
3. **Monitor Oracle verification status** for all jobs
4. **Implement retry logic** for Oracle API calls
5. **Subscribe to Facilitator events** for real-time updates
6. **Maintain correlation IDs** across all systems
7. **Log all integration points** for debugging
8. **Test with small amounts** before production

---

## Future Enhancements

### Planned Features

- **Streaming Payments**: Pay-as-you-go for long-running jobs
- **Escrow Timeouts**: Automatic refund if job fails
- **Multi-Node Jobs**: Split payments across multiple nodes
- **Dynamic Pricing**: Adjust rates based on demand
- **Subscription Model**: Recurring payments for continuous service

---

## References

- [Facilitator Smart Contract Reference](./contract-reference.md)
- [Oracle API Documentation](./oracle-api.md)
- [Integration Guide](./integration-guide.md)
- [x402 Protocol Specification](./x402-protocol.md)

---

## Support

For integration support:
- Review [Examples](./examples.md)
- Check AI Deployer documentation
- Open an issue on GitHub

---

**Last Updated:** 2025-11-01
**Version:** 1.0

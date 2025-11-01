# x402 Protocol - Solana Implementation Specification

## Overview

This document specifies Hypernode's implementation of the x402 payment protocol for Solana blockchain. The x402 protocol is a chain-agnostic standard for HTTP-based payments, leveraging the `402 Payment Required` status code to enable pay-per-use services.

**Protocol Version:** 1.0
**Network:** Solana (Mainnet-Beta, Devnet)
**Token:** HYPER (SPL Token)

---

## Table of Contents

1. [Protocol Architecture](#protocol-architecture)
2. [Core Components](#core-components)
3. [Message Format](#message-format)
4. [Payment Flow](#payment-flow)
5. [Signature Verification](#signature-verification)
6. [Settlement Process](#settlement-process)
7. [Security Considerations](#security-considerations)
8. [Implementation Guide](#implementation-guide)

---

## Protocol Architecture

The x402-Solana implementation follows a three-party architecture:

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Client    │ ◄─────► │ Resource Server  │ ◄─────► │ Facilitator │
│  (Payer)    │         │   (Payee API)    │         │  (On-chain) │
└─────────────┘         └──────────────────┘         └─────────────┘
      │                          │                          │
      │                          │                          │
      └──────────────────────────┴──────────────────────────┘
                          Solana Blockchain
```

### Key Participants

- **Client**: End-user wallet that signs payment intents off-chain
- **Resource Server**: HTTP API that provides compute resources
- **Facilitator**: On-chain Solana program that validates and settles payments
- **Oracle**: Trusted verifier that validates compute execution

---

## Core Components

### 1. Payment Intent

A payment intent is an off-chain data structure containing payment authorization:

```typescript
interface PaymentIntent {
  intentId: string;        // Unique identifier (UUID)
  client: string;          // Client wallet public key
  amount: string;          // Amount in HYPER token units
  jobId: string;           // Job/resource identifier
  timestamp: number;       // Creation timestamp (ms)
  expiresAt: number;       // Expiration timestamp (ms)
  nonce: string;           // Replay protection nonce
  metadata?: object;       // Optional metadata
}
```

### 2. Payment Requirements

Server response specifying payment terms:

```typescript
interface PaymentRequirements {
  x402Version: number;     // Protocol version (1)
  price: {
    amount: string;        // Required amount
    asset: {
      address: string;     // HYPER token mint
      decimals: number;    // Token decimals (6)
      symbol: string;      // "HYPER"
    }
  };
  network: string;         // "solana-mainnet" or "solana-devnet"
  config: {
    description: string;   // Human-readable description
    resource: string;      // Protected resource URI
    mimeType: string;      // Response content type
    maxTimeoutSeconds: number; // Request timeout
    metadata?: object;     // Optional metadata
  };
}
```

### 3. Payment Payload

Client-submitted payment in request header:

```typescript
interface PaymentPayload {
  intent: PaymentIntent;
  signature: string;       // Base58-encoded Ed25519 signature
  transaction?: string;    // Optional pre-signed transaction
}
```

---

## Message Format

### HTTP Headers

**Client Request Headers:**
```
X-PAYMENT: <base64-encoded PaymentPayload>
```

**Server Response Headers:**
```
X-PAYMENT-REQUIRED: true
X-PAYMENT-RESPONSE: <base64-encoded settlement details>
```

### Signing Message Format

Clients sign a human-readable message to prevent phishing:

```
HYPERNODE Payment Intent

Intent ID: {intentId}
Job ID: {jobId}
Amount: {amount} HYPER
Timestamp: {timestamp ISO 8601}
Expires: {expiresAt ISO 8601}
Nonce: {nonce}

By signing this message, you authorize this payment.
```

**Signature Algorithm:** Ed25519 (Solana standard)
**Encoding:** Base58 (bs58)

---

## Payment Flow

### Complete 12-Step Flow

```
1. Client → Server: GET /api/resource
2. Server → Client: 402 Payment Required + PaymentRequirements
3. Client: Creates PaymentIntent
4. Client: Signs payment message with wallet
5. Client → Server: GET /api/resource + X-PAYMENT header
6. Server: Verifies signature locally
7. Server → Facilitator: Authorize payment on-chain
8. Facilitator: Creates escrow account
9. Server: Performs requested work
10. Server → Oracle: Submit execution proof
11. Oracle → Facilitator: Submit usage proof on-chain
12. Facilitator: Releases payment to node
```

### State Diagram

```
[Pending] → [Authorized] → [Escrowed] → [Verified] → [Settled]
                ↓              ↓             ↓
            [Expired]     [Cancelled]   [Failed]
```

---

## Signature Verification

### Off-Chain Verification (Server-Side)

```javascript
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

function verifySignature(paymentIntent, signature, publicKey) {
  // 1. Create signing message
  const message = paymentIntent.toSigningMessage();
  const messageBytes = new TextEncoder().encode(message);

  // 2. Decode signature and public key
  const signatureBytes = bs58.decode(signature);
  const publicKeyBytes = new PublicKey(publicKey).toBytes();

  // 3. Verify Ed25519 signature
  return nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    publicKeyBytes
  );
}
```

### Validation Checks

Before accepting a payment, verify:

1. ✅ **Signature is valid** - Cryptographic verification passes
2. ✅ **Client matches** - Intent.client === signer public key
3. ✅ **Not expired** - Current time < expiresAt
4. ✅ **Amount sufficient** - Intent.amount >= required amount
5. ✅ **Token correct** - Using HYPER token mint
6. ✅ **Not replayed** - Intent ID not previously used

---

## Settlement Process

### On-Chain Settlement

The Facilitator smart contract handles settlement through these instructions:

#### 1. Authorize Payment
```rust
pub fn authorize_payment(
    ctx: Context<AuthorizePayment>,
    intent_data: PaymentIntentData
) -> Result<()>
```

Creates a payment intent account and escrow for the payment.

#### 2. Submit Usage Proof
```rust
pub fn submit_usage_proof(
    ctx: Context<SubmitUsageProof>,
    proof_data: UsageProofData
) -> Result<()>
```

Oracle submits proof of compute execution to release payment.

#### 3. Release Payment
```rust
pub fn release_payment(
    ctx: Context<ReleasePayment>
) -> Result<()>
```

Transfers tokens from escrow to node after successful verification.

### Escrow Mechanism

```
Client Tokens → Escrow Account → Node Rewards
                      ↓
                 [Locked until Oracle verifies]
```

**Escrow PDA Derivation:**
```javascript
const [escrowPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("escrow"), Buffer.from(intentId)],
  programId
);
```

---

## Security Considerations

### Client Protection

1. **No gas fees** - Facilitator handles all transaction fees
2. **Amount control** - Client specifies exact amount, server cannot overcharge
3. **Expiration** - Payment intents expire to prevent indefinite authorization
4. **Nonce protection** - Prevents signature replay attacks
5. **Human-readable messages** - Users see clear payment details before signing

### Server Protection

1. **Pre-verification** - Validate signatures before performing work
2. **Escrow guarantee** - Tokens locked in escrow before work begins
3. **Oracle verification** - Independent verification of compute execution
4. **Timeout enforcement** - Automatic expiration of stale payments

### Oracle Security

1. **Multi-check verification** - Six independent validation checks
2. **Execution hashing** - SHA256 hashes prove work completion
3. **On-chain attestation** - Oracle signatures recorded on blockchain
4. **Authority control** - Only authorized oracle can submit proofs

### Best Practices

```typescript
// ✅ Good: Verify before work
if (!verifyPayment(paymentIntent, signature)) {
  return res.status(402).json({ error: 'Invalid payment' });
}
performWork();

// ❌ Bad: Work before verification
performWork();
verifyPayment(paymentIntent, signature);
```

---

## Implementation Guide

### Quick Start

#### 1. Server Setup

```javascript
import { createX402SolanaAdapter } from './x402-solana-adapter.js';

const adapter = createX402SolanaAdapter({
  network: 'solana-devnet',
  hyperTokenMint: process.env.HYPER_TOKEN_MINT,
});

// Use middleware
app.use(adapter.middleware());
```

#### 2. Protected Endpoint

```javascript
app.get('/api/compute', async (req, res) => {
  // Check for payment
  if (!req.x402.paymentProvided) {
    const requirements = adapter.createPaymentRequirements({
      jobId: crypto.randomUUID(),
      amount: '1000000', // 1 HYPER (6 decimals)
      description: 'AI Compute Job',
    });

    return res.status(402).json({
      error: 'Payment Required',
      paymentRequirements: requirements,
    });
  }

  // Verify payment
  const verification = await adapter.verifyPayment(
    req.x402.paymentHeader,
    requirements
  );

  if (!verification.valid) {
    return res.status(402).json({ error: verification.error });
  }

  // Settle payment
  await adapter.settlePayment(req.x402.paymentHeader, requirements);

  // Perform work
  const result = await performCompute(req.body);

  res.json({ success: true, result });
});
```

#### 3. Client Integration

```typescript
import { createPaymentIntent } from './x402.js';
import { signMessage } from '@solana/wallet-adapter';

// 1. Request resource
const response = await fetch('/api/compute', {
  method: 'GET',
});

// 2. Handle 402
if (response.status === 402) {
  const { paymentRequirements } = await response.json();

  // 3. Create payment intent
  const intent = createPaymentIntent({
    client: wallet.publicKey.toString(),
    amount: paymentRequirements.price.amount,
    jobId: paymentRequirements.config.metadata.jobId,
  });

  // 4. Sign message
  const message = intent.toSigningMessage();
  const signature = await signMessage(message);

  // 5. Retry with payment
  const paymentPayload = { intent, signature };
  const retryResponse = await fetch('/api/compute', {
    method: 'GET',
    headers: {
      'X-PAYMENT': btoa(JSON.stringify(paymentPayload)),
    },
  });

  const result = await retryResponse.json();
}
```

---

## Differences from Standard x402

### Solana-Specific Adaptations

1. **Ed25519 Signatures**: Uses Solana's native Ed25519 instead of Ethereum's ECDSA
2. **SPL Token Transfers**: Uses Solana's Token Program instead of ERC20
3. **PDA Escrow**: Uses Program Derived Addresses for trustless escrow
4. **No Gas from Clients**: Facilitator pays all transaction fees
5. **Token Decimals**: HYPER uses 6 decimals (not 18 like ETH)

### Enhanced Features

1. **Oracle Verification**: Independent compute validation layer
2. **Node Rewards**: Automatic distribution to compute providers
3. **Proof Hashing**: SHA256 hashes for execution verification
4. **Queue System**: Asynchronous proof submission

---

## API Reference

See additional documentation:
- [Integration Guide](./integration-guide.md)
- [Oracle API](./oracle-api.md)
- [Smart Contract Reference](./contract-reference.md)
- [Example Implementations](./examples.md)

---

## Versioning

**Current Version:** 1.0
**Protocol Identifier:** `x402-solana-v1`

Future versions will maintain backward compatibility through the `x402Version` field in all protocol messages.

---

## License

MIT License - See LICENSE file for details

---

## References

- [Coinbase x402 Specification](https://github.com/coinbase/x402)
- [PayAI x402-Solana](https://github.com/payainetwork/x402-solana)
- [Solana Documentation](https://docs.solana.com)
- [Anchor Framework](https://book.anchor-lang.com)

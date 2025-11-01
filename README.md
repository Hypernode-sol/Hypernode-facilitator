# Hypernode Facilitator

> On-chain x402 payment protocol implementation for Solana-based decentralized AI compute networks

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-Mainnet%20%7C%20Devnet-9945FF)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.29+-6B4FBB)](https://www.anchor-lang.com/)

**Hypernode Facilitator** is a production-ready implementation of the x402 payment protocol for Solana blockchain, enabling pay-per-use AI compute services with cryptographic payment verification and automated settlement.

---

## Overview

The x402 protocol provides a standardized way to request and process payments over HTTP using the `402 Payment Required` status code. This implementation adapts x402 for Solana, enabling:

- **Gasless payments** - Clients sign payment intents without paying transaction fees
- **Cryptographic verification** - Ed25519 signatures prove payment authorization
- **Escrow settlement** - Tokens locked on-chain until work completion
- **Oracle validation** - Independent verification of compute execution
- **Automated distribution** - Direct payment to compute providers

### Key Benefits

- **For Clients**: Pay-per-use pricing with cryptographic guarantees
- **For Servers**: Simple integration with one middleware function
- **For Nodes**: Automatic payment distribution after verified work
- **For Developers**: Complete SDK with TypeScript support

---

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Client    │ ◄─────► │ Resource Server  │ ◄─────► │ Facilitator │
│  (Payer)    │         │   (Compute API)  │         │  (On-chain) │
└─────────────┘         └──────────────────┘         └─────────────┘
      │                          │                          │
      └──────────────────────────┴──────────────────────────┘
                          Solana Blockchain
                                 │
                          ┌──────┴──────┐
                          │   Oracle    │
                          │ (Verifier)  │
                          └─────────────┘
```

**Components:**
- **Client**: Wallet that signs payment intents
- **Server**: HTTP API providing compute resources
- **Facilitator**: On-chain program managing escrow and settlement
- **Oracle**: Trusted verifier validating compute execution

---

## Features

### Protocol Implementation
- ✅ Full x402 protocol compliance
- ✅ Ed25519 signature verification
- ✅ Replay attack protection (nonce-based)
- ✅ Payment expiration handling
- ✅ Human-readable signing messages

### Smart Contract
- ✅ Anchor-based Solana program
- ✅ Escrow mechanism with PDA
- ✅ Multi-step settlement flow
- ✅ Event emission for tracking
- ✅ Node registration and staking

### Off-Chain Services
- ✅ Express.js middleware
- ✅ Oracle verification service
- ✅ Automatic proof submission
- ✅ Client SDK and utilities

### Token Support
- ✅ SPL Token (HYPER)
- ✅ 6-decimal precision
- ✅ Associated token accounts
- ✅ Gasless client operations

---

## Quick Start

### Prerequisites

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Install dependencies
npm install
```

### Build & Deploy

```bash
# Build the program
anchor build

# Run tests
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

### Server Integration

```javascript
import { createX402SolanaAdapter } from './x402-solana-adapter.js';

const adapter = createX402SolanaAdapter();
app.use(adapter.middleware());

app.post('/api/compute', async (req, res) => {
  if (!req.x402.paymentProvided) {
    return res.status(402).json({
      paymentRequirements: adapter.createPaymentRequirements({
        amount: '1000000', // 1 HYPER
        jobId: crypto.randomUUID(),
      }),
    });
  }

  // Process paid request
  const result = await performCompute(req.body);
  res.json(result);
});
```

### Client Integration

```typescript
import { createPaymentIntent } from './x402.js';

// 1. Request resource
const res = await fetch('/api/compute', { method: 'POST' });

// 2. Handle 402
if (res.status === 402) {
  const { paymentRequirements } = await res.json();

  // 3. Sign payment
  const intent = createPaymentIntent({
    client: wallet.publicKey.toString(),
    amount: paymentRequirements.price.amount,
    jobId: paymentRequirements.config.metadata.jobId,
  });

  const signature = await wallet.signMessage(
    new TextEncoder().encode(intent.toSigningMessage())
  );

  // 4. Retry with payment
  const paidRes = await fetch('/api/compute', {
    method: 'POST',
    headers: {
      'X-PAYMENT': btoa(JSON.stringify({ intent, signature })),
    },
  });
}
```

---

## Documentation

### Core Documentation
- **[x402 Protocol Specification](./docs/x402-protocol.md)** - Complete protocol specification
- **[Smart Contract Reference](./docs/contract-reference.md)** - Program instructions and accounts
- **[Integration Guide](./docs/integration-guide.md)** - Step-by-step integration
- **[Examples](./docs/examples.md)** - Practical implementation examples

### API Documentation
- **[Oracle API](./docs/oracle-api.md)** - Oracle service endpoints
- **[Architecture](./docs/architecture.md)** - System design and flow

---

## Repository Structure

```
hypernode-facilitator/
├── programs/
│   └── hypernode_facilitator/    # Anchor Solana program
│       ├── src/
│       │   ├── lib.rs            # Program entrypoint
│       │   ├── state.rs          # Account structures
│       │   ├── instruction/      # Instruction handlers
│       │   └── constants.rs      # Program constants
│       └── Cargo.toml
├── docs/                         # Documentation
│   ├── x402-protocol.md          # Protocol spec
│   ├── contract-reference.md     # Smart contract API
│   ├── integration-guide.md      # Integration guide
│   ├── examples.md               # Code examples
│   ├── oracle-api.md             # Oracle documentation
│   └── architecture.md           # Architecture overview
├── tests/                        # Integration tests
│   └── basic-flow.ts             # End-to-end tests
├── offchain/                     # Off-chain services
│   └── oracle-service/           # Oracle verifier
│       ├── index.ts              # Oracle service
│       └── send-payment.ts       # Payment submission
├── routes/                       # API routes
│   └── facilitator.js            # HTTP endpoints
├── migrations/                   # Deployment scripts
│   └── deploy.js                 # Anchor deployment
├── x402.js                       # x402 protocol implementation
├── x402-solana-adapter.js        # Solana adapter
├── client.js                     # Facilitator client SDK
├── oracle.js                     # Oracle service
├── idl.json                      # Program IDL
├── Anchor.toml                   # Anchor configuration
├── Cargo.toml                    # Rust workspace
└── README.md                     # This file
```

---

## Token Information

### HYPER Token

**Symbol:** HYPER
**Decimals:** 6
**Network:** Solana Mainnet-Beta / Devnet

**Devnet Mint:**
```
92s9qna3djkMncZzkacyNQ38UKnNXZFh4Jgqe3Cmpump
```

---

## Payment Flow

### Complete Flow (12 Steps)

1. **Client** → Server: Request resource
2. **Server** → Client: `402 Payment Required` + requirements
3. **Client**: Create payment intent
4. **Client**: Sign message with wallet
5. **Client** → Server: Retry with `X-PAYMENT` header
6. **Server**: Verify signature locally
7. **Server** → Facilitator: Create escrow on-chain
8. **Facilitator**: Lock tokens in escrow PDA
9. **Server**: Perform compute work
10. **Server** → Oracle: Submit execution proof
11. **Oracle** → Facilitator: Verify and release payment
12. **Facilitator**: Transfer tokens to node

---

## Security

### Client Protection
- No gas fees required from clients
- Exact amount control (no overcharging)
- Expiration-based authorization
- Replay attack prevention (nonce)
- Human-readable signing messages

### Server Protection
- Signature verification before work
- Escrow guarantee of payment
- Oracle verification of completion
- Automatic timeout handling

### Oracle Security
- Multi-check verification (6 checks)
- SHA256 execution hashing
- On-chain attestation signatures
- Authority-based access control

---

## Testing

### Run Tests

```bash
# Unit tests
anchor test

# Integration tests
npm test

# With verbose output
anchor test -- --features "debug"
```

### Test Coverage

- ✅ Node registration
- ✅ Payment authorization
- ✅ Escrow creation
- ✅ Oracle proof submission
- ✅ Payment settlement
- ✅ Reward claiming
- ✅ Signature verification
- ✅ Replay protection

---

## Contributing

We welcome contributions from the community!

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Write tests for new features
- Follow Rust and TypeScript conventions
- Update documentation for API changes
- Ensure all tests pass before submitting

---

## Roadmap

### Current Version: 1.0

- ✅ Core x402 protocol implementation
- ✅ Solana smart contract
- ✅ Oracle verification service
- ✅ Client SDK and examples

### Upcoming Features

- 🔄 Multi-token support
- 🔄 Advanced oracle verification algorithms
- 🔄 Payment streaming for long-running jobs
- 🔄 Decentralized oracle network
- 🔄 GraphQL API
- 🔄 React component library

---

## References

This implementation is based on:

- [Coinbase x402 Protocol](https://github.com/coinbase/x402) - Original specification
- [PayAI x402-Solana](https://github.com/payainetwork/x402-solana) - Solana adaptation
- [Solana Documentation](https://docs.solana.com) - Blockchain platform
- [Anchor Framework](https://book.anchor-lang.com) - Smart contract framework

---

## License

MIT License - see [LICENSE](./LICENSE) file for details

---

## Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/Hypernode-sol/Hypernode-facilitator/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Hypernode-sol/Hypernode-facilitator/discussions)

---

## Acknowledgments

Built with support from:
- Solana Foundation
- Anchor Framework Team
- x402 Protocol Contributors
- Hypernode Community

---

**Hypernode Facilitator** - Enabling the future of decentralized AI compute economies

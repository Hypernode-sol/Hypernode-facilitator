# Architecture

This program implements a decentralized x402-compatible payment facilitator on Solana. It enables Hypernode compute nodes to receive on-chain rewards triggered by HTTP-style payment intents.

## Components

- **Solana Program (on-chain)**: Verifies signed authorizations and transfers HYPER tokens to nodes.
- **Off-chain Oracle**: Pushes usage data and verifies resource consumption.
- **Client SDK**: Generates x402-compatible payment headers and transaction payloads.

## Flow

1. A client receives a 402 Payment Required.
2. It signs a payment intent off-chain.
3. The facilitator contract verifies the signature and executes a token transfer (gasless).

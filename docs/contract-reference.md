# Smart Contract Reference

## Hypernode Facilitator Program

Complete reference for the on-chain Solana program implementing x402 payment settlement.

---

## Table of Contents

1. [Program Overview](#program-overview)
2. [Account Structures](#account-structures)
3. [Instructions](#instructions)
4. [Program Derived Addresses](#program-derived-addresses)
5. [Error Codes](#error-codes)
6. [Events](#events)

---

## Program Overview

**Program Name:** `hypernode_facilitator`
**Network:** Solana (Mainnet-Beta, Devnet)
**Framework:** Anchor 0.29+

### Purpose

The Facilitator program manages:
- Payment intent authorization and escrow
- Oracle-verified usage proof submission
- Token distribution to compute nodes
- Node registration and staking

---

## Account Structures

### NodeAccount

Represents a registered compute node.

```rust
#[account]
pub struct NodeAccount {
    pub authority: Pubkey,        // Node operator wallet
    pub node_id: String,          // Unique node identifier
    pub stake_amount: u64,        // Staked HYPER tokens
    pub total_earned: u64,        // Lifetime earnings
    pub jobs_completed: u64,      // Total jobs processed
    pub is_active: bool,          // Active status
    pub registered_at: i64,       // Registration timestamp
    pub bump: u8,                 // PDA bump seed
}
```

**Size:** 8 (discriminator) + 32 + 64 + 8 + 8 + 8 + 1 + 8 + 1 = 138 bytes

**PDA Seeds:** `["node", node_id.as_bytes()]`

### PaymentIntent

Represents an authorized payment for a compute job.

```rust
#[account]
pub struct PaymentIntent {
    pub intent_id: String,        // Unique intent identifier
    pub client: Pubkey,           // Paying wallet
    pub amount: u64,              // Payment amount in lamports
    pub status: PaymentStatus,    // Current status
    pub created_at: i64,          // Creation timestamp
    pub expires_at: i64,          // Expiration timestamp
    pub settled_at: Option<i64>,  // Settlement timestamp
    pub node_id: Option<String>,  // Assigned node
    pub bump: u8,                 // PDA bump seed
}
```

**Size:** 8 + 64 + 32 + 8 + 1 + 8 + 8 + 9 + 65 + 1 = 204 bytes

**PDA Seeds:** `["intent", intent_id.as_bytes()]`

### UsageProof

Oracle-submitted proof of compute execution.

```rust
#[account]
pub struct UsageProof {
    pub proof_id: String,         // Unique proof identifier
    pub intent_id: String,        // Related payment intent
    pub node_id: String,          // Executing node
    pub oracle: Pubkey,           // Oracle authority
    pub execution_hash: String,   // SHA256 of execution
    pub logs_hash: String,        // SHA256 of logs
    pub submitted_at: i64,        // Submission timestamp
    pub verified: bool,           // Verification status
    pub bump: u8,                 // PDA bump seed
}
```

**Size:** 8 + 64 + 64 + 64 + 32 + 64 + 64 + 8 + 1 + 1 = 370 bytes

**PDA Seeds:** `["proof", intent_id.as_bytes()]`

---

## Instructions

### 1. register_node

Registers a new compute node in the network.

**Accounts:**
```rust
#[derive(Accounts)]
pub struct RegisterNode<'info> {
    #[account(
        init,
        payer = authority,
        space = 138,
        seeds = [b"node", node_id.as_bytes()],
        bump
    )]
    pub node: Account<'info, NodeAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = hyper_mint,
        associated_token::authority = node
    )]
    pub staking_account: Account<'info, TokenAccount>,

    pub hyper_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
```

**Parameters:**
```rust
pub fn register_node(
    ctx: Context<RegisterNode>,
    node_id: String,
    stake_amount: u64
) -> Result<()>
```

**Validation:**
- Node ID must be unique
- Node ID length: 1-64 characters
- Authority must sign transaction
- Stake amount optional (can be 0)

**Example:**
```typescript
await program.methods
  .registerNode("node-abc-123", new BN(1000000))
  .accounts({
    node: nodeAccountPDA,
    authority: wallet.publicKey,
    stakingAccount: stakingTokenAccount,
    hyperMint: HYPER_MINT,
  })
  .rpc();
```

---

### 2. authorize_payment

Creates and authorizes a payment intent, locking tokens in escrow.

**Accounts:**
```rust
#[derive(Accounts)]
pub struct AuthorizePayment<'info> {
    #[account(
        init,
        payer = client,
        space = 204,
        seeds = [b"intent", intent_data.intent_id.as_bytes()],
        bump
    )]
    pub payment_intent: Account<'info, PaymentIntent>,

    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        init,
        payer = client,
        seeds = [b"escrow", intent_data.intent_id.as_bytes()],
        bump,
        token::mint = hyper_mint,
        token::authority = escrow
    )]
    pub escrow: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = hyper_mint,
        associated_token::authority = client
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    pub hyper_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
```

**Parameters:**
```rust
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PaymentIntentData {
    pub intent_id: String,
    pub amount: u64,
    pub expires_at: i64,
}

pub fn authorize_payment(
    ctx: Context<AuthorizePayment>,
    intent_data: PaymentIntentData
) -> Result<()>
```

**Validation:**
- Intent ID must be unique
- Amount > 0
- Expires at > current time
- Client has sufficient token balance

**Process:**
1. Create payment intent account
2. Create escrow token account
3. Transfer tokens from client to escrow
4. Set status to `Authorized`

**Example:**
```typescript
await program.methods
  .authorizePayment({
    intentId: "intent-xyz-789",
    amount: new BN(5000000),
    expiresAt: new BN(Date.now() / 1000 + 3600),
  })
  .accounts({
    paymentIntent: intentPDA,
    client: wallet.publicKey,
    escrow: escrowPDA,
    clientTokenAccount: clientATA,
    hyperMint: HYPER_MINT,
  })
  .rpc();
```

---

### 3. submit_usage_proof

Oracle submits proof of compute execution to release payment.

**Accounts:**
```rust
#[derive(Accounts)]
pub struct SubmitUsageProof<'info> {
    #[account(
        init,
        payer = oracle,
        space = 370,
        seeds = [b"proof", proof_data.intent_id.as_bytes()],
        bump
    )]
    pub usage_proof: Account<'info, UsageProof>,

    #[account(
        mut,
        seeds = [b"intent", proof_data.intent_id.as_bytes()],
        bump = payment_intent.bump
    )]
    pub payment_intent: Account<'info, PaymentIntent>,

    #[account(
        mut,
        seeds = [b"node", proof_data.node_id.as_bytes()],
        bump = node.bump
    )]
    pub node: Account<'info, NodeAccount>,

    #[account(mut)]
    pub oracle: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", proof_data.intent_id.as_bytes()],
        bump
    )]
    pub escrow: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = hyper_mint,
        associated_token::authority = node
    )]
    pub node_token_account: Account<'info, TokenAccount>,

    pub hyper_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
```

**Parameters:**
```rust
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UsageProofData {
    pub intent_id: String,
    pub node_id: String,
    pub execution_hash: String,  // SHA256 hex
    pub logs_hash: String,       // SHA256 hex
}

pub fn submit_usage_proof(
    ctx: Context<SubmitUsageProof>,
    proof_data: UsageProofData
) -> Result<()>
```

**Validation:**
- Oracle authority must match program oracle
- Payment intent must exist and be authorized
- Node must be registered and active
- Execution hash format: 64-character hex
- Logs hash format: 64-character hex

**Process:**
1. Verify oracle authority
2. Create usage proof account
3. Transfer tokens from escrow to node
4. Update payment intent status to `Settled`
5. Increment node earnings and job count
6. Emit settlement event

**Example:**
```typescript
await program.methods
  .submitUsageProof({
    intentId: "intent-xyz-789",
    nodeId: "node-abc-123",
    executionHash: "a1b2c3...",
    logsHash: "d4e5f6...",
  })
  .accounts({
    usageProof: proofPDA,
    paymentIntent: intentPDA,
    node: nodePDA,
    oracle: oracleKeypair.publicKey,
    escrow: escrowPDA,
    nodeTokenAccount: nodeATA,
    hyperMint: HYPER_MINT,
  })
  .signers([oracleKeypair])
  .rpc();
```

---

### 4. claim_rewards

Node operator withdraws earned tokens from staking account.

**Accounts:**
```rust
#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(
        mut,
        seeds = [b"node", node.node_id.as_bytes()],
        bump = node.bump,
        has_one = authority
    )]
    pub node: Account<'info, NodeAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = hyper_mint,
        associated_token::authority = node
    )]
    pub staking_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = hyper_mint,
        associated_token::authority = authority
    )]
    pub authority_token_account: Account<'info, TokenAccount>,

    pub hyper_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}
```

**Parameters:**
```rust
pub fn claim_rewards(
    ctx: Context<ClaimRewards>,
    amount: u64
) -> Result<()>
```

**Validation:**
- Authority must match node.authority
- Amount <= staking account balance
- Amount > 0

**Example:**
```typescript
await program.methods
  .claimRewards(new BN(1000000))
  .accounts({
    node: nodePDA,
    authority: wallet.publicKey,
    stakingAccount: stakingATA,
    authorityTokenAccount: authorityATA,
    hyperMint: HYPER_MINT,
  })
  .rpc();
```

---

### 5. cancel_payment

Cancels an authorized payment and returns tokens to client.

**Accounts:**
```rust
#[derive(Accounts)]
pub struct CancelPayment<'info> {
    #[account(
        mut,
        seeds = [b"intent", payment_intent.intent_id.as_bytes()],
        bump = payment_intent.bump,
        has_one = client
    )]
    pub payment_intent: Account<'info, PaymentIntent>,

    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", payment_intent.intent_id.as_bytes()],
        bump
    )]
    pub escrow: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = hyper_mint,
        associated_token::authority = client
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    pub hyper_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}
```

**Parameters:**
```rust
pub fn cancel_payment(
    ctx: Context<CancelPayment>
) -> Result<()>
```

**Validation:**
- Client must match payment intent client
- Payment must be in `Authorized` status (not settled)
- Can cancel after expiration or before settlement

**Example:**
```typescript
await program.methods
  .cancelPayment()
  .accounts({
    paymentIntent: intentPDA,
    client: wallet.publicKey,
    escrow: escrowPDA,
    clientTokenAccount: clientATA,
    hyperMint: HYPER_MINT,
  })
  .rpc();
```

---

## Program Derived Addresses

### PDA Derivation Functions

```typescript
// Node Account PDA
function deriveNodePDA(nodeId: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("node"), Buffer.from(nodeId)],
    PROGRAM_ID
  );
}

// Payment Intent PDA
function derivePaymentIntentPDA(intentId: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("intent"), Buffer.from(intentId)],
    PROGRAM_ID
  );
}

// Escrow PDA
function deriveEscrowPDA(intentId: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), Buffer.from(intentId)],
    PROGRAM_ID
  );
}

// Usage Proof PDA
function deriveUsageProofPDA(intentId: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proof"), Buffer.from(intentId)],
    PROGRAM_ID
  );
}
```

---

## Error Codes

### Custom Errors

```rust
#[error_code]
pub enum FacilitatorError {
    #[msg("Node ID must be between 1 and 64 characters")]
    InvalidNodeId,

    #[msg("Node is already registered")]
    NodeAlreadyRegistered,

    #[msg("Payment amount must be greater than zero")]
    InvalidPaymentAmount,

    #[msg("Payment intent has expired")]
    PaymentExpired,

    #[msg("Payment intent already used")]
    PaymentAlreadyUsed,

    #[msg("Invalid execution hash format")]
    InvalidExecutionHash,

    #[msg("Invalid logs hash format")]
    InvalidLogsHash,

    #[msg("Unauthorized oracle")]
    UnauthorizedOracle,

    #[msg("Node is not active")]
    NodeInactive,

    #[msg("Insufficient balance for withdrawal")]
    InsufficientBalance,

    #[msg("Payment cannot be cancelled in current status")]
    CannotCancel,
}
```

---

## Events

### PaymentAuthorized

Emitted when a payment intent is created.

```rust
#[event]
pub struct PaymentAuthorized {
    pub intent_id: String,
    pub client: Pubkey,
    pub amount: u64,
    pub expires_at: i64,
    pub timestamp: i64,
}
```

### PaymentSettled

Emitted when a payment is settled to a node.

```rust
#[event]
pub struct PaymentSettled {
    pub intent_id: String,
    pub node_id: String,
    pub amount: u64,
    pub oracle: Pubkey,
    pub timestamp: i64,
}
```

### NodeRegistered

Emitted when a new node registers.

```rust
#[event]
pub struct NodeRegistered {
    pub node_id: String,
    pub authority: Pubkey,
    pub timestamp: i64,
}
```

### RewardsClaimed

Emitted when a node claims rewards.

```rust
#[event]
pub struct RewardsClaimed {
    pub node_id: String,
    pub authority: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
```

---

## Constants

```rust
pub const NODE_ID_MAX_LEN: usize = 64;
pub const INTENT_ID_MAX_LEN: usize = 64;
pub const HASH_HEX_LEN: usize = 64;
pub const MAX_PAYMENT_TIMEOUT: i64 = 86400; // 24 hours
```

---

## Testing

### Unit Tests

Run program tests:
```bash
anchor test
```

### Integration Tests

See [tests/basic-flow.ts](../tests/basic-flow.ts) for complete flow examples.

---

## Deployment

### Deploy to Devnet

```bash
anchor build
anchor deploy --provider.cluster devnet
```

### Verify Deployment

```bash
solana program show <PROGRAM_ID> --url devnet
```

---

## Security Audit

Recommended security practices:
- ✅ Use PDA for all program-controlled accounts
- ✅ Validate all input parameters
- ✅ Check account ownership
- ✅ Prevent reentrancy with status checks
- ✅ Use native Solana token transfers
- ✅ Emit events for all state changes

---

## License

MIT License

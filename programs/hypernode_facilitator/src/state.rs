use anchor_lang::prelude::*;

#[account]
pub struct Node {
    pub owner: Pubkey,
    pub staked_amount: u64,
    pub pending_reward: u64,
    pub bump: u8,
}

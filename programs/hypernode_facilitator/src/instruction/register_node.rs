use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterNode<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 8 + 8 + 1,
        seeds = [b"node", user.key().as_ref()],
        bump
    )]
    pub node: Account<'info, Node>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterNode>) -> Result<()> {
    let node = &mut ctx.accounts.node;
    node.owner = *ctx.accounts.user.key;
    node.staked_amount = 0;
    node.pending_reward = 0;
    node.bump = *ctx.bumps.get("node").unwrap();
    Ok(())
}

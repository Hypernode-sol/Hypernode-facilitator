use anchor_lang::prelude::*;

pub mod instruction;
pub mod state;

use instruction::*;

#[program]
pub mod hypernode_facilitator {
    use super::*;
    pub fn register_node(ctx: Context<RegisterNode>) -> Result<()> {
        register_node::handler(ctx)
    }
}

use instruction::register_node;

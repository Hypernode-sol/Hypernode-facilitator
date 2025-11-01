import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HypernodeFacilitator } from "../target/types/hypernode_facilitator";

describe("hypernode-facilitator", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HypernodeFacilitator as Program<HypernodeFacilitator>;

  it("Registers a new node", async () => {
    const [nodePda, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("node"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerNode()
      .accounts({
        node: nodePda,
        user: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Node registered:", nodePda.toBase58());
  });
});

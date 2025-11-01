import { Keypair, Connection, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import * as bs58 from "bs58";

const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
const receiver = new PublicKey(process.argv[2]);
const amount = Number(process.argv[3]);

(async () => {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: receiver,
      lamports: amount,
    })
  );

  const sig = await connection.sendTransaction(tx, [payer]);
  console.log("Transaction sent:", sig);
})();

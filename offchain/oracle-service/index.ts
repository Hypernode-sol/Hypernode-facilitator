import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

app.post("/submit-usage", async (req, res) => {
  const { node, task_id, tokens_due, signature } = req.body;

  console.log("Received usage report:", req.body);
  // Here you'd verify the signature and submit to Solana via RPC

  res.status(200).json({ status: "accepted" });
});

app.listen(4002, () => {
  console.log("Oracle service listening on port 4002");
});

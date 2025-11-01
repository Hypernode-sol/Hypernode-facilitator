# Oracle API

## Endpoint

POST /submit-usage

```json
{
  "node": "<pubkey>",
  "task_id": "abc123",
  "tokens_due": 5000000,
  "signature": "<ed25519 signature>"
}

# Chamber env var management

This repo uses **[Chamber](https://github.com/segmentio/chamber)** to store environment variables/secrets in AWS instead of committing `.env` files.

## Where secrets live

By default, Chamber uses **AWS SSM Parameter Store** (`CHAMBER_SECRET_BACKEND=ssm`). Values are encrypted at rest by **AWS KMS** and access is controlled by **IAM** policies on your AWS account + region.

Chamber is just a CLI wrapper around that backend:

- Create/update a value: `chamber write <service> <key> -- <value>`
- Read a value: `chamber read <service> <key>`
- List keys: `chamber list <service>`
- Export to dotenv: `chamber export <service> -f dotenv`
- Run a command with vars injected: `chamber exec <service> -- <command>`

## Service naming convention

Chamber namespaces secrets by a **service name** (first argument in Chamber commands).

Recommended convention (adjust if your deployment already has one):

- Local/dev: `<repo-name>-local`
- Production: `<repo-name>-prod`

Example:

- `retrieval-service-local`
- `retrieval-service-prod`

## Importing from a `.env` file

This repo includes `scripts/chamber-import.sh` to import a `.env`-style file into Chamber.

Examples:

```bash
# Import your local env file (writes keys lowercased by default)
./scripts/chamber-import.sh <service> .env.local

# Import production env file
./scripts/chamber-import.sh <service> .env.production

# See what would be written (no AWS calls)
./scripts/chamber-import.sh --dry-run <service> .env.local

# Preserve original key case (optional)
./scripts/chamber-import.sh --preserve-case <service> .env.local
```

Notes:

- The importer supports `KEY=VALUE` lines and `export KEY=VALUE`.
- Comments/blank lines are ignored.
- If your `.env` includes multiline values, import them via `chamber write` manually.

## Getting secrets into your runtime

Option A: run a command with Chamber-injected env:

```bash
chamber exec <service> -- <your-command>
```

Option B: export a dotenv file (useful for tools that only support `--env-file`):

```bash
chamber export <service> -f dotenv -o .env.local
chmod 600 .env.local
```

## IAM permissions (SSM backend)

To write/import secrets, your AWS identity typically needs SSM permissions like:

- `ssm:PutParameter`, `ssm:GetParameter`, `ssm:GetParametersByPath`, `ssm:DeleteParameter`, `ssm:DescribeParameters`

…and KMS permissions to encrypt/decrypt with the key used by Parameter Store.


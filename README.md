# Rental Ops Agent

A chat agent for running a rental property: it logs expenses to a Google Sheet and answers questions about documents you upload (leases, quotes, notes). Built with LangChain tool calling, a FAISS retrieval index and a Chainlit UI.

It is a small prototype that shows the two things most agent apps need: tools that change real data, and retrieval over your own files.

<!-- TODO: add a screenshot or short GIF of a chat that logs an expense and answers from an uploaded file -->

## Quickstart

Requires Python 3.11+, an OpenAI API key, and a Google service account with access to one Google Sheet.

```bash
git clone https://github.com/dkmiller321/rental-ops-agent
cd rental-ops-agent
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then fill in the three values
chainlit run app.py              # http://localhost:8000
```

Google Sheet setup:

1. Create a sheet with a tab named `Expenses` and columns A:D as Date, Description, Amount, Category.
2. Create a Google service account, download its JSON key, and keep the file outside this repo.
3. Share the sheet with the service account's email address.
4. Put the sheet ID (the part of the URL between `/d/` and `/edit`) in `.env`.

## What to ask it

- "Log $483.64 for 'Two HVAC returns' on 2025-05-24, category HVAC."
- "Read Expenses!A1:D10."
- "Create a note titled 'AC Quote' that says '$4,500 for a 2.5 ton unit' and ingest it."
- "What did the AC Quote note say about price?"

You can also drag PDF, CSV, TXT or MD files into the chat. They are saved, indexed and searchable.

## Architecture

```
Chainlit UI ──> LangChain tool-calling agent (gpt-4o-mini)
                      |
        ┌─────────────┼──────────────────┐
        v             v                  v
  Google Sheets   File tools         RAG tools
  append, update, create, list,      ingest, query
  read ranges     delete             |
                      |              v
                  SQLite (files.db)  FAISS index (OpenAI embeddings)
```

Everything is in `app.py`. The agent has eight tools:

| Tool | What it does |
|---|---|
| `sheet_append_expense` | Adds an expense row to the sheet |
| `sheet_update_cell` | Updates one cell, such as `Expenses!C2` |
| `sheet_read_range` | Reads a range and returns it as JSON |
| `file_create_from_text` | Saves text as a file |
| `file_list` | Lists stored files |
| `file_delete` | Deletes a file |
| `rag_ingest_existing` | Re-indexes a stored file |
| `rag_query` | Searches the indexed documents |

Uploaded files go to `./uploads/`, their metadata to `files.db`, and the vector index to `./vector_index/`. All three are created at runtime and ignored by git.

## Tests

There are no automated tests yet. `python -m py_compile app.py` checks that the file parses.

## Known limits

- Deleting a file does not remove its chunks from the FAISS index. To rebuild, delete `./vector_index` and re-ingest.
- Single user, no login. Run it on your own machine.

## License

[MIT](LICENSE) © 2026 Donald Miller

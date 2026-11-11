import os
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any
import asyncio

import chainlit as cl
from langchain.agents import initialize_agent, AgentType, Tool
from langchain.tools import tool
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.document_loaders import (
    PyPDFLoader, CSVLoader, TextLoader, UnstructuredFileLoader
)
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from google.oauth2 import service_account
from googleapiclient.discovery import build
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Validate required environment variables
required_vars = ["OPENAI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "RENTAL_SHEET_ID"]
missing_vars = [var for var in required_vars if not os.getenv(var)]
if missing_vars:
    print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
    print("Please create a .env file with the required variables. See .env.example for reference.")
    exit(1)

# Create directories
Path("./uploads").mkdir(exist_ok=True)
Path("./vector_index").mkdir(exist_ok=True)

# Database setup
Base = declarative_base()

class FileRecord(Base):
    __tablename__ = 'files'
    
    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    path = Column(String(500), nullable=False)
    mime = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    meta = Column(Text)

engine = create_engine('sqlite:///files.db')
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)

# Google Sheets setup
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
credentials = service_account.Credentials.from_service_account_file(
    os.getenv('GOOGLE_APPLICATION_CREDENTIALS'), scopes=SCOPES
)
sheets_service = build('sheets', 'v4', credentials=credentials)
SHEET_ID = os.getenv('RENTAL_SHEET_ID')

# LLM and embeddings setup
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
embeddings = OpenAIEmbeddings()
text_splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=150)

# Vector store
vector_store = None
try:
    if Path("./vector_index").exists() and any(Path("./vector_index").iterdir()):
        vector_store = FAISS.load_local("./vector_index", embeddings, allow_dangerous_deserialization=True)
except:
    vector_store = None

def get_document_loader(file_path: str):
    """Get appropriate document loader based on file extension."""
    file_path = Path(file_path)
    extension = file_path.suffix.lower()
    
    if extension == '.pdf':
        return PyPDFLoader(str(file_path))
    elif extension == '.csv':
        return CSVLoader(str(file_path))
    elif extension in ['.txt', '.md']:
        return TextLoader(str(file_path))
    else:
        return UnstructuredFileLoader(str(file_path))

def ingest_file_to_vector_store(file_path: str, file_id: int):
    """Ingest a file into the vector store."""
    global vector_store
    
    try:
        loader = get_document_loader(file_path)
        documents = loader.load()
        
        # Add metadata
        for doc in documents:
            doc.metadata['file_id'] = file_id
            doc.metadata['source'] = file_path
        
        # Split documents
        texts = text_splitter.split_documents(documents)
        
        if vector_store is None:
            vector_store = FAISS.from_documents(texts, embeddings)
        else:
            vector_store.add_documents(texts)
        
        # Persist the vector store
        vector_store.save_local("./vector_index")
        return True
    except Exception as e:
        print(f"Error ingesting file {file_path}: {e}")
        return False

# LangChain Tools

@tool
def sheet_append_expense(date: str, description: str, amount: float, category: str = "General") -> str:
    """Appends an expense row to the Google Sheet."""
    try:
        # Validate amount is float
        amount = float(amount)
        
        values = [[date, description, amount, category]]
        body = {'values': values}
        
        result = sheets_service.spreadsheets().values().append(
            spreadsheetId=SHEET_ID,
            range='Expenses!A:D',
            valueInputOption='USER_ENTERED',
            body=body
        ).execute()
        
        return f"Successfully added expense: {description} (${amount}) on {date}, category: {category}"
    except Exception as e:
        return f"Error adding expense: {str(e)}"

@tool
def sheet_update_cell(a1_range: str, value: str) -> str:
    """Updates a single cell in the Google Sheet."""
    try:
        # Validate single cell (no colon)
        if ':' in a1_range:
            return "Error: Only single cell updates are supported. Use format like 'Expenses!C2'"
        
        body = {'values': [[value]]}
        
        result = sheets_service.spreadsheets().values().update(
            spreadsheetId=SHEET_ID,
            range=a1_range,
            valueInputOption='USER_ENTERED',
            body=body
        ).execute()
        
        return f"Successfully updated {a1_range} to: {value}"
    except Exception as e:
        return f"Error updating cell: {str(e)}"

@tool
def sheet_read_range(a1_range: str) -> str:
    """Reads a range from the Google Sheet and returns JSON."""
    try:
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range=a1_range
        ).execute()
        
        values = result.get('values', [])
        return json.dumps(values)
    except Exception as e:
        return f"Error reading range: {str(e)}"

@tool
def file_create_from_text(title: str, content: str, mime: str = "text/plain") -> str:
    """Creates a file from text content, saves it, and ingests into RAG."""
    try:
        session = Session()
        
        # Create file path
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{title.replace(' ', '_')}.txt"
        file_path = Path("./uploads") / filename
        
        # Write file
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Create DB record
        file_record = FileRecord(
            title=title,
            path=str(file_path),
            mime=mime,
            meta=json.dumps({"created_from": "text"})
        )
        session.add(file_record)
        session.commit()
        
        file_id = file_record.id
        session.close()
        
        # Ingest into vector store
        success = ingest_file_to_vector_store(str(file_path), file_id)
        
        if success:
            return f"Successfully created file '{title}' with ID {file_id} and ingested into RAG"
        else:
            return f"Created file '{title}' with ID {file_id} but failed to ingest into RAG"
    except Exception as e:
        return f"Error creating file: {str(e)}"

@tool
def file_list() -> str:
    """Lists all stored files as JSON."""
    try:
        session = Session()
        files = session.query(FileRecord).order_by(FileRecord.created_at.desc()).all()
        
        file_list = []
        for file in files:
            file_list.append({
                "id": file.id,
                "title": file.title,
                "path": file.path,
                "mime": file.mime,
                "created_at": file.created_at.isoformat()
            })
        
        session.close()
        return json.dumps(file_list)
    except Exception as e:
        return f"Error listing files: {str(e)}"

@tool
def file_delete(file_id: int) -> str:
    """Deletes a file from disk and database."""
    try:
        session = Session()
        file_record = session.query(FileRecord).filter(FileRecord.id == file_id).first()
        
        if not file_record:
            session.close()
            return f"File with ID {file_id} not found"
        
        # Delete file from disk
        file_path = Path(file_record.path)
        if file_path.exists():
            file_path.unlink()
        
        # Delete from database
        session.delete(file_record)
        session.commit()
        session.close()
        
        return f"Successfully deleted file '{file_record.title}' (ID: {file_id}). Note: FAISS per-document deletion not implemented in this minimal version."
    except Exception as e:
        return f"Error deleting file: {str(e)}"

@tool
def rag_ingest_existing(file_id: int) -> str:
    """Re-ingests an existing file into the vector store."""
    try:
        session = Session()
        file_record = session.query(FileRecord).filter(FileRecord.id == file_id).first()
        session.close()
        
        if not file_record:
            return f"File with ID {file_id} not found"
        
        success = ingest_file_to_vector_store(file_record.path, file_id)
        
        if success:
            return f"Successfully re-ingested file '{file_record.title}' (ID: {file_id})"
        else:
            return f"Failed to re-ingest file '{file_record.title}' (ID: {file_id})"
    except Exception as e:
        return f"Error re-ingesting file: {str(e)}"

@tool
def rag_query(question: str, k: int = 5) -> str:
    """Queries the RAG system for relevant information."""
    try:
        if vector_store is None:
            return "No documents have been ingested yet. Please upload some files first."
        
        docs = vector_store.similarity_search(question, k=k)
        
        results = []
        for doc in docs:
            content = doc.page_content[:500] + "..." if len(doc.page_content) > 500 else doc.page_content
            results.append({
                "content": content,
                "metadata": doc.metadata
            })
        
        return json.dumps(results)
    except Exception as e:
        return f"Error querying RAG: {str(e)}"

# Helper function to get files for sidebar
def get_files_for_sidebar():
    """Get files formatted for the sidebar display."""
    try:
        session = Session()
        files = session.query(FileRecord).order_by(FileRecord.created_at.desc()).all()
        
        file_list = []
        for file in files:
            file_list.append({
                "id": file.id,
                "title": file.title,
                "path": file.path,
                "mime": file.mime,
                "created_at": file.created_at.isoformat()
            })
        
        session.close()
        return file_list
    except Exception as e:
        print(f"Error getting files for sidebar: {e}")
        return []

# Create tools list
tools = [
    sheet_append_expense,
    sheet_update_cell,
    sheet_read_range,
    file_create_from_text,
    file_list,
    file_delete,
    rag_ingest_existing,
    rag_query
]

# System prompt
SYSTEM_PROMPT = """You are the "Rental Property Ops Agent."

For "log/add" expenses → parse $, ISO date YYYY-MM-DD, category fallback "General", then call sheet_append_expense.

For totals or monthly questions → prefer sheet_read_range first, then summarize.

For specific cell edits → sheet_update_cell.

For notes/receipts → file_create_from_text, then rag_ingest_existing.

For questions about uploaded files → rag_query.

Keep replies short; confirm after successful tool calls."""

# Helper functions for conversation history management
def estimate_tokens(text: str) -> int:
    """Rough estimation of token count (approximately 4 characters per token)."""
    return len(text) // 4

def format_conversation_history(history: List[Dict[str, str]]) -> str:
    """Format conversation history into a readable string."""
    if not history:
        return ""
    
    formatted_parts = ["Previous conversation:"]
    for exchange in history:
        formatted_parts.append(f"User: {exchange['user']}")
        formatted_parts.append(f"Assistant: {exchange['assistant']}")
    
    return "\n".join(formatted_parts)

def trim_conversation_history(history: List[Dict[str, str]], max_pairs: int, max_tokens: int) -> List[Dict[str, str]]:
    """Trim conversation history to stay within limits."""
    if not history:
        return history
    
    # First, limit by number of pairs
    if len(history) > max_pairs:
        history = history[-max_pairs:]
    
    # Then, limit by token count
    while history:
        formatted = format_conversation_history(history)
        if estimate_tokens(formatted) <= max_tokens:
            break
        # Remove oldest exchange
        history = history[1:]
    
    return history

def add_to_conversation_history(user_message: str, assistant_response: str):
    """Add a new exchange to the conversation history."""
    try:
        history = cl.user_session.get("conversation_history", [])
        max_pairs = cl.user_session.get("max_history_pairs", 10)
        max_tokens = cl.user_session.get("max_history_tokens", 3000)
        
        # Add new exchange
        history.append({
            "user": user_message,
            "assistant": assistant_response
        })
        
        # Trim if necessary
        history = trim_conversation_history(history, max_pairs, max_tokens)
        
        # Update session
        cl.user_session.set("conversation_history", history)
    except Exception as e:
        print(f"Error managing conversation history: {e}")

# Initialize agent
agent = initialize_agent(
    tools=tools,
    llm=llm,
    agent=AgentType.OPENAI_FUNCTIONS,
    verbose=True,
    handle_parsing_errors=True
)

@cl.on_chat_start
async def start():
    """Initialize the chat session."""
    # Initialize conversation history in session
    cl.user_session.set("conversation_history", [])
    cl.user_session.set("max_history_pairs", 10)  # Keep last 10 Q&A pairs
    cl.user_session.set("max_history_tokens", 3000)  # Approximate token limit for history
    
    # Get current files and inject them into the page for the sidebar
    current_files = get_files_for_sidebar()
    files_json = json.dumps(current_files)
    
    # Create JavaScript to initialize the sidebar with current files
    sidebar_script = f"""
    <script>
    // Store files in localStorage for sidebar access
    localStorage.setItem('chainlit_files', '{files_json}');
    
    // Function to update sidebar when files change
    window.updateSidebarFiles = function(files) {{
        localStorage.setItem('chainlit_files', JSON.stringify(files));
        if (window.fileSidebar) {{
            window.fileSidebar.updateFileList(files);
        }}
    }};
    </script>
    """
    
    welcome_message = f"""Welcome to the Rental Property Ops Agent! 🏠

Here are some example commands you can try:

• "Log $483.64 for 'Two HVAC returns (Walmart)' on 2025-05-24, category HVAC."
• "Set Expenses!D2 to HVAC."
• "Read Expenses!A1:D10."
• "Create a note titled 'AC Quote' that says '$4,500 for 2.5 ton unit from Cool Air' and ingest it."
• "List my files."
• "What did the 'AC Quote' note say about price?"

You can also drag and drop files to upload them for RAG queries!

I'll remember our conversation history to provide better context-aware responses.

{sidebar_script}"""
    
    await cl.Message(content=welcome_message).send()

@cl.on_message
async def main(message: cl.Message):
    """Handle incoming messages."""
    response_parts = []
    
    # Handle special sidebar commands (e.g., SIDEBAR_DELETE:<id>)
    if message.content and isinstance(message.content, str) and message.content.startswith("SIDEBAR_DELETE:"):
        try:
            file_id_str = message.content.split(":", 1)[1].strip()
            file_id = int(file_id_str)
            # Call the existing deletion function
            result = file_delete(file_id)
            
            # Prepare updated file list for sidebar update
            updated_files = get_files_for_sidebar()
            files_json = json.dumps(updated_files).replace("'", "\\'")
            sidebar_update_script = f"""
                    <script>
                    if (typeof window.updateSidebarFiles === 'function') {{
                        window.updateSidebarFiles({files_json});
                    }}
                    </script>
                    """
            response_parts.append(result)
            response_parts.append(sidebar_update_script)
        except Exception as e:
            response_parts.append(f"Error deleting file: {str(e)}")
        
        final_response = "\n\n".join(response_parts)
        add_to_conversation_history(message.content, final_response)
        await cl.Message(content=final_response).send()
        return
    
    # Handle file uploads
    if message.elements:
        for element in message.elements:
            if hasattr(element, 'path'):
                try:
                    session = Session()
                    
                    # Copy file to uploads directory
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = f"{timestamp}_{element.name}"
                    dest_path = Path("./uploads") / filename
                    
                    # Copy file content
                    with open(element.path, 'rb') as src, open(dest_path, 'wb') as dst:
                        dst.write(src.read())
                    
                    # Create DB record
                    file_record = FileRecord(
                        title=element.name,
                        path=str(dest_path),
                        mime=element.mime or "application/octet-stream",
                        meta=json.dumps({"uploaded": True})
                    )
                    session.add(file_record)
                    session.commit()
                    
                    file_id = file_record.id
                    session.close()
                    
                    # Ingest into vector store
                    success = ingest_file_to_vector_store(str(dest_path), file_id)
                    
                    if success:
                        response_parts.append(f"✅ Uploaded and ingested '{element.name}' (ID: {file_id})")
                    else:
                        response_parts.append(f"⚠️ Uploaded '{element.name}' (ID: {file_id}) but failed to ingest")
                    
                    # Update sidebar with new file list
                    updated_files = get_files_for_sidebar()
                    files_json = json.dumps(updated_files).replace("'", "\\'")
                    sidebar_update_script = f"""
                    <script>
                    if (typeof window.updateSidebarFiles === 'function') {{
                        window.updateSidebarFiles({files_json});
                    }}
                    </script>
                    """
                    response_parts.append(sidebar_update_script)
                        
                except Exception as e:
                    response_parts.append(f"❌ Failed to upload '{element.name}': {str(e)}")
    
    # Process the message with the agent
    try:
        # Get conversation history
        history = cl.user_session.get("conversation_history", [])
        
        # Format conversation context
        context_parts = [SYSTEM_PROMPT]
        
        if history:
            formatted_history = format_conversation_history(history)
            context_parts.append(formatted_history)
        
        context_parts.append(f"Current message: {message.content}")
        
        # Create full context message
        full_context = "\n\n".join(context_parts)
        
        # Run agent asynchronously with full context
        result = await asyncio.get_event_loop().run_in_executor(
            None, agent.run, full_context
        )
        
        response_parts.append(result)
        
        # Store this exchange in conversation history
        final_response = "\n\n".join(response_parts)
        add_to_conversation_history(message.content, final_response)
        
    except Exception as e:
        error_message = f"Error processing request: {str(e)}"
        response_parts.append(error_message)
        
        # Still store the exchange even if there was an error
        final_response = "\n\n".join(response_parts)
        add_to_conversation_history(message.content, final_response)
    
    # Send response
    final_response = "\n\n".join(response_parts)
    await cl.Message(content=final_response).send()

if __name__ == "__main__":
    print("Starting Rental Ops Agent...")
    print("Make sure your .env file is configured with the required variables.")
    print("Run with: chainlit run app.py")

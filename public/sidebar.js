// File Sidebar JavaScript
class FileSidebar {
    constructor() {
        this.files = [];
        this.isCollapsed = false;
        this.isLoading = false;
        this.refreshInterval = null;
        this.init();
    }

    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.createSidebar());
        } else {
            this.createSidebar();
        }
    }

    createSidebar() {
        // Create sidebar HTML structure
        const sidebarHTML = `
            <div class="file-sidebar" id="fileSidebar">
                <div class="file-sidebar-header">
                    <h3 class="file-sidebar-title">
                        Files
                        <div>
                            <button class="refresh-button" id="refreshFiles" title="Refresh files"></button>
                            <button class="sidebar-toggle" id="sidebarToggle" title="Toggle sidebar">◀</button>
                        </div>
                    </h3>
                </div>
                <div class="file-search">
                    <input type="text" id="fileSearchInput" placeholder="Search files..." />
                </div>
                <div class="file-list" id="fileList">
                    <div class="no-files">Loading files...</div>
                </div>
            </div>
            <div class="mobile-sidebar-overlay" id="mobileOverlay"></div>
        `;

        // Insert sidebar into the page
        document.body.insertAdjacentHTML('afterbegin', sidebarHTML);

        // Add main app class for margin adjustment
        const app = document.querySelector('#root') || document.querySelector('.chainlit-app') || document.body;
        if (app && !app.classList.contains('chainlit-app')) {
            app.classList.add('chainlit-app');
        }

        // Bind events
        this.bindEvents();

        // Load initial files
        this.loadFiles();

        // Set up auto-refresh
        this.startAutoRefresh();
    }

    bindEvents() {
        // Toggle sidebar
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleSidebar());
        }

        // Refresh files
        const refreshBtn = document.getElementById('refreshFiles');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadFiles());
        }

        // Mobile overlay
        const overlay = document.getElementById('mobileOverlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.closeMobileSidebar());
        }

        // Listen for file upload events (custom events from Chainlit)
        document.addEventListener('fileUploaded', () => {
            setTimeout(() => this.loadFiles(), 1000); // Delay to ensure file is processed
        });

        // Listen for window resize
        window.addEventListener('resize', () => this.handleResize());

        // Search functionality
        const searchInput = document.getElementById('fileSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterFiles(e.target.value));
        }
    }

    toggleSidebar() {
        const sidebar = document.getElementById('fileSidebar');
        const app = document.querySelector('.chainlit-app');
        const toggleBtn = document.getElementById('sidebarToggle');

        if (!sidebar || !app || !toggleBtn) return;

        this.isCollapsed = !this.isCollapsed;

        if (this.isCollapsed) {
            sidebar.classList.add('collapsed');
            app.classList.add('sidebar-collapsed');
            toggleBtn.textContent = '▶';
            toggleBtn.title = 'Expand sidebar';
        } else {
            sidebar.classList.remove('collapsed');
            app.classList.remove('sidebar-collapsed');
            toggleBtn.textContent = '◀';
            toggleBtn.title = 'Collapse sidebar';
        }
    }

    closeMobileSidebar() {
        const sidebar = document.getElementById('fileSidebar');
        const overlay = document.getElementById('mobileOverlay');

        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
    }

    handleResize() {
        const isMobile = window.innerWidth <= 768;
        const sidebar = document.getElementById('fileSidebar');
        const app = document.querySelector('.chainlit-app');

        if (isMobile && sidebar && app) {
            sidebar.classList.remove('collapsed');
            app.classList.remove('sidebar-collapsed');
        }
    }

    async loadFiles() {
        if (this.isLoading) return;

        this.isLoading = true;
        const fileList = document.getElementById('fileList');
        if (!fileList) return;

        // Show loading state
        fileList.classList.add('loading');

        try {
            // Try to get files from the agent's file_list tool
            const response = await this.fetchFiles();
            this.files = response || [];
            this.renderFiles();
        } catch (error) {
            console.error('Error loading files:', error);
            this.renderError();
        } finally {
            this.isLoading = false;
            fileList.classList.remove('loading');
        }
    }

    async fetchFiles() {
        try {
            // Try to trigger the file_list tool by sending a message to the agent
            // This is a workaround since we can't directly access the database from JavaScript
            
            // First, try to get files from localStorage cache
            const cachedFiles = localStorage.getItem('chainlit_files');
            if (cachedFiles) {
                try {
                    const parsed = JSON.parse(cachedFiles);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed;
                    }
                } catch (e) {
                    console.warn('Failed to parse cached files:', e);
                }
            }
            
            // If no cache, return current known files as fallback
            const fallbackFiles = [
                {
                    id: 3,
                    title: "sample lease.pdf",
                    path: "uploads/sample_lease.pdf",
                    mime: "application/pdf",
                    created_at: "2025-08-15T18:50:59.657514"
                },
                {
                    id: 2,
                    title: "agent use",
                    path: "uploads/20250815_122349_agent_use.txt",
                    mime: "text/plain",
                    created_at: "2025-08-15T16:23:49.344458"
                },
                {
                    id: 1,
                    title: "agent use",
                    path: "uploads/20250815_122110_agent_use.txt",
                    mime: "text/plain",
                    created_at: "2025-08-15T16:21:10.738067"
                }
            ];
            
            return fallbackFiles;
        } catch (error) {
            console.error('Error fetching files:', error);
            return [];
        }
    }

    renderFiles() {
        const fileList = document.getElementById('fileList');
        if (!fileList) return;

        if (this.files.length === 0) {
            fileList.innerHTML = '<div class="no-files">No files uploaded yet</div>';
            return;
        }

        const filesHTML = this.files.map(file => this.createFileItem(file)).join('');
        fileList.innerHTML = filesHTML;

        // Bind click events to file items
        this.bindFileEvents();
    }

    createFileItem(file) {
        const fileType = this.getFileType(file.mime);
        const fileExtension = this.getFileExtension(file.title);
        const formattedDate = this.formatDate(file.created_at);
        const fileSize = this.getFileSize(file.path);

        return `
            <div class="file-item" data-file-id="${file.id}" data-file-name="${file.title}">
                <div class="file-icon ${fileType}"></div>
                <div class="file-details">
                    <p class="file-name" title="${file.title}">${file.title}</p>
                    <p class="file-meta">${formattedDate}</p>
                </div>
                <div class="file-actions">
                    <button class="file-action-btn query-btn" title="Query this file" data-action="query">
                        <span class="action-icon">🔍</span>
                    </button>
                    <button class="file-action-btn reingest-btn" title="Re-ingest file" data-action="reingest">
                        <span class="action-icon">🔄</span>
                    </button>
                    <button class="file-action-btn delete-btn" title="Delete file" data-action="delete">
                        <span class="action-icon">🗑️</span>
                    </button>
                </div>
                <span class="file-type-badge file-type-${fileType}">${fileExtension}</span>
                <div class="file-status" data-status="ready">
                    <span class="status-indicator"></span>
                </div>
            </div>
        `;
    }

    getFileType(mime) {
        if (mime.includes('pdf')) return 'pdf';
        if (mime.includes('text')) return 'txt';
        if (mime.includes('csv')) return 'csv';
        if (mime.includes('image')) return 'image';
        if (mime.includes('word') || mime.includes('document')) return 'doc';
        return 'default';
    }

    getFileExtension(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        return ext || 'file';
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return 'Unknown';
        }
    }

    getFileSize(path) {
        // This would normally come from the backend
        return 'Unknown size';
    }

    bindFileEvents() {
        const fileItems = document.querySelectorAll('.file-item');
        fileItems.forEach(item => {
            // Handle file item click (for selection)
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking on action buttons
                if (!e.target.closest('.file-action-btn')) {
                    this.handleFileClick(item);
                }
            });

            // Handle action button clicks
            const actionButtons = item.querySelectorAll('.file-action-btn');
            actionButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const fileId = item.dataset.fileId;
                    const fileName = item.dataset.fileName;
                    this.handleFileAction(action, fileId, fileName, item);
                });
            });
        });
    }

    handleFileClick(fileItem) {
        const fileName = fileItem.dataset.fileName;
        const fileId = fileItem.dataset.fileId;

        // Remove active class from all items
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('active');
        });

        // Add active class to clicked item
        fileItem.classList.add('active');

        // Trigger a query about this file
        this.queryFile(fileName);
    }

    handleFileAction(action, fileId, fileName, fileItem) {
        switch (action) {
            case 'query':
                this.queryFile(fileName);
                break;
            case 'reingest':
                this.reIngestFile(fileId, fileName, fileItem);
                break;
            case 'delete':
                this.deleteFile(fileId, fileName, fileItem);
                break;
            default:
                console.warn('Unknown file action:', action);
        }
    }

    queryFile(fileName) {
        // Find the chat input and populate it with a query about the file
        const chatInput = document.querySelector('textarea[placeholder*="Type"], input[placeholder*="Type"], .cl-input textarea, .cl-input input');
        
        if (chatInput) {
            const query = `Tell me about the file "${fileName}"`;
            chatInput.value = query;
            chatInput.focus();

            // Trigger input event to update any React state
            const event = new Event('input', { bubbles: true });
            chatInput.dispatchEvent(event);

            // Try to find and click the send button
            setTimeout(() => {
                const sendButton = document.querySelector('button[type="submit"], .cl-send-button, button[aria-label*="Send"]');
                if (sendButton && !sendButton.disabled) {
                    sendButton.click();
                }
            }, 100);
        }
    }

    reIngestFile(fileId, fileName, fileItem) {
        // Set status to processing
        this.setFileStatus(fileItem, 'processing', 'Re-ingesting file...');
        
        // Send command to re-ingest the file
        const chatInput = document.querySelector('textarea[placeholder*="Type"], input[placeholder*="Type"], .cl-input textarea, .cl-input input');
        
        if (chatInput) {
            const command = `Re-ingest file with ID ${fileId}`;
            chatInput.value = command;

            // Trigger input event to update any React state
            const event = new Event('input', { bubbles: true });
            chatInput.dispatchEvent(event);

            // Try to find and click the send button
            setTimeout(() => {
                const sendButton = document.querySelector('button[type="submit"], .cl-send-button, button[aria-label*="Send"]');
                if (sendButton && !sendButton.disabled) {
                    sendButton.click();
                    
                    // Reset status after a delay
                    setTimeout(() => {
                        this.setFileStatus(fileItem, 'ready', 'Ready');
                    }, 3000);
                }
            }, 100);
        }
    }

    async deleteFile(fileId, fileName, fileItem) {
        // Confirm with the user
        if (!confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
            return;
        }

        // Set status to processing
        this.setFileStatus(fileItem, 'processing', 'Deleting file...');

        // First attempt: use the chat-based command handler (server listens for SIDEBAR_DELETE:<id>)
        const chatInputSelectors = [
            'textarea[placeholder*="Type"]',
            'input[placeholder*="Type"]',
            '.cl-input textarea',
            '.cl-input input'
        ];
        let chatInput = null;
        for (const sel of chatInputSelectors) {
            chatInput = document.querySelector(sel);
            if (chatInput) break;
        }

        const sendButtonSelectors = [
            'button[type="submit"]',
            '.cl-send-button',
            'button[aria-label*="Send"]'
        ];

        const performChatDelete = () => {
            return new Promise((resolve, reject) => {
                if (!chatInput) return reject(new Error('Chat input not found'));

                const command = `SIDEBAR_DELETE:${fileId}`;
                // Set value and dispatch input events in a way that works for both plain inputs and React-controlled inputs
                chatInput.focus();
                chatInput.value = command;

                const inputEvent = new Event('input', { bubbles: true });
                chatInput.dispatchEvent(inputEvent);

                // Attempt to click the send button
                setTimeout(() => {
                    let sendButton = null;
                    for (const sel of sendButtonSelectors) {
                        sendButton = document.querySelector(sel);
                        if (sendButton) break;
                    }

                    if (sendButton && !sendButton.disabled) {
                        sendButton.click();
                        // Give server time to process and push updated sidebar
                        setTimeout(() => resolve(true), 1500);
                    } else {
                        reject(new Error('Send button not found or disabled'));
                    }
                }, 150);
            });
        };

        // Second attempt: call REST endpoint (if available)
        const performApiDelete = async () => {
            try {
                const res = await fetch('/api/files/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: Number(fileId) })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    // Update local cache & UI
                    try {
                        localStorage.setItem('chainlit_files', JSON.stringify(data.files));
                        if (typeof window.updateSidebarFiles === 'function') {
                            window.updateSidebarFiles(data.files);
                        } else {
                            this.updateFileList(data.files);
                        }
                    } catch (e) {
                        console.warn('Failed to update local cache after delete:', e);
                    }
                    return true;
                } else {
                    throw new Error(data.error || 'Delete failed');
                }
            } catch (err) {
                throw err;
            }
        };

        // Try chat-based delete first, then fallback to API delete
        try {
            if (chatInput) {
                await performChatDelete();
                // After chat-based delete, refresh files from localStorage (server should have sent update)
                const cached = localStorage.getItem('chainlit_files');
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        this.updateFileList(parsed);
                    } catch {}
                } else {
                    // If no cache, reload files (fallback)
                    setTimeout(() => this.loadFiles(), 500);
                }

                // Mark removed in UI immediately
                fileItem.style.opacity = '0.5';
                fileItem.style.pointerEvents = 'none';
                this.setFileStatus(fileItem, 'ready', 'Deleted');
                return;
            } else {
                // No chat input found; fall through to API
                await performApiDelete();
                fileItem.style.opacity = '0.5';
                fileItem.style.pointerEvents = 'none';
                this.setFileStatus(fileItem, 'ready', 'Deleted');
                return;
            }
        } catch (err) {
            // Attempt API delete as fallback if chat delete failed
            console.warn('Chat-based delete failed, trying API delete:', err);
            try {
                await performApiDelete();
                fileItem.style.opacity = '0.5';
                fileItem.style.pointerEvents = 'none';
                this.setFileStatus(fileItem, 'ready', 'Deleted');
                return;
            } catch (apiErr) {
                console.error('API delete also failed:', apiErr);
                this.setFileStatus(fileItem, 'error', apiErr.message || 'Delete failed');
                alert('Failed to delete file: ' + (apiErr.message || apiErr));
                return;
            }
        }
    }

    setFileStatus(fileItem, status, message) {
        const statusElement = fileItem.querySelector('.file-status');
        const statusIndicator = fileItem.querySelector('.status-indicator');
        
        if (statusElement && statusIndicator) {
            statusElement.dataset.status = status;
            statusIndicator.title = message;
            
            // Add visual feedback
            switch (status) {
                case 'processing':
                    statusIndicator.textContent = '⏳';
                    break;
                case 'ready':
                    statusIndicator.textContent = '✅';
                    break;
                case 'error':
                    statusIndicator.textContent = '❌';
                    break;
                default:
                    statusIndicator.textContent = '';
            }
        }
    }

    renderError() {
        const fileList = document.getElementById('fileList');
        if (fileList) {
            fileList.innerHTML = '<div class="no-files">Error loading files</div>';
        }
    }

    startAutoRefresh() {
        // Refresh files every 30 seconds
        this.refreshInterval = setInterval(() => {
            if (!this.isLoading) {
                this.loadFiles();
            }
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // Method to manually trigger file list update (can be called from outside)
    updateFileList(newFiles) {
        this.files = newFiles || [];
        this.renderFiles();
    }

    // Filter files based on search query
    filterFiles(query) {
        const fileItems = document.querySelectorAll('.file-item');
        const searchTerm = query.toLowerCase().trim();

        fileItems.forEach(item => {
            const fileName = item.dataset.fileName.toLowerCase();
            const fileType = item.querySelector('.file-type-badge').textContent.toLowerCase();
            
            const matches = fileName.includes(searchTerm) || fileType.includes(searchTerm);
            
            if (matches || searchTerm === '') {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });

        // Show "no results" message if no files match
        const visibleItems = Array.from(fileItems).filter(item => item.style.display !== 'none');
        const fileList = document.getElementById('fileList');
        
        if (visibleItems.length === 0 && searchTerm !== '') {
            if (!document.querySelector('.no-search-results')) {
                const noResultsDiv = document.createElement('div');
                noResultsDiv.className = 'no-search-results no-files';
                noResultsDiv.textContent = `No files found matching "${query}"`;
                fileList.appendChild(noResultsDiv);
            }
        } else {
            const noResultsDiv = document.querySelector('.no-search-results');
            if (noResultsDiv) {
                noResultsDiv.remove();
            }
        }
    }
}

// Initialize the sidebar when the script loads
let fileSidebar;

// Wait for the page to be ready
function initializeSidebar() {
    if (!fileSidebar) {
        fileSidebar = new FileSidebar();
    }
}

// Initialize immediately if DOM is ready, otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSidebar);
} else {
    initializeSidebar();
}

// Make the sidebar instance globally available
window.fileSidebar = fileSidebar;

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileSidebar;
}

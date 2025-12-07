let isTranslating = false;
let currentSettings = null;
let currentTranslatingNotificationId = null; // Track current translating notification

// Load settings on start
loadSettings();

async function triggerTranslation(text, selection = null) {
  if (isTranslating) return;

  isTranslating = true;

  try {
    const settings = await getSettings();

    // Visual feedback ONLY (no notification)
    if (settings.enableVisualFeedback && selection && selection.rangeCount > 0) {
      highlightSelection(selection, 'translating');
    }

    const response = await chrome.runtime.sendMessage({
      action: "translate",
      text: text,
      targetLang: settings.targetLanguage,
      sourceLang: settings.sourceLanguage
    });

    if (response && response.success) {
      // Success feedback
      if (settings.enableVisualFeedback && selection) {
        highlightSelection(selection, 'success');
        setTimeout(() => clearHighlights(), 2000);
      }

      // Show success message
      let message = 'Translation copied to clipboard!';
      if (settings.targetLanguage === 'bn') {
        message = 'বাংলা অনুবাদ ক্লিপবোর্ডে কপি হয়েছে!';
      }
      showNotification(message, 'success');
    } else {
      showNotification(`Error: ${response?.error || 'Unknown error'}`, 'error');
      clearHighlights();
    }
  } catch (error) {
    console.error('Translation error:', error);
    showNotification('Translation failed. Please try again.', 'error');
    clearHighlights();
  } finally {
    isTranslating = false;
  }
}

// Highlight selected text
// Replace the existing highlightSelection function in content.js with this improved version
function highlightSelection(selection, state = 'normal') {
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();

  if (!selectedText) return;

  // Store original selection
  const originalStart = range.startContainer;
  const originalStartOffset = range.startOffset;
  const originalEnd = range.endContainer;
  const originalEndOffset = range.endOffset;

  try {
    // First, try to get bounding rect to determine if we can highlight
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      // Selection is likely collapsed or invalid
      throw new Error('Invalid selection');
    }

    // Check if selection crosses element boundaries
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // If selection is within the same text node, we can use surroundContents
    if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
      const span = document.createElement('span');
      span.className = `translation-highlight translation-highlight-${state}`;
      range.surroundContents(span);
    } else {
      // Complex selection crossing element boundaries - use a different approach
      highlightComplexSelection(range, state);
    }

    // Try to restore selection
    try {
      const newRange = document.createRange();
      newRange.setStart(originalStart, originalStartOffset);
      newRange.setEnd(originalEnd, originalEndOffset);

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(newRange);
    } catch (restoreError) {
      console.warn('Could not restore selection:', restoreError);
    }

  } catch (e) {
    console.warn('Could not highlight selection with surroundContents:', e);

    // Fallback: Use overlay highlighting
    createOverlayHighlight(range, state);
  }
}

// Helper function for complex selections
function highlightComplexSelection(range, state) {
  const selectedText = range.toString();
  if (!selectedText || selectedText.length > 5000) {
    // Too long or empty, use overlay instead
    createOverlayHighlight(range, state);
    return;
  }

  // Extract HTML content from range
  const fragment = range.cloneContents();
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(fragment.cloneNode(true));

  // Mark highlighted content
  const walker = document.createTreeWalker(
    tempDiv,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  const nodesToProcess = [];
  while (node = walker.nextNode()) {
    if (node.textContent.trim()) {
      nodesToProcess.push(node);
    }
  }

  // Process each text node
  nodesToProcess.forEach(textNode => {
    const span = document.createElement('span');
    span.className = `translation-highlight translation-highlight-${state}`;
    span.textContent = textNode.textContent;
    textNode.parentNode.replaceChild(span, textNode);
  });

  // Replace original content with highlighted version
  try {
    range.deleteContents();
    range.insertNode(tempDiv);
  } catch (error) {
    console.warn('Could not replace selection:', error);
    createOverlayHighlight(range, state);
  }
}

// Overlay highlighting (doesn't modify DOM)
function createOverlayHighlight(range, state) {
  const rects = range.getClientRects();
  if (rects.length === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'translation-highlight-overlay';
  overlay.style.cssText = `
    position: absolute;
    pointer-events: none;
    z-index: 10000;
    transition: all 0.3s;
    border-radius: 3px;
  `;

  // Set highlight color based on state
  if (state === 'translating') {
    overlay.style.background = 'rgba(255, 193, 7, 0.3)';
    overlay.style.border = '2px solid rgba(255, 193, 7, 0.5)';
  } else {
    overlay.style.background = 'rgba(66, 133, 244, 0.2)';
    overlay.style.border = '2px solid rgba(66, 133, 244, 0.3)';
  }

  // Create separate highlight for each rectangle
  rects.forEach(rect => {
    if (rect.width > 0 && rect.height > 0) {
      const highlight = overlay.cloneNode(true);
      highlight.style.top = `${rect.top + window.scrollY}px`;
      highlight.style.left = `${rect.left + window.scrollX}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;

      document.body.appendChild(highlight);

      // Auto-remove based on state
      setTimeout(() => {
        if (highlight.parentNode) {
          highlight.parentNode.removeChild(highlight);
        }
      }, state === 'translating' ? 2000 : 500);
    }
  });
}

// Also update the clearHighlights function to handle overlays
function clearHighlights() {
  // Clear DOM highlights
  document.querySelectorAll('.translation-highlight').forEach(el => {
    try {
      const parent = el.parentNode;
      if (parent) {
        // Replace span with its text content
        const textNode = document.createTextNode(el.textContent);
        parent.replaceChild(textNode, el);
      }
    } catch (e) {
      console.warn('Error clearing highlight:', e);
    }
  });

  // Clear overlay highlights
  document.querySelectorAll('.translation-highlight-overlay').forEach(el => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });
}

function clearHighlights() {
  document.querySelectorAll('.translation-highlight').forEach(el => {
    try {
      const parent = el.parentNode;
      if (parent) {
        // Replace span with its text content
        const textNode = document.createTextNode(el.textContent);
        parent.replaceChild(textNode, el);
      }
    } catch (e) {
      console.warn('Error clearing highlight:', e);
    }
  });

  // Clear overlay highlights
  document.querySelectorAll('.translation-highlight-overlay').forEach(el => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });
}

// Handle messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "highlightSelection":
      // Find and highlight the text on page
      highlightTextOnPage(request.text);
      break;

    case "showNotification":
      showNotification(request.message, request.type);
      break;

    case "copyToClipboard":
      // Copy text to clipboard
      copyTextToClipboard(request.text)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep message channel open
  }
});

// Function to copy text to clipboard
async function copyTextToClipboard(text) {
  try {
    // Try the modern Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    // Fallback for older browsers or restricted contexts
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (!successful) {
      throw new Error('Failed to copy text');
    }
  } catch (error) {
    throw new Error(`Clipboard copy failed: ${error.message}`);
  }
}

function highlightTextOnPage(text) {
  // Simple text search and highlight (for context menu)
  if (!text || text.length < 2) return;

  const bodyText = document.body.innerHTML;
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedText})`, 'gi');

  document.body.innerHTML = document.body.innerHTML.replace(
    regex,
    '<span class="translation-highlight translation-highlight-translating">$1</span>'
  );

  // Scroll to first occurrence
  const firstHighlight = document.querySelector('.translation-highlight');
  if (firstHighlight) {
    firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Remove highlights after 3 seconds
  setTimeout(() => {
    document.querySelectorAll('.translation-highlight').forEach(el => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
    });
  }, 3000);
}

// Notification system
let notificationCounter = 0;
const activeNotifications = new Set();

function showNotification(message, type = 'info') {
  const id = ++notificationCounter;

  // Remove old notifications
  document.querySelectorAll('.translation-notification').forEach(el => {
    if (el.dataset.id && !activeNotifications.has(parseInt(el.dataset.id))) {
      el.remove();
    }
  });

  // If showing a new notification and there's an existing translating notification, remove it
  if (type !== 'info' && currentTranslatingNotificationId) {
    removeNotification(currentTranslatingNotificationId);
    currentTranslatingNotificationId = null;
  }

  const notification = document.createElement('div');
  notification.className = `translation-notification`;
  notification.dataset.id = id;

  const styles = {
    success: { background: '#4CAF50', icon: '✓' },
    error: { background: '#f44336', icon: '✗' },
    info: { background: '#2196F3', icon: '⏳' },
    warning: { background: '#ff9800', icon: '⚠' }
  };

  const style = styles[type] || styles.info;

  notification.style.cssText = `
    position: fixed;
    top: 70px;
    right: 20px;
    background: ${style.background};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 1000000;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    max-width: 300px;
    word-wrap: break-word;
    animation: slideIn 0.3s ease;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1);
  `;

  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">${style.icon}</span>
      <span>${message}</span>
    </div>
  `;

  document.body.appendChild(notification);
  activeNotifications.add(id);

  // Info notifications (translating) should be removed when translation completes
  // Success/error notifications auto-remove after 3 seconds
  if (type === 'info') {
    // Store the ID for later removal
    currentTranslatingNotificationId = id;
  } else {
    setTimeout(() => removeNotification(id), 3000);
  }

  return id;
}

function removeNotification(id) {
  const notification = document.querySelector(`.translation-notification[data-id="${id}"]`);
  if (notification) {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => {
      notification.remove();
      activeNotifications.delete(id);

      // Clear the translating notification ID if it's the one being removed
      if (currentTranslatingNotificationId === id) {
        currentTranslatingNotificationId = null;
      }
    }, 300);
  }
}

// Add CSS animations
if (!document.querySelector('#notification-styles')) {
  const style = document.createElement('style');
  style.id = 'notification-styles';
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%) translateY(-20px);
        opacity: 0;
      }
      to {
        transform: translateX(0) translateY(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0) translateY(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%) translateY(-20px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

// Helper functions
async function getSettings() {
  if (!currentSettings) {
    currentSettings = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
    });
  }
  return currentSettings;
}

async function loadSettings() {
  currentSettings = await getSettings();

  // Update settings when changed
  chrome.storage.onChanged.addListener((changes) => {
    chrome.runtime.sendMessage({ action: "getSettings" }, (settings) => {
      currentSettings = settings;
    });
  });
}

// Keyboard shortcut (Alt+Q)
document.addEventListener('keydown', async (event) => {
  // Check for Alt key (Windows) or Option key (Mac)
  const isAltOrOption = event.altKey;

  // Check if 'q' key is pressed along with Alt/Option
  if (isAltOrOption && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      await triggerTranslation(selectedText, window.getSelection());
    }
  }
});
let clickCount = 0;
let clickTimer;
let lastSelectedText = '';
let lastSelectionTime = 0;
let isTranslating = false;
let currentSettings = null;

// Load settings on start
loadSettings();

// Mouse selection handling
document.addEventListener('mouseup', handleMouseUp);

async function handleMouseUp(event) {
  if (isTranslating) return;

  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (!selectedText) return;

  // Get current settings
  const settings = await getSettings();
  if (!settings.enableClickTranslation) return;

  const currentTime = Date.now();

  // Reset if selection changed or too much time passed
  if (selectedText !== lastSelectedText || (currentTime - lastSelectionTime) > 1000) {
    clickCount = 0;
  }

  lastSelectedText = selectedText;
  lastSelectionTime = currentTime;
  clickCount++;

  if (clickTimer) {
    clearTimeout(clickTimer);
  }

  clickTimer = setTimeout(async () => {
    if (clickCount === settings.clickCount) {
      await triggerTranslation(selectedText, selection);
    }
    clickCount = 0;
  }, 400);
}

async function triggerTranslation(text, selection = null) {
  if (isTranslating) return;

  isTranslating = true;

  try {
    const settings = await getSettings();

    // Visual feedback
    if (settings.enableVisualFeedback && selection && selection.rangeCount > 0) {
      highlightSelection(selection, 'translating');
    }

    // Show translating notification
    const translatingId = showNotification('Translating...', 'info');

    const response = await chrome.runtime.sendMessage({
      action: "translate",
      text: text,
      targetLang: settings.targetLanguage,
      sourceLang: settings.sourceLanguage
    });

    // Remove translating notification
    removeNotification(translatingId);

    if (response && response.success) {
      // Success feedback
      if (settings.enableVisualFeedback && selection) {
        highlightSelection(selection, 'success');
        setTimeout(() => clearHighlights(), 2000);
      }

      // Show success message
      let message = '✓ Translation copied to clipboard!';
      if (settings.targetLanguage === 'bn') {
        message = '✓ বাংলা অনুবাদ ক্লিপবোর্ডে কপি হয়েছে!';
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
function highlightSelection(selection, state = 'normal') {
  const range = selection.getRangeAt(0);
  const span = document.createElement('span');
  span.className = `translation-highlight translation-highlight-${state}`;

  try {
    range.surroundContents(span);
  } catch (e) {
    // If surroundContents fails, try alternative method
    const text = selection.toString();
    const newNode = document.createElement('span');
    newNode.className = `translation-highlight translation-highlight-${state}`;
    newNode.textContent = text;
    range.deleteContents();
    range.insertNode(newNode);
  }
}

function clearHighlights() {
  document.querySelectorAll('.translation-highlight').forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
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

  if (type !== 'info') {
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

// Keyboard shortcut (optional - Ctrl+Shift+T)
document.addEventListener('keydown', async (event) => {
  if (event.ctrlKey && event.shiftKey && event.key === 'T') {
    event.preventDefault();
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      await triggerTranslation(selectedText, window.getSelection());
    }
  }
});